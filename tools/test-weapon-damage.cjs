const assert = require('assert/strict');
const db = require('../data/db.json');
const { buildWeaponCombat } = require('../importer/weapon-damage');
const stat = (name, label) => db.entities[name].journal.stats.find(s => s.label === label);
assert.deepEqual([stat('Bronze Sword', 'Slash damage').value, stat('Bronze Sword', 'Slash damage').max], [31, 56]);
assert.deepEqual([stat('Bronze Dagger', 'Stab damage').value, stat('Bronze Dagger', 'Stab damage').max], [20, 50]);
assert.deepEqual([stat('Bronze Warhammer', 'Crush damage').value, stat('Bronze Warhammer', 'Crush damage').max], [52, 81]);
assert.equal(stat('Ash Shortbow', 'Ranged damage (full draw)').value, 15);
assert.equal(stat('Ash Shortbow', 'Quick-shot damage').value, 9);
assert.equal(stat('Magic Longbow', 'Ranged damage (full draw)').value, 118);
assert.equal(stat('Iron Crossbow', 'Ranged damage').value, 37);
assert.equal(stat("Necromancer's Staff", 'Rune damage multiplier').value, 5.9);
assert.equal(stat('Stone Club', 'Crush damage').value, 14, 'A missing legacy multiplier must not hide starter weapon damage');
for (const weapon of Object.values(db.entities).filter(e => e.category?.startsWith('Equipment / Weapon') && !e.name.startsWith('[PH]'))) {
  assert(weapon.journal.stats.some(s => /damage/i.test(s.label)), `${weapon.name}: weapon damage missing`);
  assert(!weapon.journal.stats.some(s => s.label === 'Damage multiplier'), `${weapon.name}: legacy multiplier masquerading as damage`);
  assert(weapon.journal.damageNote, `${weapon.name}: missing damage basis explanation`);
}
// Inheritance, cyclic combos, zero damage, and incomplete exports must be handled conservatively.
const base = ref => typeof ref === 'string' ? ref.split('/').pop().split('.')[0] : base(ref?.ObjectPath || '');
const ref = name => ({ ObjectPath: '/Game/' + name + '.0' });
const pkg = (name, props, parent) => [{ Name: `${name}_C`, ...(parent && { SuperStruct: ref(parent) }) }, { Name: `Default__${name}_C`, Properties: props }];
const resolve = buildWeaponCombat({ '/Game/Action.uasset': pkg('Action', { AttackData: ref('A') }),
  '/Game/A.uasset': pkg('A', { DamageAmount: 0, NextAttackClass: ref('B') }),
  '/Game/Parent.uasset': pkg('Parent', { DamageAmount: 20 }),
  '/Game/B.uasset': pkg('B', { NextAttackClass: ref('A') }, 'Parent') }, base);
const item = { bIsAWeapon: true, PowerLevel: 3, DamageMultiplier: 99, AdditionalDamageMultiplier: 0.5,
  PrimaryActionClass: ref('Action'), DamageTypes: ['DamageType.Physical.Slash'] };
const result = resolve(item, () => ({ Tier3: 2.8 }));
assert.deepEqual(result.stats.find(s => s.label === 'Slash damage'), { label: 'Slash damage', value: 0, max: 66, unit: '' });
assert.equal(result.stats.find(s => s.label === 'Attack combo').value, 2);
assert.equal(resolve({ ...item, PrimaryActionClass: ref('Missing') }, () => ({ Tier3: 2.8 })).stats.length, 0);
assert.equal(resolve({ ...item, DamageMultiplier: undefined }, () => null).stats.length, 0);
assert.equal(resolve({}, () => null), null);
console.log('PASS: slash/stab/crush combo ranges, shortbow/longbow/crossbow shots, rune multipliers, all named weapons, current power rows, bonuses, inheritance, cycles, zero and unknown damage');
