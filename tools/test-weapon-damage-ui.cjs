const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('weapon-damage'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: '0.1.2' }));
ipcMain.on('preferences:commit', event => { event.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Weapon UI test timed out'); app.exit(1); }, 40000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 930, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code);
  const tick = () => new Promise(r => setTimeout(r, 350));
  const capture = async name => { if (process.env.ATLAS_NO_CAPTURES) return; await tick(); fs.writeFileSync(path.join(root, 'test-fixtures', `weapon-damage-${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html')); win.showInactive(); await tick();
    await js(`selectModule('crafting');state.listSel=db.journal.categories.find(c=>c.name==='Weapons').id;go({type:'journal',arg:'Bronze Sword'},{detail:null})`);
    assert(await js(`$('#content .journal-stats').textContent.includes('Slash damage31–56') && !$('#content .journal-stats').textContent.includes('Damage multiplier')`));
    assert(await js(`$('#content .weapon-damage-note').textContent.includes('Normal attack damage')`));
    await capture('melee');
    await js(`go({type:'journal',arg:'Ash Shortbow'},{detail:null})`);
    assert(await js(`$('#content .journal-stats').textContent.includes('Ranged damage (full draw)15') && $('#content .journal-stats').textContent.includes('Quick-shot damage9')`));
    await capture('ranged');
    for (const [name, text] of [['Bronze Dagger','Stab damage20–50'],['Bronze Warhammer','Crush damage52–81'],['Iron Crossbow','Ranged damage37'],['Magic Longbow','Ranged damage (full draw)118'],["Necromancer's Staff",'Rune damage multiplier5.9×']]) {
      await js(`go({type:'journal',arg:${JSON.stringify(name)}},{detail:null})`);
      assert(await js(`$('#content .journal-stats').textContent.includes(${JSON.stringify(text)})`), name);
    }
    await js(`selectModule('types');showItem('Bronze Sword')`);
    assert(await js(`$('#detail .journal-stats').textContent.includes('Slash damage31–56')`));
    await js(`state.module='crafting';go({type:'facility',arg:E['Ash Shortbow'].recipes[0].facility},{detail:null})`);
    assert(await js(`[...document.querySelectorAll('#content .recipe')].find(r=>r.textContent.includes('Ash Shortbow')).querySelector('.journal-stats.compact').textContent.includes('Ranged damage (full draw)15')`));
    await js(`selectModule('crafting');state.listSel=db.journal.categories.find(c=>c.name==='Weapons').id;go({type:'journal',arg:'Magic Longbow'},{detail:null})`);
    win.setSize(880, 760); await tick();
    assert(await js(`$('#content').scrollWidth<=$('#content').clientWidth+1 && $('#content .journal-stats').scrollWidth<=$('#content .journal-stats').clientWidth+1`));
    await js(`$('#content .journal-stats').scrollIntoView({block:'center'})`);
    await capture('compact');
    await js(`for(const e of Object.values(E).filter(e=>e.category?.startsWith('Equipment / Weapon'))){go({type:'journal',arg:e.name},{detail:null,push:false});if(e.journal.stats.length && !$('#content .journal-stats'))throw Error('Missing stats: '+e.name)}`);
    console.log('PASS: typed melee damage, charged/quick ranged shots, crossbows, rune multiplier, journal/detail/station views, all weapon pages and compact overflow');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});
