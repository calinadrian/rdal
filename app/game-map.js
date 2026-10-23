// The app's map follows the game's own map: the tracker reads whether it is open (with M or from the in-game
// menu) and whether the game has the keyboard. As an overlay the app stands in for it: it covers the game's screen
// while the game's map is open and the game has the keyboard, and goes away when that map closes or you switch
// away from the game, so nothing pops up while you are alt-tabbed. It never takes the keyboard, so M and Esc still
// reach the game; the mouse pans, zooms and hovers as usual. The show/hide hotkey puts it away until the game's map
// next opens. As a normal window it just switches to the map when the game's map opens.
const electron = require('electron');

// window() is the main window, settings() the current settings; reveal and applyMode come from main.js.
function createGameMap({ window, settings, reveal, applyMode, minimap }) {
  let open = null;        // the game's map is open; null while the tracker cannot tell (M presses stand in)
  let shown = false;      // the overlay is covering the game's map
  let dismissed = false;  // put away with the hotkey while the game's map stayed open
  let before = null;      // where the window was and whether it showed, to put it back
  let byKey = false;      // shown by an M press (without a reading of the game's map)
  const overlay = () => settings().mode === 'overlay';

  function follow(next, focused) {
    const win = window(), opened = next && !open;
    open = next;
    if (!next) dismissed = false;
    if (shown && (!settings().mapOnM || !overlay())) hide();
    if (!settings().mapOnM) return;
    if (!overlay()) {
      if (opened && focused) {
        if (!win.isVisible() || win.isMinimized()) reveal({ focus: false });
        win.webContents.send('show-map');
      }
      return;
    }
    const want = !!next && focused && !dismissed;
    if (want && !shown) show();
    else if (!want && shown) hide();
  }

  function show() {
    const win = window();
    shown = true;
    before = { bounds: win.getBounds(), maximized: win.isMaximized(), visible: win.isVisible() && !win.isMinimized() };
    // The screen the game is on: where the mouse is while you play.
    const display = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint());
    if (before.maximized) win.unmaximize();
    win.setFocusable(false);
    win.setBounds(display.bounds);
    win.setOpacity(1);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.send('game-map', true);
    win.showInactive();
    minimap?.suspend(true);
  }

  function hide() {
    const win = window();
    if (!before.visible) win.hide();
    win.webContents.send('game-map', false);
    win.setBounds(before.bounds);
    if (before.maximized) win.maximize();
    win.setFocusable(true);
    applyMode();
    minimap?.suspend(false);
    shown = false;
  }

  // Without a reading of the game's map, M in the game switches to the map without stealing focus. The overlay
  // also pops up and away with M and Esc; the window just stays where it is.
  function key(k) {
    const win = window();
    if (!settings().mapOnM || open !== null) return;
    if (!overlay()) {
      if (k === 'M') {
        if (!win.isVisible() || win.isMinimized()) reveal({ focus: false });
        win.webContents.send('show-map');
      }
      return;
    }
    if (k === 'M') {
      if (win.isVisible() && byKey) { win.hide(); byKey = false; return; }
      reveal({ focus: false });
      win.webContents.send('show-map');
      byKey = true;
    } else if (k === 'Escape' && byKey) {
      win.hide();
      byKey = false;
    }
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
