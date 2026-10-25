// Check only our own controls. Electron's forward:true installs a global low-level mouse hook on Windows.
function createMinimapPointer({ window, cursor, schedule = setInterval, cancel = clearInterval }) {
  let regions = [], held = false, timer = null, lastWindow = null, ignored = null;
  function ignore(on) {
    const win = window();
    if (!win || win.isDestroyed()) return;
    if (win !== lastWindow || ignored !== on) {
      win.setIgnoreMouseEvents(on, { forward: false });
      lastWindow = win; ignored = on;
    }
  }
  function refresh() {
    const win = window();
    if (!win || win.isDestroyed() || !win.isVisible()) { held = false; ignore(true); return; }
    const point = cursor(), bounds = win.getBounds();
    const x = point.x - bounds.x, y = point.y - bounds.y;
    ignore(!(held || regions.some(r => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height)));
  }
  function active(on) {
    if (timer !== null) { cancel(timer); timer = null; }
    if (!on) { held = false; ignore(true); return; }
    refresh();
    timer = schedule(refresh, 16);
    timer?.unref?.();
  }
  function setRegions(next) {
    regions = (Array.isArray(next) ? next : []).filter(r => r && ['x','y','width','height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0).slice(0, 8);
    if (timer !== null) refresh();
  }
  function capture(on) { held = !!on; refresh(); }
  return { active, setRegions, capture };
}
module.exports = { createMinimapPointer };
