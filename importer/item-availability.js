// Availability is separate from character recipe progress. Missing source data
// is not evidence that an item is unobtainable.
const reviewedAt = '2026-10-22';
const wiki = page => `https://dragonwilds.runescape.wiki/w/${page}`;
const unavailable = {
  ITEM_Club_Wood: ['Unused item retained in the game files; not obtainable in the live game.', 'Wooden_Club'],
  ITEM_Ammo_Arrows_Wood: ['Deprecated arrow from an old spell prototype; not obtainable in the live game.', 'Wooden_Arrow'],
  ITEM_Ammo_Arrows_Bone_Fire: ['Unused Fang Fire Arrow variant; not obtainable in the live game.', 'Fang_Fire_Arrow'],
  ITEM_Ammo_Arrows_Bone_Bleed: ['Unused Fang Barbed Arrow variant; not craftable or obtainable in the live game.', 'Fang_Barbed_Arrow'],
};

function auditAvailability(entities, markers) {
  const mapped = new Set(markers.flatMap(m => [m.ref, m.n]).filter(Boolean));
  const report = [];
  for (const e of Object.values(entities).filter(e => e.kind === 'item')) {
    let decision = unavailable[e.id];
    if (/\(Expired\)/.test(e.name) && /inert|no longer functional/i.test(e.desc || '')) {
      decision = ['Retired healing potion. New potions can no longer be made; existing copies may remain in older inventories. Refund-pack versions reclaim their original materials.',
        'https://dragonwilds.runescape.com/de/news/health-and-wardstones'];
    }
    if (/Wardstone \(Inactive\)/.test(e.name) && /no longer functional/i.test(e.desc || '')) {
      decision = ['Retired wardstone. Wardstones were removed from progression; existing inactive copies can be consumed to reclaim their crafting materials.',
        'https://dragonwilds.runescape.com/de/news/health-and-wardstones'];
    }
    const evidence = [];
    if (e.recipes.some(r => r.facility !== 'Build menu / other')) evidence.push('station-or-vendor');
    if (e.acquisition?.length) evidence.push('acquisition-record');
    if (e.droppedBy.length) evidence.push('loot-table');
    if (e.location.length || mapped.has(e.name)) evidence.push('world-location');
    e.availability = decision
      ? { status: 'unavailable', reason: decision[0], source: decision[1].startsWith('https://') ? decision[1] : wiki(decision[1]), reviewedAt }
      : { status: evidence.length ? 'source-recorded' : 'unconfirmed' };
    for (const r of e.recipes) {
      if (decision) r.availability = e.availability;
      // An orphan recipe is not necessarily unusable: station upgrades and
      // quest scripts may expose it. Keep this uncertainty explicit.
      if (r.facility === 'Build menu / other') r.stationUnconfirmed = true;
    }
    report.push({ name: e.name, id: e.id, ...e.availability, evidence,
      unassignedRecipes: e.recipes.filter(r => r.stationUnconfirmed).map(r => r.id) });
  }
  return { reviewedAt, total: report.length,
    counts: Object.fromEntries(['unavailable', 'source-recorded', 'unconfirmed'].map(s => [s, report.filter(e => e.status === s).length])),
    items: report };
}
module.exports = { auditAvailability };
