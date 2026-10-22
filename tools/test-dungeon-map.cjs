const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('dungeon')); // removed after the test ends
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(process.env.ATLAS_TEST_WIDTH) || 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Dungeon map test timed out'); app.exit(1); }, 30000);
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
      assert(takla, 'Takla Kara must be a dungeon');
      // Every generated level must load in the same coordinate frame as its markers.
      for (const d of db.map.dungeons) for (const l of [...d.levels, ...(d.overview ? [{ image: d.overview }] : [])]) {
        const image = new Image(); image.src = '../../data/' + l.image;
        try { await image.decode(); } catch { throw Error('Cannot decode dungeon image: ' + image.src); }
        assert(image.naturalWidth === d.frame.w && image.naturalHeight === d.frame.h,
          d.name + ': floor image and coordinate frame must agree');
        if (l.heights) assert(l.heights.z.some(z => z !== null), d.name + ': floor must have height coverage');
      }
      const inside = db.map.markers.find(m => m.d === takla.id && m.c === 'chest') || db.map.markers.find(m => m.d === takla.id);
      // Walking through the door: the map follows into the dungeon.
      onPlayer({ ok: true, world: 'L_World', x: inside.x, y: inside.y, z: inside.z, yaw: 45 });
      assert(MapView.layer()?.id === takla.id, 'Entering the dungeon must switch to its floor plan');
      assert(document.querySelector('#map-layer').value === takla.id, 'Picker must show the dungeon');
      assert(!document.querySelector('#map-level-key').hidden, 'Multi-level maps must explain the continuation paths');
      assert(document.querySelector('#map-legend').hidden, 'Dungeon filters must start collapsed');
      assert(getComputedStyle(document.querySelector('#detail')).display === 'none', 'Empty detail panel must not consume dungeon space');
      const filters = document.querySelector('#map-filters');
      assert(!filters.hidden && filters.getAttribute('aria-expanded') === 'false', 'Dungeon filter toggle must be available');
      filters.click();
      assert(!document.querySelector('#map-legend').hidden && filters.getAttribute('aria-expanded') === 'true', 'Filters must remain accessible');
      filters.click();
      assert(document.querySelector('#map-legend').hidden && filters.getAttribute('aria-expanded') === 'false', 'Filters must collapse again');
      showItem(inside.ref || Object.keys(E)[0]);
      assert(getComputedStyle(document.querySelector('#detail')).display !== 'none', 'Selecting an entry must reopen the detail panel');
      state.detail = null; renderDetail();
      assert(document.querySelector('#status-progress').textContent.includes('Takla Kara'), 'Status must name the dungeon');
      await wait(800);
      MapView.setFollow(true); await wait(400);
      MapView.fit();
      assert(!MapView.isFollowing(), 'Whole map must pause following so the complete plan stays framed');
      // Stairs: standing on an upper storey shows that storey's plan.
      assert(takla.levels.length > 1, 'Takla Kara must have more than one level');
      assert(!document.querySelector('#map-level').hidden, 'Level picker must show for a multi-level dungeon');
      const startLevel = MapView.level();
      let other = null;
      for (const m of db.map.markers.filter(m => m.d === takla.id)) {
        onPlayer({ ok: true, world: 'L_World', x: m.x, y: m.y, z: m.z, yaw: 0 });
        if (MapView.level() !== startLevel) { other = m; break; }
      }
      assert(other, 'Walking onto another storey must switch the level');
      assert(document.querySelector('#map-level').value === String(MapView.level()), 'Level picker must follow the player');
      onPlayer({ ok: true, world: 'L_World', x: inside.x, y: inside.y, z: inside.z, yaw: 45 });
      // Leaving: back to the world map.
      const entrance = db.map.markers.find(m => m.enter === takla.id);
      assert(entrance, 'Takla Kara must have a surface entrance');
      onPlayer({ ok: true, world: 'L_World', x: entrance.x, y: entrance.y, z: entrance.z, yaw: 0 });
      assert(MapView.layer() === null, 'Leaving must return to the world map');
      assert(document.querySelector('#map-level-key').hidden, 'World map must hide the floor key');
      assert(document.querySelector('#map-legend').hidden && !filters.hidden && filters.getAttribute('aria-expanded') === 'false', 'World map must use the same collapsed Filters control');
      filters.click();
      assert(!document.querySelector('#map-legend').hidden && filters.getAttribute('aria-expanded') === 'true', 'World map filters must remain accessible');
      filters.click();
      // Opening a dungeon from the picker while outside it.
      const picker = document.querySelector('#map-layer');
      picker.value = takla.id; picker.dispatchEvent(new Event('change'));
      assert(MapView.layer()?.id === takla.id, 'Picker must open the dungeon');
      picker.value = ''; picker.dispatchEvent(new Event('change'));
      onPlayer({ ok: true, world: 'L_World', x: inside.x, y: inside.y, z: inside.z, yaw: 45 });
      MapView.setFollow(false); MapView.fit();
      assert(takla.overview, 'Multi-floor dungeons must have a full-layout overview');
      const levels = document.querySelector('#map-level');
      levels.value = '-1'; levels.dispatchEvent(new Event('change'));
      assert(MapView.level() === -1 && document.querySelector('#map-level-key').hidden, 'All floors must show a complete layout without a selected-floor key');
      onPlayer({ ok: true, world: 'L_World', x: other.x, y: other.y, z: other.z, yaw: 0 });
      assert(MapView.level() === -1, 'Moving between floors must preserve a manually selected overview');
      MapView.fit();
      await wait(1200);
      const canvas = document.querySelector('#map');
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      assert(pixel[0] > 100 && pixel[1] > 100 && pixel[2] > 80, 'Overview must actually paint the plan after switching before a floor image has loaded');
      return 'Dungeon map test passed: ' + db.map.dungeons.length + ' dungeons';
    })()`));
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(workspace, 'test-fixtures', process.env.ATLAS_TEST_WIDTH ? 'dungeon-map-' + process.env.ATLAS_TEST_WIDTH + '.png' : 'dungeon-map.png'), shot.toPNG());
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message || String(error)); app.exit(1);
  }
});
