// Game map: the app's map covers the game's screen while the game's own map is open and the game has the keyboard,
// and is gone when it closes or you switch away, leaving the app as it was (overlay or window) on the same page.
// Captures test-fixtures/game-map.png.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('game-map'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'overlay', hotkey: 'Control+Shift+L', mapOnM: true }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: require('../package.json').version }));
ipcMain.on('preferences:commit', e => { e.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Game map test timed out'); app.exit(1); }, 60000);
const tick = (ms = 300) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: 100, y: 100, width: 900, height: 640, show: false, webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('Renderer: ' + message); });
  const js = code => win.webContents.executeJavaScript(code);
  let settings = { mode: 'overlay', mapOnM: true };
  const suspended = [];
  const gameMap = require(path.join(target, 'app/game-map.js')).createGameMap({
    window: () => win, settings: () => settings,
    applyMode: () => { win.setAlwaysOnTop(settings.mode === 'overlay', 'screen-saver'); win.setOpacity(settings.mode === 'overlay' ? 0.94 : 1); },
    minimap: { suspend: (on) => suspended.push(on) },
  });
  const applyWindow = () => { win.setAlwaysOnTop(false); win.setOpacity(1); };
  const covering = async () => ({ shown: gameMap.shown(), visible: win.isVisible(), focusable: win.isFocusable(), bounds: win.getBounds(),
    page: await js(`document.body.classList.contains('game-map') && state.module === 'map' && getComputedStyle($('.titlebar')).display === 'none' && getComputedStyle($('#modules')).display === 'none'`) });
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html'));
    await tick(800);
    // Playing near a Nature Spirit spawn with The Wild Hunt and Dragon Slayer tracked, following on in the app's map.
    const me = await js(`(()=>{const m=db.map.markers.find(m=>m.n==='Nature Spirit'&&!m.d);return {ok:true,world:'L_World',x:m.x+2500,y:m.y+1500,z:m.z,yaw:-30}})()`);
    await js(`trackedQuests=[];onQuestLog([{id:ent('The Wild Hunt').id,s:1,o:'HuntBeast'},{id:ent('Dragon Slayer').id,s:1,o:'Find and hunt a deer'}]);
      setTracked('The Wild Hunt',true);setTracked('Dragon Slayer',true);onPlayer(${JSON.stringify(me)});
      selectModule('map');MapView.setFollow(true);selectModule('quests');`);
    // The game screen is where the mouse is: keep it on the main screen whatever the real mouse does meanwhile.
    const main = screen.getPrimaryDisplay().bounds;
    screen.getCursorScreenPoint = () => ({ x: main.x + main.width / 2, y: main.y + main.height / 2 });
    const home = win.getBounds();
    const screenBounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;

    // Opened at a lodestone (E) to teleport, the game's own map stays: the app does not cover it.
    gameMap.follow(false, true);
    gameMap.follow(true, true, true); await tick();
    assert(!gameMap.shown() && suspended.length === 0, 'A lodestone teleport map is left to the game');
    gameMap.follow(false, true);
    // The game's map opens while you play: the app's map covers that screen, with nothing else of the app.
    gameMap.follow(true, true); await tick();
    let now = await covering();
    assert(now.shown && now.visible && now.page, 'Opening the game map shows only the app map: ' + JSON.stringify(now));
    assert.deepEqual(now.bounds, screenBounds, 'It covers the game screen');
    assert(!now.focusable, 'It never takes the keyboard, so M and Esc reach the game');
    assert.deepEqual(suspended, [true], 'The minimap steps aside');

    // It opens clean and still on you, like the game's map: no filter panel, not following, you in the middle.
    const view = await js(`(()=>{const c=$('#map').getBoundingClientRect();const v=MapView.navigation().viewport;return {follow:MapView.isFollowing(),legend:getComputedStyle($('#map-legend')).display,center:v&&{u:v.u,v:v.v},scale:v&&v.scale}})()`);
    assert(!view.follow && view.legend === 'none', 'Clean and still: ' + JSON.stringify(view));
    assert(view.scale >= 0.5, 'Close enough to read');
    // Three quiet things: what to show, your quests, zoom and centre on me.
    const chrome = await js(`(()=>{const shown=s=>{const e=$(s);return !!e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0};
      return {views:[...document.querySelectorAll('.game-map-views [data-view]')].map(b=>b.textContent),
        tools:[...document.querySelectorAll('.map-tools button, .map-tools select')].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none').map(e=>e.id),
        quests:[...document.querySelectorAll('#quest-tracker .tracker-quest')].map(b=>b.querySelector('.tracker-title').textContent),
        lineButtons:document.querySelectorAll('#quest-tracker .tracker-map, #quest-tracker .tracker-remove').length}})()`);
    assert.deepEqual(chrome.views, ['Quests', 'Explore', 'Gather', 'Everything'], 'Four views');
    assert.deepEqual(chrome.tools, ['map-add-waypoint', 'map-zoom-in', 'map-zoom-out', 'map-center'], 'Waypoint placement, zoom and centre on me: ' + chrome.tools);
    assert.deepEqual(chrome.quests, ['The Wild Hunt', 'Dragon Slayer'], 'Your quests, simply');
    assert.equal(chrome.lineButtons, 0, 'No Map or × buttons on the quests');

    // Views are one click: Gather shows resources only, Quests your next steps; Customize opens the full filters.
    await js(`$('.game-map-views [data-view=gather]').click()`);
    assert(await js(`MapView.isEnabled('ore') && MapView.isEnabled('tree') && !MapView.isEnabled('quest') && !MapView.isEnabled('monster') && $('[data-view=gather]').getAttribute('aria-pressed')==='true'`), 'Gather shows resources');
    await js(`$('.game-map-views [data-view=quests]').click()`);
    assert(await js(`MapView.isEnabled('quest') && MapView.isEnabled('travel') && !MapView.isEnabled('ore') && questMapStepMode==='current' && mapViewNow()==='quests'`), 'Quests shows where to go next');
    await js(`$('#game-map-customize').click()`);
    assert(await js(`getComputedStyle($('#map-legend')).display!=='none' && $('#game-map-customize').getAttribute('aria-expanded')==='true'`), 'Customize opens the full filters');
    await js(`$('#map-legend input[type=checkbox]').click()`);
    assert(await js(`mapViewNow()===null && $('#game-map-customize').textContent==='Custom'`), 'Changing a filter by hand shows Custom');
    await js(`$('#game-map-customize').click(); $('.game-map-views [data-view=quests]').click()`);

    // A quest in the list frames where to go; centre on me comes back to you.
    await js(`[...document.querySelectorAll('#quest-tracker .tracker-quest')][0].click()`); await tick();
    assert(await js(`MapView.highlightLabel()==='The Wild Hunt' && state.module==='map' && !state.detail`), 'Clicking a quest frames its targets, nothing else opens');
    await js(`MapView.setHighlight(null); syncMapHighlight(); $('#map-center').click()`); await tick();
    assert.deepEqual(await js(`(()=>{const v=MapView.navigation().viewport;return [Math.round(v.u*1000),Math.round(v.v*1000)]})()`),
      [Math.round(view.center.u * 1000), Math.round(view.center.v * 1000)], 'Centre on me returns to you');
    await tick(200);
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', 'game-map.png'), (await win.webContents.capturePage()).toPNG());
    // A hover card: what it is, what it is for, what a click does.
    const card = await js(`(async()=>{const m=db.map.markers.find(m=>m.n==='Nature Spirit'&&!m.d);MapView.focusMarker(m);await new Promise(r=>setTimeout(r,200));
      const c=$('#map'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
      return [...$('#map-tip').children].map(e=>e.tagName+':'+e.textContent);})()`);
    assert(card[0] === 'STRONG:Nature Spirit' && card.some(l => l.includes('The Wild Hunt')) && card.at(-1) === 'EM:Click for the quest', 'Hover card: ' + card);
    await tick(200);
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', 'game-map-hover.png'), (await win.webContents.capturePage()).toPNG());
    await js(`$('#map').dispatchEvent(new MouseEvent('mouseleave')); MapView.centerOnPlayer(0.5)`);

    // Alt-tab away with the game's map still open: it goes; back in the game it returns.
    gameMap.follow(true, false); await tick();
    now = await covering();
    assert(!now.shown && !now.visible && now.focusable, 'Switching away from the game puts it away');
    assert.deepEqual(now.bounds, home, 'The window goes back where it was');
    assert(!(await js(`document.body.classList.contains('game-map')`)), 'The app layout comes back');
    assert(await js(`MapView.isFollowing() && Preferences.get('mapFollow')==='1'`), 'Following in the app comes back with your page');
    gameMap.follow(true, true); await tick();
    assert(gameMap.shown() && win.isVisible(), 'Back in the game with its map open, it returns');

    // The game's map closes (M or Esc in the game): so does the app's.
    gameMap.follow(false, true); await tick();
    assert(!gameMap.shown() && !win.isVisible(), 'Closing the game map closes it');
    assert.deepEqual(suspended, [true, false, true, false], 'The minimap comes back each time');

    // The app was showing over the game when the game's map opened: closing that map still makes it disappear,
    // and the app is left on your page (also the page it starts on next time), never on its Map section.
    win.showInactive(); await tick();
    gameMap.follow(true, true); await tick();
    assert(await js(`state.module === 'map' && Preferences.json('navigation', {}).module === 'quests'`), 'Covering the game map does not move the app to its map');
    gameMap.follow(false, true); await tick();
    assert(!win.isVisible(), 'Closing the game map hides the app even if it was showing before');
    assert(await js(`state.module === 'quests' && !document.body.classList.contains('game-map') && !document.body.classList.contains('map-mode')`), 'Your page in the app comes back out of sight');
    assert(await js(`Preferences.json('navigation', {}).module === 'quests'`), 'The app still starts where you left it');
    assert.deepEqual(win.getBounds(), home, 'and where it was');

    // While the game reads its map, stray M presses do nothing: only the game's real map counts.
    gameMap.key('M'); await tick();
    assert(!win.isVisible(), 'An M press alone (chat, menus, alt-tabbed) opens nothing');
    // Alt-tabbed when the game's map opens: nothing appears.
    gameMap.follow(true, false); await tick();
    assert(!win.isVisible(), 'Nothing opens over other windows');
    gameMap.follow(false, false);

    // The hotkey puts it away and leaves the game's own map until the game's map next opens.
    gameMap.follow(true, true); await tick();
    assert(gameMap.dismiss() && !win.isVisible(), 'The hotkey shows the game map instead');
    gameMap.follow(true, true); await tick();
    assert(!win.isVisible(), 'It stays away while that map is open');
    gameMap.follow(false, true); gameMap.follow(true, true); await tick();
    assert(gameMap.shown(), 'Next time the game map opens it is back');
    gameMap.follow(false, true); await tick();

    // If the tracker cannot read the game's map, M in the game stands in for it, just as immersive.
    gameMap.follow(null, true);
    gameMap.key('M'); await tick();
    assert(win.isVisible() && gameMap.shown() && (await covering()).page, 'Fallback: M covers the game with the map');
    gameMap.follow(null, true); await tick();
    assert(gameMap.shown(), 'Fallback: it stays while the game keeps the keyboard');
    gameMap.key('M'); await tick();
    assert(!win.isVisible() && !gameMap.shown(), 'Fallback: M again makes it disappear');
    gameMap.key('M'); gameMap.key('Escape'); await tick();
    assert(!win.isVisible(), 'Fallback: Esc makes it disappear');
    assert(await js(`state.module === 'quests'`), 'Fallback: your page is left as it was');

    // As a normal window it is just as immersive, and the window comes back as it was afterwards: open on another
    // screen it returns there; on the game's screen it waits in the taskbar rather than ending up over the game.
    settings = { mode: 'window', mapOnM: true };
    win.showInactive(); applyWindow(); await tick();
    gameMap.follow(false, true);
    gameMap.follow(true, false); await tick();
    assert(!gameMap.shown() && await js(`state.module === 'quests'`), 'Not while alt-tabbed');
    gameMap.follow(true, true); await tick();
    now = await covering();
    assert(now.shown && now.page && !now.focusable && win.isAlwaysOnTop(), 'Window mode covers the game map too: ' + JSON.stringify(now));
    gameMap.follow(false, true); await tick();
    assert(win.isMinimized() && !win.isAlwaysOnTop() && win.isFocusable(), 'On the game screen it waits in the taskbar');
    assert.deepEqual(win.getNormalBounds(), home, 'at its own size and place');
    assert(await js(`state.module === 'quests' && !document.body.classList.contains('game-map')`), 'on your page');
    win.restore(); win.hide(); await tick();
    gameMap.follow(true, true); await tick(); gameMap.follow(false, true); await tick();
    assert(!win.isVisible() && !win.isMinimized(), 'A window that was closed to the tray stays closed');
    const other = screen.getAllDisplays().find(d => d.id !== screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
    if (other) {
      const there = { x: other.workArea.x + 40, y: other.workArea.y + 40, width: 900, height: 640 };
      win.setBounds(there); win.showInactive(); await tick();
      gameMap.follow(true, true); await tick(); gameMap.follow(false, true); await tick();
      assert(win.isVisible() && !win.isMinimized(), 'On another screen it comes back where it was');
      assert.deepEqual(win.getBounds(), there);
      win.setBounds(home);
    }

    // Turned off in Settings, the game's map is left alone.
    settings = { mode: 'overlay', mapOnM: false };
    win.hide(); gameMap.follow(false, true); gameMap.follow(true, true); await tick();
    assert(!win.isVisible(), 'Off means off');
    console.log('PASS: app map covers the game screen only while the game map is open and focused, no keyboard, minimap aside; disappears with the game map even when the app showed before, app page and saved page untouched; alt-tab hides, stray M ignored, hotkey dismisses until next open, immersive M fallback; window mode covers too and returns minimized on the game screen' + (screen.getAllDisplays().length > 1 ? ' or in place on another screen' : '') + '; setting off');
    clearTimeout(timer); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timer); app.exit(1); }
});
