const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData',require('./test-profile.cjs').testProfile('quest-targets'));
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.handle('update:get',()=>({status:'idle',current:require('../package.json').version}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true}});
const timer=setTimeout(()=>{console.error('Quest targets timed out');app.exit(1)},30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1400,height:950,show:false,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 const tick=()=>new Promise(r=>setTimeout(r,300));
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));win.showInactive();await tick();
  for(const [name,key,expected] of [['Ratcatcher','Objective2','Giant Rat'],['Dragon Slayer','Find and hunt a deer','Deer'],['The Wild Hunt','HuntBeast','Nature Spirit'],['Things That Go Boom In The Night','FindSpectralChinchompaSkulls','Spectral Chinchompa']]) {
   await js(`selectModule('quests');window.q=ent(${JSON.stringify(name)});onQuestLog([{id:q.id,s:1,o:${JSON.stringify(key)}}]);showItem(q.name);state.filter=${JSON.stringify(name)};renderList();`);
   assert(await js(`$('#detail .current-objective .quest-targets-map').textContent.includes('Show targets on map')`),name);
   assert(await js(`questStepSourceMarkers(q,${JSON.stringify(key)}).some(m=>m.n===${JSON.stringify(expected)})`),name);
   if(name==='Ratcatcher')assert(await js(`questStepSourceMarkers(q,'Objective2').every(m=>m.region==='Bramblemead Valley'&&!m.d)`),'Tutorial rats stay in the starting area');
   await js(`for(const id of db.map.categories.map(c=>c.id))MapView.setEnabled(id,false);questMapStepMode='current';$('#detail .current-objective .quest-targets-map').click()`);await tick();
   assert(await js(`MapView.navigation().highlight.markers.every(i=>['monster','creature'].includes(db.map.markers[i].c))`),name+' must highlight mobs instead of NPCs');
   const ids=await js(`MapView.navigation().highlight.markers`);
   assert(ids.length>0);
   assert(await js(`(async()=>{const marker=MapView.navigation().highlight.markers.map(i=>db.map.markers[i]).find(m=>!m.d);if(!marker)return false;MapView.focusMarker(marker);await new Promise(r=>setTimeout(r,180));const canvas=$('#map'),rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));return $('#map-tip').textContent.includes(marker.n);})()`),'Highlighted mobs are painted and pickable with category filters disabled');
   await js(`onQuestLog([{id:q.id,s:1,o:${JSON.stringify(key)}}])`);
   assert.deepEqual(await js(`MapView.navigation().highlight.markers`),ids,'Repeated progress snapshots preserve spawn highlights');
   await js(`back()`);
   assert(await js(`state.module==='quests' && state.detail===q.name && state.filter===${JSON.stringify(name)}`));
   await js(`showOnMap(q.name)`);
   assert(await js(`MapView.navigation().highlight.markers.every(i=>['monster','creature'].includes(db.map.markers[i].c))`),'General quest map action uses current prey');
   await js(`back()`);
  }
  await js(`selectModule('quests');q=ent('Ratcatcher');onQuestLog([{id:q.id,s:1,o:'Objective2'}]);showItem(q.name)`);
  for(const [w,h,label] of [[1400,950,'desktop'],[900,780,'compact']]) {
   win.setSize(w,h);await tick();
   assert(await js(`$('#detail').scrollWidth<=$('#detail').clientWidth+1`));
   if(!process.env.ATLAS_NO_CAPTURES)fs.writeFileSync(path.join(root,`test-fixtures/quest-targets-${label}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js(`q=ent('What Remains is Written');onQuestLog([{id:q.id,s:1,o:'FindScrolls'}]);showItem(q.name)`);
  assert.equal(await js(`$('#detail .current-objective').querySelectorAll('.quest-pin-button').length`),3,'Named quest enemies retain exact interaction pins');
  await js(`q=ent('The Wild Hunt');onQuestLog([{id:q.id,s:1,o:'BringHeart'}]);showItem(q.name)`);
  assert.equal(await js(`$('#detail .current-objective').querySelectorAll('.quest-targets-map').length`),0,'Hand-in must not keep hunting targets');
  console.log('PASS: monster/creature kill targets, direct quest map action, disabled filters, progress refresh, Back context, exact named-enemy pins, hand-in state and desktop/compact layouts');
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);clearTimeout(timer);app.exit(1)}
});
