// Resolve the normal attack chain referenced by an item, not every attack of its weapon family.
// Special, sprint and visceral attacks are intentionally outside the base damage preview.
function buildWeaponCombat(bulk, base) {
  const packages = new Map(Object.entries(bulk).map(([name, exports]) => [base(name), exports]));
  const cache = new Map();
  function defaults(ref, seen = new Set()) {
    const id = typeof ref === 'string' ? ref : base(ref);
    if (!id || seen.has(id)) return null;
    if (cache.has(id)) return cache.get(id);
    const exports = packages.get(id);
    if (!exports) return null;
    const source = exports.find(e => e.Name === `Default__${id}_C`);
    if (!source) return null;
    const cls = exports.find(e => e.Name === `${id}_C`);
    const parent = defaults(cls?.SuperStruct || cls?.Super || cls?.Properties?.Super, new Set([...seen, id]));
    const value = { ...parent, ...source.Properties };
    cache.set(id, value);
    return value;
  }
  function attackChain(ref) {
    const seen = new Set(), hits = [];
    while (ref) {
      const id = base(ref);
      if (!id || seen.has(id)) break;
      seen.add(id);
      const attack = defaults(ref);
      if (!Number.isFinite(attack?.DamageAmount)) return [];
      hits.push(attack.DamageAmount);
      ref = attack.NextAttackClass;
    }
    return hits;
  }
  return function weaponDamage(p, row) {
    const category = p.Category?.TagName || '';
    if (!category.startsWith('Item.Equipment.Weapon.') && !p.bIsAWeapon) return null;
    // Current power-level rows also support items whose old DamageMultiplier field is absent.
    // Explicit legacy multipliers are only a fallback when a current row is unavailable.
    const power = row(p.BaseHeldEquipmentPowerLevelRowHandle)?.[`Tier${p.PowerLevel}`];
    const multiplier = Number.isFinite(power) ? power + (p.AdditionalDamageMultiplier ?? 0) : p.DamageMultiplier;
    const types = (p.DamageTypes || []).map(t => t.split('.').pop());
    const stats = [];
    if (!Number.isFinite(multiplier)) return { stats, types, note: 'Base weapon damage is not confirmed in the extracted game data.' };
    const addDamage = (label, hits) => {
      if (!hits.length) return;
      const values = hits.map(d => Math.round(d * multiplier));
      const min = Math.min(...values), max = Math.max(...values);
      stats.push({ label, value: min, ...(max !== min && { max }), unit: '' });
    };
    if (p.MagicAttackCollection || /\.(Staff|Wand)$/.test(category)) {
      stats.push({ label: 'Rune damage multiplier', value: multiplier, unit: '×' });
      return { stats, types: types.length ? types : ['Magic'], note: 'Magic damage depends on the equipped rune and spell. This is the weapon’s rune damage multiplier.' };
    }
    if (p.RangedAttackCollection) {
      const collection = defaults(p.RangedAttackCollection);
      const full = defaults(collection?.FullAttackData)?.DamageAmount;
      const quick = defaults(collection?.QuickAttackData)?.DamageAmount;
      if (Number.isFinite(full)) addDamage('Ranged damage (full draw)', [full]);
      if (Number.isFinite(quick)) addDamage(Number.isFinite(full) ? 'Quick-shot damage' : 'Ranged damage', [quick]);
      return { stats, types: types.length ? types : ['Ranged'], note: stats.length
        ? 'Base weapon damage before ammunition, skills, critical hits and target resistances.' + (Number.isFinite(full) && Number.isFinite(quick) ? ' Full draw and quick shots are shown separately.' : '')
        : 'Ranged attack damage is not confirmed in the extracted game data.' };
    }
    const hits = attackChain(defaults(p.PrimaryActionClass)?.AttackData);
    addDamage(types.length === 1 ? `${types[0]} damage` : 'Base damage', hits);
    if (hits.length > 1) stats.push({ label: 'Attack combo', value: hits.length, unit: ' hits' });
    return { stats, types, note: hits.length
      ? 'Normal attack damage across the weapon’s combo, before skills, critical hits and target resistances. Special attacks can differ.'
      : 'Normal attack damage is not confirmed in the extracted game data.' };
  };
}
module.exports = { buildWeaponCombat };
