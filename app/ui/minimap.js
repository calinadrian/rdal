// WoW-style minimap: the area around you, north up or turning with the camera, named after where you are, with
// the day and local time on its rim and the tracked quests listed under it. The main window works out what to
// show (MapView.minimapScene with the map's filters and tracked quests, plus the quest list) and main.js relays it.
(() => {
  const bridge = window.minimap;
  const ZOOMS = [4000, 7000, 11000, 17000, 26000]; // world units from the centre to the rim (40–260 m)
  const ICON = 16, MONSTER = 7, QUEST = 18;
  const AREA_UNITS = 3000;     // same shaded radius around tracked spawns as the map
  const CHUNK = 2048;          // image px kept around you (the world picture is 6144 px square)
  const canvas = document.getElementById('minimap'), ctx = canvas.getContext('2d');
  const zone = document.getElementById('zone');
  const zoomIn = document.getElementById('zoom-in'), zoomOut = document.getElementById('zoom-out');
  const clock = document.getElementById('clock');
  const questBox = document.getElementById('quests'), questToggle = document.getElementById('quests-toggle');
  const questList = document.getElementById('quest-list');
  let size = 200, rotate = false, zoom = 2, folded = false;
  let scene = { ok: false };
  let shown = null;            // position drawn, gliding towards the latest sample: { x, y, yaw }
  let dirty = true;
  let areaCanvas = null;
  const icons = MapIcons(() => { dirty = true; });
  const cat = (c) => scene.categories?.find((k) => k.id === c) || {};

  let source = null, chunk = null, cutting = false;
  function loadImage(path) {
    if (source?.dataset.path === path) return;
    chunk?.img.close(); chunk = null;
    source = new Image();
    source.dataset.path = path;
    source.onload = () => { dirty = true; };
    source.src = '../../data/' + path;
  }
  const res = () => scene.frame.res ?? scene.frame.size / source.naturalWidth;
  // The picture around image px (u, v): dungeon plans whole, the world as a piece cut around you (again as you
  // travel), so this small window never holds the whole 6144 px world picture.
  function picture(u, v) {
    if (!source?.complete || !source.naturalWidth) return null;
    const { naturalWidth: w, naturalHeight: h } = source;
    if (w <= CHUNK * 2 && h <= CHUNK * 2) return { img: source, sx: 0, sy: 0, w, h };
    const reach = CHUNK / 2 - ZOOMS[zoom] / res() - 64;
    if (!cutting && !(chunk && Math.abs(u - chunk.u) < reach && Math.abs(v - chunk.v) < reach)) {
      cutting = true;
      const from = source, sx = Math.round(u - CHUNK / 2), sy = Math.round(v - CHUNK / 2);
      createImageBitmap(from, sx, sy, CHUNK, CHUNK).then((bitmap) => {
        if (from !== source) return bitmap.close();
        chunk?.img.close();
        chunk = { img: bitmap, sx, sy, w: CHUNK, h: CHUNK, u, v };
        dirty = true;
      }).catch(() => {}).finally(() => { cutting = false; });
    }
    return chunk;
  }

  function layout(options) {
    size = options.size; rotate = !!options.rotate; zoom = Math.min(ZOOMS.length - 1, Math.max(0, options.zoom ?? 2));
    if ('questsFolded' in options) fold(options.questsFolded);
    document.documentElement.style.setProperty('--size', size + 'px');
    canvas.width = canvas.height = Math.round(size * devicePixelRatio);
    zoomIn.disabled = zoom === 0; zoomOut.disabled = zoom === ZOOMS.length - 1;
    dirty = true;
  }
  // Tracked quests as WoW lists them: the number their targets carry on the minimap, the quest and what to do now.
  let questsShown = '';
  function renderQuests(quests = []) {
    const key = JSON.stringify(quests);
    if (key === questsShown) return;
    questsShown = key;
    questBox.hidden = !quests.length;
    document.getElementById('quest-count').textContent = quests.length;
    questList.replaceChildren(...quests.map((q) => {
      const li = document.createElement('li'), name = document.createElement('div'), step = document.createElement('div');
      li.className = 'quest' + (q.done ? ' done' : '');
      name.className = 'quest-name';
      name.append(Object.assign(document.createElement('span'), { className: 'quest-num', textContent: q.index }),
        Object.assign(document.createElement('span'), { className: 'quest-title', textContent: q.name, title: q.name }));
      step.className = 'quest-step';
      if (q.step) step.append(Object.assign(document.createElement('span'), { className: 'quest-step-label', textContent: q.step + ' · ' }));
      step.append(q.text);
      li.append(name, step);
      return li;
    }));
  }
  function fold(on) {
    folded = !!on;
    questList.hidden = folded;
    questToggle.setAttribute('aria-expanded', String(!folded));
    questToggle.title = folded ? 'Show the tracked quests' : 'Fold the quest list away';
    document.getElementById('quests-chevron').textContent = folded ? '▸' : '▾';
  }
  // Long lists stop at well over half the screen; the window grows with the page (main.js keeps it in place).
  questBox.style.maxHeight = Math.round(screen.availHeight * 0.6) + 'px';
  new ResizeObserver(() => bridge.height(Math.ceil(document.body.getBoundingClientRect().height))).observe(document.body);

  // The day and local time, e.g. "Fri 14:05", kept to the minute.
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  function tick() {
    const now = new Date();
    clock.textContent = day.format(now) + ' ' + time.format(now);
    clock.dateTime = now.toISOString();
    setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  function setZoom(next) {
    next = Math.min(ZOOMS.length - 1, Math.max(0, next));
    if (next === zoom) return;
    layout({ size, rotate, zoom: next });
    bridge.zoom(next);
  }

  // Glide to each new sample (the tracker reads about seven a second); jumps and teleports snap.
  function glide() {
    const p = scene.player;
    if (!shown || Math.hypot(p.x - shown.x, p.y - shown.y) > 3000) { shown = { ...p }; return; }
    const turn = ((p.yaw - shown.yaw + 540) % 360) - 180;
    if (Math.abs(p.x - shown.x) + Math.abs(p.y - shown.y) < 1 && Math.abs(turn) < 0.2) return;
    shown.x += (p.x - shown.x) * 0.3; shown.y += (p.y - shown.y) * 0.3; shown.yaw += turn * 0.3;
    dirty = true;
  }

  function draw() {
    dirty = false;
    const c = size / 2, r = c - 3;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#0b0a08'; ctx.fillRect(0, 0, size, size);
    const rot = rotate && scene.ok ? -((shown.yaw + 90) * Math.PI) / 180 : 0;
    if (scene.ok) drawScene(c, r, rot);
    else {
      ctx.fillStyle = '#a0a0a0'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for your', c, c - 8); ctx.fillText('character…', c, c + 8);
    }
    // Darker towards the rim, like a lens.
    const shade = ctx.createRadialGradient(c, c, r * 0.72, c, c, r);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // Rim, and N wherever north is.
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.lineWidth = 5; ctx.strokeStyle = '#1a160f'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#b8924e'; ctx.stroke();
    const nx = c + r * Math.sin(rot), ny = c - r * Math.cos(rot);
    ctx.beginPath(); ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#1a160f'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#b8924e'; ctx.stroke();
    ctx.fillStyle = '#f1dfb0'; ctx.font = '700 10px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }

  function drawScene(c, r, rot) {
    const u = ZOOMS[zoom] / r; // world units per pixel
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toScreen = (x, y) => {
      const dx = (x - shown.x) / u, dy = (y - shown.y) / u;
      return [c + dx * cos - dy * sin, c + dx * sin + dy * cos];
    };
    const inView = (sx, sy, pad) => (sx - c) ** 2 + (sy - c) ** 2 < (r + pad) ** 2;

    const f = scene.frame, pic = source?.naturalWidth && picture((shown.x - f.minX) / res(), (shown.y - f.minY) / res());
    if (pic) {
      const k = res() / u;
      ctx.save(); ctx.translate(c, c); ctx.rotate(rot);
      ctx.drawImage(pic.img, (f.minX - shown.x) / u + pic.sx * k, (f.minY - shown.y) / u + pic.sy * k, pic.w * k, pic.h * k);
      ctx.restore();
    }

    // Tracked kill and loot spawns: soft shaded areas as on the map, drawn opaque on a scratch canvas and
    // composited once so overlapping circles don't darken.
    const spawns = scene.markers.filter((m) => m.track?.area);
    if (spawns.length) {
      const dpr = devicePixelRatio, area = Math.max(10, AREA_UNITS / u);
      areaCanvas ||= document.createElement('canvas');
      if (areaCanvas.width !== canvas.width) areaCanvas.width = areaCanvas.height = canvas.width;
      const g = areaCanvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, areaCanvas.width, areaCanvas.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const kind of ['loot', 'kill', 'collect']) {
        g.fillStyle = kind === 'kill' ? '#e0563a' : '#f0c040';
        g.beginPath();
        for (const m of spawns) {
          if (m.track.area !== kind) continue;
          const [sx, sy] = toScreen(m.x, m.y);
          if (inView(sx, sy, area)) { g.moveTo(sx + area, sy); g.arc(sx, sy, area, 0, Math.PI * 2); }
        }
        g.fill();
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.34; ctx.drawImage(areaCanvas, 0, 0); ctx.restore();
    }

    // Quest places closer than a disc merge, like the map: the top one is drawn with +N and the tracker numbers combine.
    const groups = new Map(), hidden = new Set(), kept = [];
    for (const m of [...scene.markers].reverse()) {
      if (!m.quest && !(m.track && !m.track.area)) continue;
      const [sx, sy] = toScreen(m.x, m.y);
      const near = kept.find(k => (k.sx - sx) ** 2 + (k.sy - sy) ** 2 < QUEST ** 2);
      if (near) { groups.get(near.m).push(m); hidden.add(m); } else { kept.push({ m, sx, sy }); groups.set(m, [m]); }
    }
    for (const m of scene.markers) {
      const [sx, sy] = toScreen(m.x, m.y);
      if (!inView(sx, sy, ICON) || hidden.has(m)) continue;
      const group = groups.get(m) || [m];
      if (m.quest) icons.paintQuest(ctx, sx, sy, QUEST, m.quest, false);
      else if (m.c === 'vent') icons.paintVent(ctx, sx, sy, ICON, m, false);
      else icons.drawIcon(ctx, sx, sy, m.c === 'monster' ? MONSTER : ICON, cat(m.c), m.i, m.ring, m.color);
      // Places to go for a tracked quest: the map's gold ring with the tracker number.
      const places = group.filter(g => g.track && !g.track.area);
      if (places.length) {
        ctx.beginPath(); ctx.arc(sx, sy, QUEST / 2 + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffd040'; ctx.shadowColor = '#ffb000'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
        const numbers = [...new Set(places.map(g => g.track.index).filter(Boolean))].sort((x, y) => x - y).join(',');
        if (numbers) badge(sx + QUEST / 2 + 1, sy - QUEST / 2 - 1, numbers);
      }
      if (group.length > 1) badge(sx + QUEST / 2 + 1, sy + QUEST / 2, '+' + (group.length - 1), '#2b2a27', '#e8dcc0');
    }

    // Live creatures: amber dots, red in combat, with a ring while they are alert.
    for (const n of scene.npcs) {
      const [sx, sy] = toScreen(n.x, n.y);
      if (!inView(sx, sy, 6)) continue;
      if (n.alert) { ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = n.combat ? 'rgba(255,60,40,.9)' : 'rgba(255,190,60,.9)'; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = n.combat ? '#d03030' : '#e8a020'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    }

    // Other players: small green arrows the way they face.
    for (const o of scene.others) {
      const [sx, sy] = toScreen(o.x, o.y);
      if (!inView(sx, sy, 10)) continue;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(((o.yaw + 90) * Math.PI) / 180 + rot);
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(-5, 6); ctx.lineTo(0, 3); ctx.lineTo(5, 6); ctx.closePath();
      ctx.fillStyle = '#5fe36a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#0b2a0e'; ctx.stroke();
      ctx.restore();
    }

    // Tracked objectives beyond the rim: a numbered arrow on the edge pointing at the nearest one.
    for (const t of scene.targets) {
      const [sx, sy] = toScreen(t.x, t.y);
      if (inView(sx, sy, -ICON / 2)) continue;
      const a = Math.atan2(sy - c, sx - c), ex = c + Math.cos(a) * (r - 12), ey = c + Math.sin(a) * (r - 12);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(3, -6); ctx.lineTo(3, 6); ctx.closePath();
      ctx.fillStyle = '#ffd040'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#2a1e00'; ctx.stroke();
      ctx.restore();
      badge(ex, ey, t.index);
    }

    // You: the game's arrow, the way the camera looks.
    ctx.save(); ctx.translate(c, c); ctx.rotate(((shown.yaw + 90) * Math.PI) / 180 + rot);
    const arrow = icons.image('mapicons/T_NavIcons_Player_Self.png');
    ctx.shadowColor = '#3cf'; ctx.shadowBlur = 6;
    if (arrow) ctx.drawImage(arrow, -11, -11, 22, 22);
    else {
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-6, 7); ctx.lineTo(0, 3); ctx.lineTo(6, 7); ctx.closePath();
      ctx.fillStyle = '#3cf'; ctx.fill();
    }
    ctx.restore();
  }

  // The tracker number in a gold disc.
  function badge(x, y, n, fill = '#ffd040', ink = '#2a1e00') {
    ctx.font = '700 9px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.max(13, ctx.measureText(String(n)).width + 6);
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 6.5, w, 13, 6.5); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = ink; ctx.stroke();
    ctx.fillStyle = ink; ctx.fillText(String(n), x, y + 0.5);
  }

  function loop() {
    if (scene.ok) glide();
    if (dirty) draw();
    requestAnimationFrame(loop);
  }

  bridge.onOptions(layout);
  bridge.onScene((next) => {
    scene = next;
    if (scene.ok) loadImage(scene.image); else shown = null;
    // The name bar names where you are; while your character loads it keeps the last place.
    if (scene.ok && zone.textContent !== scene.place) zone.textContent = scene.place;
    renderQuests(scene.quests);
    dirty = true;
  });

  // Click-through except on the name bar, zoom buttons and quest heading, so it never gets in the way of the game.
  let drag = null;
  for (const el of [zone, zoomIn, zoomOut, questToggle]) {
    el.addEventListener('mouseenter', () => bridge.interactive(true));
    el.addEventListener('mouseleave', () => { if (!drag) bridge.interactive(false); });
  }
  for (const el of [zone, zoomIn, zoomOut]) el.addEventListener('wheel', (e) => setZoom(zoom + (e.deltaY > 0 ? 1 : -1)), { passive: true });
  zoomIn.onclick = () => setZoom(zoom - 1);
  zoomOut.onclick = () => setZoom(zoom + 1);
  questToggle.onclick = () => { fold(!folded); bridge.fold(folded); };
  zone.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    drag = { x: e.screenX - window.screenX, y: e.screenY - window.screenY, moved: false };
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    bridge.move(e.screenX - drag.x, e.screenY - drag.y);
  });
  zone.addEventListener('pointerup', () => {
    if (drag?.moved) bridge.place(false);
    drag = null;
    if (!zone.matches(':hover')) bridge.interactive(false);
  });
  zone.addEventListener('dblclick', () => { bridge.place(true); bridge.interactive(false); });

  layout({ size, rotate, zoom });
  tick();
  requestAnimationFrame(loop);
})();
