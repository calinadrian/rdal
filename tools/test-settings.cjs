// Full main-process restart test; removes only this run's isolated browser storage between launches.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const appRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const profile = require('./test-profile.cjs').testProfile('settings'); // removed after the test ends
fs.mkdirSync(profile, { recursive: true });
const run = (phase, js) => {
  const result = spawnSync(require('electron'), ['--no-sandbox', appRoot], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, ATLAS_TEST_PROFILE: profile, ATLAS_SNAPSHOT: path.join(root, 'test-fixtures/settings-restored.png'), ATLAS_SNAPSHOT_WAIT: '800', ATLAS_SNAPSHOT_JS: `(async () => { ${js} })()` },
  });
  if (result.error || result.status !== 0) throw result.error || Error(result.stderr + result.stdout);
  console.log(`PASS: process ${phase}`);
};
run('1 saves settings', `
  state.module = 'map'; setMapMode(true); renderModules();
  await new Promise(r => setTimeout(r, 500));
  for (const c of db.map.categories) MapView.setEnabled(c.id, ['ore', 'gather'].includes(c.id));
  MapView.setEnabled('npc', true); MapView.setFollow(false); MapView.zoom(2);
  liveCreaturePool = new Set(['Wolf', 'Cow']); saveCreaturePool();
  Preferences.setJSON('columns', { '--w-detail': 480 });
  wish.add('Wolf'); saveWish(); showItem('Wolf');
  setTracked('The Wild Hunt', true); trackerCollapsed = true; Preferences.set('trackerCollapsed', '1');
  $('#map-filters').click();
  await atlas.setSettings({ opacity: 0.82, mapOnM: false });
  await atlas.getPreferences();
`);
let settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')));
assert.equal(settings.opacity, 0.82);
assert.equal(settings.mapOnM, false);
assert.deepEqual(JSON.parse(settings.ui.liveCreaturePool).sort(), ['Cow', 'Wolf']);
assert(JSON.parse(settings.ui.mapCategories).includes('ore'));
assert(JSON.parse(settings.ui.mapViewport).scale > 0);
assert.deepEqual(JSON.parse(settings.ui.trackedQuests), ['The Wild Hunt']);
assert.equal(settings.ui.trackerCollapsed, '1');
assert.equal(settings.ui.worldFiltersOpen, '1');
// Move generated storage aside within this test profile; keep the authoritative settings.json.
const browserStorage = path.resolve(profile, 'Local Storage');
assert(browserStorage.startsWith(profile + path.sep));
if (fs.existsSync(browserStorage)) fs.renameSync(browserStorage, path.join(profile, 'browser-storage-before-restart'));
run('2 restores from settings.json without browser storage', `
  const check = (ok, message) => { if (!ok) throw Error(message); };
  check(state.module === 'map' && state.detail === 'Wolf', 'Navigation was not restored');
  check(document.body.classList.contains('map-mode'), 'Last open map was not restored');
  check(MapView.isEnabled('ore') && MapView.isEnabled('gather') && !MapView.isEnabled('chest'), 'Category choices were not restored');
  check(liveCreaturePool?.size === 2 && liveCreaturePool.has('Wolf') && liveCreaturePool.has('Cow'), 'Creature pool was not restored');
  check(!MapView.isFollowing() && Preferences.get('mapFollow') === '0', 'Follow off was not restored');
  check(wish.has('Wolf'), 'Wishlist was not restored');
  check(isTracked('The Wild Hunt') && trackedQuests.length === 1, 'Tracked quests were not restored');
  check(trackerCollapsed && document.querySelector('#quest-tracker .quest-tracker.collapsed'), 'Collapsed quest tracker was not restored');
  check(!document.querySelector('#map-legend').hidden, 'Open map filters were not restored');
  check(document.documentElement.style.getPropertyValue('--w-detail') === '480px', 'Pane width was not restored');
  const settings = await atlas.getSettings(); check(settings.opacity === 0.82 && !settings.mapOnM, 'Application settings were not restored');
  await new Promise(r => setTimeout(r, 500));
  const before = Preferences.json('mapViewport', null); MapView.zoom(1);
  const after = Preferences.json('mapViewport', null);
  check(Math.abs(before.scale - after.scale) < 1e-6 && Math.abs(before.u - after.u) < 1e-6 && Math.abs(before.v - after.v) < 1e-6, 'Map position or zoom was not restored');
  liveCreaturePool = new Set(); saveCreaturePool();
  for (const c of [...db.map.categories.map(c => c.id), 'npc']) MapView.setEnabled(c, false);
  await atlas.getPreferences();
`);
run('3 retains deliberately empty filters', `
  if (liveCreaturePool?.size !== 0) throw Error('Empty creature pool reset to all');
  if ([...db.map.categories.map(c => c.id), 'npc'].some(c => MapView.isEnabled(c))) throw Error('All-off categories reset to defaults');
  if (MapView.isFollowing()) throw Error('Follow preference reset');
  const liveBox = document.querySelector('#count-npc').closest('label').querySelector('input');
  if (liveBox.checked) throw Error('Live creatures checkbox disagrees with saved off preference');
  await atlas.getPreferences();
`);
console.log('Settings survived three app processes, including disk-only recovery and empty selections.');
run('4 clicks Live creatures off and quits immediately', `
  // Restore a typical map first, then use the real DOM checkbox, without awaiting a save/flush.
  for (const c of ['monster', 'chest', 'quest', 'travel', 'shrine', 'agility', 'npc']) MapView.setEnabled(c, true);
  renderLegend();
  const liveBox = document.querySelector('#count-npc').closest('label').querySelector('input');
  if (!liveBox.checked) throw Error('Checkbox must start on');
  liveBox.click();
  if (liveBox.checked || MapView.isEnabled('npc')) throw Error('Checkbox click did not turn live creatures off');
  selectModule('quests');
  document.querySelector('#content .quest-filter[data-mode="active"]').click();
  atlas.quit();
`);
settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')));
assert(!JSON.parse(settings.ui.mapCategories).includes('npc'), 'Immediate quit lost Live creatures off');
assert(JSON.parse(settings.ui.mapCategories).includes('monster'), 'Other category choices were lost');
assert.equal(settings.ui.questBrowseMode, 'active', 'Immediate quit lost the quest progress filter');
run('5 keeps the visible Live creatures checkbox off after restart', `
  if (questBrowseMode !== 'active') throw Error('Quest filter was not restored');
  if (document.querySelector('#content .quest-filter[data-mode="active"]').getAttribute('aria-pressed') !== 'true') throw Error('Visible quest filter disagrees with saved preference');
  selectModule('map');
  const liveBox = document.querySelector('#count-npc').closest('label').querySelector('input');
  if (liveBox.checked || MapView.isEnabled('npc')) throw Error('Live creatures came back on');
  if (!MapView.isEnabled('monster')) throw Error('Unrelated categories changed');
`);
