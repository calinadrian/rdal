// The app's map stands in for the game's own map: the tracker reads whether it is open (with M or from the in-game
// menu) and whether the game has the keyboard. While the game's map is open and the game has the keyboard, the
// app covers the game's screen with just its map; it is gone as soon as that map closes or you switch away from
// the game, so nothing pops up while you are alt-tabbed. It never takes the keyboard, so M and Esc still reach the
// game; the mouse pans, zooms and hovers as usual. Afterwards the app is put back as it was, on the page you had
// open: an overlay hides again, and a normal window returns to where it stood (or waits in the taskbar when it
// stood on the game's screen, so it never ends up over the game). The show/hide hotkey puts the map away until the
// game's map next opens. A map opened at a lodestone to teleport is always left to the game.
const electron = require('electron');

// window() is the main window, settings() the current settings; applyMode comes from main.js.
function createGameMap({ window, settings, applyMode, minimap }) {
  let open = null;        // the game's map is open; null while the tracker cannot tell (M presses stand in)
  let shown = false;      // the app's map is covering the game's
  let dismissed = false;  // put away with the hotkey while the game's map stayed open
  let before = null;      // how the window was, to put it back
  let remaximize = null;  // maximizes it again the next time it shows
  const overlay = () => settings().mode === 'overlay';

  // teleport: the game's map was opened at a lodestone (E) to pick where to go, so the game's own map stays.
  function follow(next, focused, teleport = false) {
    if (teleport) next = false;
    open = next;
    if (!next) dismissed = false;
    if (!settings().mapOnM) { if (shown) hide(); return; }
    if (next === null) { if (shown && !focused) hide(); return; } // M presses decide (key)
    const want = next && focused && !dismissed;
    if (want && !shown) show();
    else if (!want && shown) hide();
  }

  function show() {
    const win = window();
    shown = true;
    if (remaximize) win.removeListener('show', remaximize);
    // The screen the game is on: where the mouse is while you play.
    const display = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint());
    const bounds = win.getNormalBounds();
    before = { bounds, maximized: win.isMaximized(), state: !win.isVisible() ? 'hidden' : win.isMinimized() ? 'minimized' : 'shown',
      onGameScreen: electron.screen.getDisplayMatching(bounds).id === display.id };
    if (before.maximized) win.unmaximize();
    win.setFocusable(false);
    win.setBounds(display.bounds);
    win.setOpacity(1);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.send('game-map', true);
    win.showInactive();
    minimap?.suspend(true);
  }

  // Hidden first and put back out of sight, so the app's own layout never flashes over the game.
  function hide() {
    const win = window();
    win.hide();
    win.webContents.send('game-map', false);
    win.setBounds(before.bounds);
    win.setFocusable(true);
    applyMode();
    if (before.maximized) win.once('show', remaximize = () => { remaximize = null; win.maximize(); });
    if (!overlay() && before.state !== 'hidden') {
      if (before.state === 'shown' && !before.onGameScreen) win.showInactive();
      else win.minimize();
    }
    minimap?.suspend(false);
    shown = false;
  }

  // Without a reading of the game's map, M pressed in the game stands in for it: the map comes and goes with M
  // (and goes with Esc).
  function key(k) {
    if (!settings().mapOnM || open !== null) return;
    if (k === 'M') shown ? hide() : show();
    else if (k === 'Escape' && shown) hide();
  }

  // The hotkey while it covers the game's map: back to the game's own map until it next opens.
  function dismiss() {
    if (!shown) return false;
    dismissed = true;
    hide();
    return true;
  }

  return { follow, key, dismiss, shown: () => shown };
}

module.exports = { createGameMap };
