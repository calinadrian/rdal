// Minimap: the main window's scene follows the map's filters and tracked quests around the player, and the
// minimap window (app/minimap.js) draws it over the game with the tracked quests listed under it.
// Captures test-fixtures/minimap*.png.
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
  if (process.env.ATLAS_TEST_SECONDARY_DISPLAY) {
    const primary = screen.getPrimaryDisplay();
    const secondary = screen.getAllDisplays().find(d => d.id !== primary.id);
    if (!secondary) throw Error('Secondary-display test requested but no second display is available');
    screen.getPrimaryDisplay = () => secondary;
  }
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
    const players = [{ n: 'Partner', x: me.x - 3000, y: me.y - 2000, z: me.z, yaw: 45 }];
    const scene = await lastScene({ ...me, players });
    assert(scene?.ok, 'A live position sends a scene');
    assert.equal(scene.image, await js(`db.map.image`), 'Outside dungeons the minimap shows the world picture');
    assert(await js(`db.map.regions.some(r => r.name === ${JSON.stringify(scene.place)})`), 'The name bar names the region you are in: ' + scene.place);
    assert(scene.markers.some(m => m.track?.area === 'kill'), 'Tracked kill targets nearby are shaded');
    assert(scene.targets.some(t => t.index === 1), 'The tracked quest has a target for the rim arrow');
    assert.equal(scene.others.length, 1, 'Other players nearby are on the minimap');
    assert(scene.markers.every(m => Math.abs(m.x - me.x) < 27000 && Math.abs(m.y - me.y) < 27000), 'Only markers in reach are sent');
    assert.deepEqual(scene.quests.map(q => [q.index, q.name]), [[1, 'The Wild Hunt']], 'The tracked quests go with the scene');
    assert(scene.quests[0].text.length > 10, 'Each tracked quest says what to do now: ' + scene.quests[0].text);

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
    minimap.focus(true);
    const show = async (patch, file) => {
      stored = { ...stored, ...patch }; minimap.sync(true);
      await tick(1500);
      const mm = minimap.window(), shot = await mm.webContents.capturePage();
      if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', file), shot.toPNG());
      return { mm, shot, run: (code) => mm.webContents.executeJavaScript(code) };
    };
    await lastScene({ ...me, players });
    const north = await show({}, 'minimap.png');
    const originalSend = north.mm.webContents.send.bind(north.mm.webContents);
    const relay = [];let relayedPlayer=null;
    north.mm.webContents.send = (channel, ...args) => { relay.push(channel);if(channel==='minimap:player')relayedPlayer=args[0];return originalSend(channel, ...args); };
    const area = screen.getPrimaryDisplay().workArea, at = north.mm.getBounds();
    assert.deepEqual([at.x, at.y, at.width], [area.x + area.width - 280, area.y + 16, 264], 'It starts in the top-right corner: ' + JSON.stringify(at));
    assert(!north.mm.isFocusable() && north.mm.isAlwaysOnTop() && north.mm.isVisible(), 'It floats over the game without taking focus');
    minimap.focus(false); assert(!north.mm.isVisible(), 'Alt-Tab hides the minimap over other applications');
    relay.length = 0;minimap.player({ok:true,x:me.x+6000,y:me.y,yaw:me.yaw});
    ipcMain.emit('minimap:scene',{sender:win.webContents},scene);
    assert.equal(relay.length,0,'Hidden minimaps retain data without forwarding player or scene updates');
    minimap.suspend(true); minimap.suspend(false); assert(!north.mm.isVisible(), 'Closing the large map cannot reveal a minimap outside the game');
    minimap.focus(true); assert(north.mm.isVisible(), 'Returning to the game restores the minimap');
    assert(relay.includes('minimap:active') && relay.includes('minimap:scene') && relay.includes('minimap:player'),'Resuming sends the retained scene and latest position');
    assert.equal(relayedPlayer.x,me.x+6000,'Resuming uses the newest position received while hidden');
    minimap.player({ok:false});await tick(200);
    const dial = await north.run(`(()=>{const r=document.querySelector('.dial').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width}})()`);
    assert.equal(Math.round(dial.x + dial.w), 264 - 8, 'The minimap keeps to the right, in the corner');
    const { width } = north.shot.getSize(), px = north.shot.toBitmap(), k = width / 264;
    const alpha = (x, y) => px[(Math.round(y * k) * width + Math.round(x * k)) * 4 + 3];
    assert(alpha(dial.x + 100, dial.y + 100) > 0, 'The map is drawn inside the circle');
    assert.equal(alpha(dial.x + 2, dial.y + 2), 0, 'Outside the circle the window is see-through');
    // Your position also comes straight from the tracker: the minimap moves with you while the main window is busy.
    const disc = { x: Math.round(dial.x), y: Math.round(dial.y), width: Math.round(dial.w), height: Math.round(dial.w) };
    const still = (await north.mm.webContents.capturePage(disc)).toBitmap();
    minimap.player({ ok: true, x: me.x + 6000, y: me.y, yaw: me.yaw }); await tick(800);
    assert(!still.equals((await north.mm.webContents.capturePage(disc)).toBitmap()), 'A live position moves the minimap without a new scene');
    minimap.player({ ok: false }); await tick(800);
    assert(still.equals((await north.mm.webContents.capturePage(disc)).toBitmap()), 'Without one it goes back to the scene\'s position');
    assert.equal(await north.run(`document.getElementById('zone').textContent`), scene.place, 'The name bar shows the place');
    assert(await north.run(`/\\d:\\d\\d/.test(document.getElementById('clock').textContent) && /[A-Za-z]/.test(document.getElementById('clock').textContent)`), 'The rim shows the day and local time');
    const listed = await north.run(`[...document.querySelectorAll('.quest')].map(q=>q.querySelector('.quest-num').textContent+' '+q.querySelector('.quest-title').textContent)`);
    assert.deepEqual(listed, ['1 The Wild Hunt'], 'The tracked quest is listed under the minimap');
    const page = await north.run(`Math.ceil(document.body.getBoundingClientRect().height)`);
    assert(Math.abs(north.mm.getBounds().height - page) <= 1 && page > 248, 'The window grows to fit the quest list: ' + page);

    // Folding the list keeps only its heading, and is remembered.
    await north.run(`document.getElementById('quests-toggle').click()`); await tick(300);
    assert(stored.minimapQuestsFolded && await north.run(`document.getElementById('quest-list').hidden`), 'The quest list folds away');
    assert(north.mm.getBounds().height < page, 'Folding shrinks the window');
    await north.run(`document.getElementById('quests-toggle').click()`); await tick(300);
    assert(!stored.minimapQuestsFolded, 'Unfolding is remembered');

    // While the character loads the bar keeps the last place, never a generic title.
    await js(`onPlayer({ ok: false })`); await tick(300);
    assert.equal(await north.run(`document.getElementById('zone').textContent`), scene.place, 'The name bar keeps the last place');
    assert.equal(await north.run(`document.querySelectorAll('.quest').length`), 1, 'Quests stay listed while the character loads');
    await lastScene({ ...me, players }); await tick(300);
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
    assert(!stored.minimapPosition && minimap.window().getPosition()[0] === area.x + area.width - 280, 'Double-clicking the bar puts it back in the corner');

    // Inside a dungeon it shows that storey's plan and names the dungeon.
    const takla = await js(`(()=>{const d=db.map.dungeons.find(d=>d.name==='Takla Kara');const m=db.map.markers.find(m=>m.d===d.id&&m.c==='chest');return {id:d.id,x:m.x,y:m.y,z:m.z}})()`);
    const inside = await lastScene({ ok: true, world: 'L_World', x: takla.x + 300, y: takla.y, z: takla.z, yaw: 90, players: [] });
    assert(inside.place.startsWith('Takla Kara'), 'In a dungeon the name bar names it: ' + inside.place);
    assert(inside.image.startsWith('dungeons/'), 'In a dungeon the minimap shows its floor plan');
    assert(inside.markers.some(m => m.c === 'chest'), 'Dungeon markers are on the dungeon minimap');
    const large = await show({ minimapSize: 260, minimapZoom: 2 }, 'minimap-dungeon.png');
    assert(large.mm.getSize()[0] === 276 && large.mm.getSize()[1] > 308, 'The large size grows the window: ' + large.mm.getSize());

    // Readability preferences reach the overlay and grow quest text without cutting off instructions.
    await js(`document.querySelector('#size-questText').value='160'; document.querySelector('#size-questText').dispatchEvent(new Event('input'));
      document.querySelector('#size-minimapButtons').value='160'; document.querySelector('#size-minimapButtons').dispatchEvent(new Event('input'));
      document.querySelector('#size-minimapIcons').value='160'; document.querySelector('#size-minimapIcons').dispatchEvent(new Event('input'));
      document.querySelector('#size-minimapText').value='140'; document.querySelector('#size-minimapText').dispatchEvent(new Event('input'));`);
    const sized = await lastScene({ ok: true, x: takla.x, y: takla.y, z: takla.z, yaw: 0 }); await tick(300);
    assert.equal(sized.displaySizes.questText, 160, 'Quest size reaches scene');
    assert.equal(sized.displaySizes.minimapIcons, 160, 'Icon size reaches overlay');
    assert(Math.abs(await large.run(`document.querySelector('#zoom-in').getBoundingClientRect().width`) - 35.2) < .2, 'Minimap buttons grow');
    assert(Math.abs(await large.run(`parseFloat(getComputedStyle(document.querySelector('#clock')).fontSize)`) - 15.4) < .1, 'Clock text grows');
    assert(Math.abs(await large.run(`parseFloat(getComputedStyle(document.querySelector('#zone')).fontSize)`) - 16.8) < .1, 'Location text grows');
    assert.equal(await large.run(`Number(getComputedStyle(document.querySelector('#quests')).zoom)`), 1.6, 'Minimap quest text scales');
    assert.equal(await large.run(`document.body.scrollWidth <= innerWidth`), true, 'Large text fits the overlay');
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures/minimap-text-large.png'), (await large.mm.webContents.capturePage()).toPNG());
    const smallSized = await show({minimapSize:160}, 'minimap-small-large-text.png');
    assert.equal(await smallSized.run(`(() => {
      const bounds = document.body.getBoundingClientRect();
      return [...document.querySelectorAll('.zoom')].every(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.bottom<=bounds.bottom; });
    })()`), true, 'Large zoom buttons fit even on the small minimap');
    assert.equal(await smallSized.run(`(() => {
      const a=document.querySelector('#zoom-in').getBoundingClientRect(), b=document.querySelector('#zoom-out').getBoundingClientRect(), clock=document.querySelector('#clock').getBoundingClientRect();
      const apart=(a,b)=>a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top;
      return apart(a,b) && apart(a,clock) && apart(b,clock);
    })()`), true, 'Large buttons stay separate from each other and the clock');
    await js(`for (const key of ['minimapButtons','minimapIcons','minimapText','questText']) {
      const el=document.getElementById('size-'+key);el.value='80';el.dispatchEvent(new Event('input'));
    }`);
    await lastScene({ ok:true, x:takla.x, y:takla.y, z:takla.z, yaw:0 }); await tick(200);
    assert(Math.abs(await smallSized.run(`document.querySelector('#zoom-in').getBoundingClientRect().width`) - 17.6) < .2, 'Small button setting applies live');
    assert.equal(await smallSized.run(`Number(getComputedStyle(document.querySelector('#quests')).zoom)`), .8, 'Small quest text applies live');

    // Width changes resize the transparent host too, without moving the minimap's right edge.
    const rightEdge = smallSized.mm.getBounds().x + smallSized.mm.getBounds().width;
    await js(`{const widthSlider=document.querySelector('#size-questWidth');widthSlider.value='180';widthSlider.dispatchEvent(new Event('input'));}`);
    await lastScene({ok:true,x:takla.x,y:takla.y,z:takla.z,yaw:0}); await tick(300);
    assert(Math.abs(await smallSized.run(`document.querySelector('#quests').getBoundingClientRect().width`) - 248 * 1.8) < 2, 'Quest list widens independently of text scale');
    assert.equal(smallSized.mm.getBounds().x + smallSized.mm.getBounds().width, rightEdge, 'Right edge stays anchored');
    assert.equal(await smallSized.run(`Number(getComputedStyle(document.querySelector('#quests')).zoom)`), .8, 'Changing width preserves text size');
    assert.equal(await smallSized.run(`document.querySelector('#minimap').getBoundingClientRect().width`), 160, 'Changing width preserves minimap diameter');
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures/minimap-quest-wide.png'), (await smallSized.mm.webContents.capturePage()).toPNG());
    await js(`{const widthSlider=document.querySelector('#size-questWidth');widthSlider.value='70';widthSlider.dispatchEvent(new Event('input'));}`);
    await lastScene({ok:true,x:takla.x,y:takla.y,z:takla.z,yaw:0}); await tick(200);
    assert(Math.abs(await smallSized.run(`document.querySelector('#quests').getBoundingClientRect().width`) - 248 * .7) < 2, 'Quest list narrows independently');
    assert.equal(await smallSized.run(`document.body.scrollWidth <= innerWidth`), true, 'Narrow list stays inside overlay');

    // Leaving the game empties it; the game closing removes it.
    assert.equal((await lastScene({ ok: false })).ok, false, 'No position, no scene');
    minimap.sync(false);
    assert.equal(minimap.window(), null, 'Closed when the game is not running');
    console.log('PASS: minimap scene with region name, filters, tracked targets, live creatures and players; window top-right, see-through, unfocusable; day and time, tracked quests listed and foldable, last place kept; follows the live position from the tracker; north-up, rotated, zoomed and in a dungeon; zoom, drag and reset saved');
    clearTimeout(timer); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timer); app.exit(1); }
});
