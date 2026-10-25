// Keep an explicitly opened overlay with the game, and remember it across Alt-Tab.
function createOverlay({ window, settings, gameMap, handoff, cancelHandoff }) {
  let wanted = false, parked = false, switching = false;
  let context = { game: false, atlas: false };
  let applied = null;
  const overlay = () => settings().mode === 'overlay';
  function applyMode({ force = false } = {}) {
    const win = window();
    if (!win || win.isDestroyed()) return;
    const next = { win, top: overlay() && !parked && (context.game || win.isFocused()),
      opacity: overlay() ? settings().opacity : 1, skip: overlay() };
    // Player samples arrive several times a second; native window styles only change on a real transition.
    if (force || applied?.win !== win || applied.top !== next.top) win.setAlwaysOnTop(next.top, 'screen-saver');
    if (force || applied?.win !== win || applied.opacity !== next.opacity) win.setOpacity(next.opacity);
    if (force || applied?.win !== win || applied.skip !== next.skip) win.setSkipTaskbar(next.skip);
    applied = next;
  }
  function reveal({ focus = true } = {}) {
    cancelHandoff();
    switching = false; wanted = true; parked = false;
    const win = window();
    if (win.isMinimized()) win.restore();
    focus ? win.show() : win.showInactive();
    if (focus) { win.focus(); win.webContents.send('shown'); }
    applyMode();
    // Automatic startup never leaves an overlay over an unrelated application.
    if (!focus && overlay() && !context.game && !win.isFocused()) { parked = true; win.hide(); }
  }
  function conceal() {
    cancelHandoff();
    switching = false; wanted = false; parked = false;
    handoff();
    overlay() ? window().hide() : window().minimize();
  }
  function toggle() {
    if (switching) {
      // Finish the already requested map-closing keypress, but discard its reveal callback.
      switching = false; wanted = false; parked = false;
      overlay() ? window().hide() : window().minimize();
      return;
    }
    if (gameMap.dismiss()) {
      wanted = true; parked = false; switching = true;
      handoff({ closeMap: true, complete: () => {
        if (!switching || !wanted) return;
        if (overlay() && !context.game && !context.atlas && !window().isFocused()) {
          switching = false; parked = true; applyMode();
        } else reveal();
      } });
      return;
    }
    const win = window();
    if (win.isVisible() && !win.isMinimized() && (overlay() || win.isFocused())) conceal();
    else reveal();
  }
  function follow(next) {
    context = next;
    const win = window();
    if (!win || win.isDestroyed()) return;
    if (gameMap.shown()) { wanted = false; parked = false; return; }
    if (overlay() && wanted && !switching) {
      if (!next.game && !next.atlas && !win.isFocused() && !parked) {
        parked = true;
        win.hide();
      } else if (next.game && parked) {
        parked = false; win.showInactive();
      }
    }
    applyMode();
  }
  return { applyMode, reveal, conceal, toggle, follow };
}
module.exports = { createOverlay };
