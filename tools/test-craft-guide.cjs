const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(arg=>!arg.startsWith('--'))[2]||root);
const db=JSON.parse(fs.readFileSync(path.join(target,'data/db.json')));
app.setPath('userData', require('./test-profile.cjs').testProfile('craft-guide')); // removed after the test ends
ipcMain.handle('db:get',()=>db);
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.handle('update:get',()=>({status:'idle',current:require('../package.json').version}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true};});
const timeout=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1180,height:800,show:true,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));
  await new Promise(r=>setTimeout(r,700));
  await js(`state.module='crafting';go({type:'journal',arg:'Bread'},{detail:null});document.querySelector('#content .craft-guide-button').click();`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.craft-step-title')].map(e=>e.textContent)`),['Obtain 1 × Wheat','Craft 1 × Bag of Flour at Grinder','Craft 1 × Bread at Kiln']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.craft-step-use')].map(e=>e.textContent)`),['Use 1 × Wheat.','Use 1 × Bag of Flour.']);
  assert.equal(await js(`document.querySelectorAll('.craft-sequence .recipe-unlock').length`),0);
  await js(`document.querySelector('.craft-step-sources').open=true`);
  await new Promise(r=>setTimeout(r,60));
  assert(await js(`document.querySelector('.craft-step-sources').textContent.includes('Loot, vendors')`));
  await js(`document.querySelector('.craft-step-sources').open=false`);
  for(const [w,h] of [[1180,800],[760,650]]) {
   win.setSize(w,h);
   await js(`document.querySelector('.craft-guide-button').scrollIntoView({block:'start'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
   await new Promise(r=>setTimeout(r,160));
   assert.equal(await js(`document.querySelector('#content').scrollWidth>document.querySelector('#content').clientWidth+1`),false);
   if(!process.env.ATLAS_NO_CAPTURES)fs.writeFileSync(path.join(root,`test-fixtures/craft-sequence-bread-${w}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js(`go({type:'journal',arg:'Steel Bar'},{detail:null});document.querySelector('.craft-guide-button').click();`);
  assert.equal(await js(`document.querySelector('[aria-label="Recipe for Steel Bar"]').options.length`),3);
  await js(`const steel=document.querySelector('[aria-label="Recipe for Steel Bar"]');steel.value=craftRouteKey(craftRoutes('Steel Bar').find(x=>x.recipe.id==='RECIPE_Process_SteelBar').recipe);steel.dispatchEvent(new Event('change'));`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.craft-step-title')].map(e=>e.textContent)`),['Obtain 3 × Iron Ore','Obtain 3 × Coal','Craft 1 × Steel Bar at Advanced Smelter']);
  await js(`document.querySelector('.craft-step-sources').open=true`);
  await new Promise(r=>setTimeout(r,60));
  assert(await js(`document.querySelector('.craft-procurement').textContent.includes('Gather from Iron')`));
  assert(await js(`document.querySelector('.craft-procurement .source-map-button')!==null`));
  assert.deepEqual(await js(`craftPlan('Bread',5).supplies.map(s=>[s.item,s.qty])`),[['Wheat',5]]);
  assert.deepEqual(await js(`craftPlan('Bread',5).steps.map(s=>[s.item,s.qty])`),[['Bag of Flour',5],['Bread',5]]);
  const audit=await js(`(()=>{
   let count=0;
   for(const e of Object.values(E))for(const route of craftRoutes(e.name)) {
    const plan=craftPlan(e.name,1,new Map([[e.name,craftRouteKey(route.recipe)]]));
    const inventory=new Map(plan.supplies.map(s=>[s.item,s.qty]));
    for(const step of plan.steps) {
     for(const m of step.materials) {
      if((inventory.get(m.item)||0)<m.qty)return {error:e.name+' lacks '+m.item};
      inventory.set(m.item,inventory.get(m.item)-m.qty);
     }
     inventory.set(step.item,(inventory.get(step.item)||0)+step.qty);
    }
    if((inventory.get(e.name)||0)<1)return {error:e.name+' not produced'};
    count++;
   }
   return {count};
  })()`);
  assert.equal(audit.error,undefined,audit.error);
  assert(audit.count>100);
  await js(`E['Guide Cycle']={name:'Guide Cycle',recipes:[{id:'cycle',materials:[{item:'Guide Cycle',qty:1}],outputs:[{item:'Guide Cycle',qty:1}],facility:'Kiln'}]};`);
  assert(await js(`craftPlan('Guide Cycle').supplies[0].cycle`));
  await js(`delete E['Guide Cycle']`);
  assert.equal(await js(`craftingGuide('Wooden Club')`),null);
  assert.equal(await js(`craftingGuide('Coal')`),null);
  await js(`state.module='crafting';go({type:'armourset',arg:'bronze'},{detail:null});`);
  assert.equal(await js(`document.querySelectorAll('.set-piece .craft-guide-button').length`),3);
  await js(`document.querySelector('.set-piece .craft-guide-button').click()`);
  assert(await js(`document.querySelector('.set-piece .craft-steps')!==null`));
  await js(`go({type:'journal',arg:'Bread'},{detail:null});document.querySelector('.craft-guide-button').click();document.querySelector('.craft-station-link').click();`);
  assert.equal(await js(`state.view.arg`),'Grinder');
  console.log(`PASS: ordered bread steps, alternatives, procurement/maps, quantities, cycle guard, armour/station links, 1180/760 layouts; ${audit.count} recipes have valid material ordering`);
  clearTimeout(timeout);app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
