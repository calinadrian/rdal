// AtlasLoot-style browser over the imported Dragonwilds database.
const $ = (sel) => document.querySelector(sel);

// Small DOM builder; all wiki text goes through textContent.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  if (attrs.onclick && !['button', 'a', 'input', 'select', 'summary'].includes(tag)) {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.addEventListener('keydown', event => {
      if (event.target === el && ['Enter', ' '].includes(event.key)) { event.preventDefault(); el.click(); }
    });
  }
  return el;
}

let db = null;
let E = {}; // entities by name
const state = { module: 'zones', listSel: null, view: null, detail: null, filter: '' };
// Quest log sections that are open: In progress and Ready to start until you fold or open others.
let questGroupsOpen = new Set(Preferences.json('questGroups', ['active', 'available']));
let questHubScroll = 0;
const armourChoices = Preferences.json('armourChoices', {});
const isJournalView = () => ['journal', 'armourset'].includes(state.view?.type);
const armourSet = id => db?.armourSets?.find(s => s.id === id);
function journalStart(category) {
  const n = category.groups[0].items[0];
  return category.name === 'Armour & Shields' && E[n]?.armourSet
    ? { type: 'armourset', arg: E[n].armourSet } : { type: 'journal', arg: n };
}

function itemLearningState(e) {
  if(e.availability?.status==='unavailable')return 'unavailable';
  const recipes=e.recipes.filter(r=>!r.facility?.startsWith('Vendor: '));
  if(!recipes.length)return null;
  const states=recipes.map(r=>RecipeKnowledge.status(r.id));
  return states.includes('learned') ? 'learned' : states.every(s=>s==='not-learned') ? 'not-learned' : 'unknown';
}
function learningTag(status,compact=false) {
  if(!status || (compact && status==='unknown'))return null;
  if(status==='unavailable')return h('span',{class:'learning-tag learning-unavailable',title:'Unavailable in the live game; see How to obtain for details.'},'Unavailable');
  const summary=RecipeKnowledge.summary();
  const label={learned:'Learned','not-learned':'Unlearned',unknown:'Learning status unknown'}[status]+(summary.known&&!summary.live ? ' · saved' : '');
  const source=summary.live ? 'Current character · live game data' : summary.known ? 'Last read character · saved game data' : 'Waiting for your character’s recipe progress';
  return h('span',{class:`learning-tag learning-${status}`,title:source+(summary.at ? ' · '+new Date(summary.at).toLocaleString() : '')},label);
}
function recipeProgressNote(e) {
  if (!e.recipes.some(r => !r.facility?.startsWith('Vendor: '))) return null;
  const summary = RecipeKnowledge.summary();
  return !summary.live ? h('p', { class: 'progress-context muted small' }, summary.known
    ? `Saved progress · last updated ${new Date(summary.at).toLocaleString()}`
    : 'Learning status unknown · load your character to read recipe progress.') : null;
}
function journalDescription(e) {
  return e.desc ? h('details', { class: 'journal-description' }, h('summary', {}, 'Read description'), h('p', { class: 'desc' }, e.desc)) : null;
}
function setLearningTag(set) {
  const states=armourSetSummary(set).pieces.map(p=>itemLearningState(p.item)).filter(s=>s && s!=='unavailable');
  if(!states.length || states.includes('unknown'))return null;
  const learned=states.filter(s=>s==='learned').length;
  const tag=learningTag(learned===states.length ? 'learned' : 'not-learned');
  tag.textContent=`Learned ${learned}/${states.length}${RecipeKnowledge.summary().live ? '' : ' · saved'}`;
  return tag;
}
const history = [];
let searchOrigin = null;
let searchTimer;
const wish = new Set(Preferences.json('wishlist', []));
const saveWish = () => Preferences.setJSON('wishlist', [...wish]);

const byName = (a, b) => a.localeCompare(b);
const ent = (name) => E[name]?.kind === 'quest' ? questVersion(E[name]) : E[name] || { name, kind: 'item', droppedBy: [], recipes: [], usedIn: [], drops: [], shops: [], location: [] };

function rarityClass(pct, text) {
  if (pct == null) return /always/i.test(text || '') ? 'r-always' : 'r-unknown';
  if (pct >= 100) return 'r-always';
  if (pct >= 25) return 'r-common';
  if (pct >= 5) return 'r-uncommon';
  if (pct >= 1) return 'r-rare';
  return 'r-epic';
}
// Best (highest) chance of getting an item, used to colour item names.
function itemClass(name) {
  const e = ent(name);
  const pcts = e.droppedBy.map((s) => s.pct).filter((p) => p != null);
  if (!pcts.length) return e.recipes.length ? 'r-always' : 'r-unknown';
  return rarityClass(Math.max(...pcts));
}

/* ---------- Creature pictures: the game's own journal art (World → Fauna / Factions), in data/journal ---------- */

function icon(name, size = '') {
  const e = ent(name);
  const fallback = () => e.kind === 'monster'
    ? h('img', { class: `icon ${size}`, src: '../../data/mapicons/T_Map_Icon_Animal.png', alt: '', title: 'No journal picture for this creature' })
    : h('span', { class: `icon ${size}` }, (name || '?')[0]);
  if (e.kind === 'monster' && e.image) {
    const img = h('img', { class: `icon creature-art ${size}`, src: '../../data/' + e.image, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    return img;
  }
  if (!e.icon) return fallback();
  const src = /^https?:/.test(e.icon) ? e.icon : '../../data/' + e.icon;
  const img = h('img', { class: `icon ${size}`, src, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

/* ---------- Navigation ---------- */

function snapshot() {
  return { module: state.module, listSel: state.listSel, view: state.view, detail: state.detail,
    filter: state.filter, search: $('#search').value,
    scroll: Object.fromEntries(['list', 'content', 'detail'].map(id => [id, $('#' + id).scrollTop])),
    mapContext: mapReady && state.module === 'map' ? MapView.navigation() : null };
}
// Not while the app stands in for the game's map: the page you had open is what the app comes back to.
function saveNavigation() { if (!gameMapReturn) Preferences.setJSON('navigation', { ...snapshot(), filter: state.filter }); }
let gameMapReturn = null; // your page in the app while it covers the game's map
function go(view, { detail, push = true } = {}) {
  clearTimeout(searchTimer);
  if (push) history.push(snapshot());
  state.view = view;
  if (detail !== undefined) state.detail = detail;
  render();
  $('#content').scrollTop = 0;
  $('#detail').scrollTop = 0;
}
function navigateTo(module, view, { detail = null, filter = '', listSel = null } = {}) {
  history.push(snapshot());
  Object.assign(state, { module, filter, listSel });
  selectedDiscoveryMarker = null;
  setMapMode(module === 'map');
  go(view, { detail, push: false });
}
function showItem(name, { push = true } = {}) {
  const changed = state.detail !== name;
  if (selectedQuestMarker && selectedQuestMarker.ref !== name) selectedQuestMarker = null;
  if (changed && state.module === 'quests' && !state.detail) questHubScroll = $('#content').scrollTop;
  if (state.module === 'crafting' && isJournalView()) {
    go({ type: 'journal', arg: name }, { detail: name, push });
    return;
  }
  selectedDiscoveryMarker = null;
  if (push && state.detail !== name) history.push(snapshot());
  state.detail = name;
  saveNavigation();
  if (state.module === 'quests') renderList();
  renderDetail();
  renderContent(); // refresh selection highlight
  if (changed) {
    $('#detail').scrollTop = 0;
    if (state.module === 'quests') { const heading = $('#detail h1'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
  }
}
function back() {
  const s = history.pop();
  if (!s) return;
  restoreNavigation(s);
}
function restoreNavigation(s) {
  clearTimeout(searchTimer);
  Object.assign(state, { module: s.module, listSel: s.listSel, view: s.view, detail: s.detail, filter: s.filter || '' });
  $('#search').value = s.search ?? (s.view?.type === 'search' ? s.view.arg : '');
  selectedDiscoveryMarker = null;
  selectedQuestMarker = null;
  setMapMode(state.module === 'map');
  render();
  if (s.mapContext && mapReady && state.module === 'map') {
    MapView.restoreNavigation(s.mapContext);
    syncMapHighlight();
  }
  for (const [id, top] of Object.entries(s.scroll || {})) $('#' + id).scrollTop = top;
}
function closeDetail() {
  const scroll = state.module === 'quests' && state.detail ? questHubScroll : $('#content').scrollTop;
  state.detail = null;
  selectedDiscoveryMarker = null;
  selectedQuestMarker = null;
  renderDetail(); renderContent(); if (state.module === 'quests') renderList(); saveNavigation();
  $('#content').scrollTop = scroll;
  (document.body.classList.contains('map-mode') ? $('#map-navigation button') : $('#content .content-back'))?.focus({ preventScroll: true });
}
function selectModule(id) {
  clearTimeout(searchTimer);
  searchOrigin = null;
  history.push(snapshot());
  Object.assign(state, { module: id, filter: '', listSel: null, view: null, detail: null });
  selectedDiscoveryMarker = null;
  selectedQuestMarker = null;
  $('#search').value = '';
  setMapMode(id === 'map');
  if (id === 'quests') state.view = { type: 'questlog', arg: '' };
  if (id === 'wishlist') state.view = { type: 'wishlist', arg: '' };
  if (id === 'crafting' && db?.journal?.categories?.length) {
    const category = db.journal.categories[0];
    state.listSel = category.id; state.view = journalStart(category);
  }
  render();
  for (const id of ['list', 'content', 'detail']) $('#' + id).scrollTop = 0;
}
function navigationBar() {
  const module = MODULES.find(m => m.id === state.module);
  const view = state.view;
  const label = state.module === 'map' ? (mapReady ? MapView.layer()?.name || 'World map' : 'World map')
    : view?.type === 'search' ? `Search: ${view.arg}` : view?.type === 'armourset' ? armourSet(view.arg)?.name
    : view?.arg || ({ questlog: 'Quest journal', questchain: 'Quest order' }[view?.type]);
  const detailLabel = state.module === 'map' && selectedQuestMarker?.ref === state.detail && selectedQuestMarker.target ? selectedQuestMarker.target : state.detail;
  const crumbs = h('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' },
    h('button', { type: 'button', onclick: () => selectModule(state.module) }, module?.label || 'AtlasLoot'));
  if (label) crumbs.append(h('span', { 'aria-hidden': true }, '›'),
    detailLabel && detailLabel !== label ? h('button', { type: 'button', onclick: closeDetail }, label) : h('span', { 'aria-current': 'page' }, label));
  if (detailLabel && detailLabel !== label) crumbs.append(h('span', { 'aria-hidden': true }, '›'), h('span', { 'aria-current': 'page' }, detailLabel));
  return h('div', { class: 'content-navigation' },
    h('button', { type: 'button', class: 'content-back', disabled: !history.length, onclick: back, title: 'Back (Alt+Left)' }, 'Back'), crumbs);
}
function renderNavigation() {
  $('#btn-back').disabled = !history.length;
  $('#search-clear').hidden = !$('#search').value;
  document.body.classList.toggle('search-active', !!$('#search').value);
  $('#content .content-navigation')?.remove();
  if (!document.body.classList.contains('map-mode')) $('#content').prepend(navigationBar());
  $('#map-navigation').replaceChildren(navigationBar());
  $('#detail .detail-navigation')?.replaceChildren(navigationBar());
}
// Open whatever a name refers to: monsters/containers in the middle, items in the detail panel.
function open(name) {
  const e = ent(name);
  if (state.module === 'map') return showItem(e.name);
  if (e.kind === 'monster' || (e.drops && e.drops.length)) go({ type: 'source', arg: e.name });
  else showItem(e.name);
}

/* ---------- Map ---------- */

let mapReady = false;
let selectedQuestMarker = null;
let selectedDiscoveryMarker = null;
const savedQuestMapFilter = Preferences.json('questMapFilter', {});
let questMapMode = ['all', 'selected', 'active'].includes(savedQuestMapFilter.mode) ? savedQuestMapFilter.mode : 'all';
let questMapStepMode = savedQuestMapFilter.steps === 'current' ? 'current' : 'all';
const selectedMapQuests = new Set(Array.isArray(savedQuestMapFilter.selected) ? savedQuestMapFilter.selected.filter(n => typeof n === 'string') : []);
function saveQuestMapFilter() {
  Preferences.setJSON('questMapFilter', { mode: questMapMode, selected: [...selectedMapQuests], steps: questMapStepMode });
  MapView.redraw(); refreshQuestMapHighlight(); renderQuestMapFilter();
  updateMapFilterCount();
}
let liveCreatures = [];
// null means all types; an empty Set means none. Migrate the old single selection.
let liveCreaturePool = null;
try {
  const saved = Preferences.get('liveCreaturePool');
  if (saved !== null) {
    const names = JSON.parse(saved);
    if (Array.isArray(names)) liveCreaturePool = new Set(names.filter(n => typeof n === 'string'));
  } else {
    const previous = Preferences.get('liveCreatureFilter');
    if (previous) liveCreaturePool = new Set([previous]);
  }
} catch {}
function saveCreaturePool() {
  Preferences.setJSON('liveCreaturePool', liveCreaturePool === null ? null : [...liveCreaturePool]);
  renderLiveCreatures();
  updateMapFilterCount();
}

function creaturePoolDropdown() {
  const all = h('input', { type: 'checkbox', id: 'live-creature-all', onchange: ev => {
    liveCreaturePool = ev.target.checked ? null : new Set(); saveCreaturePool();
  } });
  const search = h('input', { type: 'search', placeholder: 'Find a creature…', 'aria-label': 'Find a creature type', oninput: filterCreatureChoices });
  const dropdown = h('details', { id: 'live-creature-filter', class: 'live-creature-filter' },
    h('summary', { 'aria-label': 'Choose live creature types' }, 'All creatures'),
    h('div', { class: 'creature-pool-menu' },
      h('div', { class: 'creature-pool-actions' }, h('label', {}, all, 'All creatures'),
        h('button', { type: 'button', onclick: () => { liveCreaturePool = new Set(); saveCreaturePool(); } }, 'Clear')),
      search, h('div', { class: 'creature-pool-options' }), h('p', { class: 'muted small creature-pool-empty', hidden: true }, 'No matching creatures')));
  dropdown.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { dropdown.open = false; dropdown.querySelector('summary').focus(); }
  });
  return dropdown;
}
document.addEventListener('pointerdown', ev => {
  for (const selector of ['#live-creature-filter', '#quest-map-picker', ...MapView.resourceCategories().map(c => `#resource-filter-${c}`)]) {
    const dropdown = $(selector);
    if (dropdown && !dropdown.contains(ev.target)) dropdown.open = false;
  }
});
function filterCreatureChoices() {
  const dropdown = $('#live-creature-filter');
  if (!dropdown) return;
  const query = dropdown.querySelector('input[type="search"]').value.trim().toLowerCase();
  let matches = 0;
  for (const label of dropdown.querySelectorAll('.creature-pool-options label')) {
    label.hidden = !label.textContent.toLowerCase().includes(query);
    if (!label.hidden) matches++;
  }
  dropdown.querySelector('.creature-pool-empty').hidden = matches > 0;
}
function syncDungeonMapChrome(d = MapView.layer()) {
  const dungeon = !!d && document.body.classList.contains('map-mode');
  document.body.classList.toggle('dungeon-map', dungeon);
  // Over the game's map the filters only open with Customize (and that is not remembered).
  const open = document.body.classList.contains('game-map') ? document.body.classList.contains('game-map-customize')
    : Preferences.get(dungeon ? 'dungeonFiltersOpen' : 'worldFiltersOpen') === '1';
  $('#map-legend').hidden = !open;
  const filters = $('#map-filters');
  filters.hidden = false;
  filters.setAttribute('aria-expanded', String(open));
  filters.classList.toggle('on', open);
  updateMapFilterCount();
}

// What the game map shows, in one click: each view sets the map's categories and quest steps (saved like any filter),
// and the full filters stay one click away under Customize. Shows which view the current filters match, if any.
const MAP_VIEWS = {
  quests: { categories: ['quest', 'travel'], steps: 'current' },
  explore: { categories: ['travel', 'shrine', 'lore', 'chest', 'agility', 'recipe', 'vent'], steps: 'all' },
  gather: { categories: ['travel', 'ore', 'gather', 'tree', 'fishing', 'salvage'], steps: 'all' },
  all: { categories: null, steps: 'all' }, // every category and live creatures
};
const mapFilterIds = () => [...db.map.categories.map(c => c.id), 'npc'];
const viewCategories = id => MAP_VIEWS[id].categories || mapFilterIds();
function mapViewNow() {
  const on = mapFilterIds().filter(id => MapView.isEnabled(id)).sort().join();
  return Object.keys(MAP_VIEWS).find(id => viewCategories(id).slice().sort().join() === on
    && questMapMode === 'all' && questMapStepMode === MAP_VIEWS[id].steps) || null;
}
function setMapView(id) {
  const cats = viewCategories(id);
  for (const c of mapFilterIds()) MapView.setEnabled(c, cats.includes(c));
  questMapMode = 'all'; questMapStepMode = MAP_VIEWS[id].steps;
  MapView.setHighlight(null); syncMapHighlight();
  saveQuestMapFilter(); renderLegend();
}
function renderMapViews() {
  if (!db?.map || !mapReady) return;
  const now = mapViewNow();
  for (const b of document.querySelectorAll('.game-map-views [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === now));
  const customize = $('#game-map-customize');
  const open = document.body.classList.contains('game-map-customize');
  customize.setAttribute('aria-expanded', String(open));
  customize.classList.toggle('on', open || !now);
  customize.textContent = now ? 'Customize' : 'Custom';
}

function updateMapFilterCount() {
  if (!db?.map || !mapReady) return;
  renderMapViews();
  const defaults = MapView.defaultCategories();
  const count = [...db.map.categories.map(c => c.id), 'npc'].filter(id => MapView.isEnabled(id) !== defaults.includes(id)).length
    + Number(liveCreaturePool !== null) + Number(questMapMode !== 'all') + Number(questMapStepMode !== 'all')
    + Number(Preferences.json('ventTypes', null) !== null)
    + MapView.resourceCategories().filter(c => MapView.isResourceFiltered(c)).length
    + ['lore', 'shrine'].filter(id => MapDiscovery.mode(id) !== 'all').length;
  $('#map-filters').textContent = count ? `Filters (${count})` : 'Filters';
  $('#map-filters').title = count ? `${count} filter settings differ from defaults` : 'Show map filters';
}
function resetMapFilters() {
  const defaults = MapView.defaultCategories();
  for (const id of [...db.map.categories.map(c => c.id), 'npc']) MapView.setEnabled(id, defaults.includes(id));
  MapView.setVentTypes(null);
  for (const c of MapView.resourceCategories()) MapView.setResourceTypes(c, null);
  liveCreaturePool = null; saveCreaturePool();
  questMapMode = 'all'; questMapStepMode = 'all'; selectedMapQuests.clear(); saveQuestMapFilter();
  for (const id of ['lore', 'shrine']) MapDiscovery.setMode(id, 'all');
  MapView.setHighlight(null); syncMapHighlight(); MapView.redraw();
  renderLegend(); updateMapFilterCount();
}

// The map is set up when it first opens, or at start when the minimap needs its filters and tracked quests.
function initMap() {
  if (!db?.map || mapReady) return;
  mapReady = true;
  MapView.init($('#map'), db.map, (m) => {
    if (m.enter) { history.push(snapshot()); MapView.setLayer(db.map.dungeons.find(d => d.id === m.enter)); renderNavigation(); return; }
    selectedQuestMarker = m.c === 'quest' ? m : null;
    selectedDiscoveryMarker = ['lore', 'shrine'].includes(m.c) ? m : null;
    if (selectedDiscoveryMarker) renderDetail();
    // A tracked spawn or source opens the quest it is tracked for; quest markers open their own quest.
    else if (MapView.trackedEntry(m) && m.c !== 'quest') showItem(MapView.trackedEntry(m).quest);
    else if (m.ref) showItem(m.ref);
  });
  MapView.setTracked(trackedMapEntries());
  MapView.setQuestStatus((name) => questStatus(ent(name)));
  MapView.setQuestInfo(questMarkerInfo);
  MapView.setQuestVisibility(questMapMarkerVisible);
  MapView.onVisibilityChange(summary => {
    const box = $('#map-empty');
    box.hidden = !!summary.visible;
    if (!summary.visible) box.replaceChildren(h('p', {}, summary.reason),
      h('button', { type: 'button', onclick: resetMapFilters }, 'Reset filters'),
      h('button', { type: 'button', onclick: () => MapView.fit(false) }, 'Fit map'));
    updateMapFilterCount();
  });
  // Follow is a remembered toggle: the button shows its state, and it is restored next time.
  MapView.onFollowChange((on) => {
    $('#map-follow').classList.toggle('on', on);
    Preferences.set('mapFollow', on ? '1' : '0');
  });
  // Map picker: the world or one of the dungeons. It follows the player through dungeon doors.
  const picker = $('#map-layer');
  picker.replaceChildren(h('option', { value: '' }, 'World map'),
    ...(db.map.dungeons || []).slice().sort((a, b) => byName(a.name, b.name)).map(d => h('option', { value: d.id }, d.name)));
  picker.hidden = false;
  picker.onchange = () => { history.push(snapshot()); MapView.setLayer(db.map.dungeons.find(d => d.id === picker.value)); renderNavigation(); };
  const levels = $('#map-level');
  new ResizeObserver(() => {
    const tools = $('.map-tools');
    $('#mapview').style.setProperty('--map-controls-bottom', `${tools.offsetTop + tools.offsetHeight + 12}px`);
  }).observe($('.map-tools'));
  levels.onchange = () => { history.push(snapshot()); MapView.setLayer(MapView.layer(), +levels.value); renderNavigation(); };
  for (const b of document.querySelectorAll('.game-map-views [data-view]')) b.onclick = () => setMapView(b.dataset.view);
  $('#game-map-customize').onclick = () => { document.body.classList.toggle('game-map-customize'); syncDungeonMapChrome(); };
  $('#map-center').onclick = () => MapView.centerOnPlayer(0.5);
  $('#map-filters').onclick = () => {
    Preferences.set(MapView.layer() ? 'dungeonFiltersOpen' : 'worldFiltersOpen', $('#map-legend').hidden ? '1' : '0');
    syncDungeonMapChrome();
    requestAnimationFrame(() => MapView.fit(false));
  };
  MapView.onLayerChange((d, level) => {
    syncDungeonMapChrome(d);
    picker.value = d?.id || '';
    const count = d?.levels?.length || 0;
    levels.hidden = count < 2;
    $('#map-level-label').hidden = count < 2;
    $('#map-level-key').hidden = count < 2 || level < 0;
    levels.replaceChildren(...(d?.overview ? [h('option', { value: -1 }, 'All floors')] : []), ...Array.from({ length: count }, (_, i) =>
      h('option', { value: i }, i === 0 ? 'Level 1 (lowest)' : i === count - 1 ? `Level ${i + 1} (top)` : `Level ${i + 1}`)));
    levels.value = level;
    renderNavigation();
  });
  let saved = null;
  saved = Preferences.get('mapFollow');
  if (saved === '1') MapView.setFollow(true, { restore: true });
  renderLegend();
}

function setMapMode(on) {
  if (on) document.body.classList.remove('journal-mode');
  const changed = document.body.classList.contains('map-mode') !== on;
  document.body.classList.toggle('map-mode', on);
  $('#mapview').hidden = !on;
  if (on) initMap();
  syncDungeonMapChrome();
  if (on) MapView.resize();
  if (changed && db) { renderContent(); renderDetail(); }
  saveNavigation();
}

function questMapControls() {
  const mode = h('select', { 'aria-label': 'Display quests', onchange: ev => {
    questMapMode = ev.target.value; saveQuestMapFilter();
  } }, h('option', { value: 'all' }, 'All quests'), h('option', { value: 'selected' }, 'Selected quests'),
    h('option', { value: 'active' }, 'My active quests'));
  mode.value = questMapMode;
  const steps = h('select', { id: 'quest-map-steps', 'aria-label': 'Quest steps', onchange: ev => {
    questMapStepMode = ev.target.value; saveQuestMapFilter();
  } }, h('option', { value: 'all' }, 'All steps'), h('option', { value: 'current' }, 'Current step only'));
  steps.value = questMapStepMode;
  const search = h('input', { type: 'search', placeholder: 'Find a quest…', 'aria-label': 'Find a quest to display',
    oninput: filterQuestMapChoices });
  const names = [...new Set(db.map.markers.filter(m => m.c === 'quest' && E[m.ref]?.kind === 'quest').map(m => m.ref))].sort(byName);
  const picker = h('details', { id: 'quest-map-picker', class: 'live-creature-filter', hidden: questMapMode !== 'selected' },
    h('summary', {}, 'Choose quests'), h('div', { class: 'creature-pool-menu' },
      h('div', { class: 'creature-pool-actions' },
        h('button', { type: 'button', onclick: () => { for (const n of names) selectedMapQuests.add(n); saveQuestMapFilter(); } }, 'Select all'),
        h('button', { type: 'button', onclick: () => { selectedMapQuests.clear(); saveQuestMapFilter(); } }, 'Clear')),
      search, h('div', { class: 'creature-pool-options quest-map-options' }, names.map(name => h('label', { 'data-quest': name },
        h('input', { type: 'checkbox', checked: selectedMapQuests.has(name), onchange: ev => {
          ev.target.checked ? selectedMapQuests.add(name) : selectedMapQuests.delete(name); saveQuestMapFilter();
        } }), h('span', {}, name), h('span', { class: 'small muted quest-map-status' })))),
      h('p', { class: 'small muted quest-map-empty', hidden: true }, 'No matching quests')));
  picker.addEventListener('keydown', ev => { if (ev.key === 'Escape') { picker.open = false; picker.querySelector('summary').focus(); } });
  return h('div', { id: 'quest-map-filter', class: 'discovery-filter', hidden: !MapView.isEnabled('quest') },
    h('label', {}, h('span', { class: 'small muted' }, 'Show'), mode),
    h('label', {}, h('span', { class: 'small muted' }, 'Steps'), steps),
    h('div', { class: 'small muted quest-step-note', hidden: questMapStepMode !== 'current' }, 'Current objectives and quest pickups. Unconfirmed steps stay hidden.'), picker,
    h('div', { class: 'small muted quest-map-progress' }));
}

function filterQuestMapChoices() {
  const picker = $('#quest-map-picker');
  if (!picker) return;
  const query = picker.querySelector('input[type=search]').value.trim().toLowerCase();
  let matches = 0;
  for (const row of picker.querySelectorAll('[data-quest]')) {
    row.hidden = !row.dataset.quest.toLowerCase().includes(query);
    if (!row.hidden) matches++;
  }
  picker.querySelector('.quest-map-empty').hidden = matches > 0;
}

function renderQuestMapFilter() {
  const control = $('#quest-map-filter');
  if (!control || !db?.map) return;
  control.querySelector('select').value = questMapMode;
  $('#quest-map-steps').value = questMapStepMode;
  control.querySelector('.quest-step-note').hidden = questMapStepMode !== 'current';
  const picker = $('#quest-map-picker');
  picker.hidden = questMapMode !== 'selected';
  let selected = 0;
  for (const row of picker.querySelectorAll('[data-quest]')) {
    const checked = selectedMapQuests.has(row.dataset.quest);
    row.querySelector('input').checked = checked;
    if (checked) selected++;
    const status = QUEST_STATES.find(s => s.id === questStatus(ent(row.dataset.quest)));
    row.querySelector('.quest-map-status').textContent = status.label;
  }
  picker.querySelector('summary').textContent = `Choose quests (${selected} selected)`;
  const visible = db.map.markers.filter(m => m.c === 'quest' && questMapMarkerVisible(m)).length;
  $('#count-quest').textContent = `${visible}/${db.map.markers.filter(m => m.c === 'quest').length}`;
  control.querySelector('.quest-map-progress').textContent = questMapMode === 'active'
    ? questLog ? `${gameRunning ? 'Live' : 'Saved'} quest progress · ${visible} locations`
      : 'Start the game to read your active quests.'
    : questMapMode === 'selected' ? selected ? `${selected} quests selected · ${visible} locations` : 'Choose one or more quests above.'
      : 'Completed quests stay hidden.';
}

function includeQuestOnMap(name) {
  if (questMapMode === 'selected' || (questMapMode === 'active' && questStatus(ent(name)) !== 'active')) {
    questMapMode = 'selected'; selectedMapQuests.add(name); saveQuestMapFilter();
  }
}

function discoveryControls(category, label) {
  const select = h('select', { 'aria-label': `Display ${label}`, onchange: ev => {
    MapDiscovery.setMode(category, ev.target.value); MapView.redraw(); renderDiscoveryProgress();
  } }, h('option', { value: 'all' }, `All ${label}`), h('option', { value: 'undiscovered' }, 'Undiscovered only'));
  select.value = MapDiscovery.mode(category);
  return h('div', { class: 'discovery-filter', id: `discovery-${category}`, hidden: !MapView.isEnabled(category) },
    h('label', {}, h('span', { class: 'small muted' }, 'Show'), select),
    h('div', { class: 'small muted discovery-progress' }));
}

function renderDiscoveryProgress() {
  if (!db?.map) return;
  for (const category of ['lore', 'shrine']) {
    const control = $(`#discovery-${category}`);
    if (!control) continue;
    const summary = MapDiscovery.summary(category, db.map.markers);
    const filtered = MapDiscovery.mode(category) === 'undiscovered';
    $(`#count-${category}`).textContent = filtered ? `${summary.total - summary.discovered}/${summary.total}` : summary.total;
    control.querySelector('.discovery-progress').textContent = summary.at
      ? `${summary.discovered} discovered${summary.unknown ? ` · ${summary.unknown} unconfirmed` : ''} · ${gameRunning ? 'Game progress' : 'Saved progress'}`
      : 'Start the game to read discovery progress.';
    control.title = summary.unknown ? 'Locations with unconfirmed discovery status stay visible.' : 'Discovery progress read from the game.';
  }
}

function ventMapControls() {
  const vents = db.map.markers.filter(m => m.c === 'vent');
  const types = [...new Map(vents.map(m => [m.ventType || 'unknown', m])).entries()]
    .sort(([a], [b]) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : byName(a, b));
  return h('div', { id: 'vent-map-key', class: 'vent-map-key', hidden: !MapView.isEnabled('vent') },
    h('div', { class: 'creature-pool-actions vent-type-actions' },
      h('button', { type: 'button', 'aria-label': 'Show all vent types', onclick: () => { MapView.setVentTypes(null); renderVentMapFilter(); } }, 'All types'),
      h('button', { type: 'button', 'aria-label': 'Hide all vent types', onclick: () => { MapView.setVentTypes([]); renderVentMapFilter(); } }, 'Clear')),
    types.map(([type, m]) => h('label', { class: 'vent-type' + (type === 'unknown' ? ' vent-type-unknown' : '') },
      h('input', { type: 'checkbox', 'data-vent-type': type, checked: MapView.isVentTypeEnabled(type), onchange: ev => {
        MapView.setVentType(type, ev.target.checked); renderVentMapFilter();
      } }),
      m.ventType ? MapView.createVentIcon(m)
        : h('span', { class: 'vent-unknown-icon', 'aria-hidden': 'true' }, '·'),
      type === 'unknown' ? 'Unconfirmed type' : type)),
    h('div', { class: 'small muted vent-type-summary' }));
}

function renderVentMapFilter() {
  const control = $('#vent-map-key');
  updateMapFilterCount();
  if (!control || !db?.map) return;
  let selected = 0;
  for (const checkbox of control.querySelectorAll('[data-vent-type]')) {
    checkbox.checked = MapView.isVentTypeEnabled(checkbox.dataset.ventType);
    if (checkbox.checked) selected++;
  }
  const vents = db.map.markers.filter(m => m.c === 'vent');
  const shown = vents.filter(m => MapView.isVentTypeEnabled(m.ventType || 'unknown')).length;
  $('#count-vent').textContent = shown === vents.length ? String(shown) : `${shown}/${vents.length}`;
  control.querySelector('.vent-type-summary').textContent = selected ? `${shown} vent locations` : 'Select a vent type to show.';
}

function resourceMapControls(category) {
  const names = [...new Set(db.map.markers.filter(m => m.c === category).map(m => m.n))].sort(byName);
  const label = { ore: 'ores & rocks', gather: 'plants & gathering', tree: 'trees' }[category];
  const update = () => renderResourceMapFilter(category);
  const picker = h('details', { id: `resource-filter-${category}`, class: 'live-creature-filter', hidden: !MapView.isEnabled(category) },
    h('summary', { 'aria-label': `Choose ${label}` }, `All ${label}`),
    h('div', { class: 'creature-pool-menu' },
      h('div', { class: 'creature-pool-actions' },
        h('button', { type: 'button', onclick: () => { MapView.setResourceTypes(category, null); update(); } }, 'Select all'),
        h('button', { type: 'button', onclick: () => { MapView.setResourceTypes(category, []); update(); } }, 'Clear')),
      h('input', { type: 'search', placeholder: 'Find a resource…', 'aria-label': `Find ${label}`, oninput: ev => {
        const query = ev.target.value.trim().toLowerCase();
        let matches = 0;
        for (const row of picker.querySelectorAll('[data-resource]')) {
          row.hidden = !row.dataset.resource.toLowerCase().includes(query);
          if (!row.hidden) matches++;
        }
        picker.querySelector('.creature-pool-empty').hidden = matches > 0;
      } }),
      h('div', { class: 'creature-pool-options' }, names.map(name => h('label', { 'data-resource': name },
        h('input', { type: 'checkbox', checked: MapView.isResourceTypeEnabled(category, name), onchange: ev => {
          MapView.setResourceType(category, name, ev.target.checked); update();
        } }), h('span', {}, name)))),
      h('p', { class: 'small muted creature-pool-empty', hidden: true }, 'No matching resources')));
  picker.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { picker.open = false; picker.querySelector('summary').focus(); }
  });
  return picker;
}

function renderResourceMapFilter(category) {
  const picker = $(`#resource-filter-${category}`);
  if (!picker) return;
  let selected = 0;
  for (const row of picker.querySelectorAll('[data-resource]')) {
    const checked = MapView.isResourceTypeEnabled(category, row.dataset.resource);
    row.querySelector('input').checked = checked;
    if (checked) selected++;
  }
  const label = { ore: 'ores & rocks', gather: 'plants & gathering', tree: 'trees' }[category];
  picker.querySelector('summary').textContent = !MapView.isResourceFiltered(category) ? `All ${label}`
    : selected === 1 ? picker.querySelector('input:checked').closest('label').dataset.resource
      : `${selected} types selected`;
  const markers = db.map.markers.filter(m => m.c === category);
  const shown = markers.filter(m => MapView.isResourceTypeEnabled(category, m.n)).length;
  $(`#count-${category}`).textContent = MapView.isResourceFiltered(category) ? `${shown}/${markers.length}` : markers.length;
  updateMapFilterCount();
}

function renderLegend() {
  const counts = {};
  for (const m of db.map.markers) counts[m.c] = (counts[m.c] || 0) + 1;
  const row = (id, icon, label, count) => {
    const box = h('input', { type: 'checkbox', onchange: (ev) => {
      MapView.setEnabled(id, ev.target.checked);
      if (id === 'vent' && $('#vent-map-key')) $('#vent-map-key').hidden = !ev.target.checked;
      if (['lore', 'shrine'].includes(id)) $(`#discovery-${id}`).hidden = !ev.target.checked;
      if (id === 'quest') $('#quest-map-filter').hidden = !ev.target.checked;
      if (MapView.resourceCategories().includes(id)) $(`#resource-filter-${id}`).hidden = !ev.target.checked;
    } });
    box.checked = MapView.isEnabled(id);
    return h('label', {}, box, icon, label, h('span', { class: 'count', id: `count-${id}` }, count));
  };
  const swatch = (c) => c.style === 'badge'
    ? h('img', { class: 'legend-icon', src: '../../data/' + c.icon })
    : h('span', { class: 'legend-icon disc', style: `background:${c.style === 'item' ? '#14100c' : c.color};border-color:${c.style === 'item' ? c.color : '#000'}` },
      c.style !== 'circle' && c.icon ? h('img', { src: '../../data/' + c.icon }) : null);
  $('#map-legend').replaceChildren(
    h('div', { class: 'map-filter-header' }, h('strong', {}, 'Map filters'), h('button', { type: 'button', onclick: resetMapFilters }, 'Reset filters')),
    h('h3', {}, 'Live nearby'),
    row('npc', h('span', { class: 'legend-icon disc live' }, h('img', { src: '../../data/mapicons/T_Map_Icon_Animal.png' })), 'Live creatures', '–'),
    creaturePoolDropdown(),
    h('h3', {}, 'Places & resources'),
    ...db.map.categories.flatMap((c) => [row(c.id, swatch(c), c.label, counts[c.id] || 0),
      c.id === 'lore' ? discoveryControls('lore', 'lore') : c.id === 'shrine' ? discoveryControls('shrine', 'shrines & pools')
        : c.id === 'quest' ? questMapControls() : c.id === 'vent' ? ventMapControls()
          : MapView.resourceCategories().includes(c.id) ? resourceMapControls(c.id) : null]).filter(Boolean),
    // Drawn like the map's own quest markers, so the key matches what you see.
    h('div', { class: 'quest-map-key', 'aria-label': 'Quest marker key' },
      h('span', { class: 'quest-map-key-title' }, 'Quest markers'),
      h('span', {}, h('i', { class: 'qk qk-start' }, '?'), 'Quest pickup / first objective'),
      h('span', {}, h('i', { class: 'qk qk-current' }, '2'), 'Your current step'),
      h('span', {}, h('i', { class: 'qk' }, '3'), 'Quest step number'),
      h('span', {}, h('i', { class: 'qk' }, '·'), 'Step not confirmed')),
    h('div', { class: 'muted small' }, 'Ores, plants & trees show when zoomed in'),
    h('div', { id: 'nearby', class: 'nearby' }),
  );
  renderLiveCreatures();
  renderDiscoveryProgress();
  renderQuestMapFilter();
  renderVentMapFilter();
  for (const c of MapView.resourceCategories()) renderResourceMapFilter(c);
  updateMapFilterCount();
  $('#map-legend').onchange = updateMapFilterCount;
}

// Live creatures from the tracker, named from the game data and listed by distance.
function onNpcs(list, p) {
  const names = db?.map?.npcNames || {};
  liveCreatures = list.map((n) => {
    const cls = n.c.replace(/_C$/, ''); // variants like BP_AI_Deer_Character_03 share the base creature's name
    const name = names[cls] || names[cls.replace(/_\d+$/, '')] || words(cls.replace(/^BP_(AI_)?|_Character|_\d+$/g, ''));
    const e = E[name];
    const pictures = db?.map?.npcImages || {};
    const face = pictures[cls] || pictures[cls.replace(/_\d+$/, '')] || e?.image || null;
    // EAlertnessState: 0 ambient, 3 transition to combat, 4 combat; the rest are suspicious/searching.
    return { live: true, n: name, ref: e ? name : null, face, alert: n.alert, combat: n.alert === 3 || n.alert === 4, x: n.x, y: n.y, d: Math.hypot(n.x - p.x, n.y - p.y) / 100 };
  }).sort((a, b) => a.d - b.d);
  renderLiveCreatures();
}

function renderLiveCreatures() {
  const dropdown = $('#live-creature-filter');
  if (dropdown) {
    // Keep the catalogue stable as creatures enter/leave tracking range; include unknown live types.
    const types = [...new Set([
      ...Object.values(db?.map?.npcNames || {}),
      ...Object.values(E).filter(e => e.kind === 'monster').map(e => e.name),
      ...liveCreatures.map(n => n.n),
      ...(liveCreaturePool || []),
    ])].filter(Boolean).sort(byName);
    const options = dropdown.querySelector('.creature-pool-options');
    const signature = JSON.stringify(types);
    if (options.dataset.types !== signature) {
      options.dataset.types = signature;
      options.replaceChildren(...types.map(name => h('label', {},
        h('input', { type: 'checkbox', value: name, onchange: ev => {
          if (liveCreaturePool === null) liveCreaturePool = new Set(types);
          ev.target.checked ? liveCreaturePool.add(name) : liveCreaturePool.delete(name);
          saveCreaturePool();
        } }), h('span', { title: name }, name))));
      filterCreatureChoices();
    }
    for (const input of options.querySelectorAll('input')) input.checked = liveCreaturePool === null || liveCreaturePool.has(input.value);
    const all = $('#live-creature-all');
    all.checked = liveCreaturePool === null;
    all.indeterminate = liveCreaturePool !== null && liveCreaturePool.size > 0;
    const summary = dropdown.querySelector('summary');
    summary.textContent = liveCreaturePool === null ? 'All creatures' : !liveCreaturePool.size ? 'No creatures selected'
      : liveCreaturePool.size === 1 ? [...liveCreaturePool][0] : `${liveCreaturePool.size} creature types`;
    summary.title = liveCreaturePool === null ? 'All creatures' : [...liveCreaturePool].sort(byName).join(', ');
  }
  const npcs = liveCreaturePool === null ? liveCreatures : liveCreatures.filter(n => liveCreaturePool.has(n.n));
  MapView.setNpcs(npcs);
  const count = $('#count-npc');
  if (count) count.textContent = npcs.length;
  const box = $('#nearby');
  if (!box) return;
  box.replaceChildren(h('div', { class: 'nearby-title' }, `Nearby (${npcs.length})`), ...npcs.slice(0, 10).map((n) =>
    h('div', { class: `nearby-row${n.ref ? ' has-drops' : ''}${n.combat ? ' alert' : ''}`, onclick: () => (n.ref ? showItem(n.ref) : null), title: n.ref ? 'Show drops' : '' },
      n.face ? h('img', { class: 'nearby-face', src: '../../data/' + n.face, alt: '' }) : h('span', { class: 'nearby-face' }),
      h('span', {}, n.n), h('span', { class: 'count' }, `${Math.round(n.d)} m`))));
  if (!npcs.length) box.append(h('div', { class: 'muted small' }, liveCreaturePool?.size === 0 ? 'Select creature types above'
    : liveCreaturePool === null ? 'No live creatures nearby' : 'No selected creatures nearby'));
}
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();

// Markers for an entity: its own spawns/locations, or (for items) everything that drops it.
function markersFor(name,visited=new Set()) {
  const e = ent(name);
  if (!db?.map || visited.has(name)) return [];
  const seen=new Set([...visited,name]);
  const own = db.map.markers.filter((m) => m.ref === name && (e.kind !== 'quest' || questMarkerVisible(m)));
  if (e.kind !== 'item') return own;
  const sources = new Set(e.droppedBy.map((s) => s.from));
  const lower = name.toLowerCase();
  const found=[...own,...db.map.markers.filter((m) => sources.has(m.ref) || (!e.recipes.length && ['Materials','Fuel','Food','Seeds'].includes(e.type) && ['ore', 'gather', 'salvage'].includes(m.c) && lower.startsWith(m.n.toLowerCase())))];
  for(const route of e.acquisition || []) {
    if(route.item)found.push(...markersFor(route.item,seen));
    if(route.quest)found.push(...db.map.markers.filter(m=>m.ref===route.quest && (!route.questId || m.questId===route.questId)));
    if(route.sourceId)found.push(...db.map.markers.filter(m=>m.sourceId===route.sourceId));
  }
  const vendors=new Set(e.recipes.filter(r=>r.facility?.startsWith('Vendor: ')).map(r=>r.facility));
  found.push(...db.map.markers.filter(m=>vendors.has(m.vendor)));
  return [...new Set(found)];
}

function locationButtons(label,markers,quest=null) {
  const groups=new Map();
  for(const m of [...new Set(markers)]) {
    const key=m.d || m.region || 'World map';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
  }
  if(!groups.size)return null;
  return h('div',{class:'source-map-links'},h('span',{class:'source-map-label'},quest ? 'Show quest on map:' : 'Show on map:'),[...groups].map(([key,ms])=>{
    const dungeon=db.map.dungeons.find(d=>d.id===key);
    const place=dungeon?.name || key;
    return h('button',{type:'button',class:'source-map-button',title:`${quest ? 'Show quest on map' : 'Show on map'} · ${place}`,onclick:()=>showMapLocations(label,ms,quest)},`${place}${ms.length>1 ? ' ('+ms.length+')' : ''}`);
  }));
}
function showMapLocations(label,markers,quest=null) {
  if(state.module!=='map')history.push(snapshot());
  if(quest)includeQuestOnMap(quest);
  state.module='map';selectedQuestMarker=null;selectedDiscoveryMarker=null;
  renderModules();setMapMode(true);highlightMapMarkers(label,markers);
  showItem(quest || label,{push:false});
}

function sourceMapLinks(name) {return locationButtons(name,markersFor(name));}

function highlightMapMarkers(name, ms) {
  const hl = MapView.setHighlight(name, ms);
  syncMapHighlight();
}
function syncMapHighlight() {
  const bar = $('#map-highlight');
  const context = MapView.navigation();
  bar.hidden = !context.highlight;
  if (context.highlight) bar.replaceChildren(`Showing ${context.highlight.markers.length} ${context.highlight.markers.length === 1 ? 'location' : 'locations'} for ${context.highlight.label}`,
    h('button', { type: 'button', onclick: () => { MapView.setHighlight(null); bar.hidden = true; } }, 'Clear'));
}

function refreshQuestMapHighlight() {
  const name = MapView.highlightLabel();
  if (!mapReady || E[name]?.kind !== 'quest') return;
  // Spawn sites are source guidance; a new quest-log snapshot must not replace them with quest NPCs.
  if (MapView.navigation().highlight?.markers.some(i => ['creature','monster'].includes(db.map.markers[i]?.c))) return;
  const highlighted = MapView.navigation().highlight?.markers || [];
  if (selectedQuestMarker?.ref === name && highlighted.length === 1 && db.map.markers[highlighted[0]] === selectedQuestMarker
      && questMapMarkerVisible(selectedQuestMarker, true)) return;
  highlightMapMarkers(name, markersFor(name).filter(m => questMapMarkerVisible(m, true)));
}

// every: all of a quest's places, not just its current hunting grounds or step.
function showOnMap(name, { every = false } = {}) {
  const quest = ent(name);
  const objective = quest.kind === 'quest' && questStatus(quest) === 'active' && questNextObjective(quest);
  const spawns = objective && !every ? questStepSourceMarkers(quest,objective.key) : [];
  if(spawns.length) { showMapLocations(name,spawns,name);return; }
  if (state.module !== 'map') history.push(snapshot());
  selectedQuestMarker = null;
  selectedDiscoveryMarker = null;
  if (every && questMapStepMode !== 'all') { questMapStepMode = 'all'; saveQuestMapFilter(); }
  if (ent(name).kind === 'quest') includeQuestOnMap(name);
  let ms = markersFor(name).filter(m => ent(name).kind !== 'quest' || questMapMarkerVisible(m, true));
  if(ent(name).kind==='quest' && !ms.length && markersFor(name).length) {
    questMapStepMode='all';saveQuestMapFilter();ms=markersFor(name).filter(m=>questMapMarkerVisible(m,true));
  }
  state.module = 'map';
  renderModules();
  setMapMode(true);
  highlightMapMarkers(name, ms);
  showItem(name, { push: false });
}
const mapButton = (name) => (markersFor(name).length ? h('button', { type: 'button', onclick: () => showOnMap(name) }, `Show locations (${markersFor(name).length})`) : null);

/* ---------- Modules (left column) ---------- */

const MODULES = [
  { id: 'map', label: 'Map', icon: '🧭' },
  { id: 'zones', label: 'Zones', icon: '🗺' },
  { id: 'monsters', label: 'Monsters', icon: '⚔' },
  { id: 'containers', label: 'Chests & packs', icon: '🎒' },
  { id: 'quests', label: 'Quests', icon: '📜' },
  { id: 'crafting', label: 'Crafting', icon: '⚒' },
  { id: 'types', label: 'Item types', icon: '📦' },
  { id: 'wishlist', label: 'Wishlist', icon: '★' },
];

// One stroke family for the app chrome; game artwork remains in the content.
function navIcon(id) {
  const paths = {
    map: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM16 8l-2 6-6 2 2-6Z',
    zones: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16',
    monsters: 'm4 3 7 7-3 3-5-7V3h1ZM20 3l-7 7 3 3 5-7V3h-1ZM6 12l6 6M4 20l5-5M18 12l-6 6M20 20l-5-5',
    containers: 'M4 10h16v10H4ZM3 6h18v4H3ZM10 10v5h4v-5',
    quests: 'M6 3h12v18H6ZM9 7h6M9 11h6M9 15h4',
    crafting: 'm14 4 6 6M13 3l-3 3 8 8 3-3ZM12 10 3 19l2 2 9-9',
    types: 'm12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M7 5.8l9 5',
    wishlist: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'nav-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[id]);
  svg.append(path);
  return svg;
}

function renderModules() {
  const nav = $('#modules');
  nav.replaceChildren(...MODULES.map((m) => h('button', {
    type: 'button', 'aria-current': state.module === m.id ? 'page' : null,
    class: 'nav-item' + (state.module === m.id ? ' sel' : ''),
    onclick: () => selectModule(m.id),
  }, navIcon(m.id), h('span', { class: 'nav-label' }, m.label), m.id === 'wishlist' ? h('span', { class: 'count' }, wish.size || '') : null)));
}

function facilities() {
  const map = new Map();
  for (const e of Object.values(E)) for (const r of e.recipes) {
    const f = r.facility || 'Unknown';
    if (!map.has(f)) map.set(f, new Set());
    map.get(f).add(e.name);
  }
  return map;
}
function itemTypes() {
  const map = new Map();
  for (const e of Object.values(E)) {
    if (e.kind !== 'item') continue;
    const t = e.type || 'Other';
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}
const isContainer = (e) => e.kind !== 'monster' && e.kind !== 'quest' && e.drops.length > 0;

/* ---------- Quest progress (live from the game's quest log) ---------- */

// The game's log lists every quest you have come across: state 0 = discovered but not taken,
// 1 = in progress, 2 = complete. Quests missing from it have not been found yet.
const QUEST_STATES = [
  { id: 'active', label: 'In progress', icon: '▶', hint: 'You are on these quests now.' },
  { id: 'available', label: 'Ready to start', icon: '!', hint: 'You have found these. Talk to the quest giver to begin.' },
  { id: 'unknown', get label() { return questLog ? 'Not started' : 'Progress unknown'; }, icon: '?',
    get hint() { return questLog ? 'You have not come across these yet.' : 'Load your character in the game to see your progress.'; } },
  { id: 'done', label: 'Completed', icon: '✓', hint: 'Finished.' },
];
// { at, quests: { id: { s, o, b: bools, i: counters } }, locations: { name: shown on the game's map } }
let questLog = null;
try { questLog = JSON.parse(localStorage.getItem('questLog')); } catch {}

// Whether the game has finished this target: the quest bool its interaction sets ("Quest_X:Bool", from the quest scripts).
function questTargetDone(marker) {
  if (!marker.doneWhen) return false;
  const [id, flag] = marker.doneWhen.split(':');
  return questLog?.quests[id]?.b?.[flag] === true;
}
// Whether the game's own map shows this quest area now (null when unknown): what the quest scripts last set, else its default.
function questAreaShown(marker) {
  const live = questLog?.locations;
  if (!live || !marker.qlocation) return null;
  return Object.hasOwn(live, marker.qlocation) ? live[marker.qlocation] : !!marker.shown;
}

function questVersion(q) {
  if (!q.versions) return q;
  const progress = questLog?.quests || {};
  const versions = [q, ...q.versions.filter(v => v.id !== q.id)];
  const selected = versions.find(v => progress[v.id]?.s === 1)
    || (progress[q.id] ? q : versions.find(v => progress[v.id]?.s === 2) || versions.find(v => progress[v.id]));
  return selected && selected !== q ? { ...q, ...selected } : q;
}
function npcPresence(marker) {
  const rule = marker.npcVisibility;
  if (!rule?.flag || !rule.questId) return 'unconditional';
  const flags = questLog?.quests[rule.questId]?.b;
  if (!flags || !Object.hasOwn(flags, rule.flag)) return 'unknown';
  const value = flags[rule.flag];
  if (rule.mode === 'InvisibleWhenQuestBoolIsTrue') return value ? 'hidden' : 'visible';
  if (rule.mode === 'VisibleWhenQuestBoolIsTrue') return value ? 'visible' : 'hidden';
  return 'unknown';
}
function questMarkerVisible(marker) {
  const q = E[marker.ref];
  return (!marker.questId || !q || marker.questId === questVersion(q).id) && npcPresence(marker) !== 'hidden';
}

function questMapMarkerVisible(marker, highlighted = false) {
  if (!questMarkerVisible(marker)) return false;
  const matchesQuest = questMapMode === 'selected' ? selectedMapQuests.has(marker.ref)
    : questMapMode === 'active' ? !!E[marker.ref] && questStatus(ent(marker.ref)) === 'active'
      : highlighted || !E[marker.ref] || questStatus(ent(marker.ref)) !== 'done';
  if (!matchesQuest) return false;
  const info = questMarkerInfo(marker);
  // Until accepted, a quest marks only where to start, even with All steps or a map highlight.
  if (info.status === 'unknown' || info.status === 'available') return info.pickup;
  if (questMapStepMode === 'all') return true;
  return info.current || info.pickup;
}

function questMarkerInfo(marker) {
  const q = E[marker.ref] && questVersion(E[marker.ref]);
  const objectives = q?.objectives || [];
  const keys = new Set(marker.qsteps || []);
  const steps = objectives.flatMap((o, i) => keys.has(o.key) ? [{ number: i + 1, key: o.key, text: questStepGuidance(q, o.key)?.instruction || o.text }] : []);
  const status = q ? questStatus(q) : 'unknown';
  const currentKey = questLog?.quests[q?.id]?.o;
  const current = status === 'active' && steps.some(s => s.key === currentKey);
  // Starting an objective and accepting a quest are different interactions. Prefer the
  // actors whose dialogue actually gives this quest over all first-objective targets.
  const start = !!marker.sourceId && !!q?.guide?.starts?.includes(marker.sourceId);
  const pickup = start && ['unknown', 'available'].includes(status);
  const color = current ? '#8acbff' : start && ['unknown', 'available'].includes(status) ? '#e4c17b' : '#b6b6b6';
  const numbers = steps.map(s => s.number).join(', ');
  const badge = current ? String(steps.find(s => s.key === currentKey).number)
    : pickup ? '?'
    : steps.length ? String(steps[0].number) + (steps.length > 1 ? '+' : '') : '·';
  const label = (current ? 'Current · ' : start ? 'Start · ' : '')
    + (steps.length ? `Step${steps.length > 1 ? 's' : ''} ${numbers}` : 'Step unconfirmed');
  const rawName = marker.qlocation || '';
  const locationName = rawName.replace(/^(DR_MQ_|DR_SQ\d_|UmS_)/, '')
    .replace(/_(Objective|NPC|Area|Target)(_|$).*$/, '').replace(/NPC$/, '').replace(/(?<=[a-z])(Target|Objective)$/, '').replace(/^WOM(?=_|$)/, 'Wise Old Man');
  // Placed-actor names can carry blueprint prefixes, actor ids and the quest's own name.
  const questPrefix = new RegExp('^' + (q?.name || '').replace(/[^\w ]/g, '').replace(/ /g, ' ?') + ' ', 'i');
  const location = marker.target || (marker.qnpc ? marker.n.split(' · ')[1] || 'Quest NPC'
    : words(locationName).replace(/^(BP|DR) /, '').replace(/ C UAID .*$/, '').replace(/\bObjective /g, '').replace(questPrefix, '').trim() || 'Quest area');
  return { title: q?.name || marker.n, location, steps, status, current, start, pickup, color, badge, label };
}

function questMapLocations(q) {
  const markers = (db.map?.markers || []).filter(m => m.c === 'quest' && m.ref === q.name && questMarkerVisible(m));
  if (!markers.length) return null;
  const unique = markers.filter((m, i) => markers.findIndex(n => n.qlocation === m.qlocation && Math.hypot(n.x - m.x, n.y - m.y) < 100) === i);
  unique.sort((a, b) => (questMarkerInfo(a).steps[0]?.number ?? 999) - (questMarkerInfo(b).steps[0]?.number ?? 999));
  const place = (m, info, text) => h('button', { type: 'button', class: 'quest-location' + (selectedQuestMarker === m ? ' sel' : ''),
    title: `Show ${info.location} on the map`,
    onclick: () => {
      focusQuestTarget(q, m);
    } }, text);
  // Exactly one entry per step, in step order: a place used by several steps is listed under
  // each of them, and steps without a marked place are named so the numbering never jumps.
  const steps = new Map(), unlinked = [];
  for (const m of unique) {
    const info = questMarkerInfo(m);
    if (!info.steps.length) unlinked.push([m, info]);
    for (const s of info.steps) (steps.get(s.number) || steps.set(s.number, { step: s, places: [] }).get(s.number)).places.push([m, info]);
  }
  const quest = questVersion(q), status = questStatus(quest), currentKey = questLog?.quests[quest.id]?.o;
  const placeButtons = (places, what) => {
    if (places.length === 1) return h('div', { class: 'quest-places' }, place(...places[0], 'Show on map'));
    places = [...places].sort((a, b) => a[1].location.localeCompare(b[1].location, undefined, { numeric: true }));
    const seen = new Map();
    const names = places.map(([, i]) => i.location);
    return h('div', { class: 'quest-places' }, h('span', { class: 'muted small' }, `${places.length} places ${what}:`),
      places.map(([m, i], n) => {
        const repeated = names.filter(x => x === i.location).length > 1;
        if (repeated) seen.set(i.location, (seen.get(i.location) || 0) + 1);
        return place(m, i, repeated ? `${i.location} ${seen.get(i.location)}` : i.location);
      }));
  };
  const out = [];
  let last = 0;
  for (const n of [...steps.keys()].sort((a, b) => a - b)) {
    const { step, places } = steps.get(n);
    if (last && n - last > 1) out.push(h('p', { class: 'quest-step-gap muted small' },
      n - last === 2 ? `Step ${last + 1} has no marked place on the map.` : `Steps ${last + 1}–${n - 1} have no marked place on the map.`));
    last = n;
    const current = status === 'active' && step.key === currentKey;
    const start = n === 1 && ['unknown', 'available'].includes(status);
    out.push(h('div', { class: 'quest-step-group' + (current ? ' current' : '') },
      h('div', { class: 'quest-location-role', style: `color:${current ? '#8acbff' : start ? '#e4c17b' : '#b6b6b6'}` },
        `${current ? 'Current · ' : start ? 'Start · ' : ''}Step ${n}`),
      h('div', { class: 'quest-step-text' }, step.text),
      placeButtons(places, 'for this step')));
  }
  if (unlinked.length) out.push(h('div', { class: 'quest-step-group' },
    h('div', { class: 'quest-location-role muted' }, 'Other places'),
    h('div', { class: 'quest-step-text muted small' }, 'The game data does not say which step uses these places.'),
    placeButtons(unlinked, 'linked to this quest')));
  return h('div', { class: 'quest-locations' }, out);
}

function questStepGuidance(q, key) { return q.guide?.steps.find(step => step.key === key); }
// Where an objective sends you, each with whether it is done: the exact things to interact with (a Curse Seal, a ghost),
// else the quest areas. For the objective you are on, finished targets are ticked off from the quest log, and the
// areas follow the game's own map: ones it has hidden drop out, ones it shows for this quest come in.
function questStepTargets(q, key) {
  const step = questStepGuidance(q, key);
  const ids = new Set(step?.targets || []);
  const linked = db.map.markers.filter(m => m.questId === q.id && questMarkerVisible(m) && (ids.has(m.qlocation) || m.qsteps?.includes(key)));
  const current = questStatus(q) === 'active' && questProgress(q).current?.key === key;
  const exact = linked.filter(m => m.precision === 'interaction');
  if (exact.length) {
    const done = exact.map(m => current && questTargetDone(m));
    // With every target done the objective still waits on something else (often a hand-in), so none is ticked off.
    const all = done.every(Boolean);
    return exact.map((marker, i) => ({ marker, done: done[i] && !all }));
  }
  let areas = linked;
  if (current && questLog?.locations) {
    areas = linked.filter(m => questAreaShown(m) !== false);
    for (const m of db.map.markers) if (m.c === 'quest' && m.questId === q.id && !m.qnpc && !areas.includes(m) && questAreaShown(m) && questMarkerVisible(m)) areas.push(m);
    if (!areas.length) areas = linked;
  }
  return areas.map(marker => ({ marker, done: false }));
}
const questStepMarkers = (q, key) => questStepTargets(q, key).filter(t => !t.done).map(t => t.marker);
function questStepSourceMarkers(q, key) {
  const step=questStepGuidance(q,key);
  const names = new Set(step?.mapSources || []);
  return db.map.markers.filter(m => ['creature','monster'].includes(m.c) && names.has(m.n) && (!step.sourceRegions || step.sourceRegions.includes(m.region)));
}
function focusQuestTarget(q, marker) {
  history.push(snapshot());
  includeQuestOnMap(q.name);
  if (marker.c === 'quest' && questMapStepMode === 'current' && !questMapMarkerVisible(marker, true)) {
    questMapStepMode = 'all'; saveQuestMapFilter();
  }
  state.module = 'map'; setMapMode(true); renderModules();
  selectedQuestMarker = marker.c === 'quest' ? marker : null;
  MapView.setHighlight(q.name, [marker]); MapView.focusMarker(marker); syncMapHighlight();
  showItem(q.name, { push: false });
  $('#detail').scrollTop = 0;
}
// An objective's places as a checklist (each with a Map button, done ones ticked), the creatures to hunt and the supplies.
function questStepActions(q, objective) {
  const targets = questStepTargets(q, objective.key);
  const left = targets.filter(t => !t.done).map(t => t.marker);
  const sources = questStepSourceMarkers(q, objective.key);
  const resources = questStepGuidance(q, objective.key)?.resources || [];
  // Only the objective you are on has places ticked off.
  const counting = targets.length > 1 && targets.some(t => t.marker.precision === 'interaction')
    && questStatus(q) === 'active' && questProgress(q).current?.key === objective.key;
  const unplaced = sources.length || resources.length ? null
    : /\b(plant|water|harvest)\b/i.test(objective.text) ? 'Do this at a farming plot you have built.'
      : /\b(build|place|construct)\b/i.test(objective.text) ? 'Build wherever you like; this step has no fixed place.'
        : /\b(craft|cook)\b/i.test(objective.text) ? 'Use the right crafting or cooking station; this step has no fixed place.'
          : 'This step has no fixed place on the map. The hints from conversations below may help.';
  const entrance = id => db.map.markers.find(m => m.enter === id);
  const row = ({ marker: m, done }) => {
    const dungeon = m.d && db.map.dungeons.find(d => d.id === m.d);
    const name = m.precision === 'interaction' ? m.target : 'Search this area';
    const where = dungeon ? `Inside ${dungeon.name}` : m.region || 'World map';
    return h('li', { class: 'quest-target' + (done ? ' done' : '') },
      h('span', { class: 'quest-target-tick', 'aria-hidden': 'true' }, done ? '✓' : ''),
      h('span', { class: 'quest-target-text' }, h('span', { class: 'quest-target-name' }, name),
        h('span', { class: 'quest-target-where' }, done ? `Done · ${where}` : where)),
      done ? null : h('span', { class: 'quest-target-actions' },
        h('button', { type: 'button', class: 'quest-pin-button', 'data-source-id': m.sourceId || m.qlocation,
          title: dungeon ? `Open ${dungeon.name} on the right floor` : `Show ${name} on the map`, onclick: () => focusQuestTarget(q, m) }, 'Map'),
        dungeon && entrance(m.d) ? h('button', { type: 'button', class: 'quest-entrance-button', title: `How to get into ${dungeon.name}`,
          onclick: () => focusQuestTarget(q, entrance(m.d)) }, 'Entrance') : null));
  };
  const hunted = [...new Set(sources.map(m => m.n))];
  return h('div', { class: 'quest-step-actions' },
    targets.length ? h('ul', { class: 'quest-targets' }, targets.map(row)) : null,
    left.length > 1 || counting ? h('div', { class: 'quest-targets-summary' },
      counting ? h('span', { class: 'quest-target-count' }, `${targets.length - left.length} of ${targets.length} done`) : h('span'),
      left.length > 1 ? h('button', { type: 'button', class: 'quest-show-left', onclick: () => showMapLocations(q.name, left, q.name) }, `Show all ${left.length} on map`) : null) : null,
    sources.length ? h('div', { class: 'quest-hunt' },
      h('p', {}, h('strong', {}, 'Hunt: '), hunted.join(', ')),
      h('button', { type: 'button', class: 'quest-targets-map primary', onclick: () => showMapLocations(q.name, sources, q.name) }, `Show where they live (${sources.length})`),
      h('p', { class: 'muted small' }, 'Spots where they spawn, not live sightings.'), locationButtons(q.name, sources, q.name)) : null,
    resources.length ? h('div', { class: 'quest-step-resources' }, h('span', { class: 'quest-need-label' }, 'You need'),
      h('div', { class: 'quest-need-list' }, resources.map(name => h('div', { class: 'quest-step-resource' }, icon(name, 'sm'),
        h('button', { type: 'button', class: 'item-link', title: `Open ${name}: recipes and where to find it`, onclick: () => open(name) }, name),
        markersFor(name).length ? h('button', { type: 'button', class: 'quest-resource-map', title: `Show the ${markersFor(name).length} places to find ${name}`,
          onclick: () => showOnMap(name) }, 'Map') : null)))) : null,
    !targets.length && unplaced ? h('p', { class: 'muted small quest-location-unknown' }, unplaced) : null);
}
function questDialogueClues(q) {
  if (!q.guide?.clues.length) return null;
  return h('details', { class: 'quest-dialogue-clues' }, h('summary', {}, 'Hints from conversations'),
    h('p', { class: 'muted small' }, 'What the quest’s characters say, from the game’s quest conversations. They cover every stage and answer, so some may not apply to you yet.'),
    q.guide.clues.map(clue => h('details', {}, h('summary', {}, clue.target),
      clue.lines.map(line => h('p', { class: 'quest-dialogue-line' }, line)),
      db.map.markers.filter(m => m.questId === q.id && m.sourceId === clue.sourceId && questMarkerVisible(m)).map(marker =>
        h('button', { type: 'button', onclick: () => focusQuestTarget(q, marker) }, `Pin ${marker.target}`)))));
}

function questStatus(q) {
  q = questVersion(q);
  const p = questLog?.quests[q.id];
  if (!p) return 'unknown';
  return p.s === 2 ? 'done' : p.s === 1 ? 'active' : 'available';
}
const questLogAge = () => (questLog ? (gameRunning ? 'live' : 'saved') : '');

// The tracker's quest log: each quest's state, objective, bools and counters, plus which quest areas the game's map shows.
function onQuestLog(list, locations = null) {
  const quests = Object.fromEntries(list.map((q) => [q.id, { s: q.s, o: q.o, ...(q.b && { b: q.b }), ...(q.i && { i: q.i }) }]));
  const changed = JSON.stringify(quests) !== JSON.stringify(questLog?.quests) || JSON.stringify(locations) !== JSON.stringify(questLog?.locations ?? null);
  const before = questLog?.quests;
  questLog = { at: Date.now(), quests, ...(locations && { locations }) };
  try { localStorage.setItem('questLog', JSON.stringify(questLog)); } catch {}
  if (!changed) return;
  // Like WoW: a quest you just accepted joins the tracker, and a finished one leaves it.
  if (before) for (const q of browseQuests()) {
    const was = before[q.id]?.s, now = quests[q.id]?.s;
    if (now === 1 && was !== 1 && !isTracked(q.name)) { trackedQuests.push(q.name); toast(`Tracking ${q.name}`); }
    if (now === 2 && was !== 2 && isTracked(q.name)) { trackedQuests = trackedQuests.filter(n => n !== q.name); toast(`Quest complete: ${q.name}`); }
  }
  Preferences.setJSON('trackedQuests', trackedQuests);
  syncQuestTracker();
  MapView.redraw();
  refreshQuestMapHighlight();
  renderQuestMapFilter();
  if (state.module === 'quests') renderList();
  if (state.view?.type === 'questlog') renderContent();
  if (ent(state.detail).kind === 'quest') renderDetail();
}

// How far along a quest is: steps finished, total steps and the current objective (if known).
function questProgress(q) {
  q = questVersion(q);
  const total = q.objectives?.length || 0;
  const st = questStatus(q);
  const at = (q.objectives || []).findIndex((o) => o.key === questLog?.quests[q.id]?.o);
  const done = st === 'done' ? total : st === 'active' && at >= 0 ? at : 0;
  return { done, total, current: st === 'active' && at >= 0 ? q.objectives[at] : null, step: at + 1 };
}
const questRemoved = (e) => e?.availability?.status === 'unavailable';
const browseQuests = () => Object.values(E).filter(e => e.kind === 'quest' && !e.hidden && !questRemoved(e)).map(questVersion);
function questMatches(q) {
  const query = state.filter.trim().toLowerCase();
  return !query || [q.name, q.region, q.type, ...(q.guide?.steps || []).flatMap(s => [s.instruction, ...(s.notes || [])])].join(' ').toLowerCase().includes(query);
}
const filteredQuests = () => browseQuests().filter(questMatches);
// Sections fold only once your progress is known (until then every quest is in one), and never while filtering.
const questGroupsFold = () => !!questLog && !state.filter.trim();
const questGroupOpen = id => !questGroupsFold() || questGroupsOpen.has(id);
function questGroupHeading(st, open, cls, ...content) {
  const fold = questGroupsFold();
  return h(fold ? 'button' : 'div', { ...(fold && { type: 'button', 'aria-expanded': String(open), onclick: () => toggleQuestGroup(st.id) }),
    class: cls + (fold ? '' : ' fixed'), 'data-group': st.id }, fold ? h('span', { class: 'quest-group-chevron', 'aria-hidden': 'true' }) : null, ...content);
}
function toggleQuestGroup(id) {
  if (questGroupsOpen.has(id)) questGroupsOpen.delete(id); else questGroupsOpen.add(id);
  Preferences.setJSON('questGroups', [...questGroupsOpen]);
  renderList(); renderContent();
  $(`#content .quest-group-heading[data-group="${id}"]`)?.focus({ preventScroll: true });
}
function questProgressContext() {
  return questLog ? gameRunning ? 'Live from your game' : `Saved progress · last updated ${new Date(questLog.at).toLocaleString()}`
    : 'Progress unknown · load your character in the game to see it.';
}
function questNextObjective(q) {
  const p = questProgress(q), status = questStatus(q);
  // An unrecognised active objective must not silently fall back to the beginning.
  const startKey = { Quest_SW_MainQuest: 'AccessSW', Quest_UmS_MainQuest: 'EnterUmS' }[q.id];
  return p.current || (['unknown', 'available'].includes(status) ? q.objectives?.find(o => o.key === startKey) || q.objectives?.[0] : null);
}
/* ---------- Quest tracker: pinned quests with their current objective, like WoW's objective tracker ---------- */

let trackedQuests = Preferences.json('trackedQuests', []).filter(n => typeof n === 'string');
let trackerCollapsed = Preferences.get('trackerCollapsed') === '1';
const isTracked = name => trackedQuests.includes(name);
const trackedList = () => trackedQuests.filter(n => E[n]?.kind === 'quest').map(n => ent(n));
function setTracked(name, on) {
  trackedQuests = trackedQuests.filter(n => n !== name);
  if (on) trackedQuests.push(name);
  Preferences.setJSON('trackedQuests', trackedQuests);
  syncQuestTracker();
  if (ent(state.detail).kind === 'quest') renderDetail();
}
function trackButton(q) {
  const on = isTracked(q.name);
  return h('button', { type: 'button', class: 'track-button' + (on ? ' on' : ''), 'aria-pressed': on,
    title: on ? 'Remove from the quest tracker' : 'Pin to the quest tracker: its objective and target locations stay on the map',
    onclick: ev => { ev.stopPropagation(); setTracked(q.name, !on); } }, on ? 'Untrack' : 'Track quest');
}
// The quest list's one control: ticked quests are listed under the minimap and their targets marked on the map.
function trackToggle(q) {
  const on = isTracked(q.name);
  return h('label', { class: 'track-toggle' + (on ? ' on' : ''),
    title: on ? 'Listed under the minimap with its targets on the map. Untick to stop tracking.' : 'List under the minimap and mark its targets on the map' },
    h('input', { type: 'checkbox', checked: on, 'data-quest': q.name, onchange: () => {
      setTracked(q.name, !on);
      $(`#content .track-toggle input[data-quest="${CSS.escape(q.name)}"]`)?.focus();
    } }), on ? 'Tracked' : 'Track');
}

// What the current objective asks for, split into trackable lines: places to go, creatures to kill
// (recorded spawns) and items to collect (with the creatures that drop them). Amounts come from the
// objective text; live counters are not in the quest log, so no progress is claimed.
function questTrackerObjective(q) {
  const objective = questNextObjective(q);
  if (!objective) return null;
  const step = questStepGuidance(q, objective.key);
  const instruction = step?.instruction || objective.text;
  const amount = name => {
    const last = name.split(' ').pop().replace(/[^\w]/g, '');
    const m = last && instruction.match(new RegExp(`\\b(\\d+)\\s+(?:[\\w’'-]+\\s+){0,3}?${last}`, 'i'));
    return m ? +m[1] : null;
  };
  const lines = [];
  const places = new Map();
  for (const m of questStepMarkers(q, objective.key)) {
    const label = m.target || questMarkerInfo(m).location;
    (places.get(label) || places.set(label, []).get(label)).push(m);
  }
  for (const [label, markers] of places) lines.push({ kind: 'goto', verb: 'Go to', name: label,
    where: markers[0].d ? db.map.dungeons.find(d => d.id === markers[0].d)?.name : markers[0].region, markers });
  const spawns = questStepSourceMarkers(q, objective.key);
  if (spawns.length) {
    // Regional variants ("Deer Brynmoor") read as their base creature when that is also a target.
    const names = [...new Set(spawns.map(m => m.n))];
    lines.push({ kind: 'kill', verb: 'Slay', name: names.filter(n => !names.some(o => o !== n && n.startsWith(o + ' '))).join(', '), markers: spawns });
  }
  for (const name of step?.resources || []) {
    const e = ent(name);
    if (!E[name] || name === q.name) continue;
    if (e.kind === 'monster') {
      const kill = lines.find(l => l.kind === 'kill' && l.name.split(', ').some(n => n.startsWith(name) || name.startsWith(n)));
      if (kill) { kill.markers = [...new Set([...kill.markers, ...markersFor(name)])]; continue; }
      lines.push({ kind: 'kill', verb: 'Slay', name, qty: amount(name), markers: markersFor(name) });
      continue;
    }
    const from = [...new Set(e.droppedBy.map(d => d.from))];
    const markers = markersFor(name).filter(m => m.ref !== q.name);
    lines.push({ kind: from.length ? 'loot' : e.recipes.some(r => !r.facility?.startsWith('Vendor: ')) && !markers.length ? 'craft' : 'collect',
      verb: from.length ? 'Loot' : e.recipes.some(r => !r.facility?.startsWith('Vendor: ')) && !markers.length ? 'Craft' : 'Get',
      name, qty: amount(name), from, markers });
  }
  return { objective, instruction, lines };
}

// Map entries for every tracked quest: the tracker number, the quest and the line each marker serves.
// Like WoW (and Questie), every other active quest also marks where its current objective's creatures
// spawn, without a tracker number, so hunting targets are always on the map and minimap.
function trackedMapEntries() {
  const out = [];
  const entries = (q, index, kinds) => {
    if (['unknown', 'available'].includes(questStatus(q))) {
      for (const m of db.map.markers) if (m.c === 'quest' && m.ref === q.name && questMarkerVisible(m) && questMarkerInfo(m).pickup)
        out.push({ marker: m, index, quest: q.name, kind: 'goto', label: `Start ${q.name}` });
      return;
    }
    for (const line of questTrackerObjective(q)?.lines || []) if (kinds.includes(line.kind)) for (const m of line.markers)
      out.push({ marker: m, index, quest: q.name, kind: line.kind, label: `${line.verb} ${line.name}${line.qty ? ' ×' + line.qty : ''}` });
  };
  trackedList().forEach((q, i) => { if (questStatus(q) !== 'done') entries(q, i + 1, ['goto', 'kill', 'loot', 'collect']); });
  for (const q of browseQuests()) if (!isTracked(q.name) && questStatus(q) === 'active' && questProgress(q).current) entries(q, null, ['kill', 'loot']);
  return out;
}

function trackerShowLine(q, line) {
  if (line.markers.length === 1) focusQuestTarget(q, line.markers[0]);
  else showMapLocations(q.name, line.markers, q.name);
}

function questTrackerPanel() {
  const quests = trackedList();
  if (!quests.length) return null;
  if (document.body.classList.contains('game-map')) return gameMapQuestList();
  const toggle = h('button', { type: 'button', class: 'tracker-toggle', 'aria-expanded': !trackerCollapsed,
    title: trackerCollapsed ? 'Expand the quest tracker' : 'Collapse the quest tracker',
    onclick: () => { trackerCollapsed = !trackerCollapsed; Preferences.set('trackerCollapsed', trackerCollapsed ? '1' : '0'); renderQuestTracker(); } },
    h('span', { class: 'tracker-heading' }, 'Quests'), h('span', { class: 'tracker-count' }, quests.length), h('span', { class: 'tracker-chevron', 'aria-hidden': 'true' }, trackerCollapsed ? '▸' : '▾'));
  if (trackerCollapsed) return h('div', { class: 'quest-tracker collapsed' }, toggle);
  return h('div', { class: 'quest-tracker' }, toggle, quests.map((q, i) => {
    const status = questStatus(q);
    const t = questTrackerObjective(q);
    const p = questProgress(q);
    const stepLabel = status === 'active' && p.current && q.guide?.sequence === 'linear' ? `Step ${p.step}/${p.total}`
      : status === 'active' ? questTargetProgress(q) || '' : status === 'available' || status === 'unknown' ? 'Start' : '';
    return h('section', { class: 'tracker-quest' + (state.detail === q.name ? ' sel' : '') },
      h('div', { class: 'tracker-quest-head' }, h('span', { class: 'tracker-num', 'aria-hidden': 'true' }, i + 1),
        h('button', { type: 'button', class: 'tracker-title', title: 'Open the quest guide', onclick: () => showItem(q.name) }, q.name),
        h('button', { type: 'button', class: 'tracker-remove', 'aria-label': `Untrack ${q.name}`, title: 'Untrack', onclick: () => setTracked(q.name, false) }, '×')),
      status === 'done' ? h('p', { class: 'tracker-step done' }, 'Completed')
        : !t ? h('p', { class: 'tracker-step muted' }, 'Current objective not recorded. Load your character to refresh it.')
        : [h('p', { class: 'tracker-step' }, stepLabel ? h('span', { class: 'tracker-step-label' }, stepLabel + ' · ') : null, t.instruction),
          t.lines.length ? h('ul', { class: 'tracker-lines' }, t.lines.map(line => h('li', { class: `tracker-line ${line.kind}` },
            h('span', { class: 'tracker-line-text' }, h('span', { class: 'tracker-verb' }, line.verb), ' ',
              E[line.name] ? h('button', { type: 'button', class: 'item-link', onclick: () => open(line.name) }, line.name) : line.name,
              line.qty ? h('span', { class: 'tracker-qty' }, ` ×${line.qty}`) : null,
              line.kind === 'loot' ? h('span', { class: 'tracker-from muted' }, ` · drops from ${line.from.slice(0, 3).join(', ')}${line.from.length > 3 ? '…' : ''}`) : null,
              line.where ? h('span', { class: 'tracker-from muted' }, ` · ${line.where}`) : null),
            line.markers.length ? h('button', { type: 'button', class: 'tracker-map', title: `Show ${line.markers.length === 1 ? 'the location' : line.markers.length + ' locations'} on the map`,
              onclick: () => trackerShowLine(q, line) }, line.markers.length === 1 ? 'Map' : `Map · ${line.markers.length}`)
              : h('span', { class: 'tracker-nomap muted' }, 'no fixed place')))) : null]);
  }));
}

// Over the game's map the quest list reads like the minimap's: the number its targets carry, the quest and what to
// do next. Clicking a quest frames where to go; nothing else to press.
function gameMapQuestList() {
  return h('div', { class: 'quest-tracker compact' }, h('div', { class: 'tracker-heading' }, 'Quests'),
    minimapQuests().map(q => {
      const markers = q.done ? [] : (questTrackerObjective(ent(q.name))?.lines || []).flatMap(l => l.markers);
      return h('button', { type: 'button', class: 'tracker-quest' + (q.done ? ' done' : ''), disabled: !markers.length,
        title: markers.length ? 'Show where to go' : 'No fixed place on the map',
        onclick: () => { MapView.setHighlight(q.name, markers); syncMapHighlight(); } },
        h('span', { class: 'tracker-quest-head' }, h('span', { class: 'tracker-num', 'aria-hidden': 'true' }, q.index), h('span', { class: 'tracker-title' }, q.name)),
        h('span', { class: 'tracker-step' }, q.step ? h('span', { class: 'tracker-step-label' }, q.step + ' · ') : null, q.text));
    }));
}

function renderQuestTracker() {
  const box = $('#quest-tracker');
  if (!box) return;
  const panel = db && questTrackerPanel();
  box.hidden = !panel;
  box.replaceChildren(...(panel ? [panel] : []));
}
function syncQuestTracker() {
  if (!db) return;
  if (mapReady) MapView.setTracked(trackedMapEntries());
  renderQuestTracker();
  sendMinimap();
  if (state.view?.type === 'questlog') renderContent();
}

// How far through the places of the objective you are on ("1 of 3 done"), when it has several.
function questTargetProgress(q) {
  const current = questStatus(q) === 'active' && questProgress(q).current;
  const targets = current ? questStepTargets(q, current.key).filter(t => t.marker.precision === 'interaction') : [];
  return targets.length > 1 ? `${targets.filter(t => t.done).length} of ${targets.length} done` : null;
}
// What a quest asks of you now, in a few words: the step label (linear quests) and the rewritten instruction.
function questStepLabel(q) {
  const p = questProgress(q);
  return p.current && q.guide?.sequence === 'linear' ? `Step ${p.step} of ${p.total}` : null;
}

// The quest journal: one folding section per progress group, active quests first. Rows say what to do next;
// clicking a row opens its guide and its one control is Track.
function questOverviewPage() {
  const quests = browseQuests(), visible = filteredQuests();
  const count = id => quests.filter(q => questStatus(q) === id).length;
  const done = count('done');
  const body = [h('header', { class: 'page-head quest-page-head' }, h('div', {}, h('h1', {}, 'Quest journal'),
    h('p', { class: 'page-lead progress-context' }, gameRunning && questLog ? h('span', { class: 'quest-live' }, questProgressContext()) : questProgressContext())),
    db.questChain ? h('button', { type: 'button', onclick: () => go({ type: 'questchain', arg: '' }, { detail: null }) }, 'Story & quest order') : null),
    questLog ? h('div', { class: 'quest-journal-progress' }, h('span', { class: 'quest-journal-count' }, `${done} of ${quests.length} quests completed`),
      h('span', { class: 'quest-progress-track', role: 'progressbar', 'aria-label': 'Quests completed', 'aria-valuemin': 0, 'aria-valuemax': quests.length, 'aria-valuenow': done },
        h('span', { class: 'quest-progress-fill', style: `width:${Math.round(done / Math.max(1, quests.length) * 100)}%` }))) : null];
  if (state.filter.trim()) body.push(h('p', { class: 'quest-results-line muted small', role: 'status' }, `${visible.length} quest${visible.length === 1 ? '' : 's'} matching “${state.filter}”`));
  if (!visible.length) body.push(h('div', { class: 'quest-empty' }, h('h2', {}, 'No quests match'),
    h('p', { class: 'muted' }, 'Try a quest name, place, item or objective.'),
    h('button', { type: 'button', onclick: () => { state.filter = ''; renderList(); renderContent(); saveNavigation(); } }, 'Clear filter')));
  const tier = q => questTier(q.name, q.id, q.region)?.min ?? 99;
  for (const st of QUEST_STATES) {
    const group = visible.filter(q => questStatus(q) === st.id).sort((a, b) => tier(a) - tier(b) || (b.type === 'Main quest') - (a.type === 'Main quest') || byName(a.name, b.name));
    if (!group.length) continue;
    const open = questGroupOpen(st.id);
    body.push(h('section', { class: `quest-task-section q-${st.id}${open ? ' open' : ''}` },
      questGroupHeading(st, open, 'quest-group-heading', h('h2', {}, st.label), h('span', { class: 'quest-group-count' }, group.length),
        h('span', { class: 'quest-group-hint' }, st.hint)),
      open ? h('div', { class: 'quest-task-list' }, group.map(q => questLogRow(q, st))) : null));
  }
  const removed = Object.values(E).filter(q => q.kind === 'quest' && !q.hidden && questRemoved(q) && questMatches(q));
  if (removed.length) body.push(h('details', { class: 'quest-archive' }, h('summary', {}, `Removed quests (${removed.length})`),
    h('p', { class: 'muted small' }, 'These quests remain in the game files but cannot be started in the current game.'),
    removed.map(q => h('button', { type: 'button', class: 'quest-archive-link', onclick: () => showItem(q.name) }, q.name))));
  return h('div', { class: 'page quest-overview' }, body);
}
function questLogRow(q, st) {
  const objective = st.id === 'done' ? null : questNextObjective(q);
  const instruction = objective && (questStepGuidance(q, objective.key)?.instruction || objective.text);
  const progress = [questStepLabel(q), questTargetProgress(q)].filter(Boolean).join(' · ');
  // The whole row opens the guide (the title is its keyboard stop); the only control is Track.
  const row = h('article', { class: `quest-card quest-task q-${st.id}${state.detail === q.name ? ' sel' : ''}` },
    h('div', { class: 'quest-task-body' }, h('h3', {}, h('button', { type: 'button', class: 'quest-title-link', onclick: () => showItem(q.name) }, q.name)),
      h('div', { class: 'quest-tags' }, questTypeTag(q), questTierTag(q.name, q.id, q.region), q.region ? h('span', { class: 'quest-region' }, q.region) : null,
        progress ? h('span', { class: 'quest-row-progress' }, progress) : null),
      instruction ? h('p', { class: 'quest-now' }, h('span', { class: 'quest-now-verb' }, st.id === 'active' ? 'Next' : 'Start'), instruction)
        : st.id === 'active' ? h('p', { class: 'quest-now muted' }, 'Your game is on a step this guide does not recognise. Open the quest to find it.') : null),
    st.id !== 'done' ? trackToggle(q) : null,
    h('span', { class: 'quest-open', 'aria-hidden': 'true' }, '›'));
  row.addEventListener('click', ev => { if (!ev.target.closest('button, label')) showItem(q.name); });
  return row;
}

// Quest order from the game's quest scripts: each storyline as a numbered timeline, then stand-alone quests by region.
function questChainPage() {
  const { nodes, edges } = db.questChain;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const group = new Map(nodes.map(n => [n.id, n.id]));
  const find = id => group.get(id) === id ? id : (group.set(id, find(group.get(id))), group.get(id));
  for (const e of edges) group.set(find(e.from), find(e.to));
  const linked = n => edges.some(e => e.from === n.id || e.to === n.id);
  const chains = new Map();
  for (const n of nodes) if (linked(n)) (chains.get(find(n.id)) || chains.set(find(n.id), []).get(find(n.id))).push(n.id);
  // Each node is one exact quest asset, so read its own save progress.
  const status = n => {
    const p = questLog?.quests[n.id];
    return QUEST_STATES.find(s => s.id === (!p ? 'unknown' : p.s === 2 ? 'done' : p.s === 1 ? 'active' : 'available'));
  };
  const statusText = st => questLog ? h('span', { class: 'order-status' }, st.label) : null;
  const layers = ids => {
    const depth = new Map();
    const d = id => depth.has(id) ? depth.get(id) : (depth.set(id, 0), depth.set(id, Math.max(0, ...edges.filter(e => e.to === id && ids.includes(e.from)).map(e => d(e.from) + 1))), depth.get(id));
    ids.forEach(d);
    const cols = [];
    for (const id of ids) (cols[depth.get(id)] ||= []).push(byId.get(id));
    return cols.filter(Boolean);
  };
  const quest = n => {
    const st = status(n);
    return h('button', { type: 'button', class: `timeline-quest q-${st.id}${state.detail === n.entity ? ' sel' : ''}`, onclick: () => showItem(n.entity) },
      h('span', { class: 'timeline-name' }, n.name),
      n.hint ? h('span', { class: 'timeline-hint' }, n.hint) : null,
      h('span', { class: 'quest-tags' }, questTierTag(n.entity, n.id, n.region), questTypeTag(n), statusText(st)));
  };
  const storylines = [...chains.values()].sort((a, b) => b.length - a.length).map(ids => {
    const cols = layers(ids);
    const first = cols[0][0];
    const done = ids.filter(id => status(byId.get(id)).id === 'done').length;
    return h('section', { class: 'storyline' },
      h('header', { class: 'storyline-head' },
        h('h3', {}, first.name),
        h('span', { class: 'storyline-meta' }, [`${ids.length} quests`, first.region, questLog ? `${done} of ${ids.length} done` : null].filter(Boolean).join(' · '))),
      h('ol', { class: 'timeline' }, cols.map((col, i) => {
        const st = col.length === 1 ? status(col[0]) : null;
        return h('li', { class: `timeline-step${st ? ' q-' + st.id : ''}` },
          h('span', { class: 'timeline-dot', 'aria-label': `Step ${i + 1}` }, st?.id === 'done' ? '✓' : String(i + 1)),
          h('div', { class: 'timeline-body' }, col.length > 1 ? h('span', { class: 'timeline-any' }, 'Any of these') : null, col.map(quest)));
      })));
  });
  const free = nodes.filter(n => !linked(n));
  const regions = [...new Set(free.map(n => n.region || 'Other'))].sort((a, b) => byName(a, b));
  const stat = (n, label) => h('div', { class: 'order-stat' }, h('span', { class: 'order-stat-n' }, n), h('span', {}, label));
  return [h('div', { class: 'page quest-order' },
    h('header', { class: 'page-head' }, h('h1', {}, 'Quest order'),
      h('p', { class: 'page-lead' }, 'Some quests only appear after you finish another one. Each card is one storyline: do its quests from top to bottom.')),
    h('div', { class: 'order-stats' }, stat(storylines.length, 'storylines'), stat(nodes.length - free.length, 'quests in a storyline'), stat(free.length, 'stand-alone quests')),
    h('section', { class: 'page-section' },
      h('h2', {}, 'Storylines'),
      h('div', { class: 'storyline-grid' }, storylines)),
    h('section', { class: 'page-section' },
      h('h2', {}, 'Stand-alone quests'),
      h('p', { class: 'page-section-lead' }, 'No other quest is needed first. Start them whenever you meet the quest giver.'),
      h('div', { class: 'region-grid' }, regions.map(r => {
        const tier = n => questTier(n.entity, n.id, n.region)?.min ?? 99;
        const list = free.filter(n => (n.region || 'Other') === r).sort((a, b) => tier(a) - tier(b) || byName(a.name, b.name));
        return h('section', { class: 'region-card' },
          h('header', { class: 'region-head' }, h('h3', {}, r), h('span', { class: 'storyline-meta' }, `${list.length} quests`)),
          h('ul', { class: 'region-list' }, list.map(n => {
            const st = status(n);
            return h('li', {}, h('button', { type: 'button', class: `region-row q-${st.id}${state.detail === n.entity ? ' sel' : ''}`, onclick: () => showItem(n.entity) },
              h('span', { class: 'region-row-name' }, n.name), h('span', { class: 'quest-tags' }, questTierTag(n.entity, n.id, n.region), questTypeTag(n), statusText(st))));
          })));
      }))),
    h('p', { class: 'page-footnote' }, 'Links come only from the game’s quest scripts, so nothing here is guessed.',
      db.questChain.retired?.length ? ' Quests removed from the game are left out; find them under “Removed from the game” in the quest list.' : ''))];
}

// The quests directly before and after this one in the game's quest scripts.
function questOrderLinks(e) {
  const { nodes, edges } = db.questChain;
  const ids = new Set([e.id, ...(e.versions || []).map(v => v.id)]);
  const pick = (from, to) => [...new Map(edges.filter(x => ids.has(x[from])).map(x => nodes.find(n => n.id === x[to])).filter(n => n && n.entity !== e.name).map(n => [n.entity, n])).values()];
  const before = pick('to', 'from'), after = pick('from', 'to');
  if (!before.length && !after.length) return null;
  const links = list => list.flatMap((n, i) => [i ? ', ' : null, h('button', { type: 'button', class: 'item-link', onclick: () => showItem(n.entity) }, n.name)]).filter(Boolean);
  return h('div', { class: 'quest-order-links small' },
    before.length ? h('div', {}, h('span', { class: 'muted' }, 'Comes after: '), links(before)) : null,
    after.length ? h('div', {}, h('span', { class: 'muted' }, 'Leads to: '), links(after)) : null,
    h('button', { type: 'button', class: 'item-link muted', onclick: () => navigateTo('quests', { type: 'questchain', arg: '' }, { detail: e.name }) }, 'See the full quest order'));
}

// Recommended tier = power level of the map regions a quest sends you to. Quests without map
// locations fall back to the usual level of their area (shown as an estimate).
let areaTiers = null;
function questTier(name, id, area) {
  const levels = new Map(db.map.regions.map(r => [r.name, r.level]));
  const placed = (n, i) => db.map.markers.filter(m => m.c === 'quest' && m.ref === n && (!m.questId || !i || m.questId === i));
  const of = ms => ms.map(m => levels.get(m.region)).filter(l => l != null);
  if (!areaTiers) {
    const seen = new Map();
    for (const q of Object.values(E)) if (q.kind === 'quest' && q.region) for (const l of of(placed(q.name, q.id))) (seen.get(q.region) || seen.set(q.region, []).get(q.region)).push(l);
    areaTiers = new Map([...seen].map(([a, ls]) => {
      const count = new Map(); ls.forEach(l => count.set(l, (count.get(l) || 0) + 1));
      return [a, [...count].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]];
    }));
  }
  const ms = placed(name, id);
  const ls = of(ms);
  if (ls.length) return { min: Math.min(...ls), max: Math.max(...ls), regions: [...new Set(ms.map(m => m.region).filter(r => levels.get(r) != null))] };
  const level = levels.get(area) ?? areaTiers.get(area);
  return level != null ? { min: level, max: level, estimated: true, regions: [] } : null;
}
const tierText = t => t ? `Tier ${t.min}${t.max !== t.min ? '–' + t.max : ''}` : '';
function questTierTag(name, id, area) {
  const t = questTier(name, id, area);
  if (!t) return null;
  return h('span', { class: 'quest-tier' + (t.estimated ? ' estimated' : ''),
    title: t.estimated ? `Estimated from the usual power level of ${area}` : `Power level of ${t.regions.join(', ')}` }, tierText(t) + (t.estimated ? ' (est.)' : ''));
}

function questTypeTag(q) {
  const label = { 'Main quest': 'Main Quest', 'Side quest': 'Side Quest' }[q.type] || q.type || 'Quest';
  return h('span', { class: 'quest-type' + (q.type === 'Main quest' ? ' main' : '') }, label);
}

// Objectives as a checklist: done before the current one, current highlighted, the rest still to do.
function questChecklist(q) {
  q = questVersion(q);
  const st = questStatus(q);
  const cur = questLog?.quests[q.id]?.o;
  const at = q.objectives.findIndex((o) => o.key === cur);
  const linear = q.guide?.sequence === 'linear';
  const seen = new Set();
  const objectives = linear ? q.objectives : q.objectives.filter(o => {
    const instruction = questStepGuidance(q, o.key)?.instruction || o.text;
    if (seen.has(instruction)) return false;
    seen.add(instruction); return true;
  }).map(o => q.objectives.find(other => other.key === cur && questStepGuidance(q, other.key)?.instruction === questStepGuidance(q, o.key)?.instruction) || o);
  return h('ol', { class: 'objectives' + (!linear ? ' reference-objectives' : '') }, objectives.map((o) => {
    const i = q.objectives.indexOf(o);
    const guide = questStepGuidance(q, o.key);
    const s = st === 'done' ? 'done' : st === 'active' && i === at ? 'now' : linear && st === 'active' && at >= 0 && i < at ? 'done' : 'unknown';
    return h('li', { class: s }, h('span', { class: 'tick', 'aria-hidden': 'true' }, s === 'done' ? '✓' : linear ? String(i + 1) : '·'), h('span', {},
      s === 'now' ? h('span', { class: 'objective-now-label' }, 'Do this now') : null,
      h('span', { class: 'quest-step-instruction' }, guide?.instruction || o.text),
      (guide?.notes || (o.hint ? [o.hint] : [])).map(note => h('p', { class: 'quest-step-note muted small' }, note)),
      questStepActions(q, o),
      guide?.instruction && guide.instruction !== o.text ? h('details', { class: 'quest-original-objective' }, h('summary', {}, 'In-game objective'), h('p', {}, o.text)) : null));
  }));
}

/* ---------- Quest guide: a quest's page, read like a page of a quest journal ---------- */

// What to do now and where first, then the rewards, then everything else folded away.
function questGuide(e, star) {
  const removed = questRemoved(e);
  const st = removed ? { id: 'removed', label: 'Removed from the game' } : QUEST_STATES.find(s => s.id === questStatus(e));
  const tier = !removed && questTier(e.name, e.id, e.region);
  const out = [h('header', { class: `quest-hero q-${st.id}` },
    h('div', { class: 'quest-hero-meta' }, questTypeTag(e), e.region ? h('span', {}, e.region) : null,
      tier ? h('span', { title: tier.estimated ? `Estimated from the usual power level of ${e.region}` : `Power level of ${tier.regions.join(', ')}` },
        `Recommended ${tierText(tier)}${tier.estimated ? ' (est.)' : ''}`) : null),
    h('h1', {}, e.name),
    h('div', { class: 'quest-hero-status' }, h('span', { class: `quest-status q-${st.id}` }, st.label),
      removed ? null : h('span', { class: 'progress-context' + (gameRunning && questLog ? ' quest-live' : '') }, questProgressContext())),
    h('div', { class: 'quest-hero-actions' }, !removed && st.id !== 'done' ? trackButton(e) : null, star))];
  out.push(removed ? h('p', { class: 'quest-removed-note' }, 'You can’t get this quest anymore. ', e.availability.reason) : questNowCard(e, st));
  const mounts = e.rewards?.filter(r => r.kind === 'quest-mount') || [];
  const rewards = e.rewards?.filter(r => r.kind !== 'quest-mount') || [];
  if (mounts.length || rewards.length) out.push(h('section', { class: 'quest-rewards-block' }, h('h2', {}, 'Rewards'),
    mounts.length ? h('p', { class: 'quest-mount-reward' }, h('strong', {}, `${mounts.map(r => r.item).join(', ')} mount. `), 'Hold your Mount key (Alt by default on PC) after finishing the quest.') : null,
    e.id === 'Quest_FH_WitherBeast' ? h('p', { class: 'muted small' }, 'After unlocking the mount, Vannaka offers 50 Soul Fragments for another 3 Primordial Hearts. This is a repeatable exchange for extra hearts.') : null,
    rewards.length ? h('div', { class: 'quest-rewards mats' }, rewards.map(r => h('button', { type: 'button', class: 'mat', onclick: () => showItem(r.item) }, icon(r.item, 'sm'),
      r.qty != null && r.kind !== 'quest-recipe' ? h('span', { class: 'q' }, `${r.qty}×`) : null, h('span', { class: 'mat-name' }, r.item),
      r.kind === 'quest-recipe' ? h('span', { class: 'reward-kind' }, 'Recipe') : null))) : null));
  if (selectedQuestMarker?.ref === e.name && document.body.classList.contains('map-mode')) {
    const info = questMarkerInfo(selectedQuestMarker);
    out.push(h('div', { class: 'quest-marker-context' }, h('strong', {}, info.label), h('div', {}, info.location),
      ...info.steps.map(s => h('p', {}, `${s.number}. ${s.text}`)),
      info.steps.length ? null : h('p', {}, 'The game data does not confirm which step uses this location.')));
  }
  if (e.objectives?.length) out.push(h('details', { class: 'quest-walkthrough quest-fold', open: st.id === 'active' && !questProgress(e).current },
    h('summary', {}, 'All steps'),
    e.guide?.sequence !== 'linear' ? h('p', { class: 'muted small' }, 'Some steps are alternatives or counters, so this is a guide rather than a checklist.') : null,
    questChecklist(e)));
  if (e.desc) out.push(h('details', { class: 'quest-story quest-fold' }, h('summary', {}, 'Story'), h('p', { class: 'desc' }, e.desc)));
  const locations = questMapLocations(e);
  if (locations) out.push(h('details', { class: 'quest-map-overview quest-fold' }, h('summary', {}, 'Every place in this quest'),
    h('button', { type: 'button', class: 'quest-show-map', onclick: () => showOnMap(e.name, { every: true }) }, `Show all on map (${markersFor(e.name).length})`), locations));
  const clues = questDialogueClues(e);
  if (clues) out.push(clues);
  const order = db.questChain && questOrderLinks(e);
  const people = questPeople(e);
  if (people.length || order) out.push(h('details', { class: 'quest-background quest-fold' }, h('summary', {}, 'Related quests & people'), order, ...people));
  if (e.guide?.sources.length) out.push(h('p', { class: 'muted small quest-guide-sources' }, 'Route reference: ',
    e.guide.sources.map(source => h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title))));
  return out;
}
// The card at the top of a quest: the step you are on (or how to start), its places ticked off as you go, and tips.
function questNowCard(e, st) {
  if (st.id === 'done') return h('section', { class: 'current-objective quest-now-card q-done' }, h('div', { class: 'quest-now-label' }, 'Quest complete'),
    h('p', { class: 'quest-current-instruction' }, e.completedDesc || 'Nothing left to do.'));
  const current = questProgress(e).current;
  const next = questNextObjective(e);
  if (!next) return h('section', { class: 'current-objective quest-now-card q-active' }, h('div', { class: 'quest-now-label' }, 'Current objective not recorded'),
    h('p', { class: 'quest-current-instruction' }, 'Your game is on a step this guide does not recognise.'),
    h('p', { class: 'quest-tip' }, 'Open All steps below and find the one your game’s quest log shows.'));
  const guidance = questStepGuidance(e, next.key);
  // The places checklist counts for itself; the objective's own "1 of 3 recorded" would repeat it.
  const counted = questTargetProgress(e);
  const notes = (guidance?.notes || (next.hint ? [next.hint] : [])).filter(note => note && !(counted && /recorded in this objective/.test(note)));
  return h('section', { class: `current-objective quest-now-card q-${st.id}` },
    h('div', { class: 'quest-now-label' }, current ? questStepLabel(e) || 'What to do now' : 'How to start'),
    h('p', { class: 'quest-current-instruction' }, guidance?.instruction || next.text),
    !current && st.id === 'unknown' && questLog ? h('p', { class: 'quest-tip' }, 'You have not found this quest yet. This is where it begins.') : null,
    questStepActions(e, next),
    notes.map(note => h('p', { class: 'quest-tip' }, note)),
    e.guide?.preparation.length ? h('p', { class: 'quest-tip' }, h('strong', {}, 'Bring: '), e.guide.preparation.join(' ')) : null);
}

// Where to talk to people for a quest (givers / turn-ins), with distance if the game is running.
function questPeople(q) {
  q = questVersion(q);
  const ms = (db.map?.markers || []).filter((m) => m.ref === q.name && m.qnpc && (!m.questId || m.questId === q.id));
  return ms.map((m) => {
    const d = lastPlayer?.ok ? ` · ${Math.round(Math.hypot(m.x - lastPlayer.x, m.y - lastPlayer.y) / 100)} m` : '';
    const presence = npcPresence(m);
    const note = presence === 'hidden' ? (gameRunning ? 'Hidden by your story progress.' : 'Hidden in your saved quest snapshot.')
      : presence === 'unknown' ? 'Can leave as the story progresses; presence not confirmed.' : null;
    return h('div', {}, h('div', { class: presence === 'hidden' ? 'muted' : 'link', onclick: () => { if (presence !== 'hidden') showOnMap(q.name); } },
      `${m.n.split(' · ')[1] || 'Quest giver'}${m.region ? ' — ' + m.region : ''}${d}`), note ? h('p', { class: 'muted small' }, note) : null);
  });
}

// countUnit names what the number counts ("drop" → "12 different drops") for the tooltip and screen readers.
function listItem(label, view, count, extraClass = '', countUnit = null) {
  const sel = state.view && state.view.type === view.type && state.view.arg === view.arg;
  const countText = countUnit && count != null && count !== '' ? `${count} ${countUnit}${count === 1 ? '' : 's'}` : null;
  return h('div', { class: `list-item ${extraClass}` + (sel ? ' sel' : ''), title: label, onclick: () => go(view) },
    view.type === 'source' ? icon(view.arg, 'sm') : null, label, count != null ? h('span', { class: 'count', title: countText, 'aria-label': countText }, count) : null);
}

const uniqueDrops = (name) => new Set(ent(name).drops.map((d) => d.item)).size;
// Says what the numbers on the right of a list mean.
const LIST_CAPTIONS = { monsters: 'Number = different items it drops', containers: 'Number = different items inside', types: 'Number = items of this type' };

function renderList() {
  const list = $('#list');
  if (!db) { list.replaceChildren(h('div', { class: 'empty' }, 'No data yet')); return; }
  const f = state.filter.toLowerCase();
  const match = (s) => !f || s.toLowerCase().includes(f);
  // Keep the editing node mounted: rebuilding it resets focus, selection and IME composition.
  let filter = list.querySelector('.list-filter input');
  let results = list.querySelector('.list-results');
  if (!filter || !results) {
    filter = h('input', {
      id: 'section-filter', placeholder: 'Filter entries…', 'aria-label': 'Filter entries', autocomplete: 'off', spellcheck: 'false',
      oninput: (ev) => { state.filter = ev.target.value; saveNavigation(); renderList(); if (['crafting', 'wishlist', 'quests'].includes(state.module)) renderContent(); },
    });
    results = h('div', { class: 'list-results' });
    list.replaceChildren(h('div', { class: 'list-filter' },
      h('label', { for: 'section-filter', class: 'filter-label' }), filter,
      h('div', { class: 'filter-summary' }, h('span', { class: 'filter-count', role: 'status' }),
        h('button', { type: 'button', class: 'filter-clear', onclick: () => { state.filter = ''; renderList(); if (['crafting', 'wishlist', 'quests'].includes(state.module)) renderContent(); saveNavigation(); filter.focus(); } }, 'Clear filter'))), results);
  }
  if (filter.value !== state.filter) filter.value = state.filter;
  const filterLabel = { zones: 'Filter zones or monsters', monsters: 'Filter monsters', containers: 'Filter chests & packs', quests: 'Filter quests',
    crafting: 'Filter crafting', types: 'Filter item types', wishlist: 'Filter wishlist' }[state.module] || 'Filter entries';
  filter.placeholder = filterLabel + '…';
  filter.setAttribute('aria-label', filterLabel);
  list.querySelector('.filter-label').textContent = filterLabel;
  list.querySelector('.filter-clear').hidden = !state.filter;
  let rows = [];

  if (state.module === 'zones') {
    for (const z of db.zones) {
      const mons = z.monsters.filter(match);
      if (!mons.length && !match(z.name)) continue;
      rows.push(h('div', { class: 'list-group', onclick: () => go({ type: 'zone', arg: z.name }) }, z.name, h('span', { class: 'count' }, z.monsters.length)));
      rows.push(...(mons.length ? mons : z.monsters).sort(byName).map((m) => listItem(m, { type: 'source', arg: m }, null, 'indent')));
    }
  } else if (state.module === 'monsters') {
    rows = Object.values(E).filter((e) => e.kind === 'monster' && match(e.name)).map((e) => e.name).sort(byName)
      .map((n) => listItem(n, { type: 'source', arg: n }, uniqueDrops(n) || null, '', 'different drop'));
  } else if (state.module === 'containers') {
    rows = Object.values(E).filter((e) => isContainer(e) && match(e.name)).map((e) => e.name).sort(byName)
      .map((n) => listItem(n, { type: 'source', arg: n }, uniqueDrops(n), '', 'different item'));
  } else if (state.module === 'crafting') {
    const journalMode = isJournalView();
    filter.placeholder = 'Find station or item…';
    const categories = db.journal?.categories || [];
    const browse = categories.length ? h('div', { class: 'craft-browse', 'aria-label': 'Browse crafting' },
      h('button', { type: 'button', 'aria-pressed': journalMode, onclick: () => {
        const category = categories.find(c => c.id === state.listSel) || categories[0];
        navigateTo('crafting', journalStart(category), { listSel: category.id });
      } }, 'Journal'),
      h('button', { type: 'button', 'aria-pressed': !journalMode, onclick: () => {
        navigateTo('crafting', { type: 'facility', arg: [...facilities().keys()].sort(byName)[0] });
      } }, 'Stations')) : null;
    if (journalMode && categories.length) {
      filter.placeholder = 'Find journal item…';
      const category = categories.find(c => c.id === state.listSel) || categories[0];
      const select = h('select', { id: 'journal-category', onchange: event => {
        const next = categories.find(c => c.id === event.target.value);
        navigateTo('crafting', journalStart(next), { listSel: next.id });
      } }, categories.map(c => h('option', { value: c.id }, c.name)));
      select.value = category.id;
      rows = [browse, h('label', { class: 'journal-category', for: 'journal-category' }, 'Browse category', select)];
      const matching = f ? categories.flatMap(c => c.groups.map(g => ({ ...g, category: c }))) : category.groups.map(g => ({ ...g, category }));
      let count = 0;
      const seenSearchItems=new Set();
      for (const group of matching) {
        const names = group.items.filter(n => (!f || !seenSearchItems.has(n)) && (match(n) || match(group.name) || match(group.category.name) || match(armourSet(E[n]?.armourSet)?.name || '')));
        if (!names.length) continue;
        if(f)names.forEach(n=>seenSearchItems.add(n));
        count += names.length;
        const selected = names.includes(state.view.arg) || (state.view.type === 'armourset' && names.some(n => E[n]?.armourSet === state.view.arg));
        const setIds = [...new Set(names.map(n => E[n]?.armourSet).filter(Boolean))];
        const setRows = setIds.map(id => {
          const set = armourSet(id);
          const first = set.slots.Body[0] || set.slots.Head[0] || set.slots.Legs[0];
          return h('button', { type: 'button', class: `journal-item armour-set-item${state.view.type === 'armourset' && state.view.arg === id ? ' sel' : ''}`,
            onclick: () => navigateTo('crafting', { type: 'armourset', arg: id }, { listSel: group.category.id, filter: state.filter }) },
            icon(first, 'sm'), h('span', {class:'journal-entry-text'},h('span',{},set.name),setLearningTag(set)));
        });
        rows.push(h('details', { class: 'journal-group', open: !!f || selected },
          h('summary', {}, f ? `${group.category.name} · ${group.name}` : group.name, h('span', { class: 'count' }, setIds.length + names.filter(n=>!E[n]?.armourSet).length)),
          setRows, names.filter(n=>!E[n]?.armourSet).map(n => h('button', { type: 'button', class: `journal-item${state.view.arg === n ? ' sel' : ''}`, 'data-item-name':n, 'aria-current': state.view.arg === n ? 'page' : null,
            onclick: () => navigateTo('crafting', { type: 'journal', arg: n }, { listSel: group.category.id, filter: state.filter }) }, icon(n, 'sm'), h('span',{class:'journal-entry-text'},h('span',{},n),
              h('span',{class:'journal-entry-tags'},learningTag(itemLearningState(ent(n)),true), E[n]?.journal?.masterwork ? h('span',{class:'entry-kind'},'Masterwork') : null))))));
      }
      if (!count) rows.push(h('p', { class: 'empty' }, 'No journal items match. Try a different item name.'));
    } else {
      rows = [browse, ...[...facilities()].filter(([f, items]) => match(f) || [...items].some(match)).sort((a, b) => byName(a[0], b[0]))
        .map(([fac, items]) => listItem(fac, { type: 'facility', arg: fac }, items.size, '', 'item'))].filter(Boolean);
    }
  } else if (state.module === 'types') {
    rows = [...itemTypes()].filter(([t]) => match(t)).sort((a, b) => byName(a[0], b[0]))
      .map(([t, n]) => listItem(t, { type: 'itemtype', arg: t }, n, '', 'item'));
  } else if (state.module === 'wishlist') {
    rows = [...wish].filter(match).sort(byName).map(name => h('button', { type: 'button', class: 'list-item', title: name, onclick: () => showItem(name) }, name));
  } else if (state.module === 'quests') {
    // Grouped by your live progress, like a quest log: active first, completed last.
    rows.push(h('button', { type: 'button', class: 'list-item quest-overview-link' + (!state.detail && state.view?.type === 'questlog' ? ' sel' : ''),
      onclick: () => state.view?.type === 'questlog' ? closeDetail() : go({ type: 'questlog', arg: '' }, { detail: null }) }, h('span', { class: 'quest-overview-label' }, 'Quest journal'), h('span', { class: 'count' }, questLogAge())));
    if (db.questChain) rows.push(h('button', { type: 'button', class: 'list-item', onclick: () => go({ type: 'questchain', arg: '' }, { detail: null }) }, 'Story & quest order'));
    const quests = filteredQuests();
    const removed = f ? Object.values(E).filter((e) => e.kind === 'quest' && !e.hidden && questRemoved(e) && questMatches(e)) : [];
    for (const st of QUEST_STATES) {
      const qs = quests.filter((q) => questStatus(q) === st.id)
        .sort((a, b) => byName(a.region || '~', b.region || '~') || (b.type === 'Main quest') - (a.type === 'Main quest') || byName(a.name, b.name));
      if (!qs.length) continue;
      const open = questGroupOpen(st.id);
      rows.push(questGroupHeading(st, open, `list-group quest-list-group q-${st.id}`, st.label, h('span', { class: 'count' }, qs.length)));
      if (open) rows.push(...qs.map((q) =>
        h('div', { class: `list-item indent q-${st.id}` + (state.detail === q.name ? ' sel' : ''), title: `${q.type}${q.region ? ' · ' + q.region : ''}`, onclick: () => showItem(q.name) },
          h('span', { class: 'quest-list-text' }, h('span', { class: 'quest-list-name' }, q.name),
            h('span', { class: 'quest-list-region' }, [q.region, tierText(questTier(q.name, q.id, q.region))].filter(Boolean).join(' · '))))));
    }
    if (removed.length) {
      rows.push(h('div', { class: 'list-group q-removed' }, '✕ Removed from the game', h('span', { class: 'count' }, removed.length)));
      rows.push(...removed.sort((a, b) => byName(a.name, b.name)).map((q) =>
        h('div', { class: 'list-item indent q-removed' + (state.detail === q.name ? ' sel' : ''), title: q.availability.reason, onclick: () => showItem(q.name) },
          h('span', { class: 'quest-list-text' }, h('span', { class: 'quest-list-name' }, q.name), h('span', { class: 'quest-tags' }, questTypeTag(q), q.region ? h('span', { class: 'quest-list-region' }, q.region) : null)))));
    }
  } else if (state.module === 'map') {
    rows = [h('div', { class: 'empty' }, 'Map')];
  }
  const caption = rows.length && LIST_CAPTIONS[state.module] ? h('div', { class: 'list-caption' }, LIST_CAPTIONS[state.module]) : null;
  results.replaceChildren(...(rows.length ? [caption, ...rows].filter(Boolean) : []));
  // Folded quest groups still count.
  const count = state.module === 'quests' ? filteredQuests().length + results.querySelectorAll('.q-removed .quest-list-text').length
    : results.querySelectorAll('.list-item, .journal-item').length;
  list.querySelector('.filter-count').textContent = `${count} ${state.module === 'quests' ? 'quests' : 'entries'}${f ? ' found' : ''}`;
  if (!count && !results.querySelector('.empty')) results.append(h('div', { class: 'empty' },
    h('p', {}, f ? `No matches for “${state.filter}”. Try a shorter name or clear the filter.` : state.module === 'wishlist' ? 'Add an item to your wishlist from its details.' : 'No entries are available in this section.')));
}

/* ---------- Middle column ---------- */

function lootRow(itemName, meta, cls) {
  return h('div', { class: 'loot-row' + (state.detail === itemName ? ' sel' : ''), onclick: () => showItem(itemName) },
    icon(itemName), h('span', { class: `name ${cls || itemClass(itemName)}` }, itemName), learningTag(itemLearningState(ent(itemName)),true), h('span', { class: 'meta' }, ...meta));
}

const CHANCE_KEY = [['r-always', 'Always'], ['r-common', '25% or more'], ['r-uncommon', '5–25%'], ['r-rare', '1–5%'], ['r-epic', 'Under 1%'], ['r-unknown', 'Chance unknown']];

// One row per item within a group: a guaranteed drop plus a bonus roll of the same item reads as
// "×2 Always · +1 at 50%" instead of two look-alike rows.
function dropsGrid(drops) {
  const out = [];
  const used = new Set();
  const groups = [];
  for (const d of drops) {
    let g = groups.at(-1);
    if (!g || g.name !== d.group) groups.push(g = { name: d.group, items: new Map() });
    if (!g.items.has(d.item)) g.items.set(d.item, []);
    g.items.get(d.item).push(d);
  }
  for (const g of groups) {
    if (g.name) out.push(h('div', { class: 'group-label' }, g.name));
    for (const [item, rolls] of g.items) {
      const meta = rolls.flatMap((d, i) => {
        const cls = rarityClass(d.pct, d.rarity);
        used.add(cls);
        return [i ? h('br') : null, h('span', { class: 'drop-qty' }, `${i ? '+' : '×'}${d.qty || '?'}`), ' ', h('span', { class: cls }, i ? `at ${d.rarity || '?'}` : d.rarity || '?')];
      });
      const title = rolls.map((d, i) => `${i ? 'Bonus roll: ' : ''}${d.qty || '?'} × ${item}, ${/always/i.test(d.rarity || '') ? 'always' : (d.rarity || 'chance unknown')}`).join('\n');
      out.push(Object.assign(lootRow(item, meta, rarityClass(rolls[0].pct, rolls[0].rarity)), { title }));
    }
  }
  const key = CHANCE_KEY.filter(([cls]) => used.has(cls));
  return h('div', {},
    h('div', { class: 'chance-key', 'aria-label': 'Drop chance colours' }, h('span', { class: 'chance-key-title' }, 'Quantity · chance:'),
      key.map(([cls, label]) => h('span', { class: `chance-key-item ${cls}` }, h('i', { class: 'chance-dot' }), label))),
    h('div', { class: 'loot' }, out));
}

// Build each branch on demand: alternative recipes can share ingredients or form cycles.
function craftRoutes(name) {
  if(ent(name).availability?.status==='unavailable')return [];
  const groups=new Map();
  for(const r of ent(name).recipes) {
    if(r.facility?.startsWith('Vendor: ') || r.availability?.status==='unavailable')continue;
    const key=JSON.stringify([r.id,r.materials,r.outputs,r.stationUpgrade?.name]);
    if(groups.has(key))groups.get(key).stations.add(r.facility);
    else groups.set(key,{recipe:r,stations:new Set([r.facility])});
  }
  return [...groups.values()];
}

function craftingGuide(name,preferred) {
  if(!craftRoutes(name).length)return null;
  const body=h('div',{class:'craft-guide-body'});
  const button=h('button',{type:'button',class:'craft-guide-button','aria-expanded':'false',onclick:()=>{
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));
    body.hidden=expanded;
    if(!expanded && !body.childNodes.length)body.append(craftSequence(name,preferred));
  }},h('span',{class:'craft-guide-label'},'How to Craft'),h('span',{class:'craft-guide-hint muted small'},'From raw materials to the finished item'));
  body.hidden=true;
  return h('section',{class:'craft-guide','aria-label':`How to craft ${name}`},button,body);
}

// Resolve dependencies first so the guide reads in the order the player acts.
function craftRouteKey(recipe) { return JSON.stringify([recipe.id,recipe.stationUpgrade?.name||'']); }
function craftPlan(name,quantity=1,choices=new Map()) {
  const supplies=new Map(),steps=[],spare=new Map();
  const visit=(item,needed,seen)=>{
    const available=spare.get(item)||0;
    const used=Math.min(available,needed);
    needed-=used;spare.set(item,available-used);
    if(!needed)return;
    const routes=craftRoutes(item);
    if(!routes.length || seen.has(item)) {
      const supply=supplies.get(item)||{item,qty:0,cycle:false};
      supply.qty+=needed;supply.cycle ||= seen.has(item);supplies.set(item,supply);return;
    }
    const route=routes.find(x=>craftRouteKey(x.recipe)===choices.get(item))||routes.find(x=>x.recipe.id===choices.get(item))||routes[0];
    const r=route.recipe;
    const yieldQty=Number(r.outputs.find(o=>o.item===item)?.qty)||1;
    const batches=Math.ceil(needed/yieldQty);
    const materials=r.materials.map(m=>({item:m.item,qty:Number(m.qty)*batches}));
    const visited=new Set([...seen,item]);
    materials.forEach(m=>visit(m.item,m.qty,visited));
    spare.set(item,(spare.get(item)||0)+batches*yieldQty-needed);
    steps.push({item,qty:batches*yieldQty,batches,materials,route,routes});
  };
  visit(name,quantity,new Set());
  return {supplies:[...supplies.values()],steps};
}

function craftSequence(name,preferred) {
  const choices=new Map(preferred ? [[name,preferred]] : []);
  const wrapper=h('div',{class:'craft-sequence'});
  const link=(item,qty)=>h('button',{type:'button',class:'item-link',onclick:()=>showItem(item)},`${qty} × ${item}`);
  const renderSteps=()=>{
    const plan=craftPlan(name,1,choices);
    const list=h('ol',{class:'craft-steps','aria-label':`Steps to craft ${name}`});
    for(const supply of plan.supplies) {
      const source=h('div',{});
      const details=h('details',{class:'craft-step-sources'},h('summary',{},'Where to find it'),source);
      details.addEventListener('toggle',()=>{
        if(details.open&&!source.childNodes.length)source.append(craftProcurement(ent(supply.item)));
      });
      list.append(h('li',{class:'craft-step craft-supply'},icon(supply.item),
        h('div',{class:'craft-step-main'},h('span',{class:'craft-step-kind'},'Collect'),
          h('div',{class:'craft-step-title'},'Obtain ',link(supply.item,supply.qty)),
          supply.cycle ? h('p',{class:'muted small'},'This recipe loops back to this ingredient. Obtain it separately or choose another recipe below.') : null,
          details)));
    }
    for(const step of plan.steps) {
      const {recipe:r,stations}=step.route;
      const stationNames=[...stations].filter(Boolean);
      const title=h('div',{class:'craft-step-title'},'Craft ',link(step.item,step.qty),' at ',
        r.stationUnconfirmed || !stationNames.length ? 'an unconfirmed station' : stationNames.flatMap((station,i)=>[
          i?' or ':null,Object.assign(stationButton(station),{className:'station-chip craft-station-link'})]).filter(Boolean));
      const use=h('p',{class:'craft-step-use'},'Use ',step.materials.length ? step.materials.flatMap((m,i)=>[i?' + ':null,link(m.item,m.qty)]).filter(Boolean) : 'the materials listed in the recipe (not confirmed in the extracted data)',
        step.batches>1 ? ` · ${step.batches} crafts` : null,'.');
      const main=h('div',{class:'craft-step-main'},h('span',{class:'craft-step-kind craft-kind-make'},'Craft'),title,use);
      if (r.stationUpgrade) main.append(stationUpgradeInstructions(r));
      const row=h('li',{class:'craft-step craft-make'},icon(step.item),main);
      if(r.manualUnlockOnly || r.unlockKinds?.some(k=>['learning','quest','skill','unconfirmed'].includes(k))) {
        main.append(h('details',{class:'craft-step-sources'},h('summary',{},'Recipe unlock requirement'),recipeUnlock(r,step.item)));
      }
      if(step.routes.length>1) {
        const select=h('select',{'aria-label':`Recipe for ${step.item}`,onchange:()=>{
          choices.set(step.item,select.value);renderSteps();
          // Preserve keyboard focus when the dependency list changes.
          [...wrapper.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')===`Recipe for ${step.item}`)?.focus({preventScroll:true});
        }},step.routes.map(({recipe:option,stations:places})=>h('option',{value:craftRouteKey(option)},option.materials.map(m=>`${m.qty} × ${m.item}`).join(' + ')+` · ${[...places].join(' or ')}${option.stationUpgrade ? ` + ${option.stationUpgrade.name}` : ''}`)));
        select.value=craftRouteKey(r);
        main.append(h('label',{class:'craft-route-picker'},`Other ways to make it (${step.routes.length})`,select));
      }
      list.append(row);
    }
    wrapper.replaceChildren(h('p',{class:'muted small craft-sequence-intro'},`Do these ${plan.supplies.length+plan.steps.length} steps from top to bottom to make 1 × ${name}.`),list);
  };
  renderSteps();
  return wrapper;
}

function craftProcurement(e,optional=false) {
  const routes=acquisitionRoutes(e);
  const lower=e.name.toLowerCase();
  const directGathering=!craftRoutes(e.name).length ? db.map.markers.filter(m=>
    ['ore','gather','salvage'].includes(m.c) && (lower===m.n.toLowerCase() || lower.startsWith(m.n.toLowerCase()+' '))) : [];
  const markers=[...new Set([...directGathering,...markersFor(e.name)])];
  const gathering=markers.filter(m=>['ore','gather','salvage'].includes(m.c));
  const regions=[...new Set(gathering.map(m=>m.region).filter(Boolean))];
  if(optional && !routes.length && !markers.length && !e.location?.length)return null;
  return h('div',{class:'craft-procurement'},
    e.desc ? h('p',{},e.desc) : null,
    e.availability?.status==='unavailable' ? h('p',{},e.availability.reason) : null,
    gathering.length ? h('p',{},`Gather from ${[...new Set(gathering.map(m=>m.n))].join(' / ')}${regions.length ? ` · ${regions.join(', ')}` : ''}.`) : null,
    e.location?.length ? h('p',{},`Found in: ${e.location.join(', ')}`) : null,
    markers.length ? locationButtons(e.name,markers) : null,
    routes.length ? h('details',{class:'craft-source-list'},h('summary',{},`Loot, vendors & unlocks (${routes.length})`),routes) : null,
    !routes.length && !markers.length && !e.location?.length ? h('p',{class:'muted small'},'No acquisition location is confirmed in the extracted data.') : null);
}

function stationButton(station) {
  return h('button',{type:'button',class:'station-chip',title:`Show every recipe made at ${station}`,onclick:()=>{
    navigateTo('crafting', {type:'facility',arg:station});
  }},station);
}

// Reads as three plain answers: what you need, where you make it, how you unlock it.
// showHead=false when the page already names the item (journal page, item panel).
function stationUpgradeInstructions(recipe) {
  const upgrade = recipe.stationUpgrade;
  if (!upgrade) return null;
  return h('div', { class: 'recipe-station-upgrade' }, h('strong', {}, `Requires ${upgrade.name}`),
    h('p', { class: 'small' }, upgrade.placement || `Build ${upgrade.name} next to the ${recipe.facility} to enable this recipe.`),
    h('p', { class: 'small' }, `Put the listed ingredients into the ${recipe.facility}, then start processing.`),
    h('details', {}, h('summary', {}, `Build ${upgrade.name} · Build menu`),
      h('div', { class: 'mats' }, upgrade.materials.map(m => h('button', { type: 'button', class: 'mat', onclick: () => showItem(m.item) },
        icon(m.item, 'sm'), h('span', { class: 'q' }, `${m.qty}×`), h('span', { class: 'mat-name' }, m.item))))));
}
function recipeCard(r, outputName, showEffects = true, showHead = true, showGuide = true) {
  const out = r.outputs.find((o) => o.item === outputName) || r.outputs[0] || { item: outputName };
  const e = ent(out.item);
  const vendor = r.facility?.startsWith('Vendor: ');
  const unavailable = r.availability?.status==='unavailable';
  const skills = r.skills.map((s) => `${s.skill}${s.xp != null ? ' +' + s.xp + ' xp' : ''}`).join(', ');
  const row = (cls, label, ...content) => h('div', { class: `recipe-row ${cls}` }, h('div', { class: 'recipe-label' }, label), h('div', { class: 'recipe-value' }, ...content));
  const where = unavailable ? h('span', {}, 'Not craftable')
    : vendor ? h('span', {}, db.vendors?.[r.facility]?.name || r.facility.slice(8))
    : r.stationUnconfirmed || !r.facility ? h('span', { class: 'muted' }, 'Station not confirmed')
    : r.facility.split(' · ').map(stationButton);
  return h('div', { class: 'recipe' + (showHead ? '' : ' recipe-bare') },
    showHead ? h('div', { class: 'recipe-head' }, icon(out.item),
      h('div', { class: 'recipe-title' },
        h('button', { type: 'button', class: 'name item-link ' + itemClass(out.item), onclick: () => showItem(out.item), 'aria-label': `View ${out.item} item details` }, `${out.qty && out.qty !== 1 ? out.qty + ' × ' : ''}${out.item}`),
        h('div', { class: 'recipe-type muted small' }, [e.type, e.journal?.masterwork && 'Masterwork', e.journal?.armourWeight && `${e.journal.armourWeight} armour`, e.journal?.skill].filter(Boolean).join(' · ')))) : null,
    showHead ? journalStats(e, true) : null,
    showEffects ? itemEffectsPanel(e) : null,
    h('div', { class: 'recipe-rows' },
      row('recipe-cost', vendor ? 'Price' : 'You need',
        h('div', { class: 'mats' }, r.materials.length ? r.materials.map((m) => h('button', { type: 'button', class: 'mat', title: `${m.qty} × ${m.item}`, onclick: () => showItem(m.item) }, icon(m.item, 'sm'), h('span', { class: 'q' }, `${m.qty}×`), h('span', { class: 'mat-name' }, m.item))) : h('span', { class: 'muted' }, 'No materials listed'))),
      row('recipe-where', vendor ? 'Buy from' : 'Make it at', h('div', { class: 'station-chips' }, where), stationUpgradeInstructions(r), skills ? h('span', { class: 'recipe-skill muted small' }, skills) : null),
      vendor ? null : row('recipe-unlock-row', 'Unlock', recipeUnlock(r, out.item)),
      r.outputs.length > 1 ? row('recipe-extra', 'Also makes', r.outputs.filter(o => o !== out).map(o => h('button', { type: 'button', class: 'item-link', onclick: () => showItem(o.item) }, `${o.qty} × ${o.item}`))) : null),
    showGuide && !vendor && !unavailable ? craftingGuide(out.item,r.id) : null);
}

function openQuest(name) {
  navigateTo('quests', {type:'questlog',arg:''}, {detail:name});
}

function recipeUnlock(r,name) {
  const routes=(ent(name).acquisition || []).filter(a=>a.recipe===r.id);
  if(r.facility?.startsWith('Vendor: '))return null;
  if(r.availability?.status==='unavailable')return h('div',{class:'recipe-unlock small'},unlockBadges(r,true),h('div',{},'Historical recipe retained in the game files. It cannot currently be crafted.'));
  return h('div',{class:'recipe-unlock small'},unlockBadges(r,true),
    r.stationUnconfirmed ? h('div',{},'Crafting station is not confirmed in the extracted data.') : null,
    !r.stationUnconfirmed && r.unlockKinds?.includes('materials') ? h('div',{},'Nothing to do: you learn it the first time you pick up all the materials.') : null,
    routes.map(a=>a.kind==='study' ? h('div',{},'Study ',h('button',{type:'button',class:'item-link',onclick:()=>showItem(a.item)},a.item),' to learn it.')
      : a.kind==='quest-recipe' ? h('div',{},'You get it during the quest ',h('button',{type:'button',class:'item-link',onclick:()=>openQuest(a.quest)},a.quest),'.')
      : a.kind==='world-recipe' ? h('div',{},'Learn it from ',a.label,'.')
      : a.kind==='skill-recipe' ? h('div',{},'Unlock the skill perk ',h('b',{},a.perk),'.') : null),
    r.unlockKinds?.includes('unconfirmed') ? h('div',{},'Recipe unlock source is not confirmed in the extracted data.') : null);
}

// compact hides "unknown" learning status, which says nothing useful inside a recipe card.
function unlockBadges(recipe,compact=false) {
  if(recipe.availability?.status==='unavailable')return h('div',{class:'unlock-badges'},learningTag('unavailable'));
  const labels={learning:'Must be learned',quest:'Quest reward',materials:'Automatic',skill:'Skill perk',unconfirmed:'Unlock unconfirmed'};
  return h('div',{class:'unlock-badges'},learningTag(RecipeKnowledge.status(recipe.id),compact),(recipe.unlockKinds || []).filter(k=>!recipe.stationUnconfirmed || k!=='materials').map(k=>h('span',{class:`unlock-badge unlock-${k}`},labels[k])));
}

function acquisitionRoutes(e,depth=0,seen=new Set()) {
  if (depth>3 || seen.has(e.name)) return [];
  const visited=new Set([...seen,e.name]);
  const nested=n=>acquisitionRoutes(ent(n),depth+1,visited);
  const itemButton=n=>h('button',{type:'button',class:'item-link',onclick:()=>showItem(n)},n);
  const routes=[];
  for (const a of e.acquisition || []) {
    if (a.kind==='study' || a.kind==='open') {
      const source=nested(a.item);
      routes.push(h('div',{class:'acquisition-route'},h('div',{},a.kind==='study' ? 'Study ' : 'Open ',itemButton(a.item),
        a.kind==='study' ? ' to unlock the crafting recipe.' : a.pct != null ? ` · ${a.pct === 100 ? 'Always' : a.pct+'%'}` : ''),
        sourceMapLinks(a.item),source.length ? h('div',{class:'acquisition-chain'},source) : h('p',{class:'muted small'},'Where to obtain this item is not confirmed in the extracted data.')));
    } else if (a.kind==='quest-item' || a.kind==='quest-recipe') {
      const q=ent(a.quest);
      const objective=q.objectives?.find(o=>o.key===a.objective)?.text;
      const questMarkers=db.map.markers.filter(m=>m.ref===a.quest && (!a.questId || m.questId===a.questId));
      const stepMarkers=a.objective ? questMarkers.filter(m=>m.qsteps?.includes(a.objective)) : questMarkers;
      routes.push(h('div',{class:'acquisition-route'},h('span',{class:'unlock-badge'},a.kind==='quest-recipe' ? 'Quest recipe' : 'Quest item'),h('div',{},a.kind==='quest-recipe' ? 'Recipe granted during ' : 'Item granted during ',
        h('button',{type:'button',class:'item-link',onclick:()=>openQuest(a.quest)},a.quest),
        a.qty != null ? ` · ×${a.qty}` : ''),objective ? h('div',{class:'muted small'},objective) : null,
        locationButtons(a.quest,stepMarkers.length ? stepMarkers : questMarkers,a.quest)));
    } else if(a.kind==='world-recipe') {
      routes.push(h('div',{class:'acquisition-route'},h('span',{class:'unlock-badge'},'Learning required'),
        h('div',{},'Learn the recipe from ',a.label,'.'),locationButtons(e.name,db.map.markers.filter(m=>m.sourceId===a.sourceId && m.recipe===a.recipe))));
    } else if(a.kind==='skill-recipe') {
      routes.push(h('div',{class:'acquisition-route'},h('span',{class:'unlock-badge'},'Skill perk'),h('div',{},'Unlock ',a.perk,'.')));
    }
  }
  const vendors=e.recipes.filter(r=>r.facility?.startsWith('Vendor: '));
  for(const r of vendors) {
    const vendor=db.vendors?.[r.facility];
    routes.push(h('div',{class:'acquisition-route'},h('div',{},'Buy from ',vendor?.name || r.facility.slice(8),vendor?.region ? ` · ${vendor.region}` : ''),
      h('div',{class:'acquisition-cost'},r.materials.map(m=>h('span',{},`${m.qty} × `,itemButton(m.item)))),
      locationButtons(e.name,db.map.markers.filter(m=>m.vendor===r.facility))));
  }
  for(const s of e.droppedBy) routes.push(h('div',{class:'acquisition-route'},
    h('button',{type:'button',class:'item-link',onclick:()=>{
      navigateTo(ent(s.from).kind==='monster'?'monsters':'containers', {type:'source',arg:s.from}, {detail:e.name});
    }},s.from),h('span',{class:'muted small'},` · ${s.rarity || 'Chance unconfirmed'}${s.qty ? ' · ×'+s.qty : ''}`),
    sourceMapLinks(s.from)));
  if(depth && !routes.length) {
    const crafted=e.recipes.filter(r=>!r.facility?.startsWith('Vendor: '));
    if(crafted.length) routes.push(h('div',{class:'acquisition-route'},'Craft at ',[...new Set(crafted.map(r=>r.facility))].join(' / '),
      h('div',{class:'muted small'},'Open the item for its materials.')));
  }
  return routes;
}

// besideRecipe: the recipe card on the same page already explains automatic unlocks.
function acquisitionPanel(e,besideRecipe=false) {
  if(e.availability?.status==='unavailable')return h('section',{class:'acquisition availability-explanation'},h('h2',{},'How to obtain'),
    h('p',{},e.availability.reason),h('a',{href:e.availability.source,target:'_blank',rel:'noopener noreferrer'},'Availability source'),
    h('span',{class:'muted small'},` · Checked ${e.availability.reviewedAt}`));
  const manual=e.recipes.some(r=>r.manualUnlockOnly);
  const automatic=e.recipes.filter(r=>!r.stationUnconfirmed && r.unlockKinds?.includes('materials'));
  if (!e.acquisition?.length && e.type!=='Recipe unlock' && !manual && !e.contents?.length && !e.droppedBy.length && !automatic.length) return null;
  // Skill perks are fully described by the recipe card's unlock row.
  const routes=acquisitionRoutes(besideRecipe ? {...e,acquisition:e.acquisition?.filter(a=>a.kind!=='skill-recipe')} : e);
  if(besideRecipe && !routes.length && !e.unlocks?.length && !e.contents?.length)return null;
  return h('section',{class:'acquisition'},h('h2',{},'How to obtain'),
    automatic.length && !besideRecipe ? h('div',{class:'automatic-unlock'},h('span',{class:'unlock-badge'},'Automatic'),
      h('p',{},'You learn this recipe the first time you pick up all its materials. Then craft it at the station listed below.'),
      h('details',{class:'discovery-materials'},h('summary',{},'Find required materials on map'),[...new Set(automatic.flatMap(r=>r.materials.map(m=>m.item)))].map(n=>h('div',{},
        h('button',{type:'button',class:'item-link',onclick:()=>showItem(n)},n),sourceMapLinks(n))))) : null,
    routes.length ? routes : automatic.length ? null : h('p',{class:'muted'},manual ? 'A recipe unlock is required, but its source is not confirmed in the extracted data.' : 'No source is confirmed in the extracted data.'),
    e.unlocks?.length ? h('div',{class:'acquisition-unlocks'},h('h3',{},'Unlocks recipes for'),h('div',{class:'mats'},e.unlocks.map(n=>h('button',{type:'button',class:'mat',onclick:()=>showItem(n)},icon(n,'sm'),n)))) : null,
    e.contents?.length ? h('div',{},h('h3',{},'Contains'),h('div',{class:'mats'},e.contents.map(c=>h('button',{type:'button',class:'mat',onclick:()=>showItem(c.item)},icon(c.item,'sm'),c.item,
      h('span',{class:'muted small'},c.pct != null ? ` · ${c.pct}%` : ''))))) : null);
}

function itemEffectsPanel(e) {
  if(!e.effects?.length)return null;
  return h('section',{class:'item-effects','aria-label':`${e.name} benefits and effects`},
    h('h3',{},'Benefits & effects'),
    h('ul',{},e.effects.flatMap(effect=>effect.description.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>h('li',{},line)))),
    e.effectNotes?.length ? h('p',{class:'muted small'},e.effectNotes.join(' ')) : null);
}

function journalStats(e, compact = false) {
  const stats = e.journal?.stats || [];
  if (!stats.length) return null;
  const shown = compact ? stats.filter(s => !['Durability', 'Critical chance bonus'].includes(s.label)).slice(0, 4) : stats;
  const values = h('dl', { class: compact ? 'journal-stats compact' : 'journal-stats', 'aria-label': `${e.name} base item stats` },
    shown.map(s => h('div', { class: 'journal-stat' }, h('dt', {}, s.label), h('dd', {}, `${s.prefix || ''}${+s.value.toFixed(2)}${s.max != null ? '–' + s.max : ''}${s.unit}`))));
  return h('div', { class: 'journal-stats-block' }, values,
    !compact && e.journal?.damageNote ? h('p', { class: 'muted small weapon-damage-note' }, e.journal.damageNote) : null);
}

function armourSetSummary(set) {
  const pieces = Object.entries(set.slots).filter(([,names]) => names.length).map(([slot,names]) => ({ slot,
    item: ent(names.includes(armourChoices[set.id]?.[slot]) ? armourChoices[set.id][slot] : names[0]) }));
  const stats = ['Defence', 'Melee resistance', 'Ranged resistance', 'Magic resistance', 'Vital shield'].map(label => {
    const values = pieces.map(p => p.item.journal?.stats.find(s => s.label === label)?.value);
    return { label, value: values.every(Number.isFinite) ? values.reduce((a,b)=>a+b,0) : null, unit: '' };
  }).filter(s => s.value != null);
  if (pieces.every(p=>Number.isFinite(p.item.weight))) stats.push({ label: 'Weight', value: pieces.reduce((sum,p)=>sum+p.item.weight,0), unit: '' });
  return { pieces, stats };
}

function armourSetPage(id) {
  const set = armourSet(id);
  if (!set) return h('p', { class: 'empty' }, 'This armour set is no longer in the game data.');
  const { pieces, stats } = armourSetSummary(set);
  const levels = pieces.map(p=>p.item.journal?.stats.find(s=>s.label==='Power level')?.value).filter(Number.isFinite);
  const power = levels.length === pieces.length ? `Power level ${Math.min(...levels)}${Math.max(...levels) !== Math.min(...levels) ? '–'+Math.max(...levels) : ''}` : null;
  const portraits = pieces.map(({slot,item}) => {
    const names = set.slots[slot];
    const art = item.journal?.image ? h('img', { src: '../../data/'+item.journal.image, alt: '', class: 'set-piece-art' }) : icon(item.name,'lg');
    if (art.tagName === 'IMG') art.addEventListener('error',()=>art.replaceWith(icon(item.name,'lg')), { once:true });
    const select = names.length > 1 ? h('select', { 'aria-label': `${slot} variant`, onchange: event => {
      armourChoices[id] = { ...armourChoices[id], [slot]: event.target.value };
      Preferences.setJSON('armourChoices',armourChoices); renderContent();
    } }, names.map(n=>h('option',{value:n},n))) : null;
    if (select) select.value = item.name;
    return h('div', { class:'set-piece' }, h('div', { class:'muted small' },slot),
      h('button', { type:'button', class:'set-art-link', onclick:()=>showItem(item.name), 'aria-label':`Read ${item.name} journal entry` },art),
      h('div',{class:'set-piece-title'},h('button', { type:'button', class:'item-link', onclick:()=>showItem(item.name) },item.name)), h('div',{class:'set-variant'},select), pieceCrafting(item),
      h('div',{class:'piece-source-links'},sourceMapLinks(item.name)));
  });
  return h('article', { class:'journal-page armour-set-page' }, header(set.name, [set.weightClass && `${set.weightClass} armour`, `${pieces.length} pieces`, power].filter(Boolean).join(' · ')),setLearningTag(set),
    h('div', {class:'set-portraits'}, portraits),
    h('div', {class:'set-summary'},
      h('section', {}, h('h2',{},'Combined base stats'), journalStats({name:set.name,journal:{stats}}),
        h('p',{class:'muted small'},`Totals for the ${pieces.length} selected pieces. One item per slot; skills and temporary effects are excluded.`)),
      h('section', {}, h('h2',{},set.weightClass ? `${set.weightClass} armour bonuses` : 'Armour bonuses'),
        set.bonuses.length ? h('div',{class:'set-bonuses'},set.bonuses.map(b=>h('div',{class:'set-bonus'},
          h('span',{class:'muted small'},`Tier ${b.tier}`),h('span',{},b.label),h('strong',{},`${b.value > 0 ? '+' : ''}${b.value}${b.unit}${b.duration ? ` · ${b.duration}s` : ''}`)))) : h('p',{class:'muted'},'No weight-class bonus is recorded for these pieces.'),
        set.bonuses.length ? h('p',{class:'muted small'},`Shared by ${set.weightClass.toLowerCase()} armour. Bonuses are listed separately from base totals.`) : null)),
    h('section',{class:'set-acquisition'},h('h2',{},'How to obtain this set'),pieces.map(({slot,item})=>
      h('div',{class:'set-acquisition-piece'},h('h3',{},`${slot} · `,h('button',{type:'button',class:'item-link',onclick:()=>showItem(item.name)},item.name)),
        acquisitionRoutes(item).length ? acquisitionRoutes(item) : h('p',{class:'muted small'},item.recipes.length ? `Craft at ${[...new Set(item.recipes.map(r=>r.facility))].join(' / ')}. Open the piece for its materials.` : 'No acquisition source is confirmed in the extracted data.')))),
    h('section',{class:'set-breakdown'},h('h2',{},'Stats by piece'),h('div',{class:'set-table-scroll'},
      h('table',{class:'set-table'},h('thead',{},h('tr',{},h('th',{scope:'col'},'Piece'),stats.map(s=>h('th',{scope:'col'},s.label)))),
        h('tbody',{},pieces.map(({slot,item})=>h('tr',{},h('th',{scope:'row'},h('button',{type:'button',class:'item-link',onclick:()=>showItem(item.name)},item.name),h('div',{class:'muted small'},slot)),
          stats.map(s=>h('td',{},s.label==='Weight' ? item.weight : item.journal.stats.find(v=>v.label===s.label)?.value ?? '—')))),
          h('tr',{class:'set-total'},h('th',{scope:'row'},'Total'),stats.map(s=>h('td',{},+s.value.toFixed(2))))))))) ;
}

function pieceCrafting(item) {
  const groups=new Map();
  for(const r of item.recipes.filter(r=>!r.facility?.startsWith('Vendor: '))) {
    const key=JSON.stringify([r.id,r.materials,r.outputs,r.stationUpgrade?.name]);
    if(groups.has(key)) groups.get(key).stations.add(r.facility);
    else groups.set(key,{recipe:r,stations:new Set([r.facility])});
  }
  if(!groups.size) return h('p',{class:'muted small piece-crafting'},'No crafting recipe recorded.');
  return h('div',{class:'piece-crafting'},[...groups.values()].map(({recipe,stations})=>h('div',{class:'piece-recipe'},
    unlockBadges(recipe),
    recipe.availability?.status!=='unavailable' ? craftingGuide(item.name,recipe.id) : null,
    h('div',{class:'small muted'},'Materials'),
    h('div',{class:'piece-materials'},recipe.materials.length ? recipe.materials.map(m=>h('button',{type:'button',class:'piece-material',onclick:()=>showItem(m.item)},
      icon(m.item,'sm'),h('span',{},`${m.qty} × ${m.item}`))) : h('span',{class:'muted small'},'No materials listed.')),
    h('div',{class:'piece-station'},h('span',{class:'small muted'},recipe.availability?.status==='unavailable' ? 'Historical recipe' : 'Crafted at'),h('span',{},recipe.availability?.status==='unavailable' ? 'Not craftable' : recipe.stationUnconfirmed ? 'Station unconfirmed' : [...stations].join(' / '))))));
}

function journalPage(name) {
  const e = ent(name);
  const j = e.journal;
  const artwork = j?.image ? h('img', { class: 'journal-art', src: '../../data/' + j.image, alt: `${e.name} — in-game journal illustration` }) : null;
  if (artwork) artwork.addEventListener('error', () => artwork.replaceWith(icon(name, 'lg')), { once: true });
  const recipeGroups = new Map();
  for (const r of e.recipes.filter(r => !r.facility?.startsWith('Vendor: '))) {
    const key = JSON.stringify([r.id, r.materials, r.outputs, r.skills, r.stationUpgrade?.name]);
    const existing = recipeGroups.get(key);
    if (existing) existing.facility += ` · ${r.facility}`;
    else recipeGroups.set(key, { ...r });
  }
  const recipes = [...recipeGroups.values()];
  return h('article', { class: 'journal-page' },
    header(e.name, [j?.category, j?.group].filter(Boolean).join(' / ') || e.type),
    learningTag(itemLearningState(e)), recipeProgressNote(e),
    h('div', { class: 'actions' }, mapButton(name), h('button', { type: 'button', onclick: () => {
      wish.has(name) ? wish.delete(name) : wish.add(name); saveWish(); renderContent(); renderModules();
    } }, wish.has(name) ? 'Remove from wishlist' : 'Add to wishlist')),
    acquisitionPanel(e, recipes.length > 0),
    e.armourSet ? h('button', { type: 'button', class: 'set-open', onclick: () => go({ type: 'armourset', arg: e.armourSet }, { detail: null }) }, `View ${armourSet(e.armourSet).name}`) : null,
    h('div', { class: 'journal-overview' },
      h('div', { class: 'journal-illustration' }, artwork || icon(name, 'lg')),
      h('div', { class: 'journal-facts' },
        recipes.length ? h('section', { class: 'journal-recipes' }, h('h2', {}, e.availability?.status==='unavailable' ? 'Historical recipe' : 'How to make it'),
          recipes.flatMap((r, i) => [recipes.length > 1 ? h('div', { class: 'recipe-option' }, `Option ${i + 1} of ${recipes.length}`) : null, recipeCard(r, name, false, false, false)]))
          : h('p', { class: 'muted' }, 'This item can’t be crafted. See where to find it below.'),
        h('section', { class: 'journal-stat-block' }, h('h2', {}, 'Stats'),
          journalStats(e),
          h('dl', { class: 'journal-stats' }, [['Weight', e.weight], ['Stack', e.stack]].filter(([,v]) => v != null).map(([label,value]) => h('div', { class: 'journal-stat' }, h('dt', {}, label), h('dd', {}, value))))),
        itemEffectsPanel(e), journalDescription(e))),
    // Full width below the overview: the expanded guide is a long tree and needs the room.
    recipes.length && e.availability?.status !== 'unavailable' ? craftingGuide(name, recipes[0].id) : null,
    j?.notes?.length ? h('section', { class: 'journal-notes' }, h('h2', {}, 'Journal notes'), j.notes.flatMap(note => note.split(/\r?\n\s*\r?\n/).map(p => h('p', {}, p)))) : null,
    e.droppedBy.length ? h('section', {}, h('h2', {}, 'Sources'), e.droppedBy.map(s => h('button', { type: 'button', class: 'journal-source', onclick: () => {
      navigateTo(ent(s.from).kind === 'monster' ? 'monsters' : 'containers', { type: 'source', arg: s.from }, { detail: name });
    } }, `${s.from} · ${s.qty || ''} · ${s.rarity || 'Chance unknown'}`))) : null,
    e.usedIn.length ? h('section', {}, h('h2', {}, 'Used in'), h('div', { class: 'mats' }, [...new Set(e.usedIn.map(u => u.item))].map(n => h('button', { type: 'button', class: 'mat', onclick: () => showItem(n) }, icon(n, 'sm'), n)))) : null);
}

function header(title, sub, name) {
  return h('div', { class: 'detail-head' }, name ? icon(name, 'lg') : null,
    h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null));
}

// The creature's page art from the in-game journal; creatures without a journal page show nothing here.
function creaturePicture(e) {
  if (!e.image) return null;
  const img = h('img', { class: 'creature-picture-art', src: '../../data/' + e.image, alt: `${e.name} — in-game journal illustration` });
  const figure = h('figure', { class: 'creature-picture' }, img);
  img.addEventListener('error', () => figure.remove(), { once: true });
  return figure;
}

function renderContent() {
  const c = $('#content');
  // Quests always have a page to show, so the wide middle column is never a splash screen there.
  const v = state.view || (state.module === 'quests' ? { type: 'questlog', arg: '' } : null);
  if (!db) {
    c.replaceChildren(h('div', { class: 'empty' }, h('h1', {}, 'No loot data yet'),
      h('p', {}, 'Open ⚙ Settings and choose "Update from wiki" to download the item, drop and recipe data.')));
    renderNavigation(); return;
  }
  if (!v) {
    const prompts = { monsters: 'Select a monster on the left to see its drops.', containers: 'Select a chest or pack on the left to see its contents.',
      zones: 'Select a zone on the left to explore its loot.', types: 'Select an item type on the left to browse its items.', crafting: 'Select a crafting station on the left to see its recipes.' };
    c.replaceChildren(h('div', { class: 'empty' }, h('h1', {}, MODULES.find(m=>m.id===state.module)?.label || 'Dragonwilds AtlasLoot'),
      h('p', {}, prompts[state.module] || 'Choose an entry on the left to get started.')));
    renderNavigation(); return;
  }
  let body = [];
  if (v.type === 'armourset') {
    body = [armourSetPage(v.arg)];
  } else if (v.type === 'journal') {
    body = [journalPage(v.arg)];
  } else if (v.type === 'source') {
    const e = ent(v.arg);
    const sub = [e.level && `Power level ${[].concat(e.level).join(', ')}`, e.health && `${e.health} HP`, e.weakness && `Weak to ${e.weakness}`,
      e.resistance && `Resists ${e.resistance}`, e.location.length && e.location.join(' · ')].filter(Boolean).join('  —  ');
    body = [header(e.name, sub || e.type, e.name),
      e.kind === 'monster' && !document.body.classList.contains('map-mode') ? creaturePicture(e) : null,
      h('div', { class: 'actions' }, mapButton(e.name)),
      h('h2', {}, 'Drops'), e.drops.length ? dropsGrid(e.drops) : h('p', { class: 'muted' }, 'No drop data on the wiki.')];
  } else if (v.type === 'zone') {
    const z = db.zones.find((x) => x.name === v.arg);
    body = [header(z.name, `${z.monsters.length} monsters`)];
    for (const m of [...z.monsters].sort(byName)) {
      body.push(h('h2', { class: 'link', onclick: () => go({ type: 'source', arg: m }) }, m));
      body.push(ent(m).drops.length ? dropsGrid(ent(m).drops) : h('p', { class: 'muted' }, 'No drop data.'));
    }
  } else if (v.type === 'facility') {
    const names = [...(facilities().get(v.arg) || [])].sort(byName);
    const f = state.filter.toLowerCase();
    const shown = !f || v.arg.toLowerCase().includes(f) ? names : names.filter(n => n.toLowerCase().includes(f));
    const cards = shown.flatMap((n) => ent(n).recipes.filter((r) => (r.facility || 'Unknown') === v.arg).map((r) => recipeCard(r, n)));
    body = [header(v.arg, `${cards.length} recipe${cards.length === 1 ? '' : 's'} made here · click any item for details`),
      ...cards, !cards.length ? h('p', { class: 'muted' }, 'No recipes match your filter. Clear it to see this station’s recipes.') : null];
  } else if (v.type === 'itemtype') {
    const items = Object.values(E).filter((e) => e.kind !== 'monster' && (e.type || 'Other') === v.arg).map((e) => e.name).sort(byName);
    body = [header(v.arg, `${items.length} items`), h('div', { class: 'loot' }, items.map((n) => lootRow(n, [sourceHint(n)])))];
  } else if (v.type === 'wishlist') {
    const items = [...wish].filter(name => name.toLowerCase().includes(state.filter.toLowerCase())).sort(byName);
    body = [header('Wishlist', 'Star items in the detail panel to track them here')];
    for (const n of items) {
      body.push(lootRow(n, [sourceHint(n)]));
    }
    if (!items.length) body.push(h('p', { class: 'muted' }, state.filter && wish.size ? 'No wishlist items match. Clear the filter to see your saved items.' : 'Your wishlist is empty. Add an item from its details to keep it here.'));
  } else if (v.type === 'questchain') {
    body = questChainPage();
  } else if (v.type === 'questlog') {
    body = [questOverviewPage()];
  } else if (v.type === 'search') {
    const q = v.arg.toLowerCase();
    if (q.length < 2) {
      c.replaceChildren(header('Search everything', 'Type at least two characters to find items, creatures, and quests.'));
      renderNavigation(); return;
    }
    const matches = Object.values(E).filter((e) => e.name.toLowerCase().includes(q))
      .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || byName(a.name, b.name));
    const hits = matches.slice(0, 200);
    const mons = hits.filter((e) => e.kind === 'monster' || isContainer(e));
    const quests = hits.filter(e => e.kind === 'quest');
    const items = hits.filter((e) => !mons.includes(e) && e.kind !== 'quest');
    body = [header(`Search: “${v.arg}”`, matches.length > hits.length ? `Showing ${hits.length} of ${matches.length} results · narrow your search to see more` : `${hits.length} results`),
      !hits.length ? h('p', { class: 'search-empty' }, 'No matches. Try a shorter item, creature, or quest name, or clear the search to return to browsing.') : null];
    if (mons.length) body.push(h('h2', {}, 'Monsters & containers'), h('div', { class: 'loot' }, mons.map((e) =>
      h('div', { class: 'loot-row', onclick: () => go({ type: 'source', arg: e.name }) }, icon(e.name), h('span', { class: 'name' }, e.name), h('span', { class: 'meta' }, `${e.drops.length} drops`)))));
    if (quests.length) body.push(h('h2', {}, 'Quests'), h('div', { class: 'loot' }, quests.map(e => lootRow(e.name, [questRemoved(e) ? 'Unavailable' : 'Quest']))));
    if (items.length) body.push(h('h2', {}, 'Items'), h('div', { class: 'loot' }, items.map((e) => lootRow(e.name, [sourceHint(e.name)]))));
    // Recipes that use the searched material
    const usedIn = items.length === 1 ? items[0].usedIn : [];
    if (usedIn.length) body.push(h('h2', {}, `Recipes using ${items[0].name}`), ...usedIn.flatMap((u) => ent(u.item).recipes.map((r) => recipeCard(r, u.item))));
  }
  c.replaceChildren(...body.filter(Boolean));
  renderNavigation();
}

function sourceHint(name) {
  const e = ent(name);
  if (e.droppedBy.length) return `${e.droppedBy.length} source${e.droppedBy.length > 1 ? 's' : ''}`;
  if (e.recipes.length) return e.recipes[0].facility || 'Crafted';
  return '';
}

/* ---------- Detail panel ---------- */

function renderDetail() {
  document.body.classList.toggle('map-detail-open', !!state.detail || !!selectedDiscoveryMarker);
  document.body.classList.toggle('quests-mode', state.module === 'quests');
  const d = $('#detail');
  d.classList.remove('quest-page');
  const close = () => h('div', { class: 'detail-controls' }, h('div', { class: 'detail-navigation' }, navigationBar()),
    h('button', { type: 'button', class: 'detail-close', onclick: closeDetail, 'aria-label': 'Close details' }, 'Close details'));
  if (selectedDiscoveryMarker && document.body.classList.contains('map-mode')) {
    const marker = selectedDiscoveryMarker;
    const status = MapDiscovery.state(marker);
    const manual = MapDiscovery.manuallyMarked(marker);
    d.replaceChildren(close(), h('h1', {}, marker.n), h('div', { class: 'sub' }, marker.region || 'World map'),
      h('p', {}, status === 'discovered' ? `Discovered · ${manual ? 'marked by you' : 'game progress'}`
        : status === 'undiscovered' ? 'Undiscovered' : 'Discovery status unconfirmed'),
      status !== 'discovered' || manual ? h('button', { type: 'button', class: 'primary', onclick: () => {
        MapDiscovery.mark(marker, !manual); MapView.redraw(); renderDiscoveryProgress(); renderDetail();
      } }, manual ? 'Undo discovered mark' : 'Mark discovered') : null,
      h('p', { class: 'muted small' }, marker.discovery?.kind === 'pois'
        ? 'Pools without a confirmed game record can be marked here after visiting. Undiscovered only hides recorded or marked locations.'
        : 'Discovery progress comes from your character. You can also mark a location after visiting it.'));
    return;
  }
  if (!state.detail) { d.replaceChildren(h('div', { class: 'empty' }, state.module === 'quests' ? 'Select a quest to see its steps, rewards and where to go.' : 'Select an item to see where it comes from.')); return; }
  const e = ent(state.detail);
  const star = h('button', { type: 'button', class: 'wishlist-action' + (wish.has(e.name) ? ' on' : ''),
    onclick: () => { wish.has(e.name) ? wish.delete(e.name) : wish.add(e.name); saveWish(); renderDetail(); renderModules(); if (state.view?.type === 'wishlist') renderContent(); } }, wish.has(e.name) ? 'Remove from wishlist' : 'Add to wishlist');
  d.classList.toggle('quest-page', e.kind === 'quest');
  if (e.kind === 'quest') { d.replaceChildren(close(), ...questGuide(e, star).filter(Boolean)); return; }

  const body = [
    close(),
    h('div', { class: 'detail-head' }, icon(e.name, 'lg'),
      h('div', { style: 'flex:1;min-width:0' }, h('h1', { class: e.kind === 'quest' ? '' : itemClass(e.name) }, e.name),
        e.type ? h('span', { class: 'tag' }, e.type) : null)),
    e.kind === 'item' ? learningTag(itemLearningState(e)) : null,
    e.kind === 'item' ? recipeProgressNote(e) : null,
    e.kind !== 'quest' ? h('div', { class: 'actions' }, mapButton(e.name), star,
      e.recipes.length ? h('button', { type: 'button', onclick: () => d.querySelector('.detail-recipes')?.scrollIntoView({ block: 'start' }) }, 'View recipe') : null) : null,
    e.kind==='item' ? acquisitionPanel(e, e.recipes.some(r=>!r.facility?.startsWith('Vendor: '))) : null,
    e.recipes.length ? h('section', { class: 'detail-recipes' }, h('h2', {}, e.recipes.length > 1 ? `Recipes (${e.recipes.length})` : 'Recipe'), ...e.recipes.map(r => recipeCard(r, e.name, false, false))) : null,
  ];
  if (e.journal?.stats?.length) body.push(h('h2', {}, 'Item stats'),
    h('p', { class: 'muted small' }, [e.journal.armourWeight && `${e.journal.armourWeight} armour`, e.journal.skill, ...e.journal.damageTypes].filter(Boolean).join(' · ') || 'Base values'), journalStats(e));
  if (e.journal?.id) body.push(h('button', { type: 'button', class: 'journal-open', onclick: () => {
    history.push(snapshot());
    state.module = 'crafting'; state.filter = '';
    state.listSel = db.journal.categories.find(c => c.groups.some(g => g.items.includes(e.name)))?.id;
    setMapMode(false); go({ type: 'journal', arg: e.name }, { detail: null, push: false });
  } }, 'Read journal entry'));
  if (e.armourSet) body.push(h('button', { type:'button', class:'set-open', onclick:()=>{
    history.push(snapshot());
    state.module='crafting'; state.filter=''; state.listSel=db.journal.categories.find(c=>c.name==='Armour & Shields')?.id;
    setMapMode(false); go({type:'armourset',arg:e.armourSet},{detail:null,push:false});
  } }, 'View armour set'));


  // The creature's 3D model from the game files: drag to turn it, wheel to zoom.
  // Keep one interactive viewer: the selected creature page owns it while open.
  if (!(state.view?.type === 'source' && ent(state.view.arg).kind === 'monster' && !document.body.classList.contains('map-mode')) && e.kind === 'monster' && e.image) body.push(creaturePicture(e));

  const stats = [['Health', e.health], ['Weak to', e.weakness], ['Resists', e.resistance], ['Region', e.region],
    ['Found in', e.location.length ? e.location.join(', ') : null], ['Weight', e.weight], ['Stack', e.stack]].filter(([, v]) => v != null && v !== '');
  if (stats.length) body.push(h('dl', { class: 'stats' }, stats.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])));

  if (e.drops.length) {
    body.push(h('h2', {}, e.kind === 'container' ? 'Contents' : 'Drops'), h('table', { class: 'src-table' }, e.drops.map((d) => h('tr', {},
      h('td', { onclick: () => showItem(d.item) }, d.item, d.group ? h('span', { class: 'muted small' }, `  ${d.group}`) : null),
      h('td', { class: 'num' }, d.qty ? `×${d.qty}` : ''),
      h('td', { class: 'num ' + rarityClass(d.pct, d.rarity) }, d.rarity || '?')))));
  }

  if (e.droppedBy.length) {
    const rows = [...e.droppedBy].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    body.push(h('h2', {}, 'Dropped by / found in'), h('table', { class: 'src-table' }, rows.map((s) => h('tr', {},
      h('td', { onclick: () => open(s.from) }, s.from), h('td', { class: 'num' }, s.qty ? `×${s.qty}` : ''),
      h('td', { class: 'num ' + rarityClass(s.pct, s.rarity) }, s.rarity || '?')))));
  }
  if (e.shops.length) {
    body.push(h('h2', {}, 'Sold by'), h('div', {}, e.shops.map((s) => h('div', { class: 'link', onclick: () => open(s) }, s))));
  }
  if (e.usedIn.length) {
    body.push(h('h2', {}, `Used in (${e.usedIn.length})`), h('table', { class: 'src-table' }, [...e.usedIn].sort((a, b) => byName(a.item, b.item)).map((u) =>
      h('tr', {}, h('td', { onclick: () => showItem(u.item) }, u.item), h('td', { class: 'num' }, `${u.qty}×`), h('td', { class: 'num' }, u.facility || '')))));
  }
  if (e.kind === 'item' && !e.droppedBy.length && !e.recipes.length && !e.shops.length)
    body.push(h('p', { class: 'muted' }, markersFor(e.name).length ? 'Gathered from the world — see the map.' : 'No source found in the game data (it may be gathered or a quest reward).'));
  body.push(itemEffectsPanel(e), journalDescription(e));
  d.replaceChildren(...body.filter(Boolean));
}

function render() {
  document.body.classList.toggle('journal-mode', state.module === 'crafting' && isJournalView());
  saveNavigation();
  renderModules();
  renderList();
  renderContent();
  renderDetail();
  renderQuestTracker();
}

/* ---------- Status, settings, import ---------- */

let settingsMode = 'window';
const DEFAULT_HOTKEY = 'Control+Shift+L';
// "Control+Shift+L" → "Ctrl + Shift + L" for people; the accelerator stays as-is for Electron.
const hotkeyLabel = (accel) => (accel || DEFAULT_HOTKEY).split('+').map((k) => ({ Control: 'Ctrl', CommandOrControl: 'Ctrl', Super: 'Win', num0: 'Num 0' }[k] || k)).join(' + ');

// Turns a keydown into an Electron accelerator, or explains why it can't be used.
const ACCEL_KEYS = { Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };
function hotkeyFromEvent(ev) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(ev.key)) return { pending: true };
  const c = ev.code;
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad\d$/.test(c) ? 'num' + c.slice(6)
    : /^F([1-9]|1\d|2[0-4])$/.test(c) ? c : ACCEL_KEYS[c];
  if (!key) return { error: `${ev.key} can't be used as a hotkey. Try a letter, number or F-key.` };
  const mods = [ev.ctrlKey && 'Control', ev.altKey && 'Alt', ev.shiftKey && 'Shift', ev.metaKey && 'Super'].filter(Boolean);
  // Plain keys would fire while typing in the game; F-keys alone are fine.
  if (!mods.length && !/^F\d+$/.test(key)) return { error: 'Add Ctrl, Alt or Shift to that key (F1–F24 also work on their own).' };
  if (mods.length === 1 && mods[0] === 'Shift' && !/^F\d+$/.test(key)) return { error: 'Shift alone would fire while typing. Add Ctrl or Alt.' };
  return { accel: [...mods, key].join('+') };
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function renderStatus(settings) {
  $('#status-data').textContent = db ? `${db.meta.entities} entries · ${db.meta.source === 'game' ? 'from game files' : db.meta.source} · ${new Date(db.meta.generatedAt).toLocaleString()}` : 'No data';
  if (!settings) return;
  settingsMode = settings.mode;
  $('#status-hotkey').textContent = `Show/hide: ${hotkeyLabel(settings.hotkey)}${settings.mapOnM ? ' · Game map (M): AtlasLoot map' : ''}`;
  $('#btn-hide').title = settings.mode === 'overlay' ? 'Hide (Esc)' : 'Minimise';
}

// App updates (main.js watchUpdates): the version sits at the right of the status bar and turns into
// "Update available" once a new release has downloaded; clicking it checks again or opens the dialog.
let update = { status: 'dev', current: '' };
let updateOffered = null; // the version whose dialog already opened by itself this session
const MAX_NOTES = 8;
const checkedLabel = (u) => u.checkedAt ? ` · checked ${new Date(u.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
function updateSummary(u) {
  return {
    dev: 'Updates are available in the installed app only',
    idle: 'Not checked yet',
    checking: 'Checking for updates…',
    downloading: `Downloading version ${u.version}: ${u.percent || 0}%`,
    ready: `Version ${u.version} is ready to install`,
    installing: 'Restarting to install the update…',
    latest: `Up to date${checkedLabel(u)}`,
    error: `${u.message || 'Update check failed'}${checkedLabel(u)}`,
  }[u.status];
}

function renderUpdate(u) {
  update = u;
  const chip = $('#status-update');
  const ready = u.status === 'ready';
  chip.classList.toggle('ready', ready);
  chip.replaceChildren(...(ready
    ? [h('span', { class: 'update-dot', 'aria-hidden': 'true' }), `Update available · v${u.version}`]
    : u.status === 'downloading' ? [`v${u.current} · downloading v${u.version} ${u.percent || 0}%`]
    : u.status === 'checking' ? [`v${u.current} · checking…`]
    : [`v${u.current}${u.status === 'dev' ? ' · dev' : ''}`]));
  chip.disabled = ['checking', 'downloading', 'installing'].includes(u.status);
  chip.title = ready ? 'Open the update' : `${updateSummary(u)}${['dev', 'checking', 'downloading', 'installing'].includes(u.status) ? '' : '. Click to check now.'}`;
  $('#update-meta').textContent = `Version ${u.current} · ${updateSummary(u)}`;
  $('#update-check').disabled = ['dev', 'checking', 'downloading', 'ready', 'installing'].includes(u.status);
  $('#update-restart').hidden = !ready;
  $('#update-now').disabled = !ready;
  if (u.status !== 'ready' && $('#update-dialog').open) $('#update-dialog').close();
  if (ready && updateOffered !== u.version) { updateOffered = u.version; showUpdateDialog(); }
}

function showUpdateDialog() {
  if (update.status !== 'ready') return;
  $('#update-lede').textContent = `Dragonwilds AtlasLoot ${update.version} is ready to install. You have ${update.current}.`;
  const notes = update.notes || [];
  let shown = 0;
  const sections = notes.map((s) => {
    const items = s.items.slice(0, Math.max(0, MAX_NOTES - shown));
    shown += items.length;
    return items.length ? h('section', {}, s.title && h('h3', {}, s.title), h('ul', {}, items.map((i) => h('li', {}, i)))) : null;
  });
  const rest = notes.reduce((n, s) => n + s.items.length, 0) - shown;
  $('#update-notes').replaceChildren(...sections.filter(Boolean), ...(rest > 0 ? [h('p', { class: 'update-more' }, `+ ${rest} more change${rest === 1 ? '' : 's'} included.`)] : []));
  $('#update-notes').hidden = !notes.length;
  if (!$('#update-dialog').open) $('#update-dialog').showModal();
}

async function checkUpdateNow() {
  try { renderUpdate(await window.atlas.checkUpdate()); }
  catch { renderUpdate({ ...update, status: 'error', message: 'Could not check for updates. Please try again.' }); }
}

let lastPlayer = null;
// The minimap window (app/minimap.js) draws what the map shows around you, sent with every position sample.
// Its farthest zoom reaches 260 m from the player, so markers within 270 m are enough.
let minimapOn = false;
const MINIMAP_RANGE = 27000;
// Like WoW, the tracked quests are listed under the minimap: the number their map targets carry and what to do now.
function minimapQuests() {
  return trackedList().map((q, i) => {
    const status = questStatus(q), p = questProgress(q), objective = status === 'done' ? null : questNextObjective(q);
    return { index: i + 1, name: q.name, done: status === 'done',
      step: status === 'active' ? (p.current && q.guide?.sequence === 'linear' ? `Step ${p.step}/${p.total}` : questTargetProgress(q) || '') : status === 'done' ? '' : 'Start',
      text: status === 'done' ? 'Completed' : objective ? questStepGuidance(q, objective.key)?.instruction || objective.text
        : 'Objective not recorded. Load your character to refresh it.' };
  });
}
function sendMinimap() {
  if (minimapOn && mapReady) window.atlas.sendMinimap({ ...MapView.minimapScene(MINIMAP_RANGE), quests: minimapQuests() });
}
function onPlayer(p) {
  lastPlayer = p;
  MapView.setPlayer(p);
  const recipesChanged=p.discovery ? RecipeKnowledge.ingest(p.discovery) : !p.ok && gameRunning ? RecipeKnowledge.waiting() : false;
  if(recipesChanged && db){renderList();renderContent();renderDetail();}
  if (p.discovery && db?.map && MapDiscovery.ingest(p.discovery, db.map.markers)) {
    MapView.redraw(); renderDiscoveryProgress();
    if (selectedDiscoveryMarker) renderDetail();
  }
  if (p.quests) onQuestLog(p.quests, p.questLocations);
  if (p.lodestones && db?.map) onLodestones(p.lodestones);
  // Co-op: other players arrive with the creature scan; they disappear when you leave the game.
  if (p.players) MapView.setOthers(p.players);
  else if (!p.ok) MapView.setOthers([]);
  if (p.npcs && mapReady) onNpcs(p.npcs, p);
  else if (!p.ok && mapReady) { liveCreatures = []; renderLiveCreatures(); }
  sendMinimap();
  const el = $('#status-progress');
  if (el.dataset.importing) return;
  el.textContent = p.ok ? `● Live: ${MapView.playerDungeon()?.name || p.region || p.world} (${Math.round(p.x / 100)}, ${Math.round(p.y / 100)})` : !gameRunning ? '○ Waiting for RuneScape: Dragonwilds to start' : '◐ Game detected, waiting for your character…';
}

// Lodestones players have built: the game lists every lodestone, and the ones away from a world lodestone were built.
// They join the map's Travel markers (kept at the end, so other markers keep their positions) and are remembered offline.
let builtLodestones = [];
try { builtLodestones = JSON.parse(localStorage.getItem('builtLodestones')) || []; } catch {}
const insidePoly = (poly, x, y) => poly.reduce((inside, [ax, ay], i) => {
  const [bx, by] = poly[(i + 1) % poly.length];
  return (ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax ? !inside : inside;
}, false);
function onLodestones(list) {
  const world = db.map.markers.filter(m => m.c === 'travel' && !m.built && m.n === 'Lodestone');
  const built = list.filter(l => !world.some(w => Math.hypot(w.x - l.x, w.y - l.y) < 1000));
  if (JSON.stringify(built) === JSON.stringify(builtLodestones)) return;
  builtLodestones = built;
  try { localStorage.setItem('builtLodestones', JSON.stringify(built)); } catch {}
  applyBuiltLodestones();
}
function applyBuiltLodestones() {
  if (!db?.map) return;
  db.map.markers = db.map.markers.filter(m => !m.built).concat(builtLodestones.map(l => ({ c: 'travel', n: 'Built lodestone', built: true,
    x: l.x, y: l.y, z: l.z, region: db.map.regions.find(r => insidePoly(r.poly, l.x, l.y))?.name || '' })));
  if (mapReady) { MapView.redraw(); sendMinimap(); }
}

let gameRunning = false;
function onGame(g) {
  gameRunning = g.running;
  if(RecipeKnowledge.connection(g.running) && db){renderList();renderContent();renderDetail();}
  onPlayer(g.running ? { ok: false } : { ok: false, offline: true });
}

async function loadDb() {
  db = await window.atlas.getDb();
  E = db ? db.entities : {};
  applyBuiltLodestones();
}

function settingsMessage(text, kind = '') {
  const el = $('#settings-msg');
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

// Live import progress, shown in the dialog and the status bar (the dialog may be closed meanwhile).
function showImportProgress({ msg, done, total }) {
  const bar = $('#import-progress');
  if (total) { bar.max = total; bar.value = done; } else bar.removeAttribute('value'); // no total: indeterminate
  $('#import-text').textContent = total ? `Step ${done} of ${total}: ${msg}` : msg;
  $('#status-progress').textContent = total ? `Updating data ${done}/${total}: ${msg}` : `Updating data: ${msg}`;
}

async function doImport(kind) {
  const buttons = [$('#import-game'), $('#import-wiki')];
  const clicked = kind === 'game' ? buttons[0] : buttons[1];
  const label = clicked.textContent;
  buttons.forEach((b) => (b.disabled = true));
  clicked.textContent = 'Updating…';
  clicked.setAttribute('aria-busy', 'true');
  $('#import-status').hidden = false;
  showImportProgress({ msg: kind === 'game' ? 'Reading your game files…' : 'Downloading from the wiki…' });
  settingsMessage('');
  $('#status-progress').dataset.importing = '1';
  const res = await window.atlas.runImport(kind);
  buttons.forEach((b) => (b.disabled = false));
  clicked.textContent = label;
  clicked.removeAttribute('aria-busy');
  $('#import-status').hidden = true;
  delete $('#status-progress').dataset.importing;
  $('#status-progress').textContent = '';
  mapReady = false;
  if (res.ok) {
    await loadDb();
    const done = `Data updated: ${res.meta.entities} entries${res.meta.markers ? `, ${res.meta.markers} map markers` : ''}.`;
    settingsMessage('✓ ' + done, 'ok');
    if (!$('#settings').open) toast(done);
    $('#data-meta').textContent = `Current data: ${db.meta.entities} entries (${db.meta.source === 'game' ? 'game files' : db.meta.source}, ${new Date(db.meta.generatedAt).toLocaleString()}).`;
    render();
    renderStatus();
    if (minimapOn) initMap();
  } else {
    const hint = kind === 'game' ? 'Check that RuneScape: Dragonwilds is installed, then try again.' : 'Check your internet connection, then try again.';
    settingsMessage(`The update didn't finish, so your current data is unchanged. ${hint}`, 'err');
    $('#settings-msg').title = String(res.error || ''); // technical detail on hover only
    if (!$('#settings').open) toast('Data update failed. Open Settings for details.');
  }
}

// Resizable columns: a handle on each pane border; widths are kept per viewer in localStorage.
const COLUMNS = [
  { pane: '#modules', prop: '--w-modules', min: 110, max: 320, edge: 'right' },
  { pane: '#list', prop: '--w-list', min: 160, max: 600, edge: 'right' },
  { pane: '#detail', prop: '--w-detail', min: 240, max: 800, edge: 'left' },
];
function initSplitters() {
  const layout = $('.layout');
  const root = document.documentElement.style;
  let saved = {};
  saved = Preferences.json('columns', {});
  for (const c of COLUMNS) if (saved[c.prop]) root.setProperty(c.prop, saved[c.prop] + 'px');

  const handles = COLUMNS.map((c) => {
    const el = h('div', { class: 'splitter', title: 'Drag to resize · double-click to reset' });
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const start = ev.clientX, w0 = $(c.pane).getBoundingClientRect().width;
      el.classList.add('drag'); document.body.classList.add('col-resizing');
      const move = (e) => {
        const dx = e.clientX - start;
        const w = Math.round(Math.min(c.max, Math.max(c.min, w0 + (c.edge === 'right' ? dx : -dx))));
        root.setProperty(c.prop, w + 'px');
        saved[c.prop] = w;
        place();
      };
      const up = () => {
        el.classList.remove('drag'); document.body.classList.remove('col-resizing');
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        Preferences.setJSON('columns', saved);
        if (mapReady) MapView.resize();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    el.addEventListener('dblclick', () => {
      root.removeProperty(c.prop); delete saved[c.prop];
      Preferences.setJSON('columns', saved);
      place();
    });
    layout.append(el);
    return el;
  });

  // Keep each handle on its pane's border (panes move when another column resizes or the map opens).
  function place() {
    const base = layout.getBoundingClientRect().left;
    COLUMNS.forEach((c, i) => {
      const r = $(c.pane).getBoundingClientRect();
      handles[i].hidden = r.width === 0;
      handles[i].style.left = (c.edge === 'right' ? r.right : r.left) - base + 'px';
    });
  }
  new ResizeObserver(place).observe(layout);
  for (const c of COLUMNS) new ResizeObserver(place).observe($(c.pane));
  place();
}

async function init() {
  initSplitters();
  const settings = await window.atlas.getSettings();
  await loadDb();
  const savedNavigation = Preferences.json('navigation', {});
  if (MODULES.some(m => m.id === savedNavigation.module)) {
    state.module = savedNavigation.module;
    state.detail = E[savedNavigation.detail] ? savedNavigation.detail : null;
    state.filter = typeof savedNavigation.filter === 'string' ? savedNavigation.filter : '';
    state.listSel = db?.journal?.categories?.some(c => c.id === savedNavigation.listSel) ? savedNavigation.listSel : null;
    const view = savedNavigation.view;
    if (view && ['source', 'zone', 'facility', 'itemtype', 'wishlist', 'questlog', 'questchain', 'search', 'journal', 'armourset'].includes(view.type)
      && (view.type !== 'zone' || db?.zones.some(z => z.name === view.arg))
      && (view.type !== 'armourset' || armourSet(view.arg))
      && (!['journal', 'source'].includes(view.type) || E[view.arg])) state.view = view;
    if (view?.type === 'search') $('#search').value = view.arg;
  }
  setMapMode(state.module === 'map');
  minimapOn = !!settings.minimap;
  if (minimapOn) initMap();
  render();
  renderStatus(settings);

  const clearSearch = () => {
    clearTimeout(searchTimer);
    $('#search').value = '';
    if (searchOrigin) {
      const origin = searchOrigin; searchOrigin = null;
      restoreNavigation(origin);
    } else if (state.view?.type === 'search') {
      state.view = null; state.detail = null; render();
    } else renderNavigation();
    $('#search').focus();
  };
  $('#search-clear').onclick = clearSearch;
  $('#search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    const q = ev.target.value.trim();
    if (!q) { clearSearch(); return; }
    renderNavigation();
    searchTimer = setTimeout(() => {
      const starting = state.view?.type !== 'search';
      if (starting) {
        searchOrigin = snapshot(); searchOrigin.search = '';
        history.push(searchOrigin);
      }
      if (state.module === 'map') { state.module = 'types'; setMapMode(false); }
      go({ type: 'search', arg: q }, { detail: null, push: false });
    }, 150);
  });
  $('#btn-back').onclick = back;
  $('#btn-hide').onclick = () => window.atlas.hide();
  $('#btn-quit').onclick = () => window.atlas.quit();
  // Settings: the hotkey is recorded by pressing it; opacity previews live and Cancel puts it back.
  let savedSettings = null;
  let hotkey = DEFAULT_HOTKEY;
  const hotkeyInput = $('#set-hotkey');
  const hotkeyHint = (text, kind = '') => { const el = $('#hotkey-hint'); el.textContent = text; el.className = 'hotkey-hint' + (kind ? ' ' + kind : ''); };
  const idleHint = () => hotkeyHint('Click the box, then press the new key combination.');
  const showHotkey = (accel) => { hotkey = accel; hotkeyInput.value = hotkeyLabel(accel); };
  hotkeyInput.addEventListener('focus', () => {
    window.atlas.pauseHotkey?.(true); // so pressing the current hotkey doesn't hide the window
    hotkeyInput.classList.add('recording');
    hotkeyInput.value = 'Press keys…';
    hotkeyHint('Hold Ctrl, Alt or Shift and press a key. Esc keeps the current one.');
  });
  hotkeyInput.addEventListener('blur', () => {
    window.atlas.pauseHotkey?.(false);
    hotkeyInput.classList.remove('recording');
    hotkeyInput.value = hotkeyLabel(hotkey);
    // Keep a result ("will be used…" or an error); only replace the "press keys" prompt.
    if (!/\b(ok|err)\b/.test($('#hotkey-hint').className)) idleHint();
  });
  hotkeyInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') return; // keep keyboard navigation working
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { hotkeyInput.blur(); idleHint(); return; }
    const r = hotkeyFromEvent(ev);
    if (r.pending) return;
    if (r.error) { hotkeyHint(r.error, 'err'); return; }
    showHotkey(r.accel);
    hotkeyHint(r.accel === savedSettings?.hotkey ? 'That is already your hotkey.' : `${hotkeyLabel(r.accel)} will be used after you press Save.`, 'ok');
    hotkeyInput.blur();
  });
  $('#hotkey-reset').onclick = () => { showHotkey(DEFAULT_HOTKEY); hotkeyHint(`Reset to ${hotkeyLabel(DEFAULT_HOTKEY)}. Press Save to keep it.`, 'ok'); };

  $('#btn-settings').onclick = async () => {
    const s = await window.atlas.getSettings();
    savedSettings = s;
    showHotkey(s.hotkey || DEFAULT_HOTKEY);
    idleHint();
    $('#set-opacity').value = s.opacity ?? 0.94;
    $('#opacity-val').textContent = Math.round((s.opacity ?? 0.94) * 100) + '%';
    $('#data-meta').textContent = db ? `Current data: ${db.meta.entities} entries (${db.meta.source === 'game' ? 'game files' : db.meta.source}, ${new Date(db.meta.generatedAt).toLocaleString()}).` : 'No data imported yet.';
    $('#set-maponm').checked = !!s.mapOnM;
    $('#set-minimap').checked = !!s.minimap;
    $('#set-minimap-size').value = String(s.minimapSize || 200);
    $('#set-minimap-rotate').checked = !!s.minimapRotate;
    $('#minimap-options').hidden = !s.minimap;
    $('#set-mode').value = s.mode;
    $('#set-showongame').checked = !!s.showOnGame;
    $('#set-autostart').checked = !!s.autoStart;
    if (!$('#status-progress').dataset.importing) settingsMessage('');
    $('#settings').showModal();
  };
  $('#set-opacity').oninput = (ev) => {
    $('#opacity-val').textContent = Math.round(ev.target.value * 100) + '%';
    window.atlas.setSettings({ opacity: Number(ev.target.value) });
  };
  // Cancel, Esc or the dialog closing any other way without Save restores the previewed opacity.
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'saved' && savedSettings && Number($('#set-opacity').value) !== savedSettings.opacity)
      window.atlas.setSettings({ opacity: savedSettings.opacity });
    $('#settings').returnValue = '';
  });
  $('#set-minimap').onchange = (ev) => { $('#minimap-options').hidden = !ev.target.checked; };
  $('#settings-save').onclick = async () => {
    const res = await window.atlas.setSettings({
      hotkey, opacity: Number($('#set-opacity').value), mapOnM: $('#set-maponm').checked,
      mode: $('#set-mode').value, showOnGame: $('#set-showongame').checked, autoStart: $('#set-autostart').checked,
      minimap: $('#set-minimap').checked, minimapSize: Number($('#set-minimap-size').value), minimapRotate: $('#set-minimap-rotate').checked,
    });
    if (!res.ok) {
      hotkeyHint(`${hotkeyLabel(hotkey)} is already taken by another program. Choose a different combination.`, 'err');
      settingsMessage('Not saved: the hotkey could not be registered.', 'err');
      return;
    }
    const minimapAdded = res.settings.minimap && !minimapOn;
    minimapOn = !!res.settings.minimap;
    if (minimapOn) initMap(); // the next position sample fills it in
    savedSettings = res.settings;
    renderStatus(res.settings);
    $('#settings').close('saved');
    toast(minimapAdded && !gameRunning ? 'Settings saved. The minimap appears while the game runs.' : 'Settings saved');
  };
  $('#import-game').onclick = () => doImport('game');
  $('#import-wiki').onclick = () => doImport('wiki');
  window.atlas.onProgress(showImportProgress);
  window.atlas.onShown(() => $('#search').focus());
  window.atlas.onPlayer(onPlayer);
  window.atlas.onGame(onGame);
  window.atlas.onUpdate(renderUpdate);
  window.atlas.getUpdate().then(renderUpdate);
  $('#status-update').onclick = () => update.status === 'ready' ? showUpdateDialog() : update.status !== 'dev' && checkUpdateNow();
  $('#update-check').onclick = checkUpdateNow;
  $('#update-restart').onclick = $('#update-now').onclick = () => window.atlas.installUpdate();
  // The game's map opened: the app covers it with just its map, following the player. It is a layer over your page
  // in the app, not a visit to the Map section: that page comes back (and is all that is saved) when it closes.
  window.atlas.onGameMap((on) => {
    if (on && !gameMapReturn) {
      gameMapReturn = { page: snapshot(), following: mapReady && MapView.isFollowing() };
      document.body.classList.add('game-map');
      document.body.classList.remove('game-map-customize');
      state.module = 'map';
      renderModules();
      setMapMode(true);
      renderNavigation();
      // Like the game's own map: clean, on you and still (no following, no earlier search results).
      if (MapView.isFollowing()) MapView.setFollow(false);
      MapView.setHighlight(null); syncMapHighlight();
      MapView.centerOnPlayer(0.5);
      renderQuestTracker(); renderMapViews();
    } else if (!on && gameMapReturn) {
      const { page, following } = gameMapReturn;
      gameMapReturn = null;
      document.body.classList.remove('game-map', 'game-map-customize');
      restoreNavigation(page);
      if (following) MapView.setFollow(true, { restore: true });
      renderQuestTracker();
    }
    requestAnimationFrame(() => MapView.resize());
  });
  $('#map-follow').onclick = () => MapView.setFollow(!MapView.isFollowing());
  $('#map-zoom-in').onclick = () => MapView.zoom(1.5);
  $('#map-zoom-out').onclick = () => MapView.zoom(1 / 1.5);
  $('#map-fit').onclick = () => MapView.fit();

  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); $('#search').select(); }
    else if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); back(); }
    else if (ev.key === 'Escape' && !$('#settings').open && !$('#update-dialog').open) {
      if ($('#search').value) clearSearch();
      else if (state.detail || selectedDiscoveryMarker) closeDetail();
      else if (settingsMode === 'overlay') window.atlas.hide();
    }
  });
}

init();
