// Use the item's own tooltip text; never infer percentages from effect names.
function itemEffects(properties, text) {
  const effects=[];
  const seen=new Set();
  for(const buff of properties.BuffDatas || []) {
    const description=text(buff.Description)?.trim();
    if(!description || seen.has(description))continue;
    seen.add(description);
    effects.push({title:text(buff.Title)?.trim() || 'Special effect',description});
  }
  const effectNotes=[];
  if(properties.bBreakOnSingleUse===true)effectNotes.push('Breaks after one use.');
  if(properties.bLosesDurabilityOverTimeEquipped===true)effectNotes.push('Loses durability over time while equipped.');
  return {effects,effectNotes};
}
module.exports={itemEffects};
