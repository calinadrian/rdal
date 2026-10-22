// Upgrade components expose recipes missing from the base processing-station table.
function stationUpgradeRecipes(bulk, { base, text, item }) {
  const pieces = Object.values(bulk).flat().filter(e => e.Type === 'BuildingPieceData');
  const byActor = new Map(pieces.map(e => [base(e.Properties.BuildableActor?.AssetPathName), e]));
  const recipes = [];
  for (const [pkg, exports] of Object.entries(bulk)) {
    const piece = byActor.get(base(pkg));
    if (!piece) continue;
    const name = text(piece.Properties.DisplayName);
    if (!name) continue;
    const materials = (piece.Properties.Requirements || []).map(r => ({ item: item(r.ItemData), qty: r.Amount })).filter(m => m.item);
    for (const component of exports.filter(e => e.Type === 'StationUpgradeComponent')) {
      const station = byActor.get(base(component.Properties?.StationToUpgrade));
      const facility = station && text(station.Properties.DisplayName);
      if (!facility) continue;
      for (const group of component.Properties.UpgradeInfos?.RecipesToAdd || []) for (const ref of group.Collection || []) {
        const id = base(ref);
        if (id) recipes.push({ id, facility, upgrade: { name, materials,
          ...(name === 'Loom Harness' && { placement: 'Build the Loom Harness within 9 m of the Loom. Keep the Loom under a roof.',
            source: 'https://dragonwilds.runescape.wiki/w/Loom_Harness' }) } });
      }
    }
  }
  return recipes;
}
module.exports = { stationUpgradeRecipes };
