const assert = require('assert/strict');
const { auditAvailability } = require('./item-availability');
const db = require('../data/db.json');
const audit = require('../data/item-availability-audit.json');
const items = Object.values(db.entities).filter(e => e.kind === 'item');
assert.equal(audit.items.length, items.length, 'Every imported item must be audited');
assert.equal(new Set(audit.items.map(e => e.id)).size, items.length);
for (const n of ['Wooden Club','Wooden Arrow','Fang Fire Arrow','Fang Barbed Arrow']) {
  assert.equal(db.entities[n].availability.status, 'unavailable');
  assert(db.entities[n].recipes.every(r => r.availability.status === 'unavailable'));
}
for (const n of ['Staff of Light','Dragonblight Shield','Dragon Platebody','Infinity Cloth','Padded Cloth']) {
  assert.notEqual(db.entities[n].availability.status, 'unavailable', n);
}
const orphan = { name:'Unknown source',id:'ITEM_Unknown',kind:'item',recipes:[],droppedBy:[],location:[] };
auditAvailability({orphan},[]);
assert.equal(orphan.availability.status,'unconfirmed','Missing acquisition data must never mean unavailable');
for (const e of items.filter(e => e.availability.status === 'unavailable')) {
  assert(e.availability.reason && e.availability.source && e.availability.reviewedAt);
}
console.log(`PASS: ${items.length} item audit, unavailable evidence, loot-only/quest/material preservation and unknown-source distinction`);
