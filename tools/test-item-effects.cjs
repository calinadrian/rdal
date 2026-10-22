const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData', require('./test-profile.cjs').testProfile('item-effects')); // removed after the test ends
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true};});
const timer=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1180,height:800,show:true,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=s=>win.webContents.executeJavaScript(s);
 try {
  const {itemEffects}=require(path.join(target,'importer/item-effects'));
  const text=t=>t?.LocalizedString||t?.SourceString||null;
  assert.deepEqual(itemEffects({},text),{effects:[],effectNotes:[]});
  assert.equal(itemEffects({BuffDatas:[{Description:{SourceString:'bonus'}},{Description:{SourceString:'bonus'}},{Title:{SourceString:'Empty'}}]},text).effects.length,1);
  const db=JSON.parse(fs.readFileSync(path.join(target,'data/db.json')));
  const raw=require(path.join(root,'tools/Extractor/out/raw/items.json'));
  let count=0;
  for(const exports of Object.values(raw))for(const item of exports)if(item.Type==='TrinketItemData') {
   const entity=Object.values(db.entities).find(e=>e.id===item.Name);
   assert(entity,item.Name);
   assert.deepEqual({effects:entity.effects,effectNotes:entity.effectNotes},itemEffects(item.Properties,text),item.Name);
   assert(entity.effects.length,item.Name+' has no benefits');count++;
  }
  await win.loadFile(path.join(target,'app/ui/index.html'));await new Promise(r=>setTimeout(r,700));
  for(const [name,expected] of [['Amulet of Strength','MELEE DAMAGE'],['Inspiring Ring of Mining','+5%'],['Ring of Life','TELEPORTS'],['Amulet of Glory','CRIT DAMAGE'],['Golden Gyrhawk Amulet','+25%']]) {
   // Some names are not identical to the internal export; find by tooltip if needed.
   const actual=db.entities[name]?name:Object.values(db.entities).find(e=>e.effects?.some(b=>b.description.includes(expected)))?.name;
   await js(`state.module='crafting';go({type:'journal',arg:${JSON.stringify(actual)}},{detail:null});`);
   assert(await js(`document.querySelector('#content .item-effects').textContent.includes(${JSON.stringify(expected)})`));
   assert.equal(await js(`document.querySelectorAll('#content .item-effects').length`),1);
   if(name==='Ring of Life')assert(await js(`document.querySelector('.item-effects').textContent.includes('Breaks after one use')`));
  }
  await js(`go({type:'journal',arg:'Amulet of Glory'},{detail:null});`);
  assert.equal(await js(`document.querySelectorAll('.item-effects li').length`),2);
  for(const [w,h] of [[1180,800],[760,650]]) {
   win.setSize(w,h);await js(`document.querySelector('.item-effects').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   await new Promise(r=>setTimeout(r,120));
   assert.equal(await js(`document.querySelector('#content').scrollWidth>document.querySelector('#content').clientWidth+1`),false);
   fs.writeFileSync(path.join(root,`test-fixtures/jewellery-benefits-${w}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js(`state.module='monsters';go({type:'source',arg:'Chicken'},{detail:null});showItem('Ring of Recoil');`);
  assert(await js(`document.querySelector('#detail .item-effects').textContent.includes('REFLECT')`));
  assert.equal(await js(`document.querySelectorAll('#detail .item-effects').length`),1);
  await js(`state.module='crafting';go({type:'facility',arg:E['Amulet of Strength'].recipes[0].facility},{detail:null});`);
  assert(await js(`document.querySelector('#content .item-effects')!==null`));
  console.log(`PASS: all ${count} trinkets retain game tooltip effects; percentages, multi-effects, one-use warning, journal/station/detail display, no duplicates, 1180/760 layouts`);
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
