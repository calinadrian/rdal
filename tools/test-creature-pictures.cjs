// Run with: electron --no-sandbox tools/test-creature-pictures.cjs
// Creatures show the game's own journal art (World → Fauna / Factions); there is no 3D viewer.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('pictures')); // removed after the test ends
setTimeout(() => { console.error('Creature picture test timed out'); app.exit(1); }, 25000);
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json')));
ipcMain.handle('db:get', () => db);
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
let uiPreferences = {};
ipcMain.handle('preferences:get', () => uiPreferences);
ipcMain.on('preferences:commit', (event, patch) => { uiPreferences = { ...uiPreferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive();
    await new Promise(r => setTimeout(r, 1500));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const loaded = img => img.complete && img.naturalWidth > 0;
      assert(!window.Model3D && !document.querySelector('script[src*="model3d"]'), 'The 3D viewer must not load');
      const monsters = Object.values(E).filter(e => e.kind === 'monster');
      const pictured = monsters.filter(e => e.image);
      assert(pictured.length >= 95, 'Most creatures must have a journal picture, got ' + pictured.length);
      state.module = 'monsters'; render();
      await wait(800);
      const select = name => {
        const row = [...document.querySelectorAll('#list .list-item')].find(r => r.title === name);
        assert(row, 'Missing creature row: ' + name); row.click();
      };
      assert(document.querySelectorAll('#list .list-item img').length === monsters.length, 'Every creature must have a list icon');
      select('Wolf');
      await wait(600);
      const art = document.querySelector('#content .creature-picture-art');
      assert(art && art.src.includes('T_Icon_Journal_Wolf'), 'Wolf must show its journal picture');
      assert(loaded(art), 'Wolf picture must load');
      // Regional variants use their base creature's page; creatures without a page show no empty frame.
      assert(E['Skeleton DR 1H'].image.includes('Skeletal_Warrior'), 'Dowdun skeleton must use the Skeletal Warrior page');
      const missing = monsters.find(e => !e.image);
      if (missing) { select(missing.name); await wait(300); assert(!document.querySelector('#content .creature-picture'), 'No picture frame without a picture'); }
      select('Wolf'); await wait(300);
      showItem('Animal Hide'); await wait(400);
      assert(document.querySelector('#content .creature-picture-art'), 'Selecting a drop must keep the creature picture');
      // Map layout: the detail panel shows the picture instead.
      document.body.classList.add('map-mode'); renderContent(); showItem('Wolf'); await wait(400);
      assert(document.querySelector('#detail .creature-picture-art'), 'Map selection must show the picture in the detail panel');
      document.body.classList.remove('map-mode'); go({ type: 'source', arg: 'Wolf' }, { detail: 'Animal Hide' }); await wait(600);
      return JSON.stringify({ passed: true, creatures: monsters.length, pictured: pictured.length });
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/creature-pictures.png'), (await win.webContents.capturePage()).toPNG());
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
