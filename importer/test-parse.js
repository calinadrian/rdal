// Sanity checks for the parser against saved wiki pages.
// Usage: node importer/test-parse.js <dir with Goblin_Warrior.txt, Bronze_bar.txt, Monsters.txt>
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parsePage, parseZones, fromFullPage } = require('./parse');

const dir = process.argv[2] || path.join(__dirname, '..', 'test-fixtures');
const load = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const goblin = parsePage(fromFullPage(load('Goblin_Warrior.txt')));
assert.strictEqual(goblin.kind, 'monster');
assert.deepStrictEqual(goblin.drops.map((d) => [d.page, d.rarity, d.group]), [
  ['Goblin Pack', 'Always', '100%'],
  ['A Cruel Goblin Blade', '2/100', 'Other'],
]);
assert.strictEqual(goblin.drops[1].pct, 2);
assert.ok(goblin.location.includes('Bramblemead Valley'), goblin.location);

const bar = parsePage(fromFullPage(load('Bronze_bar.txt')));
assert.strictEqual(bar.kind, 'item');
assert.strictEqual(bar.type, 'Basic Item');
assert.strictEqual(bar.recipes.length, 3);
assert.deepStrictEqual(bar.recipes[0], {
  variant: 'Furnace', facility: 'Furnace', skills: [{ skill: 'Artisan', xp: 5 }],
  materials: [
    { name: 'Copper Ore', page: 'Copper Ore', icon: bar.recipes[0].materials[0].icon, qty: 3 },
    { name: 'Tin Ore', page: 'Tin Ore', icon: bar.recipes[0].materials[1].icon, qty: 3 },
  ],
  outputs: [{ name: 'Bronze Bar', page: 'Bronze Bar', icon: bar.recipes[0].outputs[0].icon, qty: 2 }],
});
assert.strictEqual(bar.sources[0].page, 'Metal Salvage');
assert.ok(bar.image && bar.image.startsWith('https://dragonwilds.runescape.wiki/images/'), bar.image);

const zones = parseZones(load('Monsters.txt'));
assert.ok(zones.length >= 8, zones.map((z) => z.name));
assert.strictEqual(zones[0].name, 'Temple Woods');
assert.ok(zones[1].monsters.some((m) => m.page.toLowerCase() === 'goblin warrior'));

console.log('parse OK:', zones.length, 'zones;', JSON.stringify(goblin.drops[1]));
