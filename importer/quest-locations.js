// Link revealed map locations to the objective explicitly set in their quest-flow branch.
// Export order and location-name suffixes are not evidence of quest order.
function questLocationSteps(flows) {
  const links = new Map();
  for (const exports of Object.values(flows)) {
    const names = new Map(exports.map(e => [e.Name, e]));
    for (const location of exports) {
      if (location.Type !== 'QFT_UpdateQuestLocation_C' || location.Properties?.Revealed !== true) continue;
      let node = location;
      const visited = new Set();
      while (node && !visited.has(node)) {
        visited.add(node);
        if (/^QFT_CompleteQuest/.test(node.Type)) break;
        if (node.Type === 'QFT_SetQuestObjective_C') {
          const quest = (node.Properties.QuestData?.ObjectPath || '').split('/').pop().split('.')[0];
          const key = quest + '|' + location.Properties['Quest Location Name'];
          if (quest && node.Properties.TextName) {
            if (!links.has(key)) links.set(key, new Set());
            links.get(key).add(node.Properties.TextName);
          }
          break;
        }
        const parent = (node.Properties?.ParentNode?.ObjectName || '').split(':').pop().replace(/'$/, '');
        node = names.get(parent);
      }
    }
  }
  return links;
}
module.exports = { questLocationSteps };
