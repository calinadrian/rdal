// Minimap: the main window's scene follows the map's filters and tracked quests around the player, and the
// minimap window (app/minimap.js) draws it over the game. Captures test-fixtures/minimap*.png.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('minimap'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L', minimap: true, minimapSize: 200 }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: require('../package.json').version }));
ipcMain.on('preferences:commit', e => { e.returnValue = { ok: true }; });
let scenes = [];
ipcMain.on('minimap:scene', (_, scene) => scenes.push(scene));
const timer = setTimeout(() => { console.error('Minimap test timed out'); app.exit(1); }, 60000);
const tick = (ms = 300) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('Renderer: ' + message); });
  const js = code => win.webContents.executeJavaScript(code);
  const lastScene = async (player) => { scenes = []; await js(`onPlayer(${JSON.stringify(player)})`); await tick(100); return scenes.at(-1); };
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html'));
    await tick(800);
    // The minimap works without ever opening the map.
    assert(await js(`mapReady && state.module !== 'map'`), 'With the minimap on, the map is set up at start even when another section is open');

    // Track The Wild Hunt (kill Nature Spirits) and stand near a Nature Spirit spawn.
    await js(`trackedQuests=[];const q=ent('The Wild Hunt');onQuestLog([{id:q.id,s:1,o:'HuntBeast'}]);setTracked(q.name,true);`);
    const spirit = await js(`(()=>{const m=db.map.markers.find(m=>m.n==='Nature Spirit'&&!m.d);return {x:m.x,y:m.y,z:m.z}})()`);
    const me = { ok: true, world: 'L_World', x: spirit.x + 2500, y: spirit.y + 1500, z: spirit.z, yaw: -30 };
    const npcs = [{ c: 'BP_AI_Deer_Character', x: me.x + 900, y: me.y - 400, z: me.z, alert: 0 }, { c: 'BP_AI_Deer_Character', x: me.x - 1200, y: me.y + 600, z: me.z, alert: 4 }];
    const players = [{ n: 'Partner', x: me.x - 3000, y: me.y - 2000, z: me.z, yaw: 45 }];
    const scene = await lastScene({ ...me, npcs, players });
    assert(scene?.ok, 'A live position sends a scene');
    assert.equal(scene.image, await js(`db.map.image`), 'Outside dungeons the minimap shows the world picture');
    assert(await js(`db.map.regions.some(r => r.name === ${JSON.stringify(scene.place)})`), 'The name bar names the region you are in: ' + scene.place);
    assert(scene.markers.some(m => m.track?.area === 'kill'), 'Tracked kill targets nearby are shaded');
    assert(scene.targets.some(t => t.index === 1), 'The tracked quest has a target for the rim arrow');
    assert.equal(scene.npcs.length, 2, 'Live creatures are on the minimap');
    assert(scene.npcs.some(n => n.combat), 'Creatures in combat are marked');
    assert.equal(scene.others.length, 1, 'Other players nearby are on the minimap');
    assert(scene.markers.every(m => Math.abs(m.x - me.x) < 27000 && Math.abs(m.y - me.y) < 27000), 'Only markers in reach are sent');

    // The map's filters apply: hiding monster spawns drops untracked ones but keeps the tracked targets.
    assert(scene.markers.some(m => m.c === 'monster' && !m.track), 'Monster spawns show by default');
    await js(`MapView.setEnabled('monster', false)`);
    const filtered = await lastScene(me);
    assert.equal(filtered.markers.filter(m => m.c === 'monster' && !m.track).length, 0, 'Filtered categories leave the minimap');
    assert(filtered.markers.some(m => m.track?.area === 'kill'), 'Tracked targets stay whatever the filters');
    await js(`MapView.setEnabled('monster', true)`);

    // The real minimap window: top-right of the main screen, drawn from the relayed scene.
    let stored = { minimap: true, minimapSize: 200, minimapRotate: false, minimapZoom: 2 };
    const minimap = require(path.join(target, 'app/minimap.js')).createMinimap({ settings: () => stored, update: (p) => { stored = { ...stored, ...p }; } });
    const show = async (patch, file) => {
      stored = { ...stored, ...patch }; minimap.sync(true);
      await tick(1500);
      const mm = minimap.window(), shot = await mm.webContents.capturePage();
      if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', file), shot.toPNG());
      return { mm, shot, run: (code) => mm.webContents.executeJavaScript(code) };
    };
    await lastScene({ ...me, npcs, players });
    const north = await show({}, 'minimap.png');
    const area = screen.getPrimaryDisplay().workArea, at = north.mm.getBounds();
    assert.deepEqual([at.x, at.y, at.width, at.height], [area.x + area.width - 232, area.y + 16, 216, 238], 'It starts in the top-right corner: ' + JSON.stringify(at));
    assert(!north.mm.isFocusable() && north.mm.isAlwaysOnTop() && north.mm.isVisible(), 'It floats over the game without taking focus');
    const { width } = north.shot.getSize(), px = north.shot.toBitmap(), k = width / 216;
    const alpha = (x, y) => px[(Math.round(y * k) * width + Math.round(x * k)) * 4 + 3];
    assert(alpha(108, 134) > 0, 'The map is drawn inside the circle');
    assert.equal(alpha(2, 236), 0, 'Outside the circle the window is see-through');
    assert.equal(await north.run(`document.getElementById('zone').textContent`), scene.place, 'The name bar shows the place');
    const turned = await show({ minimapRotate: true, minimapZoom: 1 }, 'minimap-rotated.png');
    assert(await turned.run(`!document.getElementById('zoom-in').disabled && !document.getElementById('zoom-out').disabled`), 'Zoom buttons work between the limits');
    const close = await show({ minimapRotate: false, minimapZoom: 0 }, 'minimap-zoomed.png');
    assert(await close.run(`document.getElementById('zoom-in').disabled`), 'Zoom in stops at the closest level');

    // Zooming, dragging and double-clicking the name bar are remembered through the settings.
    await close.run(`document.getElementById('zoom-out').click()`); await tick(200);
    assert.equal(stored.minimapZoom, 1, 'Zoom is saved');
    await close.run(`minimap.move(${area.x + 40}, ${area.y + 60}); minimap.place(false)`); await tick(300);
    assert.deepEqual(stored.minimapPosition, { x: area.x + 40, y: area.y + 60 }, 'A dragged position is saved');
    assert.deepEqual(minimap.window().getPosition(), [area.x + 40, area.y + 60], 'The window moved');
    await close.run(`minimap.place(true)`); await tick(300);
    assert(!stored.minimapPosition && minimap.window().getPosition()[0] === area.x + area.width - 232, 'Double-clicking the bar puts it back in the corner');

    // Inside a dungeon it shows that storey's plan and names the dungeon.
    const takla = await js(`(()=>{const d=db.map.dungeons.find(d=>d.name==='Takla Kara');const m=db.map.markers.find(m=>m.d===d.id&&m.c==='chest');return {id:d.id,x:m.x,y:m.y,z:m.z}})()`);
    const inside = await lastScene({ ok: true, world: 'L_World', x: takla.x + 300, y: takla.y, z: takla.z, yaw: 90, npcs: [], players: [] });
    assert(inside.place.startsWith('Takla Kara'), 'In a dungeon the name bar names it: ' + inside.place);
    assert(inside.image.startsWith('dungeons/'), 'In a dungeon the minimap shows its floor plan');
    assert(inside.markers.some(m => m.c === 'chest'), 'Dungeon markers are on the dungeon minimap');
    const large = await show({ minimapSize: 260, minimapZoom: 2 }, 'minimap-dungeon.png');
    assert.deepEqual(large.mm.getSize(), [276, 298], 'The large size grows the window');

    // Leaving the game empties it; the game closing removes it.
    assert.equal((await lastScene({ ok: false })).ok, false, 'No position, no scene');
    minimap.sync(false);
    assert.equal(minimap.window(), null, 'Closed when the game is not running');
    console.log('PASS: minimap scene with region name, filters, tracked targets, live creatures and players; window top-right, see-through, unfocusable; north-up, rotated, zoomed and in a dungeon; zoom, drag and reset saved');
    clearTimeout(timer); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timer); app.exit(1); }
});
