const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const workspace = path.resolve(__dirname, '..');
const root = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || workspace);
app.setPath('userData', require('./test-profile.cjs').testProfile('quest-starts'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.6' }));
ipcMain.on('preferences:commit', e => { e.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Quest starts timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 1400, height: 950, show: false,
      webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message); });
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive();
    await new Promise(r => setTimeout(r, 500));
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, msg) => { if (!ok) throw Error(msg); };
      trackedQuests = []; questLog = null; selectModule('map');
      questMapMode = 'all'; questMapStepMode = 'all';
      const markers = db.map.markers.filter(m => m.c === 'quest');
      const catalogue = Object.values(E).filter(q => q.kind === 'quest');
      let auditedVersions = 0, auditedObjectives = 0;
      for (const q of catalogue) {
        for (const v of [q, ...(q.versions || []).filter(v => v.id !== q.id)]) {
          const own = markers.filter(m => m.ref === q.name);
          questLog = { quests: { [v.id]: { s: 0 } } };
          selectedMapQuests.clear(); selectedMapQuests.add(q.name);
          for (const mode of ['all', 'selected', 'active']) for (const steps of ['all', 'current']) {
            questMapMode = mode; questMapStepMode = steps;
            for (const m of own) {
              const expected = mode !== 'active' && m.questId === v.id && !!m.qstart && questMarkerVisible(m);
              assert(questMapMarkerVisible(m) === expected && questMapMarkerVisible(m, true) === expected,
                v.id + ': only confirmed pickups in ' + mode + '/' + steps + ' at ' + m.qlocation);
            }
          }
          questMapMode = 'all'; questMapStepMode = 'all'; trackedQuests = [q.name];
          const pins = trackedMapEntries().filter(t => t.quest === q.name);
          assert(pins.every(t => t.marker.qstart && t.marker.questId === v.id), v.id + ': unaccepted tracking cannot reveal targets');
          assert(pins.length === own.filter(m => m.questId === v.id && m.qstart && questMarkerVisible(m)).length, v.id + ': tracking retains every genuine start');
          for (const objective of v.objectives || []) {
            questLog = { quests: { [v.id]: { s: 1, o: objective.key } } };
            questMapStepMode = 'current';
            for (const m of own) assert(questMapMarkerVisible(m) === (m.questId === v.id && questMarkerVisible(m) && m.qsteps.includes(objective.key)), v.id + ': current objective unchanged');
            auditedObjectives++;
          }
          questLog = { quests: { [v.id]: { s: 1, o: v.objectives?.[0]?.key } } };
          questMapStepMode = 'all';
          for (const m of own) assert(questMapMarkerVisible(m) === (m.questId === v.id && questMarkerVisible(m)), v.id + ': accepted All steps unchanged');
          questLog = { quests: { [v.id]: { s: 2 } } };
          assert(own.every(m => !questMapMarkerVisible(m)), v.id + ': completed quest stays hidden');
          auditedVersions++;
        }
      }
      questLog = null; trackedQuests = []; questMapMode = 'all'; questMapStepMode = 'all';
      for (const m of markers) assert(questMapMarkerVisible(m) === (!!m.qstart && questMarkerVisible(m)), 'Unknown progress never substitutes first-objective targets');
      trackedQuests = catalogue.map(q => q.name); syncQuestTracker();
      assert(trackedMapEntries().every(t => t.marker.qstart), 'Tracking the whole catalogue shows only confirmed starts');
      MapView.setPlayer({ ok: true, x: 150000, y: 50000, z: 0 });
      const allScene = MapView.minimapScene(1000000);
      for (const m of markers.filter(m => !m.d && questMarkerVisible(m) && !m.qstart))
        assert(!allScene.markers.some(p => p.c === 'quest' && p.x === m.x && p.y === m.y && !markers.some(s => s.qstart && questMarkerVisible(s) && s.x === p.x && s.y === p.y)), 'Minimap must hide objective-only locations');
      trackedQuests = []; syncQuestTracker();
      const rat = markers.find(m => m.ref === 'Ratcatcher' && m.qstart && m.questId === ent('Ratcatcher').id);
      const later = markers.find(m => m.ref === 'Ratcatcher' && m.qlocation === 'Windmill_Area_FTUE_RC');
      assert(questMapMarkerVisible(rat) && !questMapMarkerVisible(later), 'Unknown progress shows starts only');
      for (const mode of ['all', 'selected']) for (const steps of ['all', 'current']) {
        questMapMode = mode; questMapStepMode = steps; selectedMapQuests.clear();
        for (const m of markers) selectedMapQuests.add(m.ref);
        onQuestLog([]);
        const shown = markers.filter(m => questMapMarkerVisible(m, true));
        assert(shown.length > 0 && shown.every(m => questMarkerInfo(m).pickup), 'Only starts show in ' + mode + '/' + steps + ', including highlights');
      }
      questMapMode = 'all'; questMapStepMode = 'all';
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 0 }]);
      assert(questMapMarkerVisible(rat) && !questMapMarkerVisible(later), 'Available quests show starts only');
      showOnMap('Ratcatcher', { every: true });
      assert(MapView.navigation().highlight.markers.every(i => questMarkerInfo(db.map.markers[i]).pickup), 'Show all locations respects unaccepted status');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 1, o: 'Objective2' }]);
      assert(questMapMarkerVisible(rat) && questMapMarkerVisible(later), 'Accepted quests retain All steps');
      setTracked('Ratcatcher', false);
      assert(questMapMarkerVisible(later), 'Untracking an accepted quest preserves its steps');
      questMapStepMode = 'current';
      assert(!questMapMarkerVisible(rat) && questMapMarkerVisible(later), 'Accepted quests retain current-step filtering');
      onQuestLog([{ id: 'Quest_FTUE_RC', s: 2 }]);
      assert(!questMapMarkerVisible(rat) && !questMapMarkerVisible(later), 'Completed quests stay hidden');
      onQuestLog([]); questMapStepMode = 'all'; MapView.setHighlight(null);
      const mirrorMarkers = markers.filter(m => m.ref === 'Mirror Mirror');
      const mirror = mirrorMarkers.find(m => m.qstart);
      const shownMirror = () => mirrorMarkers.filter(m => questMapMarkerVisible(m));
      assert(shownMirror().length === 1 && shownMirror()[0] === mirror && mirror.target === 'Mirror', 'Mirror Mirror has exactly one start at the Mirror, excluding candles, Edna and spellbook');
      setTracked('Mirror Mirror', true);
      const pins = trackedMapEntries().filter(t => t.quest === 'Mirror Mirror');
      assert(pins.length === 1 && pins[0].marker === mirror, 'Manually tracking an unaccepted quest must not expose first-objective targets');
      MapView.setPlayer({ ok: true, x: mirror.x, y: mirror.y, z: mirror.z });
      const scene = MapView.minimapScene(1000000);
      const mirrorPins = scene.markers.filter(m => m.c === 'quest' && mirrorMarkers.some(p => p.x === m.x && p.y === m.y));
      assert(mirrorPins.length === 1, 'Minimap shows only the Mirror pickup too');
      onQuestLog([{ id: ent('Mirror Mirror').id, s: 1, o: 'FindSilverThread' }]);
      assert(mirrorMarkers.filter(m => questMapMarkerVisible(m)).length > 1, 'Accepting Mirror Mirror restores objective places');
      onQuestLog([]); setTracked('Mirror Mirror', false);
      showOnMap('Mirror Mirror', { every: true });
      assert(MapView.navigation().highlight.markers.length === 1, 'Mirror Mirror Show locations frames only its true start');
      MapView.focusMarker(mirror); MapView.redraw();
      await new Promise(r => setTimeout(r, 900));
      return 'PASS: all ' + catalogue.length + ' quests / ' + auditedVersions + ' versions / ' + auditedObjectives + ' objectives; pickup-only filters, highlights, tracking and minimap; accepted objectives and completion preserved';
    })()`));
    fs.writeFileSync(path.join(workspace, 'test-fixtures/quest-starts-only.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
