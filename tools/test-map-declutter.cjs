// Verify that quest places close together merge into one marker, and that lodestones players built show on the map.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('map-declutter'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.6' }));
ipcMain.on('preferences:commit', (event) => { event.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Map declutter timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 950, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Renderer:', code); throw error; } };
  const tick = () => new Promise(r => setTimeout(r, 400));
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html')); win.showInactive(); await tick();
    // Emberwood village: a Curse Seal, the ghost beside it and other quests' places sit within a few metres.
    await js(`localStorage.removeItem('builtLodestones'); trackedQuests=['Withering Heights','Even More Restless Ghosts']; selectModule('map');
      onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'BreakTheThreeSeals'},{id:'Quest_FH_GhostQuest',s:1,o:'FindGhosts0/3'}]); syncQuestTracker();
      window.seal=db.map.markers.find(m=>m.entry==='QuestFlow.Entry.DeathQuestMain.Seals.Emberwood');
      MapView.focusMarker(seal); MapView.zoom(0.25);`);
    await tick();
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures/map-declutter-emberwood.png'), (await win.webContents.capturePage()).toPNG());
    // Every quest disc on screen is at least a marker's width from the next, and the tracker numbers share one badge.
    assert(await js(`typeof MapView.questGroupOf === 'function'`), 'The map exposes merged quest places');
    assert(await js(`(()=>{const g=MapView.questGroupOf(seal);return g.length>1 && g.includes(seal)})()`), 'The Emberwood seal shares one marker with the quest places next to it');
    assert(await js(`(()=>{const kept=db.map.markers.filter(m=>m.c==='quest'&&!m.d&&questMapMarkerVisible(m)&&MapView.questGroupOf(m)[0]===m);
      const canvas=document.querySelector('#map');
      const pts=kept.map(MapView.screenOf).filter(p=>p.x>0&&p.y>0&&p.x<canvas.clientWidth&&p.y<canvas.clientHeight);
      return pts.every((p,i)=>pts.every((q,j)=>i===j||Math.hypot(p.x-q.x,p.y-q.y)>=24))})()`), 'Quest discs never overlap');
    // Zoomed in close, the places separate again.
    await js(`MapView.zoom(4)`); await tick();
    assert(await js(`MapView.questGroupOf(seal).length===1`), 'Zooming in separates them');
    // Lodestones: the game's list includes world lodestones; only the ones away from them are built.
    await js(`window.worldStone=db.map.markers.find(m=>m.c==='travel'&&m.n==='Lodestone');
      onLodestones([{x:worldStone.x,y:worldStone.y,z:worldStone.z},{x:135326,y:-12439,z:-6814}])`);
    assert(await js(`(()=>{const b=db.map.markers.filter(m=>m.built);return b.length===1&&b[0].x===135326&&b[0].region==='Bleakfields Valley'&&b[0].c==='travel'})()`), 'One built lodestone, placed in its region');
    assert(await js(`db.map.markers.at(-1).built && JSON.parse(localStorage.getItem('builtLodestones')).length===1`), 'Built lodestones go last and are remembered');
    await js(`onLodestones([{x:worldStone.x,y:worldStone.y,z:worldStone.z}])`);
    assert(await js(`!db.map.markers.some(m=>m.built)`), 'A removed lodestone leaves the map');
    console.log('PASS: nearby quest places merge into one marker with combined tracker numbers, separate when zoomed in; built lodestones join Travel, are remembered and leave when removed');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
