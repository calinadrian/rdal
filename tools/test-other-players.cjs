const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('players')); // removed after the test ends
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(process.env.ATLAS_TEST_WIDTH) || 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Other players test timed out'); app.exit(1); }, 30000);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer: ' + message); });
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive(); await new Promise(r => setTimeout(r, 800));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      state.module = 'map'; setMapMode(true); renderModules();
      await wait(600);
      const takla = db.map.dungeons.find(d => d.name === 'Takla Kara');
      const inside = db.map.markers.find(m => m.d === takla.id && m.c === 'chest') || db.map.markers.find(m => m.d === takla.id);
      const me = { x: 150000, y: 60000, z: 0 };
      const names = [];
      const ctx = document.querySelector('#map').getContext('2d'), fillText = ctx.fillText;
      ctx.fillText = function (text, ...rest) { names.push(text); return fillText.call(this, text, ...rest); };
      const draw = async () => { names.length = 0; MapView.redraw(); await wait(120); };
      // A partner next to you on the surface, another inside a dungeon.
      onPlayer({ ok: true, world: 'L_World', ...me, yaw: 0,
        players: [{ n: 'dianiiix3', x: me.x + 400, y: me.y, z: me.z, yaw: 90 }, { n: 'Delver', x: inside.x, y: inside.y, z: inside.z, yaw: 0 }] });
      MapView.setFollow(true); await wait(300); await draw();
      assert(names.includes('dianiiix3'), 'A nearby player must be drawn with their name');
      assert(!names.includes('Delver'), 'A player inside a dungeon must not be drawn on the world map');
      const canvas = document.querySelector('#map'), r = canvas.getBoundingClientRect();
      const [px, py] = [r.x + r.width / 2, r.y + r.height / 2];
      MapView.zoom(1);
      // Hover the partner: they are 4 m east of the centre.
      for (let dx = 0; dx < 80 && document.querySelector('#map-tip').hidden; dx += 2)
        canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: px + dx, clientY: py }));
      assert(document.querySelector('#map-tip').textContent.includes('dianiiix3') && document.querySelector('#map-tip').textContent.includes('m away'),
        'Hovering a player must name them and say how far away they are');
      MapView.setLayer(takla, 0); await wait(600); await draw();
      assert(MapView.layer()?.id === takla.id, 'Dungeon must open');
      // Delver is on one of Takla Kara's levels: browse them until they show up.
      let seen = names.includes('Delver');
      for (let l = 0; l < takla.levels.length && !seen; l++) { MapView.setLayer(takla, l); await wait(300); await draw(); seen = names.includes('Delver'); }
      assert(seen, 'A player inside a dungeon must be drawn on that dungeon map');
      assert(!names.includes('dianiiix3'), 'A player on the surface must not be drawn on a dungeon map');
      onPlayer({ ok: false });
      await draw();
      assert(!names.includes('Delver'), 'Other players must disappear when you leave the game');
      ctx.fillText = fillText;
      return 'Other players test passed';
    })()`));
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(workspace, 'test-fixtures', process.env.ATLAS_TEST_WIDTH ? 'dungeon-map-' + process.env.ATLAS_TEST_WIDTH + '.png' : 'other-players.png'), shot.toPNG());
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message || String(error)); app.exit(1);
  }
});
