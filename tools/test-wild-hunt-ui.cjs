const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData',require('./test-profile.cjs').testProfile('wild-hunt'));
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.handle('update:get',()=>({status:'idle',current:require('../package.json').version}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true}});
const timer=setTimeout(()=>{console.error('Wild Hunt UI timed out');app.exit(1)},30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 const tick=()=>new Promise(r=>setTimeout(r,350));
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));win.showInactive();await tick();
  await js(`selectModule('quests');window.hunt=ent('The Wild Hunt');onQuestLog([{id:hunt.id,s:1,o:'HuntBeast'}]);showItem(hunt.name);`);
  assert(await js(`$('#detail .quest-mount-reward').textContent.includes('Terrorbird mount')`));
  assert(await js(`$('#detail .current-objective').textContent.includes('loot 3 Primordial Hearts') && $('#detail .current-objective').textContent.includes('white, glowing terrorbirds')`));
  assert.equal(await js(`$('#detail .current-objective').querySelectorAll('.quest-pin-button').length`),0);
  assert.equal(await js(`$('#detail .current-objective').querySelectorAll('.source-map-button').length`),5);
  assert(await js(`$('#detail').textContent.includes('repeatable exchange for extra hearts')`));
  for(const [w,h,label] of [[1440,1000,'desktop'],[900,780,'compact']]){
   win.setSize(w,h);await tick();
   assert(await js(`$('#detail').scrollWidth<=$('#detail').clientWidth+1`));
   if(!process.env.ATLAS_NO_CAPTURES)fs.writeFileSync(path.join(root,`test-fixtures/wild-hunt-${label}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js(`state.filter='Wild';renderList();for(const id of db.map.categories.map(c=>c.id))MapView.setEnabled(id,false);$('#detail .current-objective .source-map-button').click();`);await tick();
  assert(await js(`MapView.navigation().highlight.markers.length===1 && db.map.markers[MapView.navigation().highlight.markers[0]].n==='Nature Spirit'`));
  await js(`back()`);
  assert(await js(`state.module==='quests' && state.detail===hunt.name && state.filter==='Wild'`));
  await js(`onQuestLog([{id:hunt.id,s:1,o:'BringHeart'}]);renderDetail()`);
  assert(await js(`$('#detail .current-objective .quest-target-name').textContent==='Vannaka' && $('#detail .current-objective').querySelectorAll('.quest-pin-button').length===1 && $('#detail .current-objective').textContent.includes('unlock the Terrorbird mount')`));
  await js(`questLog=null;renderDetail()`);
  assert(await js(`$('#detail').textContent.includes('Progress unknown') && !$('#detail [role=progressbar]')`));
  console.log('PASS: Wild Hunt mount reward, post-Vannaka instructions, five real spirit sites, map filters/Back, hand-in and unknown progress, desktop/compact layouts');
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);clearTimeout(timer);app.exit(1)}
});
