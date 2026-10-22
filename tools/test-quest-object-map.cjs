// Regression for Standing Stone being interpreted as the ordinary Stone resource.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('quest-object-map'));
const preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.1' }));
ipcMain.on('preferences:commit', (event, patch) => { Object.assign(preferences, patch); event.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Quest-object map test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 940, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code);
  const tick = () => new Promise(r => setTimeout(r, 450));
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html')); win.showInactive(); await tick();
    await js(`window.q=E['Withering Heights']; selectModule('quests');
      onQuestLog([{id:q.id,s:1,o:'InteractedWithStone1'}]); showItem(q.name);
      questMapMode='selected';questMapStepMode='all';selectedMapQuests.clear();
      Object.values(E).filter(e=>e.kind==='quest').slice(0,8).forEach(e=>selectedMapQuests.add(e.name));saveQuestMapFilter();`);
    assert(await js(`$('#detail .current-objective').querySelectorAll('.quest-pin-button').length===3`));
    assert(await js(`![...$('#detail').querySelectorAll('.quest-step-resource .item-link')].some(b=>b.textContent==='Stone')`), 'Quest stones must not produce a Stone supply link');
    await js(`window.pin=questStepMarkers(q,'InteractedWithStone1')[0];$('#detail .current-objective .quest-pin-button').click()`); await tick();
    assert(await js(`selectedQuestMarker===pin && state.detail===q.name && $('#detail h1').textContent===q.name`));
    assert(await js(`MapView.navigation().highlight.markers.length===1 && db.map.markers[MapView.navigation().highlight.markers[0]]===pin && $('#map-highlight').textContent.includes(q.name)`));
    await js(`onQuestLog([{id:q.id,s:1,o:'InteractedWithStone1'},{id:'Quest_FTUE_RC',s:2}]);`);
    assert(await js(`MapView.navigation().highlight.markers.length===1 && db.map.markers[MapView.navigation().highlight.markers[0]]===pin`), 'A live snapshot must not expand an explicitly pinned object to every quest location');
    await js(`MapView.focusMarker(pin)`); await tick();
    assert(await js(`(()=>{const r=$('#map').getBoundingClientRect();$('#map').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));return $('#map-tip').textContent.includes('Standing Stone') && $('#map-tip').textContent.includes(q.name)})()`));
    await js(`(()=>{const r=$('#map').getBoundingClientRect(),p={bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2};$('#map').dispatchEvent(new MouseEvent('mousedown',p));window.dispatchEvent(new MouseEvent('mouseup',p))})()`);
    assert(await js(`state.detail===q.name && selectedQuestMarker===pin && $('#map-navigation').textContent.includes('Standing Stone')`));
    await tick(); fs.writeFileSync(path.join(root, 'test-fixtures/quest-standing-stone-fixed.png'), (await win.webContents.capturePage()).toPNG());
    await js(`$('#detail .quest-show-map').click()`);
    assert(await js(`selectedQuestMarker===null && state.detail===q.name && MapView.navigation().highlight.markers.every(i=>db.map.markers[i].ref===q.name)`));
    await js(`focusQuestTarget(q,pin);showItem('Stone');renderNavigation();`);
    assert(await js(`selectedQuestMarker===null && !$('#map-navigation').textContent.includes('Standing Stone') && $('#detail h1').textContent==='Stone'`));
    await js(`showOnMap('Stone')`);
    assert(await js(`MapView.highlightLabel()==='Stone' && !$('#map-navigation').textContent.includes('Standing Stone')`), 'An intentional material lookup must have its own breadcrumb');
    console.log('PASS: actual standing-stone pin/hover/click, no false Stone supply link, stable live-update focus, quest-only all-locations, and independent material breadcrumbs');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
