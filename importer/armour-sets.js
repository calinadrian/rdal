// Named outfit families come from the game's Head/Body/Legs asset identifiers.
// Weight-class bonuses are separate from the combined item stats.
function buildArmourSets(entities, effects, { text }) {
  const families = new Map();
  for (const e of Object.values(entities)) {
    if (!e.journal?.id || e.journal.category !== 'Armour & Shields') continue;
    const match = /^ITEM_Armour_(?:T\d+_)?(Head|Body|Legs)_(.+)$/.exec(e.id || '');
    if (!match) continue;
    const family = match[2].replace(/Med$/, '').replace(/^ObsidianHelmet$/, 'Obsidian').replace(/^DragonArmour$/, 'Dragon').toLowerCase();
    const group = families.get(family) || { id: family, slots: { Head: [], Body: [], Legs: [] } };
    group.slots[match[1]].push(e.name); families.set(family, group);
  }
  const bonuses = { Light: [], Medium: [], Heavy: [] };
  for (const e of Object.values(effects).flat()) {
    const match = /^Default__GE_(Light|Medium|Heavy)ArmorSetT(\d)/.exec(e.Name || '');
    const data = e.Properties?.Data;
    if (!match || !Number.isFinite(data?.AmountToModify?.Value)) continue;
    bonuses[match[1]].push({ tier: +match[2], label: text(data.OverrideTooltipStatName) || text(e.Properties.Name),
      value: +(data.AmountToModify.Value * (data.StatValueType?.includes('Percent') ? 100 : 1)).toFixed(3),
      unit: data.StatValueType?.includes('Percent') ? '%' : '', duration: data.Duration ?? null });
  }
  const sets = [];
  for (const family of families.values()) {
    if (Object.values(family.slots).filter(names => names.length).length < 2) continue;
    for (const names of Object.values(family.slots)) names.sort((a,b) => Number(/Med Helm/.test(a)) - Number(/Med Helm/.test(b)) || a.localeCompare(b));
    const items = Object.values(family.slots).flat();
    const defaults = Object.values(family.slots).filter(a => a.length).map(a => entities[a[0]]);
    const words = defaults.map(e => e.name.replace(/['’]s\b/g, '').split(' '));
    const prefix = [];
    for (let i=0; i<words[0].length && words.every(w => w[i] === words[0][i]); i++) prefix.push(words[0][i]);
    const name = prefix.join(' ') || defaults.find(e => family.slots.Body.includes(e.name))?.name || items[0];
    const classes = [...new Set(defaults.map(e => e.journal.armourWeight).filter(Boolean))];
    const weightClass = classes.length === 1 && defaults.every(e => e.journal.armourWeight === classes[0]) ? classes[0] : null;
    const set = { ...family, name: `${name} set`, weightClass, bonuses: (bonuses[weightClass] || []).sort((a,b) => a.tier-b.tier) };
    sets.push(set);
    for (const n of items) entities[n].armourSet = set.id;
  }
  return sets.sort((a,b) => a.name.localeCompare(b.name));
}
module.exports = { buildArmourSets };
