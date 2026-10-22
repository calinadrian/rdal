const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const root = process.argv[2] ? path.resolve(process.argv[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('resource-filter'));
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
ipcMain.handle('update:get', () => ({ status: 'idle' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Resource filter test timed out'); app.exit(1); }, 30000);
  win.webContents.on('console-message', (_, level, message) => { if (level >= 2) console.error('Renderer:', message); });
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive();
    await new Promise(r => setTimeout(r, 900));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      state.module = 'map'; setMapMode(true); renderModules();
      resetMapFilters();
      for (const c of [...db.map.categories.map(c => c.id), 'npc']) MapView.setEnabled(c, false);
      const picker = c => document.querySelector('#resource-filter-' + c);
      const buttons = c => picker(c).querySelectorAll('button');
      const box = (c, name) => [...picker(c).querySelectorAll('[data-resource]')].find(r => r.dataset.resource === name).querySelector('input');
      const toggleCategory = c => document.querySelector('#count-' + c).closest('label').querySelector('input').click();
      renderLegend();
      for (const [c, name] of [['ore', 'Gold'], ['gather', 'Flax'], ['tree', 'Oak tree']]) {
        assert(picker(c).hidden, c + ' picker follows disabled category');
        toggleCategory(c); assert(!picker(c).hidden, c + ' picker opens with category');
        buttons(c)[1].click();
        assert([...picker(c).querySelectorAll('input[type=checkbox]')].every(b => !b.checked), 'Clear keeps empty selection');
        box(c, name).click();
        assert(MapView.isResourceTypeEnabled(c, name) && picker(c).querySelector('summary').textContent === name, 'Single resource label');
        const search = picker(c).querySelector('input[type=search]');
        search.value = name; search.dispatchEvent(new Event('input'));
        const matches = [...picker(c).querySelectorAll('[data-resource]')].filter(r => !r.hidden);
        assert(matches.length > 0 && matches.every(r => r.dataset.resource.toLowerCase().includes(name.toLowerCase())), 'Search narrows resources');
        search.value = 'no such resource'; search.dispatchEvent(new Event('input'));
        assert(!picker(c).querySelector('.creature-pool-empty').hidden, 'Search empty state');
        search.value = ''; search.dispatchEvent(new Event('input'));
        const sample = db.map.markers.find(m => m.c === c && m.n === name && !m.d);
        assert(sample, 'Real exported marker exists: ' + name);
        MapView.setPlayer({ ok: true, x: sample.x, y: sample.y, z: sample.z, yaw: 0 });
        const scene = MapView.minimapScene(1000000).markers.filter(m => m.c === c);
        const wanted = db.map.markers.filter(m => m.c === c && m.n === name && !m.d && Math.abs(m.x - sample.x) < 1000000 && Math.abs(m.y - sample.y) < 1000000);
        assert(scene.length === wanted.length && scene.length > 0, 'Minimap shows only selected resource: ' + name);
        assert(document.querySelector('#count-' + c).textContent.startsWith(db.map.markers.filter(m => m.c === c && m.n === name).length + '/'), 'Filtered count');
      }
      box('ore', 'Iron').click(); assert(MapView.isResourceTypeEnabled('ore', 'Gold') && MapView.isResourceTypeEnabled('ore', 'Iron'), 'Multiple types supported');
      box('ore', 'Iron').click();
      const hidden = db.map.markers.find(m => m.c === 'ore' && m.n === 'Iron' && !m.d);
      MapView.setHighlight('Hidden iron', [hidden]); MapView.focusMarker(hidden); await wait(1300);
      const canvas = document.querySelector('#map');
      const hover = () => { const r = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); };
      hover(); assert(document.querySelector('#map-tip').hidden, 'Excluded resources cannot be hovered through highlights');
      const gold = db.map.markers.find(m => m.c === 'ore' && m.n === 'Gold' && !m.d);
      MapView.setHighlight('Gold', [gold]); MapView.focusMarker(gold); await wait(180); hover();
      assert(!document.querySelector('#map-tip').hidden && document.querySelector('#map-tip').textContent.includes('Gold'), 'Selected resource is drawn and hoverable');
      MapView.setHighlight(null); syncMapHighlight();
      buttons('ore')[0].click(); assert(!MapView.isResourceFiltered('ore'), 'Select all restores default');
      buttons('ore')[1].click(); box('ore', 'Gold').click();
      buttons('gather')[1].click();
      MapView.setLayer(null); MapView.focusMarker(gold); MapView.zoom(2);
      Preferences.set('worldFiltersOpen', '1'); syncDungeonMapChrome(); picker('ore').open = true;
      document.querySelector('#map-legend').scrollTop = picker('ore').offsetTop - 60;
      await wait(200);
      return 'PASS: resource search, empty state, independent/multiple choices, category controls, counts, world hover/drawing and minimap filtering';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/resource-map-filter.png'), (await win.webContents.capturePage()).toPNG());
    win.reload(); await new Promise(r => setTimeout(r, 1000));
    console.log(await win.webContents.executeJavaScript(`(() => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      initMap();
      assert(MapView.isResourceTypeEnabled('ore', 'Gold') && !MapView.isResourceTypeEnabled('ore', 'Iron'), 'Gold-only must restore');
      assert(MapView.isResourceFiltered('gather') && !MapView.isResourceTypeEnabled('gather', 'Flax'), 'Empty plant selection must restore');
      assert(MapView.isResourceTypeEnabled('tree', 'Oak tree') && !MapView.isResourceTypeEnabled('tree', 'Ash tree'), 'Tree selection must restore');
      resetMapFilters();
      assert(MapView.resourceCategories().every(c => !MapView.isResourceFiltered(c)), 'Reset clears resource restrictions');
      return 'PASS: saved resource choices, intentionally empty selection and global reset';
    })()`));
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
