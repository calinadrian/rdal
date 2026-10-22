const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData', require('./test-profile.cjs').testProfile('module-navigation')); // removed after the test ends
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true};});
const timer=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1180,height:800,show:true,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=s=>win.webContents.executeJavaScript(s);
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));await new Promise(r=>setTimeout(r,600));
  for(const module of ['monsters','containers','zones','types','quests','wishlist','map']) {
   await js(`state.module='crafting';state.filter='Stone Club';go({type:'journal',arg:'Stone Club'},{detail:'Stone Club'});document.querySelector('#search').value='Stone Club';[...document.querySelectorAll('#modules button')].find(b=>b.textContent.startsWith(MODULES.find(m=>m.id===${JSON.stringify(module)}).label)).click();`);
   console.log('Checking '+module);assert.equal(await js('state.detail'),null,module+' detail reset');
   assert.equal(await js('state.filter'),'');
   assert.equal(await js(`document.querySelector('#search').value`),'');
   assert.equal(await js(`document.querySelector('#content .journal-page')!==null`),false,module+' old journal');
   assert.equal(await js(`document.querySelector('#detail').textContent.includes('Stone Club')`),false,module+' old detail');
   assert.equal(await js(`Preferences.json('navigation',{}).module`),module);
   assert.equal(await js(`Preferences.json('navigation',{}).detail`),null);
   if(['monsters','containers','zones','types'].includes(module)) {
    assert.equal(await js('state.view'),null);
    assert(await js(`document.querySelector('#content h1').textContent===MODULES.find(m=>m.id===state.module).label`));
   }
   if(module==='monsters') {
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(root,'test-fixtures/module-monsters-reset.png'),(await win.webContents.capturePage()).toPNG());
   }
   await js('back()');
   assert.equal(await js('state.module'),'crafting','back restores original module');
   assert.equal(await js('state.view.arg'),'Stone Club','back restores original entry');
  }
  await js(`state.module='monsters';go({type:'source',arg:'Chicken'},{detail:'Feather'});[...document.querySelectorAll('#modules button')].find(b=>b.textContent==='Crafting').click();`);
  assert.equal(await js('state.view.type'),'journal');
  assert.equal(await js('state.detail'),null);
  assert.equal(await js(`document.body.classList.contains('map-mode')`),false);
  console.log('PASS: seven module transitions clear stale content/details/search, correct landing screens, saved navigation, back restores crafting, crafting resets monster selection');
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});

