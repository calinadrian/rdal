// Exercise the shipped renderer: one quest list, focused guidance, and navigation continuity.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(arg => !arg.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('quest-browser'));
let preferences = {};
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.13' }));
ipcMain.on('preferences:commit', (event, patch) => { Object.assign(preferences, patch); event.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Quest browser timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (e) { console.error(code); throw e; } };
  const tick = () => new Promise(r => setTimeout(r, 250));
  const capture = async name => { await tick(); if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', `quest-browser-${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html')); win.showInactive(); await tick();
    await js(`window.$$=s=>[...document.querySelectorAll(s)]; window.visible=el=>!!el&&el.getClientRects().length>0&&!el.closest('details:not([open])');
      questLog=null;lastQuestSelection=null;selectModule('quests');window.htp=E['Highlighting the Problem'];window.melody=E['A Melody Remembered'];`);
    assert(await js(`!state.detail && $('#content .quest-empty') && !$('#list .quest-other').open`), 'Without progress, invite browsing and fold Other quests');
    assert(await js(`document.querySelectorAll('#list .quest-list-state').length>0 && [...document.querySelectorAll('#list .quest-list-state')].filter(el=>!el.closest('.q-removed')).every(el=>el.textContent==='Progress unknown')`), 'No snapshot must not label quests undiscovered');
    await js(`onQuestLog([{id:htp.id,s:1,o:htp.objectives[0].key},{id:melody.id,s:1,o:'Objective1'},{id:'Quest_FTUE_RC',s:2},{id:'Quest_FTUE_LO',s:0}]);`);
    assert(await js(`state.detail===htp.name && visible($('#detail')) && !visible($('#content')) && visible($('#mapview')) && document.body.classList.contains('quest-log-map') && MapView.layer()?.name==='Thishepen Kara' && MapView.navigation().highlight.markers.some(i=>db.map.markers[i].target==='Password statue')`), 'First active quest fills the reader when progress arrives');
    assert(await js(`(()=>{const row=name=>[...document.querySelectorAll('#list .quest-list-entry')].find(el=>el.dataset.quest===name);return row(htp.name).querySelector('.quest-type').textContent==='Side Quest' && row(htp.name).querySelector('.quest-list-state').textContent==='Active' && row('Rune Mysteries').querySelector('.quest-type').textContent==='Main Quest' && row('Rune Mysteries').querySelector('.quest-list-state').textContent==='Ready to start' && row('Ratcatcher').querySelector('.quest-list-state').textContent==='Completed' && !row('Ratcatcher').querySelector('.quest-list-objective') && row('Dragon Slayer').querySelector('.quest-list-state').textContent==='Not discovered' && row('Rogue Trader').querySelector('.quest-type').textContent==='Task';})()`), 'Every quest row identifies its real type and progress state');
    assert(await js(`!$('#content .quest-task') && !$('#list .quest-overview-link') && $$('#list .quest-list-entry').filter(visible).length===3`), 'Only one visible quest collection');
    assert(await js(`$$('#list .quest-list-entry').every(el=>el.tagName==='BUTTON'&&!el.querySelector('button,input,select'))`), 'Quest rows only select');
    assert(await js(`$$('select').filter(visible).length===0 && $$('#list .quest-order-link').length===1`), 'Default quests has no dropdowns and one order link');
    assert(await js(`$('#detail .quest-now-label').textContent==='Step 1 of 4' && $('#detail .current-objective').textContent.includes('Enter Thishepen Kara')`));
    assert(await js(`$('#detail .quest-walkthrough').tagName==='SECTION' && !$('#detail .quest-background-details').open && [...$('#detail').children].filter(el=>el.matches('details')).every(el=>!el.open)`), 'Walkthrough is visible while supplemental details start folded');
    assert(await js(`$$('.progress-context').filter(visible).length===1 && $('.quest-section-header .progress-context').textContent.includes('Saved progress')`));
    const trackedBefore=await js(`JSON.stringify(trackedQuests)`);
    const filtersBefore=await js(`JSON.stringify(['mapCategories','questMapFilter','mapFollow','mapViewport'].map(key=>Preferences.get(key)))`);
    await js(`$('#list .quest-list-entry[data-quest="A Melody Remembered"]').click()`);
    assert.equal(await js(`JSON.stringify(trackedQuests)`), trackedBefore, 'Selecting never changes tracking');
    assert.equal(await js(`JSON.stringify(['mapCategories','questMapFilter','mapFollow','mapViewport'].map(key=>Preferences.get(key)))`), filtersBefore, 'Quest browsing does not change saved map settings');
    assert(await js(`$('#quest-map-caption h2').textContent===melody.name && MapView.navigation().highlight.markers.length>0 && visible($('#detail .quest-story-inline'))`), 'Selection updates the map and readable description');
    assert(await js(`document.activeElement===$('#detail h1')`), 'Selection moves keyboard focus into the reader');
    await js(`$('#detail .track-button').click()`);
    assert(await js(`isTracked(melody.name) && $('#list .quest-list-entry.sel .quest-tracked-indicator') && document.activeElement===$('#detail .track-button')`));
    await js(`$('#detail .track-button').click();showItem(htp.name)`);
    await js(`(async()=>{const marker=db.map.markers.find(m=>m.ref===htp.name&&m.target==='Password statue');MapView.focusMarker(marker);await new Promise(r=>setTimeout(r,300));const canvas=$('#map'),r=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));if(!$('#map-tip').textContent.includes('Password statue'))throw Error('Quest destination is not pickable');canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));canvas.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    assert(await js(`state.module==='quests'&&state.detail===htp.name&&selectedQuestMarker.target==='Password statue'`), 'Map clicks keep the matching quest details');
    await js(`$('#quest-map-caption button').click()`);
    assert(await js(`state.module==='map'&&state.detail===htp.name&&MapView.navigation().highlight.markers.length===1&&!MapView.isFollowing()`), 'Full map keeps the selected quest and destination');
    await js(`back()`);
    assert(await js(`state.module==='quests'&&document.body.classList.contains('quest-log-map')&&state.detail===htp.name&&MapView.layer()?.name==='Thishepen Kara'`), 'Back restores the map-and-log layout');
    await capture('desktop');
    // Search includes objective text, keeps the reader, and reveals folded matches.
    await js(`$('#section-filter').value='Thishepen';$('#section-filter').dispatchEvent(new Event('input'))`);
    assert(await js(`$$('#list .quest-list-entry').length===1 && state.detail===htp.name`));
    await js(`$('#section-filter').value='no-such-quest';$('#section-filter').dispatchEvent(new Event('input'))`);
    assert(await js(`$('#list .empty').textContent.includes('No quests match') && visible($('#detail .current-objective'))`));
    await js(`$('#list .filter-clear').click();$('#list .quest-other').open=true;`);await tick();
    assert(JSON.parse(preferences.questGroups).includes('other'));
    // Real mouse selection low in a long sidebar must preserve its exact scroll offset.
    for (const name of ['What Remains is Written', 'Withering Heights']) {
      const point = await js(`(()=>{const row=[...document.querySelectorAll('#list .quest-list-entry')].find(el=>el.dataset.quest===${JSON.stringify(name)});row.scrollIntoView({block:'center'});window.beforeSelectionTop=$('#list').scrollTop;const r=row.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await tick();
      assert(await js(`state.detail===${JSON.stringify(name)} && beforeSelectionTop>500 && Math.abs($('#list').scrollTop-beforeSelectionTop)<2`), 'Selecting a lower quest must not jump the sidebar');
    }
    await js(`showItem(htp.name)`);
    // Preserve search/list scroll and reader folds through target map -> Back.
    await js(`$('#list').scrollTop=120;window.listTop=$('#list').scrollTop;$('#detail').scrollTop=80;window.detailTop=$('#detail').scrollTop;$('#detail .current-objective .quest-pin-button').click()`);await tick();
    assert(await js(`state.module==='map' && MapView.layer()?.name==='Thishepen Kara' && selectedQuestMarker.target==='Password statue'`));
    await js(`back()`);
    assert(await js(`state.module==='quests' && state.detail===htp.name && $('#list').scrollTop===listTop && $('#detail').scrollTop===detailTop`), 'Map Back restores both scroll positions');
    // Item navigation restores the selected quest rather than opening a third pane.
    await js(`showItem(melody.name);window.item=$$('#detail .current-objective .item-link').find(b=>b.textContent==='Inspiring Ring of Runecrafting');item.click();back()`);
    assert(await js(`state.detail===melody.name && $('#detail .current-objective').textContent.includes('Inspiring Ring') && !visible($('#content'))`));
    await js(`onQuestLog([{id:htp.id,s:1,o:'unrecognised-key'}]);showItem(htp.name)`);
    assert(await js(`$('#detail .current-objective').textContent.includes('Current objective not recorded') && !$('#detail .current-objective .quest-pin-button') && $('#detail .quest-walkthrough').tagName==='SECTION' && !MapView.navigation().highlight`));
    await js(`onQuestLog([{id:htp.id,s:1,o:htp.objectives[2].key}])`);
    assert(await js(`$('#detail .quest-now-label').textContent==='Step 3 of 4' && $$('#detail .current-objective .quest-pin-button').length===3 && $$('#detail .current-objective .quest-pin-button').every(b=>b.textContent==='Show target')`));
    await js(`onQuestLog([{id:'Quest_DeathQuestMain',s:1,o:'BreakTheThreeSeals',b:{SilverthornSealBroken:true}}],{VillageArea:true,FortressArea:false,FallArea:true});showItem('Withering Heights')`);
    assert(await js(`$('#detail .current-objective .quest-target-count').textContent==='1 of 3 done' && !$('#detail .current-objective .quest-target.done .quest-pin-button')`));
    await js(`onQuestLog([{id:htp.id,s:2}]);showItem(htp.name)`);
    assert(await js(`$('#detail .current-objective').textContent.includes('Quest complete') && !$('#detail .track-button')`));
    // No target is preferable to a fabricated map action.
    await js(`window.unplaced=browseQuests().find(q=>q.objectives?.some(o=>!questStepTargets(q,o.key).length&&!questStepSourceMarkers(q,o.key).length&&!(questStepGuidance(q,o.key)?.resources||[]).length));window.step=unplaced.objectives.find(o=>!questStepTargets(unplaced,o.key).length&&!questStepSourceMarkers(unplaced,o.key).length&&!(questStepGuidance(unplaced,o.key)?.resources||[]).length);onQuestLog([{id:unplaced.id,s:1,o:step.key}]);showItem(unplaced.name)`);
    assert(await js(`$('#detail .quest-location-unknown') && !$('#detail .current-objective button')`));
    // The guide is a readable page: every instruction and useful detail stays inline.
    await js(`window.referenceQuest=E["Icthlarin's Little Helper"];onQuestLog([{id:referenceQuest.id,s:1,o:'FindGarou'}]);showItem(referenceQuest.name)`);
    assert(await js(`$('#detail .quest-walkthrough').tagName==='SECTION' && !$('#detail .quest-walkthrough details, #detail .quest-walkthrough summary, #detail .quest-walkthrough select') && $('#detail .objectives .now .quest-stage-status').textContent==='Your current stage' && !$('#detail .objectives .quest-stage-number')`), 'Walkthrough has no dropdowns, disclosures or invented numbering');
    assert(await js(`referenceQuest.objectives.every(o=>$('#detail .quest-walkthrough').textContent.includes(o.text)) && referenceQuest.guide.steps.every(step=>(step.notes||[]).every(note=>$('#detail .quest-walkthrough').textContent.includes(note)))`), 'Game objectives and guidance notes are retained inline');
    assert(await js(`[...$('#detail .quest-walkthrough').querySelectorAll('.quest-game-text,.quest-step-note,.quest-target-actions button')].every(el=>el.getClientRects().length>0&&!el.closest('details')) && !!$('#detail .objectives .quest-location-unknown')`), 'Useful text, location guidance and map actions need no expanding');
    await js(`onQuestLog([{id:referenceQuest.id,s:1,o:'FirstGarouEarnReputation.LowReputation'}])`);
    assert(await js(`$('#detail .objectives .now').textContent.includes('Complete tasks for the Alcarrid') && $('#detail .objectives .now').textContent.includes('Gain the trust')`), 'Counter variants retain the current stage and original objective');
    await js(`$('#detail .quest-walkthrough').scrollIntoView({block:'start'})`);
    await capture('stages-desktop');
    win.setSize(900,780);await tick();await js(`$('#detail .quest-walkthrough').scrollIntoView({block:'start'})`);await capture('stages-compact');
    assert(await js(`$('#detail').scrollWidth<=$('#detail').clientWidth+1`));
    win.setSize(1440,1000);await tick();
    await js(`questLog=null;showItem(htp.name)`);
    win.setSize(900,780);await tick();await capture('compact-guide');
    assert(await js(`!visible($('#list')) && visible($('#detail')) && visible($('#detail .quest-back-list')) && $$('.progress-context').filter(visible).length===1 && $('#detail').textContent.includes('Progress unknown')`));
    assert(await js(`$('#detail').scrollWidth<=$('#detail').clientWidth+1 && $('#detail .current-objective .quest-pin-button').getBoundingClientRect().width>40`));
    await js(`$('#detail .quest-back-list').click()`);await tick();await capture('compact');
    assert(await js(`visible($('#list')) && !visible($('#detail')) && !visible($('#content'))`), 'Compact list occupies the reading area');
    await js(`$('#list .quest-order-link').click()`);
    assert(await js(`visible($('#content .quest-order')) && !visible($('#list'))`), 'Order remains usable at compact width');
    await js(`$('#content .quest-back-list').click();$('#section-filter').focus()`);
    win.focus();win.webContents.focus();
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await tick();
    assert(await js(`document.activeElement.closest('#list') && getComputedStyle(document.activeElement).outlineStyle!=='none'`), 'Visible keyboard focus');
    await js(`$('#list .quest-other').open=true;$('#list').scrollTop=260;window.compactListTop=$('#list').scrollTop;showItem(melody.name);$('#detail .current-objective .item-link').click();back();$('#detail .quest-back-list').click()`);
    assert(await js(`$('#list').scrollTop===compactListTop && compactListTop>0`), 'Compact item Back and list return preserve scroll');
    await js(`showItem(melody.name);selectModule('zones');selectModule('quests')`);
    assert(await js(`state.detail===melody.name`), 'Re-entering restores the last quest');
    await win.reload();await tick();
    assert(await js(`state.module==='quests' && state.detail==='A Melody Remembered' && questGroupsOpen.has('other')`), 'Selection and Other quests survive restart');
    await js(`lastQuestSelection=null;onQuestLog([{id:'Quest_FTUE_LO',s:0}]);selectModule('quests')`);
    assert(await js(`state.detail===preferredQuest() && questStatus(ent(state.detail))==='available'`), 'Ready quest is the fallback');
    await js(`onGame({running:true});onQuestLog([{id:'Quest_FTUE_LO',s:1,o:'test'}])`);
    assert(await js(`$('#detail .quest-section-header .progress-context').textContent==='Live from your game'`));
    await js(`onGame({running:false})`);
    assert(await js(`$('#detail .quest-section-header .progress-context').textContent.includes('Saved progress')`), 'Disconnect updates context without a new quest snapshot');
    console.log('PASS: quest list + objective map + details/rewards, map picking/full-map return and settings isolation, one quest list, active/ready defaults, selection persistence, separate tracking, inline walkthrough with all guidance, folded background details, objective search, map/item Back and scroll, honest progress, multiple/done/missing targets, compact list/reader/order, keyboard focus, live/saved context');
    clearTimeout(timer);app.exit(0);
  } catch(e) { console.error(e);clearTimeout(timer);app.exit(1); }
});
