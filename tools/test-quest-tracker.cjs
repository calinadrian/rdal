const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData',require('./test-profile.cjs').testProfile('quest-tracker'));
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.handle('update:get',()=>({status:'idle',current:require('../package.json').version}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true}});
const timer=setTimeout(()=>{console.error('Quest tracker timed out');app.exit(1)},30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1400,height:950,show:false,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 const tick=()=>new Promise(r=>setTimeout(r,300));
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));win.showInactive();await tick();
  await js(`localStorage.removeItem('questLog');questLog=null;trackedQuests=[];selectModule('quests');`);
  assert(await js(`!$('#content .quest-tracker') && !$('#list .track-toggle') && !!$('#list .quest-other')`),'Quest browsing has no tracking controls');

  // Pin from the guide: the kill target and the item it drops are both tracked, with the amount from the objective.
  await js(`window.q=ent('The Wild Hunt');onQuestLog([{id:q.id,s:1,o:'HuntBeast'}]);showItem(q.name)`);
  await js(`[...document.querySelectorAll('#detail .track-button')].find(b=>b.getAttribute('aria-pressed')==='false').click()`);
  assert(await js(`isTracked('The Wild Hunt')`));
  const lines=await js(`questTrackerObjective(q).lines.map(l=>[l.kind,l.name,l.qty,l.markers.length])`);
  assert(lines.some(([k,n,,c])=>k==='kill'&&n==='Nature Spirit'&&c>0),JSON.stringify(lines));
  assert(lines.some(([k,n,qty,c])=>k==='loot'&&n==='Primordial Heart'&&qty===3&&c>0),JSON.stringify(lines));
  assert(await js(`$('#quest-tracker').textContent.includes('drops from Nature Spirit')`),'The tracker names the drop source');

  // Regional creature variants read as the base creature; the antler shows the creature that drops it.
  await js(`q=ent('Dragon Slayer');onQuestLog([{id:ent('The Wild Hunt').id,s:1,o:'HuntBeast'},{id:q.id,s:1,o:'Find and hunt a deer'}])`);
  assert(await js(`isTracked('Dragon Slayer')`),'Accepting a quest tracks it, like WoW');
  const deer=await js(`questTrackerObjective(q).lines.map(l=>[l.kind,l.name,l.from||[]])`);
  assert(deer.some(([k,n])=>k==='kill'&&n==='Deer'),JSON.stringify(deer));
  assert(deer.some(([k,n,from])=>k==='loot'&&n==='Antler'&&from.includes('Deer')),JSON.stringify(deer));

  // On the map the tracker sits beside the controls and its targets stay visible with every filter off.
  await js(`selectModule('map');for(const id of db.map.categories.map(c=>c.id))MapView.setEnabled(id,false);MapView.setHighlight(null)`);await tick();
  assert(await js(`!$('#quest-tracker').hidden && document.querySelectorAll('#quest-tracker .tracker-quest').length===2`));
  const spirit=await js(`(async()=>{const m=db.map.markers.find(m=>m.n==='Nature Spirit');MapView.focusMarker(m);await new Promise(r=>setTimeout(r,200));
    const canvas=$('#map'),rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
    return $('#map-tip').textContent;})()`);
  assert(spirit.includes('The Wild Hunt')&&spirit.includes('Nature Spirit'),spirit);
  if(!process.env.ATLAS_NO_CAPTURES)fs.writeFileSync(path.join(root,'test-fixtures/quest-tracker-map.png'),(await win.webContents.capturePage()).toPNG());

  // A line's Map button frames that line's locations.
  await js(`[...document.querySelectorAll('#quest-tracker .tracker-line.loot .tracker-map')][0].click()`);await tick();
  assert(await js(`MapView.navigation().highlight.markers.every(i=>db.map.markers[i].n==='Nature Spirit'||db.map.markers[i].ref==='Nature Spirit')`));

  // Finishing a quest drops it from the tracker; × untracks.
  await js(`onQuestLog([{id:ent('The Wild Hunt').id,s:2},{id:ent('Dragon Slayer').id,s:1,o:'Find and hunt a deer'}])`);
  assert(await js(`!isTracked('The Wild Hunt') && isTracked('Dragon Slayer')`),'Completed quests leave the tracker');
  await js(`$('#quest-tracker .tracker-remove').click()`);
  assert(await js(`!trackedQuests.length && $('#quest-tracker').hidden`),'Untracking the last quest hides the map tracker');
  assert(await js(`Preferences.json('trackedQuests',null).length===0`),'Tracked quests are saved');
  // Like WoW, an active quest still marks its hunting targets on the map when untracked, just without a number.
  assert(await js(`(()=>{const line=questTrackerObjective(ent('Dragon Slayer')).lines.find(l=>l.kind==='kill');const t=MapView.trackedEntry(line.markers[0]);return !!t&&t.index===null&&t.quest==='Dragon Slayer'})()`),'Untracked active quests keep their target creatures on the map');
  console.log('PASS: track from guide, kill + drop-source lines with amounts, auto-track on accept, map visibility with filters off, line map buttons, auto-untrack on completion');
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);clearTimeout(timer);app.exit(1)}
});
