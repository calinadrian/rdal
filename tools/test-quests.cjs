// Regression coverage for same-title quest assets and story-dependent NPC markers.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const root = args[2] ? path.resolve(args[2]) : workspace;
app.setPath('userData', require('./test-profile.cjs').testProfile('quest')); // removed after the test ends
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json')));
const liveFile = path.join(workspace, 'cache/quest-live-sample.json');
const liveSample = fs.existsSync(liveFile) ? JSON.parse(fs.readFileSync(liveFile, 'utf8').trim()) : null;
ipcMain.handle('db:get', () => db);
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window' }));
let uiPreferences = {};
ipcMain.handle('preferences:get', () => uiPreferences);
ipcMain.handle('preferences:set', (_, patch) => { uiPreferences = { ...uiPreferences, ...patch }; return true; });
ipcMain.on('preferences:commit', (event, patch) => { uiPreferences = { ...uiPreferences, ...patch }; event.returnValue = { ok: true }; });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timeout = setTimeout(() => { console.error('Quest test timed out'); app.exit(1); }, 20000);
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive(); await new Promise(r => setTimeout(r, 1000));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      assert(E.Ratcatcher.id === 'Quest_FTUE_RC', 'Current map-referenced Ratcatcher must be the default');
      assert(E.Ratcatcher.versions.length === 2, 'Legacy quest definition must be preserved separately');
      const marker = db.map.markers.find(m => m.ref === 'Ratcatcher' && m.qnpc);
      assert(marker.n.endsWith('Vannaka') && marker.npcVisibility.flag === 'WOMTempleHidden', 'Marker must use the real NPC and its story condition');
      questLog = null; state.module = 'quests'; render(); showItem('Ratcatcher');
      assert(npcPresence(marker) === 'unknown', 'No quest snapshot must not imply NPC presence');
      assert(document.querySelector('#detail').textContent.includes('presence not confirmed'), 'Conditional location must be labelled');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 1, o: 'Objective2' }, { id: 'Quest_DragonSlayer', s: 1, b: { WOMTempleHidden: false } }]);
      assert(questStatus(ent('Ratcatcher')) === 'active', 'Live current ID must resolve');
      assert(document.querySelector('#detail .objectives .now').textContent.toLowerCase().includes('rat roast'), 'Current objectives must not be overwritten by the old fang quest');
      assert(npcPresence(marker) === 'visible' && questMarkerVisible(marker), 'Explicit false flag must keep Vannaka marker');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 2, o: 'Objective2' }, { id: 'Quest_FTUE_Q5', s: 0 }]);
      assert(questStatus(ent('Ratcatcher')) === 'done', 'An unstarted legacy duplicate must not overwrite current completion');
      onQuestLog([{ id: 'Quest_FTUE_Q5', s: 1, o: 'Objective2' }]);
      assert(ent('Ratcatcher').id === 'Quest_FTUE_Q5' && ent('Ratcatcher').objectives[1].text.includes('fangs'), 'A save using the older quest must retain its own objectives');
      assert(!questMarkerVisible(marker), 'Do not mix current locations into a legacy quest');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 1, o: 'Objective1' }, { id: 'Quest_DragonSlayer', s: 1, b: { WOMTempleHidden: true } }]);
      assert(npcPresence(marker) === 'hidden' && !questMarkerVisible(marker), 'Hidden NPC must be suppressed from rendering and picking');
      assert(!markersFor('Ratcatcher').includes(marker), 'Show on map must exclude the hidden NPC');
      assert(document.querySelector('#detail').textContent.includes('Hidden in your saved quest snapshot'), 'Saved data must not be presented as live');
      gameRunning = true; renderDetail();
      assert(document.querySelector('#detail').textContent.includes('Hidden by your story progress'), 'Live story condition must be explained');
      assert(questLog.quests.Quest_DragonSlayer.b.WOMTempleHidden === true, 'Quest flags must survive snapshot handling');
      const actual = ${JSON.stringify(liveSample?.quests || null)};
      if (actual) {
        onQuestLog(actual); gameRunning = false; render(); showItem('Ratcatcher');
        assert(questStatus(ent('Ratcatcher')) === 'done', 'Actual player snapshot must show Ratcatcher completed');
        assert(npcPresence(marker) === 'hidden', 'Actual player snapshot must explain absent Vannaka');
      }
      // Quest map labels come from flow-linked objective keys, never the NPC flag alone.
      const start = db.map.markers.find(m => m.ref === 'Ratcatcher' && m.qlocation === 'Vannaka_Objective_FTUE_RC');
      const windmill = db.map.markers.find(m => m.ref === 'Ratcatcher' && m.qlocation === 'Windmill_Area_FTUE_RC');
      questLog = null;
      assert(questMarkerInfo(start).badge === '?' && questMarkerInfo(start).pickup, 'First objective must show a quest pickup question mark');
      assert(questMarkerInfo(marker).badge === '2', 'Return NPC must not be labelled as the quest start');
      assert(questMarkerInfo({ ...marker, qsteps: [] }).badge === '·' && !questMarkerInfo({ ...marker, qsteps: [] }).pickup, 'Unlinked locations must not look like quest pickups');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 1, o: 'Objective2' }, { id: 'Quest_DragonSlayer', s: 1, b: { WOMTempleHidden: false } }]);
      assert(questMarkerInfo(windmill).current && questMarkerInfo(windmill).badge === '2', 'Current step must follow live progress');
      assert(!questMarkerInfo(start).current, 'Earlier steps must not look current');
      showOnMap('Ratcatcher'); MapView.setFollow(false);
      await new Promise(r => setTimeout(r, 1400));
      MapView.focusMarker(windmill);
      await new Promise(r => setTimeout(r, 200));
      const canvas = document.querySelector('#map');
      const rect = canvas.getBoundingClientRect();
      const coords = { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      canvas.dispatchEvent(new MouseEvent('mousemove', coords));
      assert(document.querySelector('#map-tip').textContent.includes('Current · Step 2'), 'Hovered map icon must show its step');
      assert(document.querySelector('#map-tip').textContent.toLowerCase().includes('rat roast'), 'Tooltip must show the actual objective');
      canvas.dispatchEvent(new MouseEvent('mousedown', coords));
      window.dispatchEvent(new MouseEvent('mouseup', coords));
      assert(selectedQuestMarker === windmill, 'Map click must select the exact location');
      assert(document.querySelector('.quest-marker-context').textContent.includes('Windmill'), 'Detail panel must identify the clicked location');
      assert(document.querySelectorAll('.quest-location').length >= 3, 'Original quest locations and added interaction pins must allow navigation between steps');
      await new Promise(r => setTimeout(r, 600));
      return 'PASS: quest identity, visibility, start vs return, current step, unknown links, map tooltip, marker click and location navigation';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/quest-map-steps.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`(async () => {
      onQuestLog([]);
      const start = db.map.markers.find(m => m.ref === 'Ratcatcher' && m.qlocation === 'Vannaka_Objective_FTUE_RC');
      selectedQuestMarker = start; MapView.focusMarker(start); renderDetail();
      const ctx = document.querySelector('#map').getContext('2d');
      const arc = ctx.arc, fillText = ctx.fillText;
      let circle, checked = 0;
      ctx.arc = function(x, y, radius, ...args) { circle = { x, y, radius }; return arc.call(this, x, y, radius, ...args); };
      ctx.fillText = function(text, x, y, ...args) {
        if (text === '?' && circle?.radius === 13) {
          const m = this.measureText(text);
          if (Math.abs(x + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 - circle.x) > 0.01
            || Math.abs(y + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2 - circle.y) > 0.01) throw Error('Question mark ink is not centered');
          checked++;
        }
        return fillText.call(this, text, x, y, ...args);
      };
      MapView.redraw();
      await new Promise(r => setTimeout(r, 250));
      ctx.arc = arc; ctx.fillText = fillText;
      if (!checked) throw Error('Pickup marker did not render');
      const canvas = document.querySelector('#map'), r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    })()`);
    fs.writeFileSync(path.join(workspace, 'test-fixtures/quest-map-pickup.png'), (await win.webContents.capturePage()).toPNG());
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const vents = db.map.markers.filter(m => m.c === 'vent');
      const known = vents.filter(m => m.ventType);
      if (new Set(known.map(m => m.ventType)).size !== 7) throw Error('Missing vent types');
      for (const m of known) {
        if (!/^#[0-9A-F]{6}$/.test(m.color) || !m.i.includes('T_Rune_' + (m.ventType === 'Fire' ? 'Fire1' : m.ventType))) throw Error('Untyped vent appearance');
      }
      const checkbox = document.querySelector('#count-vent').closest('label').querySelector('input');
      if (!checkbox.checked) checkbox.click();
      if (document.querySelector('#vent-map-key').hidden) throw Error('Vent color key is hidden');
      checkbox.click();
      if (!document.querySelector('#vent-map-key').hidden) throw Error('Vent color key did not hide');
      checkbox.click();
      MapView.setHighlight(null); document.querySelector('#map-highlight').hidden = true;
      for (const category of db.map.categories) MapView.setEnabled(category.id, category.id === 'vent');
      MapView.focusMarker(known.find(m => m.ventType === 'Air'));
      await new Promise(r => setTimeout(r, 500));
      return 'PASS: centered question mark ink, seven typed vent colors/icons, and vent legend toggle';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/anima-vent-colors.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
