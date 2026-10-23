// Game map: as an overlay the app's map covers the game's screen while the game's own map is open and the game has
// the keyboard, and goes away when it closes or you switch away. Captures test-fixtures/game-map.png.
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
    reveal: () => win.showInactive(), applyMode: () => win.setOpacity(settings.mode === 'overlay' ? 0.94 : 1),
    minimap: { suspend: (on) => suspended.push(on) },
  });
  const covering = async () => ({ shown: gameMap.shown(), visible: win.isVisible(), focusable: win.isFocusable(), bounds: win.getBounds(),
    page: await js(`document.body.classList.contains('game-map') && state.module === 'map' && getComputedStyle($('.titlebar')).display === 'none' && getComputedStyle($('#modules')).display === 'none'`) });
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html'));
    await tick(800);
    await js(`selectModule('quests')`);
    const home = win.getBounds();
    const screenBounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;

    // The game's map opens while you play: the app's map covers that screen, with nothing else of the app.
    gameMap.follow(false, true);
    gameMap.follow(true, true); await tick();
    let now = await covering();
    assert(now.shown && now.visible && now.page, 'Opening the game map shows only the app map: ' + JSON.stringify(now));
    assert.deepEqual(now.bounds, screenBounds, 'It covers the game screen');
    assert(!now.focusable, 'It never takes the keyboard, so M and Esc reach the game');
    assert.deepEqual(suspended, [true], 'The minimap steps aside');
    await tick(200);
    if (!process.env.ATLAS_NO_CAPTURES) fs.writeFileSync(path.join(root, 'test-fixtures', 'game-map.png'), (await win.webContents.capturePage()).toPNG());

    // Alt-tab away with the game's map still open: it goes; back in the game it returns.
    gameMap.follow(true, false); await tick();
    now = await covering();
    assert(!now.shown && !now.visible && now.focusable, 'Switching away from the game puts it away');
    assert.deepEqual(now.bounds, home, 'The window goes back where it was');
    assert(!(await js(`document.body.classList.contains('game-map')`)), 'The app layout comes back');
    gameMap.follow(true, true); await tick();
    assert(gameMap.shown() && win.isVisible(), 'Back in the game with its map open, it returns');

    // The game's map closes (M or Esc in the game): so does the app's.
    gameMap.follow(false, true); await tick();
    assert(!gameMap.shown() && !win.isVisible(), 'Closing the game map closes it');
    assert.deepEqual(suspended, [true, false, true, false], 'The minimap comes back each time');

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

    // If the tracker cannot read the game's map, M in the game stands in for it.
    gameMap.follow(null, true);
    gameMap.key('M'); await tick();
    assert(win.isVisible() && !gameMap.shown(), 'Fallback: M shows the overlay');
    gameMap.key('Escape'); await tick();
    assert(!win.isVisible(), 'Fallback: Esc hides it');

    // As a normal window it only switches to its map, once per opening of the game's map, and only in the game.
    settings = { mode: 'window', mapOnM: true };
    await js(`selectModule('quests')`);
    gameMap.follow(false, true);
    gameMap.follow(true, false); await tick();
    assert(await js(`state.module === 'quests'`), 'Not while alt-tabbed');
    gameMap.follow(false, true); gameMap.follow(true, true); await tick();
    assert(await js(`state.module === 'map' && !document.body.classList.contains('game-map')`) && win.isVisible() && win.isFocusable(), 'The window switches to its map');
    assert.deepEqual(win.getBounds(), home, 'and stays where it is');

    // Turned off in Settings, the game's map is left alone.
    settings = { mode: 'overlay', mapOnM: false };
    win.hide(); gameMap.follow(false, true); gameMap.follow(true, true); await tick();
    assert(!win.isVisible(), 'Off means off');
    console.log('PASS: overlay map covers the game screen only while the game map is open and focused, no keyboard, minimap aside, restored after; alt-tab hides, stray M ignored, hotkey dismisses until next open, M fallback, window mode, setting off');
    clearTimeout(timer); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timer); app.exit(1); }
});
