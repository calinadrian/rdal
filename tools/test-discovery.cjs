// Run: electron --no-sandbox tools/test-discovery.cjs [packaged resources/app]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('discovery')); // removed after the test ends
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json')));
let preferences = {};
ipcMain.handle('db:get', () => db);
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Discovery test timed out'); app.exit(1); }, 20000);
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive(); await new Promise(r => setTimeout(r, 800));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const lore = db.map.markers.find(m => m.c === 'lore');
      const shrine = db.map.markers.find(m => m.discovery?.kind === 'shrines');
      const pool = db.map.markers.find(m => m.discovery?.kind === 'pois');
      const manualPool = db.map.markers.find(m => m.discovery?.kind === 'pois' && m !== pool);
      assert([lore, shrine, pool].every(m => m.discovery.ids.length), 'Markers need real discovery IDs');
      state.module = 'map'; setMapMode(true); renderModules();
      assert(!document.querySelector('#map-legend').textContent.includes('null'), 'Legend must not render empty entries as text');
      for (const c of ['lore', 'shrine']) {
        const checkbox = document.querySelector('#count-' + c).closest('label').querySelector('input');
        if (!checkbox.checked) checkbox.click();
      }
      const choose = (c, mode) => {
        const select = document.querySelector('#discovery-' + c + ' select');
        select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      choose('lore', 'undiscovered');
      assert(MapDiscovery.visible(lore) && MapDiscovery.state(lore) === 'unknown', 'No data must not hide lore or call it undiscovered');
      assert(MapDiscovery.mode('shrine') === 'all', 'Category filters must be independent');
      const packet = { character: 'A'.repeat(32), journal: lore.discovery.ids, shrines: shrine.discovery.ids, pois: pool.discovery.ids };
      onPlayer({ ok: true, x: lore.x, y: lore.y, discovery: packet });
      assert(!MapDiscovery.visible(lore), 'Discovered lore must hide');
      assert(MapDiscovery.visible(shrine), 'All shrines must stay visible');
      choose('shrine', 'undiscovered');
      assert(!MapDiscovery.visible(shrine) && !MapDiscovery.visible(pool), 'Unlocked shrines and discovered pools must hide');
      MapDiscovery.mark(manualPool, true);
      assert(MapDiscovery.manuallyMarked(manualPool) && !MapDiscovery.visible(manualPool), 'Manual pool marks must hide visited pools');
      MapDiscovery.ingest({ character: 'B'.repeat(32), journal: [], shrines: [], pois: [] }, db.map.markers);
      assert(!MapDiscovery.manuallyMarked(manualPool), 'Manual marks must not leak between characters');
      onPlayer({ ok: true, x: lore.x, y: lore.y, discovery: packet });
      MapDiscovery.mark(manualPool, false);
      assert(!MapDiscovery.manuallyMarked(manualPool), 'Manual pool marks must support undo');
      assert(MapDiscovery.visible({ ...lore, discovery: { kind: 'journal', ids: ['not-read'] } }), 'Unread lore must remain visible');
      await wait(1200);
      MapView.setHighlight('Discovery regression', [lore]); MapView.focusMarker(lore);
      await wait(100);
      const canvas = document.querySelector('#map');
      const point = () => { const r = canvas.getBoundingClientRect(); return { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }; };
      canvas.dispatchEvent(new MouseEvent('mousemove', point()));
      assert(document.querySelector('#map-tip').hidden, 'Filtered lore must not remain clickable or hoverable');
      choose('lore', 'all');
      canvas.dispatchEvent(new MouseEvent('mousemove', point()));
      assert(document.querySelector('#map-tip').textContent.includes('Discovered'), 'All mode must restore the discovered marker');
      choose('lore', 'undiscovered');
      MapDiscovery.ingest({ character: 'B'.repeat(32) }, db.map.markers);
      assert(MapDiscovery.state(lore) === 'unknown' && MapDiscovery.visible(shrine), 'Changing characters must not reuse another player progress');
      MapDiscovery.ingest({ character: 'B'.repeat(32), journal: [], shrines: [], pois: [] }, db.map.markers);
      assert(MapDiscovery.state(lore) === 'undiscovered', 'A confirmed empty list differs from unknown data');
      onPlayer({ ok: true, x: lore.x, y: lore.y, discovery: packet });
      MapDiscovery.ingest({ character: packet.character, journal: null }, db.map.markers);
      assert(MapDiscovery.state(lore) === 'discovered', 'Missing partial reads must preserve same-player recorded progress');
      MapDiscovery.ingest({ character: packet.character, session: 'another-world-session' }, db.map.markers);
      assert(MapDiscovery.state(lore) === 'unknown', 'World transitions must not reuse stale discovery records');
      onPlayer({ ok: true, x: lore.x, y: lore.y, discovery: packet });
      renderDiscoveryProgress(); MapView.setHighlight(null); document.querySelector('#map-highlight').hidden = true;
      selectedDiscoveryMarker = manualPool; renderDetail();
      document.querySelector('#detail button.primary').click();
      assert(MapDiscovery.manuallyMarked(manualPool) && !MapDiscovery.visible(manualPool), 'Mark discovered button must apply the pool filter');
      document.querySelector('#detail button.primary').click();
      assert(!MapDiscovery.manuallyMarked(manualPool), 'Undo discovered mark button must work');
      document.querySelector('#detail button.primary').click();
      onGame({ running: false });
      for (const c of db.map.categories) MapView.setEnabled(c.id, ['lore', 'shrine'].includes(c.id));
      MapView.focusMarker(lore); await wait(200);
      return 'PASS: lore, shrines and pools; all vs undiscovered; independent filters; unknown/empty state; character isolation; partial reads; hidden-marker picking';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/discovery-filters.png'), (await win.webContents.capturePage()).toPNG());
    await win.reload(); await new Promise(r => setTimeout(r, 1000));
    console.log(await win.webContents.executeJavaScript(`(() => {
      const lore = db.map.markers.find(m => m.c === 'lore');
      if (MapDiscovery.mode('lore') !== 'undiscovered' || MapDiscovery.mode('shrine') !== 'undiscovered'
        || MapDiscovery.state(lore) !== 'discovered' || MapDiscovery.visible(lore)) throw Error('Discovery settings did not survive reload');
      const pool = db.map.markers.find(m => m.discovery?.kind === 'pois');
      const manualPool = db.map.markers.find(m => m.discovery?.kind === 'pois' && m !== pool);
      if (!MapDiscovery.manuallyMarked(manualPool)) throw Error('Manual pool mark was not restored');
      return 'PASS: both selections and recorded discovery progress restored after reload';
    })()`));
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
