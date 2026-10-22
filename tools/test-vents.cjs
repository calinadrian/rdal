const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('vent')); // removed after the test ends
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Vent test timed out'); app.exit(1); }, 30000);
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive(); await new Promise(r => setTimeout(r, 800));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      state.module = 'map'; setMapMode(true); renderModules();
      const master = document.querySelector('#count-vent').closest('label').querySelector('input');
      if (!master.checked) master.click();
      const fire = db.map.markers.find(m => m.ventType === 'Fire'), water = db.map.markers.find(m => m.ventType === 'Water');
      const box = type => document.querySelector('[data-vent-type="' + type + '"]');
      const buttons = document.querySelectorAll('.vent-type-actions button');
      assert([...document.querySelectorAll('[data-vent-type]')].every(c => c.checked), 'Default must include every vent type');
      buttons[1].click();
      assert(!MapView.isVentTypeEnabled('Fire') && !MapView.isVentTypeEnabled('unknown'), 'Clear must include unknown vents');
      box('Fire').click();
      assert(MapView.isVentTypeEnabled('Fire') && !MapView.isVentTypeEnabled('Water'), 'One vent type must be selectable');
      assert(document.querySelector('#count-vent').textContent === '45/228', 'Count must reflect selected types');
      await wait(1200);
      const canvas = document.querySelector('#map');
      const hover = () => { const r = canvas.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); };
      MapView.setHighlight('Filtered water vent', [water]); MapView.focusMarker(water); await wait(100); hover();
      assert(document.querySelector('#map-tip').hidden, 'Filtered vent must not remain hoverable');
      MapView.setHighlight('Fire vent', [fire]); MapView.focusMarker(fire); await wait(150); hover();
      assert(document.querySelector('#map-tip').textContent.includes('Fire Anima Vent'), 'Selected vent must be hoverable');
      const ctx = canvas.getContext('2d'), drawImage = ctx.drawImage, arc = ctx.arc, fill = ctx.fill;
      let runeSize = 0, rings = 0, backgrounds = 0;
      ctx.arc = function(...args) { assert(args[2] === 13, 'Vent circle must match the 26px quest circle'); rings++; return arc.apply(this, args); };
      ctx.fill = function(...args) { backgrounds++; return fill.apply(this, args); };
      ctx.drawImage = function(img, ...args) {
        if (img.dataset?.ventType === 'Fire' && args.length === 4) {
          runeSize = args[2];
          const pixels = img.getContext('2d').getImageData(0, 0, 64, 64).data;
          let left = 64, top = 64, right = -1, bottom = -1;
          for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (pixels[(y * 64 + x) * 4 + 3] > 8) {
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          if (Math.abs((left + right) / 2 - 31.5) > 1 || Math.abs((top + bottom) / 2 - 31.5) > 1) throw Error('Rune is not centered');
        }
        return drawImage.call(this, img, ...args);
      };
      MapView.redraw(); await wait(150); ctx.drawImage = drawImage; ctx.arc = arc; ctx.fill = fill;
      assert(runeSize === 17, 'Native rune must fit inside the 26px circle');
      assert(rings > 0 && backgrounds === 0, 'Vent must have a circle outline with a transparent center');
      // Measure actual canvas geometry for every category at two zoom levels.
      const markers = db.map.markers;
      const measured = [];
      for (const category of db.map.categories) {
        const sample = category.id === 'vent' ? fire : markers.find(m => m.c === category.id);
        if (!sample) continue;
        db.map.markers = [sample];
        MapView.setQuestInfo(() => ({ pickup: true, badge: '?', color: '#ffd040' }));
        MapView.setQuestVisibility(() => true);
        MapView.setHighlight('Size check', [sample]); MapView.focusMarker(sample);
        await wait(120);
        for (const zoom of [0.2, 5]) {
          MapView.zoom(zoom);
          let sized = false;
          const expectedSize = category.id === 'monster' ? 10 : 26;
          ctx.arc = function(...args) { if (args[2] === expectedSize / 2) sized = true; return arc.apply(this, args); };
          ctx.drawImage = function(img, ...args) { if (args.length === 4 && args[2] === expectedSize && args[3] === expectedSize) sized = true; return drawImage.call(this, img, ...args); };
          MapView.redraw(); await wait(40);
          ctx.arc = arc; ctx.drawImage = drawImage;
          assert(sized, category.id + ' must render at ' + expectedSize + 'px at both zoom levels');
        }
        measured.push(category.id);
      }
      db.map.markers = markers;
      MapView.setQuestInfo(questMarkerInfo); MapView.setQuestVisibility(questMapMarkerVisible);
      box('Water').click();
      assert(MapView.isVentTypeEnabled('Fire') && MapView.isVentTypeEnabled('Water') && !MapView.isVentTypeEnabled('Nature'), 'Multiple types must be selectable');
      master.click(); assert(document.querySelector('#vent-map-key').hidden, 'Category off must hide its controls');
      master.click(); assert(box('Fire').checked && box('Water').checked && !box('Nature').checked, 'Category toggle must preserve types');
      MapView.setHighlight(null);
      for (const category of db.map.categories) {
        const checkbox = document.querySelector('#count-' + category.id).closest('label').querySelector('input');
        if (checkbox.checked !== (category.id === 'vent')) checkbox.click();
      }
      MapView.focusMarker(fire); MapView.zoom(0.5);
      document.querySelector('#vent-map-key').scrollIntoView({ block: 'nearest' }); await wait(200);
      return 'PASS: vent filters, centered runes; 10px monster dots and 26px landmarks at both zoom levels for: ' + measured.join(', ');
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/vent-type-filter.png'), (await win.webContents.capturePage()).toPNG());
    win.reload(); await new Promise(r => setTimeout(r, 1000));
    await win.webContents.executeJavaScript(`(() => {
      if (!MapView.isVentTypeEnabled('Fire') || !MapView.isVentTypeEnabled('Water') || MapView.isVentTypeEnabled('Nature')) throw Error('Vent selections did not restore');
      MapView.setVentTypes([]);
    })()`);
    win.reload(); await new Promise(r => setTimeout(r, 1000));
    await win.webContents.executeJavaScript(`(() => {
      if (MapView.isVentTypeEnabled('Fire') || MapView.isVentTypeEnabled('unknown')) throw Error('Empty vent selection did not restore');
      MapView.setVentTypes(null);
      if (!MapView.isVentTypeEnabled('Fire') || !MapView.isVentTypeEnabled('Nature')) throw Error('All types did not restore all vents');
    })()`);
    console.log('PASS: multiple and deliberately empty vent selections restored after reload; All types restores the catalogue');
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
