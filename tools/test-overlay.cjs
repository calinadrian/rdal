const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOverlay } = require('../app/overlay');
function fixture(mode = 'overlay') {
  const win = { visible: false, focused: false, minimized: false, top: false, styleCalls: 0,
    isDestroyed: () => false, isVisible() { return this.visible; }, isFocused() { return this.focused; }, isMinimized() { return this.minimized; },
    show() { this.visible = true; }, showInactive() { this.visible = true; }, hide() { this.visible = false; this.focused = false; },
    focus() { this.focused = true; }, restore() { this.minimized = false; }, minimize() { this.minimized = true; this.focused = false; },
    setAlwaysOnTop(on) { this.styleCalls++; this.top = on; }, setOpacity() { this.styleCalls++; }, setSkipTaskbar() { this.styleCalls++; }, webContents: { send() {} } };
  const map = { visible: false, open: false, dismissed: false, shown() { return this.visible; },
    dismiss() { if (!this.visible && (!this.open || this.dismissed)) return false; this.visible = false; this.dismissed = true; win.hide(); return true; } };
  const handoffs = [];
  const host = createOverlay({ window: () => win, settings: () => ({ mode, opacity: .94 }), gameMap: map,
    handoff: options => handoffs.push(options || {}), cancelHandoff() {} });
  const follow = (game, atlas = false) => { win.focused = atlas; host.follow({ game, atlas }); };
  return { host, win, map, handoffs, follow };
}
test('overlay parks on Alt-Tab, returns over the game, and stays closed after an explicit hide', () => {
  const { host, win, follow, handoffs } = fixture();
  follow(true); host.reveal(); assert(win.visible && win.top);
  follow(false); assert(!win.visible && !win.top);
  follow(true); assert(win.visible && win.top && !win.focused);
  host.toggle(); assert(!win.visible && handoffs.length === 1, 'A second shortcut closes even when the game has focus');
  follow(false); follow(true); assert(!win.visible, 'Explicitly closed overlays stay closed');
});
test('switching from the map closes the native map before revealing the ordinary overlay', () => {
  const { host, win, map, handoffs, follow } = fixture();
  follow(true); map.open = map.visible = true; win.visible = true;
  host.toggle(); assert(!win.visible && handoffs[0].closeMap);
  handoffs[0].complete(); assert(win.visible && win.focused && win.top && !map.visible);
  host.toggle(); assert(!win.visible && handoffs.length === 2 && !handoffs[1].closeMap, 'Closing the overlay never reopens or toggles the game map');
});
test('a second shortcut cancels an unfinished map handoff', () => {
  const { host, win, map, handoffs, follow } = fixture();
  follow(true); map.open = map.visible = true;
  host.toggle(); host.toggle(); handoffs[0].complete();
  assert(!win.visible, 'A late helper callback cannot reopen a closed overlay');
});
test('Alt-Tab during a map handoff keeps the overlay parked until the game returns', () => {
  const { host, win, map, handoffs, follow } = fixture();
  follow(true); map.open = map.visible = true; host.toggle();
  follow(false); handoffs[0].complete(); assert(!win.visible && !win.top);
  follow(true); assert(win.visible && win.top && !win.focused);
});
test('automatic overlay startup waits for the game; window mode remains an ordinary window', () => {
  const f = fixture(); f.host.reveal({ focus: false }); assert(!f.win.visible && !f.win.top);
  f.follow(true); assert(f.win.visible && f.win.top);
  const normal = fixture('window'); normal.host.reveal(); normal.follow(false);
  assert(normal.win.visible && !normal.win.top);
});
test('unchanged player/focus samples never rewrite native window styles', () => {
  const { host, win, follow } = fixture();
  follow(true);host.reveal();
  const applied = win.styleCalls;
  for(let i=0;i<1000;i++)follow(true,true);
  assert.equal(win.styleCalls,applied);
  follow(false);const parked = win.styleCalls;
  for(let i=0;i<1000;i++)follow(false);
  assert.equal(win.styleCalls,parked);
  host.applyMode({force:true});
  assert.equal(win.styleCalls,parked+3,'Leaving the fullscreen map can explicitly restore externally changed styles');
});
