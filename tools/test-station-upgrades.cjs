const assert = require('assert/strict');
const db = require('../data/db.json');
const fine = db.entities['Fine Cloth'].recipes;
assert.equal(fine.length, 1);
assert.equal(fine[0].facility, 'Loom');
assert.equal(fine[0].stationUpgrade.name, 'Loom Harness');
assert(!fine[0].stationUnconfirmed);
assert.deepEqual(fine[0].materials, [{item:'Fine Thread',qty:3},{item:'Gold Bar',qty:1}]);
assert.deepEqual(fine[0].outputs, [{item:'Fine Cloth',qty:1}]);
assert.equal(fine[0].stationUpgrade.materials.find(m=>m.item==='Iron Bar').qty, 4);
for (const name of ['Padded Cloth','Fine Cloth','Desert Cloth','Infinity Cloth']) {
  assert(db.entities[name].recipes.some(r=>r.facility==='Loom' && r.stationUpgrade?.name==='Loom Harness' && !r.stationUnconfirmed), name);
}
assert(db.entities['Fine Thread'].usedIn.some(r=>r.item==='Fine Cloth' && r.facility==='Loom'));
assert(db.entities['Rough Cloth'].recipes.some(r=>r.facility==='Loom'&&!r.stationUpgrade), 'Basic loom recipes do not require its upgrade');
console.log('PASS: game-linked loom upgrade, exact Fine Cloth recipe, upgrade build materials, related cloths, reverse sources and unupgraded loom recipes');
