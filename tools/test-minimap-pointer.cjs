const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMinimapPointer } = require('../app/minimap-pointer');
function fixture() {
  let tick = null, position = { x: 0, y: 0 }, visible = true;
  const changes = [];
  const win = { isDestroyed: () => false, isVisible: () => visible, getBounds: () => ({ x: 100, y: 200, width: 280, height: 400 }),
    setIgnoreMouseEvents: (ignore, options) => { assert.equal(options.forward, false); changes.push(ignore); } };
  const pointer = createMinimapPointer({ window: () => win, cursor: () => position,
    schedule: fn => { tick = fn; return 1; }, cancel: () => { tick = null; } });
  pointer.setRegions([{ x: 10, y: 10, width: 200, height: 22 },{ x: 220, y: 160, width: 24, height: 24 }]);
  return { pointer, changes, move(x, y) { position = { x, y }; tick?.(); }, tick: () => tick?.(),
    hide() { visible = false; tick?.(); }, polling: () => !!tick };
}
test('game mouse movement stays click-through with no forwarding hook; only controls receive clicks', () => {
  const f = fixture();f.pointer.active(true);
  assert.equal(f.changes.at(-1),true);
  f.move(120,215);assert.equal(f.changes.at(-1),false,'Name bar accepts input');
  f.move(250,300);assert.equal(f.changes.at(-1),true,'The map body remains click-through');
  f.move(330,370);assert.equal(f.changes.at(-1),false,'Zoom control accepts input');
  f.move(500,500);const count=f.changes.length;
  for(let i=0;i<1000;i++)f.tick();
  assert.equal(f.changes.length,count,'Polling does not repeatedly change native window styles');
});
test('drag capture survives leaving the bar and is cleared by hiding or suspension', () => {
  const f=fixture();f.pointer.active(true);f.move(120,215);f.pointer.capture(true);f.move(800,800);
  assert.equal(f.changes.at(-1),false,'Dragging keeps receiving pointer events outside the window');
  f.pointer.capture(false);assert.equal(f.changes.at(-1),true);
  f.pointer.capture(true);f.pointer.active(false);
  assert.equal(f.changes.at(-1),true);assert(!f.polling(),'No cursor polling while hidden');
  f.pointer.active(true);f.hide();assert.equal(f.changes.at(-1),true);
});
test('invalid and hidden-control rectangles cannot capture game clicks', () => {
  const f=fixture();f.pointer.setRegions([{x:NaN,y:0,width:20,height:20},{x:0,y:0,width:-1,height:20}]);f.pointer.active(true);f.move(120,215);
  assert.equal(f.changes.at(-1),true);
  f.pointer.setRegions([{x:10,y:10,width:200,height:22}]);assert.equal(f.changes.at(-1),false);
  f.pointer.setRegions([]);assert.equal(f.changes.at(-1),true);
});
