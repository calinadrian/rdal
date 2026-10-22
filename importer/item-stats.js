// Journal-facing values from explicit item properties and their referenced game rows.
// Missing properties stay missing: UObject defaults and combat formulas are not guessed.
function itemStats(p, row, base, combat = {}) {
  const stats = [];
  const add = (label, value, unit = '') => {
    if (typeof value === 'number' && Number.isFinite(value)) stats.push({ label, value, unit });
  };
  add('Power level', p.PowerLevel);
  const fraction = p.ProjectileData?.AdditionalDamageFraction;
  const types = p.ProjectileData?.BaseDamageTypes || [];
  if (Number.isFinite(fraction) && types.includes('DamageType.Ranged.Arrows') && Number.isFinite(combat.arrowMin) && Number.isFinite(combat.arrowMax))
    stats.push({ label: 'Arrow damage', value: Math.round(combat.arrowMin * fraction), max: Math.round(combat.arrowMax * fraction), unit: '', prefix: '+' });
  if (Number.isFinite(fraction) && types.includes('DamageType.Ranged.Bolts')) add('Bolt damage', Number.isFinite(combat.bolt) ? Math.round(combat.bolt * fraction) : null);
  const armour = row(p.WearableEquipmentDataTableRowHandle);
  for (const [key, label] of Object.entries({ Defense: 'Defence', MeleeResistance: 'Melee resistance', RangedResistance: 'Ranged resistance', MagicResistance: 'Magic resistance', MaxVitalShield: 'Vital shield' })) add(label, armour?.[key]);
  const weapon = combat.weaponDamage?.(p, row);
  if (weapon) stats.push(...weapon.stats);
  else add('Damage multiplier', p.DamageMultiplier, '×');
  add('Block', p.BlockingDamageNegation, '%');
  add('Critical chance bonus', p.CriticalHitChanceIncrease == null ? null : p.CriticalHitChanceIncrease * 100, '%');
  add('Durability', p.BaseDurability);
  for (const [handle, key, label] of [
    ['SustenanceRowHandle', 'Sustenance', 'Sustenance'], ['HydrationRowHandle', 'Hydration', 'Hydration'],
    ['VitalShieldRowHandle', 'VitalShield', 'Vital shield'], ['EnduranceRowHandle', 'ValueToAdd', 'Rest endurance'],
    ['ToxicityRowHandle', 'Toxicity', 'Toxicity'], ['WitherRowHandle', 'Wither', 'Wither'],
  ]) add(label, row(p[handle])?.[key]);
  return { stats, skill: p.AssociatedSkill ? base(p.AssociatedSkill)?.replace(/^SKILL_/, '') : null,
    damageTypes: weapon?.types || (p.DamageTypes || []).map(t => t.split('.').pop()),
    ...(weapon?.note && { damageNote: weapon.note }),
    armourWeight: p.ArmorWeight?.split('::').pop() || null };
}
module.exports = { itemStats };
