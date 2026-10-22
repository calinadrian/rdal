const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('fine-cloth'));
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.handle('update:get',()=>({status:'idle',current:'0.1.4'}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true}});
const timer=setTimeout(()=>{console.error('Fine Cloth UI timed out');app.exit(1)},30000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1380,height:940,show:false,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code);
  const tick=()=>new Promise(r=>setTimeout(r,350));
  const capture=async name=>{if(process.env.ATLAS_NO_CAPTURES)return;await tick();fs.writeFileSync(path.join(root,'test-fixtures',`fine-cloth-${name}.png`),(await win.webContents.capturePage()).toPNG())};
  try{
    await win.loadFile(path.join(target,'app/ui/index.html'));win.showInactive();await tick();
    await js(`selectModule('crafting');state.listSel=db.journal.categories.find(c=>c.name==='Processed Materials').id;go({type:'journal',arg:'Fine Cloth'},{detail:null})`);
    assert(await js(`$('#content .recipe-where').textContent.includes('Loom') && $('#content .recipe-where').textContent.includes('Requires Loom Harness') && !$('#content .recipe-where').textContent.includes('not confirmed')`));
    assert(await js(`$('#content .recipe-cost').textContent.includes('3×Fine Thread') && $('#content .recipe-cost').textContent.includes('1×Gold Bar')`));
    await js(`$('#content .recipe-station-upgrade details').open=true;$('#content .recipe-where').scrollIntoView({block:'center'})`);
    assert(await js(`$('#content .recipe-station-upgrade').textContent.includes('within 9 m') && $('#content .recipe-station-upgrade').textContent.includes('under a roof') && $('#content .recipe-station-upgrade details .mats').children.length===5`));
    await capture('desktop');
    await js(`$('#content .craft-guide-button').click()`);
    assert(await js(`$('#content .craft-guide-body').textContent.includes('Requires Loom Harness') && !$('#content .craft-guide-body').textContent.includes('an unconfirmed station')`));
    await js(`$('#content .recipe-cost .mat').click();back()`);
    assert(await js(`state.view.arg==='Fine Cloth' && $('#content .recipe-station-upgrade')`));
    win.setSize(880,760);await tick();
    await js(`$('#content .recipe-where').scrollIntoView({block:'center'})`);
    assert(await js(`$('#content').scrollWidth<=$('#content').clientWidth+1 && $('#content .recipe-station-upgrade').scrollWidth<=$('#content .recipe-station-upgrade').clientWidth+1`));
    await capture('compact');
    await js(`$('#content .recipe-where .station-chip').click()`);
    assert(await js(`state.view.type==='facility' && state.view.arg==='Loom' && $('#content').textContent.includes('Fine Cloth')`));
    assert(await js(`(()=>{const routes=craftRoutes('Draconic Leather');const upgraded=routes.find(x=>x.recipe.stationUpgrade);const basic=routes.find(x=>!x.recipe.stationUpgrade && x.recipe.id===upgraded?.recipe.id);if(!upgraded||!basic)return false;const sequence=craftSequence('Draconic Leather');document.body.append(sequence);const pick=sequence.querySelector('select[aria-label="Recipe for Draconic Leather"]');pick.value=craftRouteKey(upgraded.recipe);pick.dispatchEvent(new Event('change'));const hasUpgrade=sequence.textContent.includes('Requires '+upgraded.recipe.stationUpgrade.name);const next=sequence.querySelector('select[aria-label="Recipe for Draconic Leather"]');next.value=craftRouteKey(basic.recipe);next.dispatchEvent(new Event('change'));const cleared=!sequence.textContent.includes('Requires '+upgraded.recipe.stationUpgrade.name);sequence.remove();return hasUpgrade&&cleared;})()`));
    console.log('PASS: exact Fine Cloth ingredients, Loom/Harness requirement and build materials, placement, craft guide, ingredient/Back, Loom catalogue, desktop/compact layouts and switching upgraded/basic station routes');
    clearTimeout(timer);app.exit(0);
  }catch(e){console.error(e);clearTimeout(timer);app.exit(1)}
});
