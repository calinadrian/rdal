// Verify browsing, task guidance, progress honesty and map/back context in the shipped renderer.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('quest-browser'));
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.1' }));
ipcMain.on('preferences:commit', (event, patch) => { Object.assign(preferences, patch); event.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Quest browser timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Renderer:', code); throw error; } };
  const tick = () => new Promise(r => setTimeout(r, 450));
  const capture = async name => { if (process.env.ATLAS_NO_CAPTURES) return; await tick(); fs.writeFileSync(path.join(root, 'test-fixtures', `quest-browser-${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html')); win.showInactive(); await tick();
    await js(`window.$$=selector=>[...document.querySelectorAll(selector)];selectModule('quests'); window.htp=E['Highlighting the Problem']; window.melody=E['A Melody Remembered'];
      onQuestLog([{id:htp.id,s:1,o:htp.objectives[0].key},{id:melody.id,s:1,o:'Objective1'},{id:'Quest_FTUE_RC',s:2},{id:'Quest_FTUE_LO',s:0}]);`);
    assert(await js(`$('#content .quest-task.q-active').textContent.includes('Enter Thishepen Kara')`), 'Overview must show rewritten guidance');
    // One control per row: Track. Ticking it tracks the quest without opening the guide, and keeps focus.
    assert(await js(`[...$('#content .quest-task.q-active').querySelectorAll('button, label')].filter(el=>!el.matches('.quest-title-link')).map(el=>el.className).join()==='track-toggle'+(isTracked(htp.name)?' on':'')`), 'A quest row has the Track tickbox as its only control');
    const wasTracked = await js(`isTracked(htp.name)`);
    await js(`$('#content .quest-task.q-active .track-toggle input').click()`);
    assert(await js(`isTracked(htp.name)===${!wasTracked} && !state.detail && document.activeElement===$('#content .quest-task.q-active .track-toggle input')`), 'Ticking Track only tracks the quest');
    await js(`$('#content .quest-task.q-active .track-toggle input').click()`);
    assert.equal(await js(`isTracked(htp.name)`), wasTracked);
    // The journal folds into sections: In progress and Ready to start open, Not started and Completed folded until opened.
    assert(await js(`$$('#content .quest-task.q-active').length===2 && $$('#content .quest-task.q-available').length===1 && !$('#content .quest-task.q-done')
      && $('#content .quest-group-heading[data-group=done]').getAttribute('aria-expanded')==='false'`), 'Active and ready quests show; completed ones are folded');
    assert(await js(`$$('#list .quest-list-text').length===3 && $('#list .filter-count').textContent.startsWith('45 quests')`), 'The sidebar folds the same groups and still counts every quest');
    await capture('desktop');
    await js(`$('#section-filter').value='Thishepen';$('#section-filter').dispatchEvent(new Event('input'))`);
    assert(await js(`$$('#content .quest-task').length===1 && $$('#list .quest-list-text').length===1`), 'Search objective text as well as quest names');
    await js(`$('#section-filter').value='no-such-quest';$('#section-filter').dispatchEvent(new Event('input'))`);
    assert(await js(`$('#content .quest-empty').textContent.includes('Clear filter') && !$$('#content .quest-task').length`));
    await js(`$('#content .quest-empty button').click()`);
    // Scroll, open the guide from anywhere on the row, pin an interior actor, then return to the exact list context.
    await js(`$('#content').scrollTop=100;window.beforeTop=$('#content').scrollTop;$('#content .quest-task.q-active .quest-now').click()`); await tick();
    assert(await js(`state.detail===htp.name`), 'Clicking a quest row opens its guide');
    assert(await js(`$('#detail .quest-now-label').textContent==='Step 1 of 4' && $$('#detail .current-objective .quest-target').length===1`), 'A linear quest says which step you are on and lists its place');
    await js(`$('#detail .current-objective .quest-pin-button').click()`); await tick();
    assert(await js(`state.module==='map' && MapView.layer()?.name==='Thishepen Kara' && selectedQuestMarker.target==='Password statue'`));
    await js(`back()`);
    assert(await js(`state.module==='quests' && state.detail===htp.name`));
    await js(`closeDetail()`);
    assert(await js(`beforeTop>0 && $('#content').scrollTop===beforeTop`), 'Closing the guide returns the journal to where you were');
    await js(`showItem(melody.name)`);
    assert(await js(`$('#detail .current-objective').textContent.includes('Inspiring Ring of Runecrafting') && document.activeElement===$('#detail h1')`));
    assert(await js(`!$('#detail .quest-walkthrough').open && $('#detail .progress-context').textContent.includes('Saved progress')`));
    await js(`window.itemButton=$$('#detail .current-objective .item-link').find(b=>b.textContent==='Inspiring Ring of Runecrafting');itemButton.click();back()`);
    assert(await js(`state.detail===melody.name && $('#detail .current-objective').textContent.includes('Inspiring Ring')`));
    await js(`closeDetail();$('#content .quest-group-heading[data-group=done]').click()`);
    assert.deepEqual(JSON.parse(preferences.questGroups).sort(), ['active', 'available', 'done'], 'Opening a section is remembered');
    assert(await js(`$$('#content .quest-task.q-done').length===1 && !$('#content .q-done .track-toggle') && $('#content .q-done').textContent.includes('Ratcatcher')
      && document.activeElement===$('#content .quest-group-heading[data-group=done]')`), 'Completed quests have nothing to track');
    await js(`onQuestLog([{id:htp.id,s:1,o:'unrecognised-key'}]);showItem(htp.name);`);
    assert(await js(`$('#detail .current-objective').textContent.includes('Current objective not recorded') && !$('#detail [role=progressbar]')`));
    // Places are ticked off from the quest's own bools, not guessed from the objective counter.
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'InteractedWithStone1',b:{VillageStoneDone:true}}]);showItem('Withering Heights');`);
    assert(await js(`!$('#detail .objectives > li.done') && $('#detail .current-objective .quest-target-count').textContent==='1 of 3 done'
      && $$('#detail .current-objective .quest-target.done').length===1 && $$('#detail .current-objective .quest-pin-button').length===2`), 'A finished stone is ticked off and leaves the map buttons');
    // A broken seal leaves the list, the tracker and the map; the rest keep their Map buttons.
    await js(`trackedQuests=['Withering Heights'];onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'BreakTheThreeSeals',b:{SilverthornSealBroken:true}}], {VillageArea:true,FortressArea:false,FallArea:true});showItem('Withering Heights')`);
    assert(await js(`$('#detail .quest-target.done .quest-target-where').textContent==='Done · Silverthorn Keep' && $('#detail .current-objective .quest-target-count').textContent==='1 of 3 done'
      && questTrackerObjective(E['Withering Heights']).lines.flatMap(l=>l.markers).filter(m=>!m.opens).length===2 && !questTrackerObjective(E['Withering Heights']).lines.flatMap(l=>l.markers).some(m=>m.entry.endsWith('Silverthorn'))`), 'A finished seal is ticked off everywhere');
    // The four god shrines that bring down the Emberwood barrier are listed and tracked, but only the seals are counted.
    assert(await js(`$$('#detail .current-objective .quest-target-where').filter(e=>e.textContent.includes('opens the way to the Emberwood Curse Seal')).length===5
      && questTrackerObjective(E['Withering Heights']).lines.flatMap(l=>l.markers).filter(m=>m.opens).length===5`), 'The Emberwood barrier shrines are shown and tracked');
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'BreakRemainingtwoSeals',b:{SilverthornSealBroken:true,EmberwoodSealBroken:true}}]);showItem('Withering Heights')`);
    assert(await js(`!$$('#detail .current-objective .quest-target:not(.done) .quest-target-where').some(e=>e.textContent.includes('opens the way'))
      && $('#detail .current-objective .quest-target-count').textContent==='2 of 3 done'`), 'With the Emberwood seal broken its shrines are done too');
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'BreakTheThreeSeals',b:{SilverthornSealBroken:true}}], {VillageArea:true,FortressArea:false,FallArea:true});showItem('Withering Heights')`);
    assert(await js(`$('#content .quest-task.q-active .quest-row-progress')?.textContent.includes('1 of 3 done') || $$('#content .quest-row-progress').some(p=>p.textContent==='1 of 3 done')`), 'The journal row shows how many places are done');
    // With no exact interaction point, the areas follow the game's own map: hidden ones go, ones it shows for this quest come in.
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'FindACleansingPool'}], {CleansingPoolTarget:false,StandingStonesArea:true,NPCDeath:true})`);
    assert.deepEqual(await js(`questStepMarkers(E['Withering Heights'],'FindACleansingPool').map(m=>m.qlocation)`), ['StandingStonesArea']);
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'FindACleansingPool'}])`);
    assert.deepEqual(await js(`questStepMarkers(E['Withering Heights'],'FindACleansingPool').map(m=>m.qlocation)`), ['CleansingPoolTarget'], 'Without the game\'s map the guide keeps its own areas');
    await js(`trackedQuests=[]`);
    await js(`window.boom=E['Things That Go Boom In The Night'];onQuestLog([{id:boom.id,s:1,o:'FindSpectralChinchompaSkulls'}]);showItem(boom.name);`);
    assert(await js(`$('#detail .current-objective .source-map-links') && $('#detail .current-objective').textContent.includes('not live sightings')`));
    await js(`$('#detail .current-objective .source-map-button').click()`); await tick();
    assert(await js(`MapView.navigation().highlight.markers.length>0 && MapView.navigation().highlight.markers.every(i=>db.map.markers[i].n==='Spectral Chinchompa')`));
    await js(`onQuestLog([{id:boom.id,s:1,o:'FindSpectralChinchompaSkulls'},{id:'Quest_FTUE_RC',s:2}])`);
    assert(await js(`MapView.navigation().highlight.markers.every(i=>db.map.markers[i].n==='Spectral Chinchompa')`), 'A progress update must preserve the chosen spawn sites');
    await js(`back()`);
    await js(`questLog=null;closeDetail();showItem(htp.name)`);
    assert(await js(`$('#detail .current-objective').textContent.includes('How to start') && $('#detail .progress-context').textContent.includes('unknown')`));
    win.setSize(900, 780); await tick(); await capture('compact-guide');
    assert(await js(`$('#detail').scrollWidth <= $('#detail').clientWidth+1 && $('#detail .current-objective .quest-pin-button').getBoundingClientRect().width>40`));
    await js(`closeDetail();onQuestLog([{id:htp.id,s:1,o:htp.objectives[0].key},{id:melody.id,s:1,o:'Objective1'}])`);
    await capture('compact');
    assert(await js(`$('#content').scrollWidth <= $('#content').clientWidth+1 && $$('#content .track-toggle').every(b=>b.scrollWidth<=b.clientWidth+1)`));
    assert(await js(`(()=>{const b=$('#list .quest-overview-link'),label=b.querySelector('.quest-overview-label'),r=label.getBoundingClientRect(),pane=$('#list').getBoundingClientRect();return r.left>=pane.left && r.right<=pane.right && label.scrollWidth<=label.clientWidth+1})()`), 'Journal label must fit the sidebar');
    win.focus(); win.webContents.focus();
    await js(`$('#content .quest-group-heading[data-group=active]').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await tick();
    assert(await js(`document.activeElement.matches('#content .q-active .quest-title-link') && getComputedStyle(document.activeElement).outlineStyle!=='none'`), 'Tab navigation must show a visible focus ring');
    await win.reload(); await tick();
    assert(await js(`questGroupsOpen.has('done') && $('#content .quest-group-heading[data-group=active]').getAttribute('aria-expanded')==='true' && $('#content .quest-group-heading[data-group=unknown]').getAttribute('aria-expanded')==='false'`), 'Open sections must hydrate from preferences');
    console.log('PASS: folding journal sections remembered, sidebar groups and counts, search, row opens guide → step label → exact objective pin → Back, guide → item → Back, saved/unknown/unrecognised progress, places ticked off from quest bools, desktop/compact and preference hydration');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
