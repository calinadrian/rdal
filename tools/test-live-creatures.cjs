// Runtime check: electron --no-sandbox tools/test-live-creatures.cjs [packaged resources/app]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('live')); // removed after the test ends
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json')));
ipcMain.handle('db:get', () => db);
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
let uiPreferences = {};
ipcMain.handle('preferences:get', () => uiPreferences);
ipcMain.handle('preferences:set', (_, patch) => { uiPreferences = { ...uiPreferences, ...patch }; return true; });
ipcMain.on('preferences:commit', (event, patch) => { uiPreferences = { ...uiPreferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Live filter test timed out'); app.exit(1); }, 25000);
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive();
    await new Promise(r => setTimeout(r, 1000));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      state.module = 'map'; setMapMode(true); renderModules();
      const original = MapView.setNpcs;
      let shown = [];
      MapView.setNpcs = list => { shown = list; original(list); };
      const p = { ok: true, x: db.map.bounds.minX + db.map.bounds.size / 2, y: db.map.bounds.minY + db.map.bounds.size / 2 };
      const fixture = [
        { c: 'BP_AI_Wolf_Character_C', x: p.x + 5000, y: p.y, alert: 0 },
        { c: 'BP_AI_Cow_Character_C', x: p.x + 10000, y: p.y, alert: 0 },
        { c: 'BP_AI_Wolf_Character_C', x: p.x + 15000, y: p.y, alert: 4 },
      ];
      const choose = names => {
        document.querySelector('.creature-pool-actions button').click();
        if (names === null) return document.querySelector('#live-creature-all').click();
        for (const name of names) {
          const box = [...document.querySelectorAll('.creature-pool-options input')].find(box => box.value === name);
          assert(box, 'Missing checkbox: ' + name); box.click();
        }
      };
      onNpcs(fixture, p);
      assert(shown.length === 3, 'All creatures must show by default');
      choose(['Wolf']);
      assert(shown.length === 2 && shown.every(n => n.n === 'Wolf'), 'Only wolves must reach map rendering and hit testing');
      assert(document.querySelectorAll('#nearby .nearby-row').length === 2, 'Nearby must match filter');
      assert(document.querySelector('#count-npc').textContent === '2', 'Count must match filter');
      assert(shown[0].d < shown[1].d && shown[1].combat, 'Distances and combat status must be preserved');
      onNpcs([fixture[1]], p);
      assert(!shown.length && document.querySelector('#nearby').textContent.includes('No selected creatures nearby'), 'Selected creature leaving range must show empty state');
      assert(liveCreaturePool.has('Wolf'), 'Tracking updates must preserve selection');
      choose(null); assert(shown.length === 1, 'All creatures must restore the current live list');
      onNpcs([...fixture, { c: 'BP_AI_NewCreature_Character_C', x: p.x, y: p.y, alert: 0 }], p);
      assert([...document.querySelectorAll('.creature-pool-options input')].some(o => o.value === 'New Creature'), 'Unknown live creatures must be selectable');
      choose(['Wolf']); renderLegend();
      assert(liveCreaturePool.has('Wolf'), 'Legend rebuild must preserve selection');
      onPlayer({ ok: false }); assert(!shown.length && document.querySelector('#count-npc').textContent === '0', 'Disconnect must clear filtered creatures');
      onPlayer({ ...p, npcs: fixture });
      assert(shown.length === 2, 'Reconnection must retain the filter');
      choose(['Wolf', 'Cow']);
      assert(shown.length === 3, 'Pool must include both selected types');
      [...document.querySelectorAll('.creature-pool-options input')].find(box => box.value === 'Cow').click();
      assert(shown.length === 2 && shown.every(n => n.n === 'Wolf'), 'Unchecking a type must retain the other');
      choose([]); assert(!shown.length, 'An empty pool must hide all live creatures');
      choose(['Wolf', 'Cow']);
      const menu = document.querySelector('#live-creature-filter'); menu.open = true;
      const search = menu.querySelector('input[type=search]'); search.value = 'wolf'; search.dispatchEvent(new Event('input'));
      assert([...menu.querySelectorAll('.creature-pool-options label')].filter(l => !l.hidden).every(l => /wolf/i.test(l.textContent)), 'Search must filter checkbox choices');
      assert(menu.open, 'Checkbox changes must leave the dropdown open');
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(!menu.open, 'Escape must close the dropdown');
      return 'PASS: multiple types, unchecking, all/clear, search, map markers, nearby, counts and reconnect';
    })()`));
    await win.reload();
    await new Promise(r => setTimeout(r, 1000));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      state.module = 'map'; setMapMode(true); renderModules();
      if (!liveCreaturePool?.has('Wolf') || !liveCreaturePool?.has('Cow') || liveCreaturePool.size !== 2) throw Error('Pool must survive a reload');
      const p = { x: db.map.bounds.minX + db.map.bounds.size / 2, y: db.map.bounds.minY + db.map.bounds.size / 2 };
      onNpcs([{ c: 'BP_AI_Wolf_Character_C', x: p.x, y: p.y, alert: 0 }], p);
      document.querySelector('#live-creature-filter').open = true;
      const search = document.querySelector('.creature-pool-menu input[type=search]'); search.value = 'wolf'; search.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 700));
      return 'PASS: saved selection restored after reload';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/live-creature-filter.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
