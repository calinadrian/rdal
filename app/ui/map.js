// World map: the game's own map image with extracted markers, regions and the live player.
// Dungeons are separate layers: their floor plans (drawn from the game geometry) replace the world image
// while you are inside one, or when you open one from its entrance or the dungeon picker.
window.MapView = (() => {
  const MARKER_SIZE = 26;
  const markerSize = marker => marker.c === 'monster' ? 10 : MARKER_SIZE;
  const DENSE_UNITS = 147;     // ores & plants show once a screen pixel covers fewer world units than this
  let canvas, ctx, img, map, onSelect;
  let layer = null;            // null = world map, else one of map.dungeons
  let playerLayer = null;      // the dungeon the player is in (null = outside)
  let level = 0;               // storey of the dungeon on show (0 = lowest)
  let playerLevel = 0;         // storey the player is on
  let layerChanged = () => {};
  const layerViews = {};       // dungeon id -> { scale, u, v } while the app is open
  let W = 1, H = 1;            // map image size in px
  let scale = 0.1, ox = 0, oy = 0; // screen = imagePx * scale + offset
  const savedCategories = Preferences.json('mapCategories', null);
  const DEFAULT_CATEGORIES = ['monster', 'chest', 'quest', 'travel', 'shrine', 'agility'];
  const enabled = new Set(Array.isArray(savedCategories) ? savedCategories.filter(c => typeof c === 'string') : DEFAULT_CATEGORIES);
  let visibilityChanged = () => {}, lastVisibility = '';
  const savedVentTypes = Preferences.json('ventTypes', null);
  let ventTypes = Array.isArray(savedVentTypes) ? new Set(savedVentTypes.filter(t => typeof t === 'string')) : null;
  const ventTypeEnabled = type => ventTypes === null || ventTypes.has(type);
  const RESOURCE_CATEGORIES = ['ore', 'gather', 'tree'];
  const savedResources = Preferences.json('resourceTypes', {});
  const resourceTypes = Object.fromEntries(RESOURCE_CATEGORIES.map(c => [c,
    Array.isArray(savedResources?.[c]) ? new Set(savedResources[c].filter(n => typeof n === 'string')) : null]));
  const resourceTypeEnabled = (category, name) => !RESOURCE_CATEGORIES.includes(category)
    || resourceTypes[category] === null || resourceTypes[category].has(name);
  function setResourceTypes(category, names) {
    if (!RESOURCE_CATEGORIES.includes(category)) return;
    resourceTypes[category] = names === null ? null : new Set(names);
    Preferences.setJSON('resourceTypes', Object.fromEntries(RESOURCE_CATEGORIES.map(c => [c,
      resourceTypes[c] === null ? null : [...resourceTypes[c]]])));
    dirty = true; hover = null;
    const tip = document.getElementById('map-tip'); if (tip) tip.hidden = true;
  }
  function setVentTypes(types) {
    ventTypes = types === null ? null : new Set(types);
    Preferences.setJSON('ventTypes', ventTypes === null ? null : [...ventTypes]);
    dirty = true; hover = null;
    const tip = document.getElementById('map-tip'); if (tip) tip.hidden = true;
  }
  function saveViewport() {
    if (!fitted || W <= 1 || !canvas?.width || !canvas?.height) return;
    const view = { scale, u: (viewW / 2 - ox) / scale / W, v: (viewH / 2 - oy) / scale / H };
    if (layer) layerViews[layer.id] = view;
    else Preferences.setJSON('mapViewport', view);
  }
  let highlight = null;        // { label, markers:Set }
  let tracked = new Map();     // marker -> { index, quest, kind, label } for pinned quests' current objectives
  let player = null;
  let paintedPlayer = null;  // visual interpolation only; live lookups keep the latest tracker coordinates
  let destination = null, updateWaypoint = () => {}, placingWaypoint = false;
  function setWaypointPlacement(on) {
    placingWaypoint = on;
    canvas.classList.toggle('placing-waypoint', on);
    const button = document.getElementById('map-add-waypoint');
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Click map · Cancel' : 'Add waypoint';
  }
  function placeWaypoint(e) {
    if (W <= 1) return;
    const r = canvas.getBoundingClientRect(), f = frame();
    const u = (e.clientX - r.left - ox) / scale, v = (e.clientY - r.top - oy) / scale;
    if (u < 0 || v < 0 || u > W || v > H) return;
    const floor = layer ? level < 0 ? playerLayer === layer ? playerLevel : 0 : level : 0;
    selectDestination({ x: f.minX + u * f.res, y: f.minY + v * f.res,
      d: layer?.id, _level: floor, custom: true,
      n: layer?.levels?.length > 1 ? `My waypoint · Level ${floor + 1}` : 'My waypoint' });
    setWaypointPlacement(false);
    hover = null; document.getElementById('map-tip').hidden = true;
  }
  function selectDestination(marker) {
    destination = marker && Number.isFinite(marker.x) && Number.isFinite(marker.y) ? marker : null;
    dirty = true;
  }
  function waypoint() {
    if (!destination) return null;
    const d = destination.d ? map.dungeons.find(d => d.id === destination.d) : null;
    const blocked = !player?.ok ? null : (destination.d || null) !== (playerLayer?.id || null)
      ? d ? `Enter ${d.name}` : 'Return to the world map'
      : d && markerLevel(destination) !== playerLevel ? `Go to Level ${markerLevel(destination) + 1}` : null;
    return { x: destination.x, y: destination.y, n: destination.n, blocked };
  }
  let others = [];             // other players in your world (co-op): { n, x, y, z, yaw }
  let follow = false;          // keep the player centred (stays on until toggled off)
  let followPause = 0;         // a drag pauses following until this time, then it glides back
  let followChanged = () => {};
  let hover = null;
  let dirty = true;

  // World units per image pixel and the image origin of the current layer.
  const frame = () => layer ? layer.frame : { minX: map.bounds.minX, minY: map.bounds.minY, res: map.bounds.size / W };
  const toImg = (x, y) => { const f = frame(); return [(x - f.minX) / f.res, (y - f.minY) / f.res]; };
  // Which storey of dungeon d a position is on: the level whose floor under it is nearest in height.
  function levelAt(d, p) {
    const levels = d?.levels || [];
    if (levels.length < 2) return 0;
    const u = (p.x - d.frame.minX) / d.frame.res, v = (p.y - d.frame.minY) / d.frame.res;
    let best = 0, bestGap = Infinity;
    levels.forEach((l, i) => {
      const g = l.heights, cx = Math.floor(u / g.cell), cy = Math.floor(v / g.cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        const z = x >= 0 && y >= 0 && x < g.w && y < g.h ? g.z[y * g.w + x] : null;
        // Standing on a floor (or a little above it, e.g. a chest or a torch on the wall) beats being below one.
        const gap = z == null ? Infinity : p.z >= z - 100 ? p.z - z : (z - p.z) * 3;
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
    });
    if (bestGap === Infinity) { // nowhere near any drawn floor: go by the storeys' height ranges
      levels.forEach((l, i) => { const gap = p.z < l.zLo ? l.zLo - p.z : p.z > l.zHi ? p.z - l.zHi : 0; if (gap < bestGap) { bestGap = gap; best = i; } });
    }
    return best;
  }
  const markerLevel = (m) => m._level ??= levelAt(map.dungeons.find(d => d.id === m.d), m);
  const onStorey = (m, l, lv) => (m.d || null) === (l?.id || null) && (!l || lv < 0 || markerLevel(m) === lv);
  const onLayer = (m) => onStorey(m, layer, level);
  const dungeonAt = (p) => (map?.dungeons || []).find(({ bounds: b }) =>
    p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ) || null;
  const playerHere = () => player?.ok && playerLayer === layer && (!layer || level < 0 || playerLevel === level);
  // Another player is drawn on whichever map (world, dungeon, storey) they are standing on.
  const otherHere = (o) => dungeonAt(o) === layer && (!layer || level < 0 || levelAt(layer, o) === level);
  const layerImage = () => layer ? level < 0 && layer.overview ? layer.overview : layer.levels?.[level]?.image || layer.image : map.image;
  const toScreen = (x, y) => { const [u, v] = toImg(x, y); return [u * scale + ox, v * scale + oy]; };
  const cat = (c) => map.categories.find((k) => k.id === c) || {};

  // Icons extracted from the game, loaded on first use (painting shared with the minimap, map-icons.js).
  const icons = MapIcons(() => { dirty = true; });
  const image = icons.image;
  const drawIcon = (sx, sy, s, c, iconPath, ring, markerColor) => icons.drawIcon(ctx, sx, sy, s, cat(c), iconPath, ring, markerColor);
  const drawVent = (sx, sy, marker, hovered) => icons.paintVent(ctx, sx, sy, MARKER_SIZE, marker, hovered);

  function init(cnv, mapData, selectFn, openDungeon) {
    canvas = cnv;
    ctx = canvas.getContext('2d');
    map = mapData;
    onSelect = selectFn;
    document.addEventListener('visibilitychange', () => { if (document.hidden) wasVisible = hadPlayer = false; });
    updateWaypoint = Waypoint.mount('map-waypoint', canvas.parentElement, () => selectDestination(null));
    document.getElementById('map-add-waypoint').onclick = () => setWaypointPlacement(!placingWaypoint);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && placingWaypoint) setWaypointPlacement(false); });
    loadLayerImage();

    let drag = null;
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, ox, oy, moved: false }; });
    window.addEventListener('mouseup', (e) => {
      if (drag && !drag.moved && e.button === 0 && e.target === canvas) {
        if (placingWaypoint) placeWaypoint(e);
        else {
          pick(e);
          if (hover?.custom && hover === destination) {
            selectDestination(null); hover = null; document.getElementById('map-tip').hidden = true;
          } else if (hover) { selectDestination(hover); onSelect(hover); }
        }
      }
      if (drag?.moved) { followPause = performance.now() + 3000; saveViewport(); } // look around, then glide back to the player
      drag = null;
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault(); drag = null;
      pick(e);
      if (hover?.enter) { setWaypointPlacement(false); openDungeon?.(hover); }
      else placeWaypoint(e);
    });
    window.addEventListener('mousemove', (e) => {
      lastPointer = performance.now();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; followPause = Infinity; }
        ox = drag.ox + dx; oy = drag.oy + dy; dirty = true;
        return;
      }
      if (e.target === canvas) pick(e);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      lastPointer = performance.now();
      const r = canvas.getBoundingClientRect();
      const f = e.deltaY < 0 ? 1.25 : 0.8;
      // While following, zoom around the player so it stays in the middle.
      if (following()) zoomAt(r.width / 2, r.height / 2, f);
      else zoomAt(e.clientX - r.left, e.clientY - r.top, f);
    }, { passive: false });
    new ResizeObserver(() => { resize(); }).observe(canvas.parentElement);
    requestAnimationFrame(loop);
  }

  function loadLayerImage() {
    const next = new Image();
    img = next;
    next.onload = () => { if (img !== next) return; W = next.naturalWidth; H = next.naturalHeight; fitted = false; resize(); };
    next.src = '../../data/' + layerImage();
    W = H = 1; dirty = true;
  }

  // Switch between the world map (null) and a dungeon's floor plan.
  function setLayer(d, storey) {
    d = d || null;
    storey = d ? storey ?? (d === playerLayer ? playerLevel : d.overview ? -1 : 0) : 0;
    if (d === layer && storey === level) return;
    hover = null;
    const tip = document.getElementById('map-tip'); if (tip) tip.hidden = true;
    if (d === layer) {
      // Another storey of the same dungeon: same frame, so keep the view and just swap the picture.
      level = storey;
      const keep = { W, H }, next = new Image();
      img = next; next.onload = () => {
        if (img !== next) return;
        W = next.naturalWidth; H = next.naturalHeight;
        // Switching to Overview before the first floor finishes loading must establish
        // the image dimensions too; otherwise the pending view remains a 1x1 blank map.
        if (keep.W <= 1 || keep.H <= 1 || !fitted) { fitted = false; resize(); }
        dirty = true;
      };
      next.src = '../../data/' + layerImage();
      ({ W, H } = keep);
    } else {
      saveViewport();
      layer = d; level = storey;
      loadLayerImage();
    }
    dirty = true;
    layerChanged(layer, level);
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const oldWidth = viewW, oldHeight = viewH;
    viewW = r.width; viewH = r.height;
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    if (fitted) { ox += (r.width - oldWidth) / 2; oy += (r.height - oldHeight) / 2; }
    dirty = true;
    // First real size after the image loaded: frame the whole map.
    if (!fitted && W > 1 && r.width > 0) {
      fitted = true;
      const savedViewport = layer ? layerViews[layer.id] : Preferences.json('mapViewport', null);
      if (savedViewport && Number.isFinite(savedViewport.scale) && savedViewport.scale > 0
        && Number.isFinite(savedViewport.u) && Number.isFinite(savedViewport.v)) {
        scale = Math.min(4, Math.max(0.05, savedViewport.scale));
        ox = r.width / 2 - savedViewport.u * W * scale;
        oy = r.height / 2 - savedViewport.v * H * scale;
      } else {
        fit(false);
        // Opening the dungeon you are standing in: start on yourself.
        if (layer && playerHere() && follow) centerOn(player.x, player.y, 0.6);
      }
      pendingFocus?.(); pendingFocus = null;
    }
  }
  let fitted = false;
  // The view's exact CSS size. canvas.width is a whole number of device pixels, so deriving the view
  // size from it lost fractions on every resize and nudged the centre (and the saved viewport) a little.
  let viewW = 0, viewH = 0;
  let pendingFocus = null; // centring requested before the layer's image had loaded

  function fit(persist = true) {
    if (!fitted) return resize();
    // Whole map must stay framed instead of Follow immediately pulling it off centre again.
    if (persist && follow) { follow = false; followChanged(false); }
    const cw = viewW, ch = viewH;
    // Dungeon plans must fit in the visible area beside the legend, below the controls.
    // Fitting to the raw canvas puts the left-hand rooms behind the legend.
    const legend = document.getElementById('map-legend');
    const left = legend && !legend.hidden ? Math.min(cw * 0.6, legend.getBoundingClientRect().width + 32) : 16;
    const tools = document.querySelector('.map-tools');
    const top = tools ? tools.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top + 16 : 16, bottom = 52;
    const width = Math.max(1, cw - left - 16), height = Math.max(1, ch - top - bottom);
    scale = Math.min(width / W, height / H);
    ox = left + (width - W * scale) / 2; oy = top + (height - H * scale) / 2;
    dirty = true;
    if (persist) saveViewport();
  }

  function zoomAt(sx, sy, f) {
    const ns = Math.min(4, Math.max(0.05, scale * f));
    ox = sx - ((sx - ox) * ns) / scale;
    oy = sy - ((sy - oy) * ns) / scale;
    scale = ns;
    dirty = true;
    saveViewport();
  }

  function centerOn(x, y, minScale) {
    const cw = viewW, ch = viewH;
    if (minScale && scale < minScale) scale = minScale;
    const [u, v] = toImg(x, y);
    ox = cw / 2 - u * scale; oy = ch / 2 - v * scale;
    dirty = true;
  }

  // Dense categories only appear once zoomed in, unless they are highlighted.
  // Completed quests drop off the map (like Questie); highlighted results always show.
  let questStatus = () => 'unknown';
  let questVisibility = (m, highlighted) => highlighted || !m.ref || questStatus(m.ref) !== 'done';
  let questInfo = () => null;
  // Vent type, discovery and quest filters, which the minimap applies too.
  const filtered = (m, highlighted) => resourceTypeEnabled(m.c, m.n) && (m.c !== 'vent' || ventTypeEnabled(m.ventType || 'unknown')) && MapDiscovery.visible(m) && (m.c !== 'quest' || questVisibility(m, highlighted));
  // Tracked quest targets stay on the map whatever the filters or highlight, like WoW's quest areas.
  const visible = (m) => onLayer(m) && (tracked.has(m) || filtered(m, !!highlight?.markers.has(m)) && (highlight ? highlight.markers.has(m)
    : enabled.has(m.c) && (frame().res / scale < DENSE_UNITS || !RESOURCE_CATEGORIES.includes(m.c))));
  // Ring around quest markers: blue for quests in progress, gold for givers of quests you can still take.
  const questRing = (m) => {
    if (m.c !== 'quest' || !m.ref) return null;
    const s = questStatus(m.ref);
    return s === 'active' ? '#4fc3ff' : m.qnpc && s !== 'done' ? '#ffd040' : null;
  };
  // Ring around a quest's target creatures and drop sources, in its shaded area's colour.
  const targetRing = (m) => {
    const t = tracked.get(m);
    return t && t.kind !== 'goto' && m.c !== 'quest' ? t.kind === 'kill' ? '#ff6a4a' : '#ffd040' : null;
  };

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 100;
    const live = others.filter(otherHere);
    for (const m of [...(destination?.custom && onLayer(destination) ? [destination] : []), ...live, ...map.markers]) {
      if (!m.custom && !m.live && (!visible(m) || questHidden.has(m))) continue;
      const [sx, rawY] = toScreen(m.x, m.y), sy = rawY - (m.custom ? 10 : 0);
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      const info = m.c === 'quest' ? questInfo(m) : null;
      const hit = d < (markerSize(m) / 2 + 1) ** 2;
      const priority = m.custom ? 100 : info?.current ? 30 : info?.pickup ? 15 : 0;
      const score = d - priority;
      if (hit && (!best || score < bd)) { bd = score; best = m; }
    }
    if (best !== hover) { hover = best; dirty = true; }
    const tip = document.getElementById('map-tip');
    if (hover) {
      tip.hidden = false;
      tip.style.left = mx + 14 + 'px';
      tip.style.top = my + 10 + 'px';
      const dist = hover.live && player?.ok ? ` · ${Math.round(Math.hypot(hover.x - player.x, hover.y - player.y) / 100)} m away` : '';
      const qs = hover.c === 'quest' && hover.ref ? questStatus(hover.ref) : null;
      const mood = qs ? { active: ' · in progress', available: ' · not started', unknown: ' · not found yet', done: ' · completed' }[qs] : '';
      const info = hover.c === 'quest' ? questInfo(hover) : null;
      const t = tracked.get(hover);
      if (t && hover.c !== 'quest') {
        card(tip, hover.n, [t.label, `${t.index ? `Quest ${t.index}: ` : ''}${t.quest}${hover.region ? ' · ' + hover.region : ''}`], 'Click for the quest');
      } else if (info) {
        // One step: the one this place is for now (current, or where the quest starts), else its first.
        const step = info.steps.find(s => String(s.number) === info.badge) || info.steps[0];
        const more = (questGroups.get(hover)?.length || 1) - 1;
        card(tip, info.title, [t ? `Tracked · ${t.label}` : '', `${info.label} · ${info.location}`,
          step ? step.text : 'Step not confirmed in the game data', more ? `+${more} more quest place${more > 1 ? 's' : ''} here · zoom in to see ${more > 1 ? 'them' : 'it'}` : ''], 'Click for the quest guide');
      } else {
        const discovery = ['lore', 'shrine'].includes(hover.c) ? { discovered: 'Discovered', undiscovered: 'Undiscovered', unknown: 'Discovery not confirmed yet' }[MapDiscovery.state(hover)] : '';
        const about = [mood.replace(/^ · /, ''), dist.replace(/^ · /, ''), hover.region, discovery].filter(Boolean).join(' · ');
        card(tip, `${hover.live ? '● ' : ''}${hover.n}`, [about],
          hover.custom ? 'Click to remove waypoint' : hover.enter ? 'Left-click to navigate · Right-click to open its map' : hover.ref || ['lore', 'shrine'].includes(hover.c) ? 'Click for details' : '');
      }
      tip.style.left = Math.max(8, Math.min(mx + 14, r.width - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(my + 10, r.height - tip.offsetHeight - 8)) + 'px';
    } else tip.hidden = true;
  }

  // Hover card: what it is, a line or two about it, and what a click does.
  function card(tip, title, lines, action) {
    const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
    tip.replaceChildren(el('strong', title), ...lines.filter(Boolean).map(l => el('span', l)), ...(action ? [el('em', action)] : []));
  }

  const following = () => follow && playerHere() && performance.now() > followPause;
  function snapPlayer() {
    paintedPlayer = player?.ok ? { x: player.x, y: player.y, yaw: player.yaw } : null;
  }
  function animatePlayer(ms) {
    if (!paintedPlayer || !playerHere()) return false;
    const dx = player.x - paintedPlayer.x, dy = player.y - paintedPlayer.y;
    const turn = ((player.yaw - paintedPlayer.yaw) % 360 + 540) % 360 - 180;
    if (Math.abs(dx) + Math.abs(dy) < 0.1 && Math.abs(turn) < 0.05) {
      if (dx === 0 && dy === 0 && turn === 0) return false;
      snapPlayer(); return true;
    }
    const k = 1 - Math.pow(0.7, ms / (1000 / 60));
    paintedPlayer.x += dx * k; paintedPlayer.y += dy * k;
    paintedPlayer.yaw = ((paintedPlayer.yaw + turn * k + 180) % 360 + 360) % 360 - 180;
    return true;
  }

  let lastFrame = 0, lastPointer = -Infinity, wasVisible = false, hadPlayer = false;
  function loop(now) {
    requestAnimationFrame(loop);
    // Keep live data for the minimap, but never paint a retained full-size canvas behind a closed map.
    if (document.hidden || !canvas.getClientRects().length) { wasVisible = hadPlayer = false; return; }
    // The fullscreen map intentionally leaves keyboard focus with the game. It is still the active map view.
    // A separate map on another monitor retains its lower budget while you play.
    const fps = document.body.classList.contains('game-map') || document.hasFocus() || now - lastPointer < 2000 ? 60 : 20;
    if (now - lastFrame < 1000 / fps - 0.5) return;
    const elapsed = lastFrame ? Math.min(100, now - lastFrame) : 1000 / fps;
    lastFrame = now;
    if (!wasVisible || playerHere() && !hadPlayer) { snapPlayer(); dirty = true; }
    wasVisible = true; hadPlayer = playerHere();
    if (animatePlayer(elapsed)) dirty = true;
    if (following()) {
      // Glide towards the player instead of snapping, so movement and returning from a drag look smooth.
      const cw = viewW, ch = viewH;
      const pose = paintedPlayer || player;
      const [u, v] = toImg(pose.x, pose.y);
      const dx = cw / 2 - u * scale - ox, dy = ch / 2 - v * scale - oy;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        const k = Math.abs(dx) + Math.abs(dy) > 2000 ? 1 : 1 - Math.pow(0.8, elapsed / (1000 / 60));
        ox += dx * k; oy += dy * k; dirty = true;
      }
    }
    if (dirty) draw();
  }

  // WoW-style quest areas: spawns of tracked kill/loot targets merge into one soft shaded region.
  // Drawn opaque on a scratch canvas, then composited once so overlapping circles don't darken.
  const AREA_UNITS = 3000;     // world radius around each recorded spawn
  let areaCanvas = null;
  function drawTrackedAreas(cw, ch) {
    const spawns = [...tracked].filter(([m, t]) => t.kind !== 'goto' && m.c !== 'quest' && onLayer(m));
    if (!spawns.length) return;
    const dpr = devicePixelRatio;
    areaCanvas ||= document.createElement('canvas');
    if (areaCanvas.width !== canvas.width || areaCanvas.height !== canvas.height) { areaCanvas.width = canvas.width; areaCanvas.height = canvas.height; }
    const g = areaCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, areaCanvas.width, areaCanvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = Math.max(18, AREA_UNITS / frame().res * scale);
    for (const kind of ['loot', 'kill', 'collect']) {
      g.fillStyle = kind === 'kill' ? '#e0563a' : '#f0c040';
      g.beginPath();
      for (const [m, t] of spawns) {
        if (t.kind !== kind) continue;
        const [sx, sy] = toScreen(m.x, m.y);
        if (sx < -r || sy < -r || sx > cw + r || sy > ch + r) continue;
        g.moveTo(sx + r, sy); g.arc(sx, sy, r, 0, Math.PI * 2);
      }
      g.fill();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(areaCanvas, 0, 0);
    ctx.restore();
  }
  // Places to go: a gold ring with the quest's tracker number, above everything but the player.
  // One per merged group: a quest's numbers share one badge ("1,3") and one ring.
  function drawTrackedPins(cw, ch) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [m, group] of questGroups) {
      const ts = group.map(g => tracked.get(g)).filter(t => t && (t.kind === 'goto' || m.c === 'quest'));
      if (!ts.length) continue;
      const [sx, sy] = toScreen(m.x, m.y);
      ctx.beginPath(); ctx.arc(sx, sy, MARKER_SIZE / 2 + 5, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = '#ffd040'; ctx.shadowColor = '#ffb000'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      // An untracked active quest's place has no tracker number.
      const label = [...new Set(ts.map(t => t.index).filter(Boolean))].sort((a, b) => a - b).join(',');
      if (label) pill(sx + MARKER_SIZE / 2 + 2, sy - MARKER_SIZE / 2 - 2, label, '#ffd040', '#2a1e00');
    }
    ctx.textBaseline = 'alphabetic';
  }
  // A small rounded label centred on (x, y): tracker numbers, and the +N of merged quest places.
  function pill(x, y, text, fill, ink) {
    ctx.save();
    ctx.font = '700 11px Segoe UI';
    const w = Math.max(16, ctx.measureText(text).width + 8);
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 8); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = ink; ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  // Quest places closer than a marker's width merge into one, so their discs, rings and numbers never pile up: the
  // most important (a tracked quest's, the current step, a start) is drawn with +N. Zooming in separates them.
  let questGroups = new Map(), questHidden = new Set();
  function groupQuestMarkers(infos, cw, ch) {
    questGroups = new Map(); questHidden = new Set();
    const rank = m => (tracked.get(m)?.index ? 8 : 0) + (infos.get(m)?.current ? 4 : 0) + (infos.get(m)?.pickup ? 2 : 0) + (tracked.has(m) ? 1 : 0);
    const kept = [];
    for (const it of [...infos.keys()].filter(visible).map(m => { const [x, y] = toScreen(m.x, m.y); return { m, x, y, r: rank(m) }; })
      .filter(i => i.x > -40 && i.y > -40 && i.x < cw + 40 && i.y < ch + 40).sort((a, b) => b.r - a.r)) {
      const near = kept.find(k => (k.x - it.x) ** 2 + (k.y - it.y) ** 2 < MARKER_SIZE ** 2);
      if (near) { questGroups.get(near.m).push(it.m); questHidden.add(it.m); }
      else { kept.push(it); questGroups.set(it.m, [it.m]); }
    }
  }

  function draw() {
    const pose = paintedPlayer || player;
    updateWaypoint(waypoint(), pose);
    dirty = false;
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (img.complete && W > 1) ctx.drawImage(img, ox, oy, W * scale, H * scale);

    // Region outlines (faint) and names as the game writes them: a serif in cream with a dark outline, the region's
    // power level small beneath (world map only).
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const r of layer ? [] : map.regions) {
      ctx.beginPath();
      r.poly.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.closePath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,230,170,0.16)';
      ctx.stroke();
      if (scale > 0.12) {
        const cx = r.poly.reduce((a, p) => a + p[0], 0) / r.poly.length, cy = r.poly.reduce((a, p) => a + p[1], 0) / r.poly.length;
        const [sx, sy] = toScreen(cx, cy), size = scale > 0.3 ? 18 : 15;
        ctx.font = `600 ${size}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
        ctx.letterSpacing = '0.5px';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,9,5,0.85)'; ctx.strokeText(r.name, sx, sy);
        ctx.fillStyle = '#f3e3b8'; ctx.fillText(r.name, sx, sy);
        if (r.level) {
          ctx.font = '600 11px Segoe UI';
          ctx.letterSpacing = '1px';
          ctx.lineWidth = 3; ctx.strokeText(`TIER ${r.level}`, sx, sy + 15);
          ctx.fillStyle = '#c9b88c'; ctx.fillText(`TIER ${r.level}`, sx, sy + 15);
        }
        ctx.letterSpacing = '0px';
      }
    }
    ctx.lineWidth = 1;
    ctx.font = `${scale > 0.3 ? 13 : 11}px Segoe UI`;

    // Spawn dots stay subdued; landmarks retain their readable size at any zoom.
    const cw = viewW, ch = viewH;
    const layerMarkers = map.markers.filter(onLayer);
    const shown = layerMarkers.filter(visible);
    const inViewport = m => { const [x, y] = toScreen(m.x, m.y); return x >= -26 && x <= cw + 26 && y >= -26 && y <= ch + 26; };
    const zoomHidden = frame().res / scale >= DENSE_UNITS && layerMarkers.some(m => enabled.has(m.c) && RESOURCE_CATEGORIES.includes(m.c) && filtered(m, false));
    const summary = { visible: shown.filter(inViewport).length,
      reason: shown.length ? 'No markers in this area. Pan the map or choose Fit map.'
        : zoomHidden ? 'Ores, plants and trees appear when zoomed in. Zoom in to see resource locations.'
        : layerMarkers.length ? 'No locations match your filters on this map or floor. Change or reset the filters.' : 'No recorded locations on this map or floor. Try another floor or map.' };
    const visibilityKey = JSON.stringify(summary);
    if (visibilityKey !== lastVisibility) { lastVisibility = visibilityKey; visibilityChanged(summary); }
    // Current objectives and starts sit above overlapping later quest locations.
    const infos = new Map(map.markers.filter(m => m.c === 'quest' && onLayer(m)).map(m => [m, questInfo(m)]));
    const priority = m => infos.get(m)?.current ? 3 : infos.get(m)?.pickup ? 2 : 1;
    const nonQuests = map.markers.filter(m => m.c !== 'quest' && onLayer(m));
    const ordered = nonQuests.filter(m=>m.c==='monster').concat(nonQuests.filter(m=>m.c!=='monster'), [...infos.keys()].sort((a, b) => priority(a) - priority(b)));
    drawTrackedAreas(cw, ch);
    groupQuestMarkers(infos, cw, ch);
    for (const m of ordered) {
      if (!visible(m) || questHidden.has(m)) continue;
      const [sx, sy] = toScreen(m.x, m.y);
      if (sx < -20 || sy < -20 || sx > cw + 20 || sy > ch + 20) continue;
      const info = infos.get(m);
      if (info) {
        icons.paintQuest(ctx, sx, sy, MARKER_SIZE, info, m === hover);
        const more = questGroups.get(m)?.length - 1;
        if (more > 0) pill(sx + MARKER_SIZE / 2 + 2, sy + MARKER_SIZE / 2 + 1, '+' + more, '#2b2a27', '#e8dcc0');
      } else if (m.c === 'vent') {
        drawVent(sx, sy, m, m === hover);
      } else drawIcon(sx, sy, markerSize(m), m.c, m.i, m === hover ? '#fff' : questRing(m) || targetRing(m), m.color);
    }

    drawTrackedPins(cw, ch);
    if (destination?.custom && onLayer(destination)) {
      const [x, y] = toScreen(destination.x, destination.y);
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, -15); ctx.arc(0, -15, 9, Math.PI, 0); ctx.closePath();
      ctx.fillStyle = '#ffd040'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#362a12'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -15, 3, 0, Math.PI * 2); ctx.fillStyle = '#362a12'; ctx.fill(); ctx.restore();
    }

    // Other players: a green arrow the way their character faces, with their name above it.
    ctx.font = '600 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const o of others) {
      if (!otherHere(o)) continue;
      const [sx, sy] = toScreen(o.x, o.y);
      if (sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(((o.yaw + 90) * Math.PI) / 180);
      ctx.shadowColor = '#6f6'; ctx.shadowBlur = o === hover ? 12 : 6;
      ctx.beginPath();
      ctx.moveTo(0, -11); ctx.lineTo(-8, 9); ctx.lineTo(0, 4); ctx.lineTo(8, 9); ctx.closePath();
      ctx.fillStyle = '#5fe36a'; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = o === hover ? 2.5 : 1.5; ctx.strokeStyle = o === hover ? '#fff' : '#0b2a0e'; ctx.stroke();
      ctx.restore();
      if (o.n) {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(o.n, sx, sy - 16);
        ctx.fillStyle = '#b8ffbe'; ctx.fillText(o.n, sx, sy - 16);
      }
    }

    // Player: the game's own arrow, pointing where the camera looks (yaw 0 = +X = right), large on a soft halo so
    // you find yourself at a glance.
    if (playerHere()) {
      if (destination && !waypoint().blocked && onLayer(destination)) {
        const [px, py] = toScreen(pose.x, pose.y), [tx, ty] = toScreen(destination.x, destination.y);
        const angle = Math.atan2(ty - py, tx - px);
        ctx.save(); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty);
        ctx.setLineDash([7, 7]); ctx.lineWidth = 2; ctx.strokeStyle = '#ffd040'; ctx.stroke(); ctx.setLineDash([]);
        if (Math.hypot(tx - px, ty - py) > 36) {
          ctx.translate(px + Math.cos(angle) * 36, py + Math.sin(angle) * 36); ctx.rotate(angle);
          ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath();
          ctx.fillStyle = '#ffd040'; ctx.fill(); ctx.strokeStyle = '#362a12'; ctx.stroke();
        }
        ctx.restore();
      }
      const [sx, sy] = toScreen(pose.x, pose.y);
      ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,200,255,0.16)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(140,225,255,0.55)'; ctx.stroke();
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(((pose.yaw + 90) * Math.PI) / 180);
      const img = image('mapicons/T_NavIcons_Player_Self.png');
      ctx.shadowColor = '#3cf';
      ctx.shadowBlur = 8;
      if (img) ctx.drawImage(img, -18, -18, 36, 36);
      else {
        ctx.beginPath();
        ctx.moveTo(0, -12); ctx.lineTo(-7, 8); ctx.lineTo(0, 4); ctx.lineTo(7, 8); ctx.closePath();
        ctx.fillStyle = '#3cf';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  return {
    init,
    setDestination: selectDestination,
    waypoint,
    resize: () => { resize(); },
    redraw: () => { dirty = true; hover = null; const tip = document.getElementById('map-tip'); if (tip) tip.hidden = true; },
    setEnabled(cat, on) { on ? enabled.add(cat) : enabled.delete(cat); Preferences.setJSON('mapCategories', [...enabled]); dirty = true; },
    isEnabled: (cat) => enabled.has(cat),
    defaultCategories: () => [...DEFAULT_CATEGORIES],
    onVisibilityChange(fn) { visibilityChanged = fn; lastVisibility = ''; dirty = true; },
    navigation() {
      return { layer: layer?.id || null, level,
        viewport: W > 1 ? { scale, u: (viewW / 2 - ox) / scale / W, v: (viewH / 2 - oy) / scale / H } : null,
        highlight: highlight ? { label: highlight.label, markers: [...highlight.markers].map(m => map.markers.indexOf(m)).filter(i => i >= 0) } : null };
    },
    restoreNavigation(context) {
      highlight = context.highlight ? { label: context.highlight.label, markers: new Set(context.highlight.markers.map(i => map.markers[i]).filter(Boolean)) } : null;
      setLayer(context.layer ? map.dungeons.find(d => d.id === context.layer) : null, context.level);
      const restore = () => {
        if (context.viewport) { scale = context.viewport.scale; ox = viewW / 2 - context.viewport.u * W * scale; oy = viewH / 2 - context.viewport.v * H * scale; }
        dirty = true; saveViewport();
      };
      if (W > 1) restore(); else pendingFocus = restore;
    },
    isVentTypeEnabled: ventTypeEnabled,
    resourceCategories: () => RESOURCE_CATEGORIES.slice(),
    isResourceTypeEnabled: resourceTypeEnabled,
    isResourceFiltered: category => resourceTypes[category] !== null,
    setResourceTypes,
    setResourceType(category, name, on) {
      const names = resourceTypes[category] === null
        ? new Set((map?.markers || []).filter(m => m.c === category).map(m => m.n)) : new Set(resourceTypes[category]);
      on ? names.add(name) : names.delete(name); setResourceTypes(category, names);
    },
    createVentIcon: icons.createVentIcon,
    setVentTypes,
    setVentType(type, on) {
      const types = ventTypes === null ? new Set((map?.markers || []).filter(m => m.c === 'vent').map(m => m.ventType || 'unknown')) : new Set(ventTypes);
      on ? types.add(type) : types.delete(type); setVentTypes(types);
    },
    setHighlight(label, markers, { preserveDestination = false } = {}) {
      // Choose once; movement must not silently switch between nearby copies of a resource.
      if (markers?.length && !markers.includes(destination)) {
        const here = player?.ok ? markers.filter(m => onStorey(m, playerLayer, playerLevel)) : [];
        const candidates = here.length ? here : markers;
        selectDestination(player?.ok ? candidates.reduce((a, b) =>
          Math.hypot(a.x - player.x, a.y - player.y) <= Math.hypot(b.x - player.x, b.y - player.y) ? a : b) : candidates[0]);
      } else if (!markers?.length && !preserveDestination) selectDestination(null);
      highlight = markers && markers.length ? { label, markers: new Set(markers) } : null;
      if (highlight && follow) { follow = false; followChanged(false); } // framing the results beats following
      if (highlight) {
        // Results can sit in dungeons: stay on this layer if it has any, else open the one with the most.
        if (!markers.some(onLayer)) {
          const counts = {};
          for (const m of markers) { const k = m.d ? m.d + '|' + markerLevel(m) : ''; counts[k] = (counts[k] || 0) + 1; }
          const [best, storey] = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0].split('|');
          setLayer(best ? map.dungeons.find(d => d.id === best) : null, +storey || 0);
        }
        const here = markers.filter(onLayer);
        const frameResults = () => {
          // Frame all highlighted markers on this layer.
          const xs = here.map((m) => m.x), ys = here.map((m) => m.y);
          const [u1, v1] = toImg(Math.min(...xs), Math.min(...ys)), [u2, v2] = toImg(Math.max(...xs), Math.max(...ys));
          const cw = viewW, ch = viewH;
          scale = Math.min(1.2, Math.max(0.08, Math.min(cw / (u2 - u1 + 400), ch / (v2 - v1 + 400))));
          ox = cw / 2 - ((u1 + u2) / 2) * scale; oy = ch / 2 - ((v1 + v2) / 2) * scale;
          dirty = true;
        };
        // A layer that just switched frames once its image (and so its scale) is known.
        if (W > 1) frameResults(); else pendingFocus = frameResults;
      }
      dirty = true;
      return highlight;
    },
    highlightLabel: () => highlight?.label || null,
    // On you, on your map and floor, at least this close (as the game's own map opens).
    centerOnPlayer(minScale) {
      if (!player?.ok) return false;
      snapPlayer();
      if (layer !== playerLayer || (layer && level !== playerLevel)) setLayer(playerLayer, playerLevel);
      const go = () => { centerOn(player.x, player.y, minScale); saveViewport(); };
      if (W > 1) go(); else pendingFocus = go;
      return true;
    },
    setPlayer(p) {
      const previous = player;
      player = p;
      // Going through a dungeon door (either way) takes the map with you.
      const now = p?.ok ? dungeonAt(p) : playerLayer;
      const storey = now && p?.ok ? levelAt(now, p) : playerLevel;
      if (!p?.ok || !previous?.ok || previous.world !== p.world || now !== playerLayer || storey !== playerLevel
        || !paintedPlayer || Math.hypot(p.x - paintedPlayer.x, p.y - paintedPlayer.y) > 3000) snapPlayer();
      // Going through a dungeon door, or up/down to another storey, takes the map with you.
      if (now !== playerLayer || storey !== playerLevel) {
        const follows = now !== playerLayer || (layer === playerLayer && level >= 0);
        playerLayer = now; playerLevel = storey;
        if (canvas && follows) setLayer(now, storey);
      }
      dirty = true;
    },
    setLayer(d, storey) { setLayer(d, storey); },
    layer: () => layer,
    level: () => level,
    dungeons: () => map?.dungeons || [],
    playerDungeon: () => playerLayer,
    onLayerChange(fn) { layerChanged = fn; },
    setOthers(list) { others = list.map(o => ({ ...o, live: true, c: 'player', n: o.n || 'Another player' })); dirty = true; },
    setQuestStatus(fn) { questStatus = fn; dirty = true; },
    setQuestVisibility(fn) { questVisibility = fn; dirty = true; },
    setQuestInfo(fn) { questInfo = fn; dirty = true; },
    setTracked(entries) {
      tracked = new Map();
      for (const e of entries) if (!tracked.has(e.marker)) tracked.set(e.marker, e);
      dirty = true;
    },
    trackedEntry: (m) => tracked.get(m) || null,
    // The quest places drawn as one with this one (it first when it is the one drawn), as of the last frame.
    questGroupOf: (m) => questGroups.get(m) || [...questGroups.values()].find(g => g.includes(m)) || [m],
    screenOf: (m) => { const [x, y] = toScreen(m.x, m.y); return { x, y }; },
    // What the minimap draws around you: the map and storey you stand on (whatever this map shows), markers
    // within `range` world units that the filters let through (search highlights aside), live creatures,
    // other players, and the nearest target of each tracked quest so it can point at those past its rim.
    minimapScene(range) {
      if (!map || !player?.ok) return { ok: false, waypoint: waypoint(), displaySizes: MapAppearance.sizes() };
      const l = playerLayer, lv = playerLevel;
      const near = (p) => Math.abs(p.x - player.x) < range && Math.abs(p.y - player.y) < range;
      const markers = [], targets = new Map();
      for (const m of map.markers) {
        if (!onStorey(m, l, lv)) continue;
        const t = tracked.get(m);
        if (t?.index) { // rim arrows only for quests in the tracker
          const d = Math.hypot(m.x - player.x, m.y - player.y), best = targets.get(t.index);
          if (!best || d < best.d) targets.set(t.index, { x: m.x, y: m.y, index: t.index, d });
        }
        if (!near(m) || !(t || filtered(m, false) && enabled.has(m.c))) continue;
        const info = m.c === 'quest' ? questInfo(m) : null;
        markers.push({ x: m.x, y: m.y, c: m.c, i: m.i, color: m.color, ventType: m.ventType, ring: questRing(m) || targetRing(m),
          quest: info && { badge: info.badge, color: info.color, current: info.current, pickup: info.pickup },
          track: t && { index: t.index, area: t.kind !== 'goto' && m.c !== 'quest' ? t.kind : null } });
      }
      // Same stacking as the map: spawn dots under places, current quest steps and pickups on top.
      const rank = (m) => m.c === 'monster' ? 0 : !m.quest ? 1 : m.quest.current ? 4 : m.quest.pickup ? 3 : 2;
      markers.sort((a, b) => rank(a) - rank(b));
      const inside = (poly) => {
        let hit = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if ((yi > player.y) !== (yj > player.y) && player.x < (xj - xi) * (player.y - yi) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      };
      return {
        ok: true,
        player: { x: player.x, y: player.y, yaw: player.yaw },
        place: l ? l.name + (l.levels?.length > 1 ? ` · Level ${lv + 1}` : '') : map.regions.find(r => inside(r.poly))?.name || 'Dragonwilds',
        image: l ? l.levels?.[lv]?.image || l.image : map.image,
        frame: l ? { minX: l.frame.minX, minY: l.frame.minY, res: l.frame.res } : { minX: map.bounds.minX, minY: map.bounds.minY, size: map.bounds.size },
        categories: map.categories,
        displaySizes: MapAppearance.sizes(),
        waypoint: waypoint(),
        markers,
        targets: [...targets.values()].map(({ x, y, index }) => ({ x, y, index })),
        others: others.filter(o => dungeonAt(o) === l && (!l || levelAt(l, o) === lv) && near(o)).map(o => ({ x: o.x, y: o.y, yaw: o.yaw })),
      };
    },
    focusMarker(marker) {
      selectDestination(marker);
      if (highlight && !highlight.markers.has(marker)) highlight = null;
      hover = null;
      document.getElementById('map-tip').hidden = true;
      setLayer(marker.d ? map.dungeons.find(d => d.id === marker.d) : null, marker.d ? markerLevel(marker) : 0);
      follow = false; followChanged(false);
      const focus = () => { centerOn(marker.x, marker.y, 0.45); saveViewport(); };
      if (W > 1) focus(); else pendingFocus = focus;
    },
    image,
    setFollow(on, { restore = false } = {}) {
      follow = on;
      followPause = 0;
      if (on && !restore && scale < 0.5) { scale = 0.5; dirty = true; saveViewport(); }
      followChanged(on);
    },
    isFollowing: () => follow,
    onFollowChange(fn) { followChanged = fn; },
    zoom(f) { zoomAt(viewW / 2, viewH / 2, f); },
    fit,
  };
})();
