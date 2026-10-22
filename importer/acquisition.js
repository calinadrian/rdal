// Explicit acquisition edges only; names and directory proximity do not imply rewards.
function buildAcquisition({ itemBulk, recipeBulk, flows, entities, item, base, questName }) {
  const recipeOutputs = new Map();
  for (const exports of Object.values(recipeBulk)) for (const e of exports) {
    if (!e.Properties?.ItemsCreated) continue;
    recipeOutputs.set(e.Name, e.Properties.ItemsCreated.map(o=>item(o.ItemData)).filter(Boolean));
  }
  const add = (name, route) => {
    if (!entities[name]) return;
    const routes = entities[name].acquisition ||= [];
    if (!routes.some(r=>JSON.stringify(r)===JSON.stringify(route))) routes.push(route);
    if (route.quest && entities[route.quest]) {
      const rewards=entities[route.quest].rewards ||= [];
      const reward={item:name,kind:route.kind,objective:route.objective,qty:route.qty ?? null};
      if (!rewards.some(r=>JSON.stringify(r)===JSON.stringify(reward))) rewards.push(reward);
    }
  };
  for (const exports of Object.values(itemBulk)) for (const e of exports) {
    const name = item(e.Name);
    const p = e.Properties;
    if (!name || !p) continue;
    for (const ref of p.RecipesToUnlock || []) {
      const recipe = base(ref);
      for (const output of recipeOutputs.get(recipe) || []) {
        add(output,{kind:'study',item:name,recipe});
        const unlocked = entities[name].unlocks ||= [];
        if (!unlocked.includes(output)) unlocked.push(output);
      }
    }
    for (const drop of p.DropData?.ItemsToDrop || []) {
      const output = item(drop.ItemDataClass);
      if (!output || output===name || drop.ProbabilityOfDrop===0) continue;
      const pct = Number.isFinite(drop.ProbabilityOfDrop) ? drop.ProbabilityOfDrop*100 : null;
      add(output,{kind:'open',item:name,min:drop.MinToDrop ?? null,max:drop.MaxToDrop ?? null,pct});
      const contents = entities[name].contents ||= [];
      if (!contents.some(c=>c.item===output)) contents.push({item:output,pct,min:drop.MinToDrop ?? null,max:drop.MaxToDrop ?? null});
    }
  }
  let unresolved = 0;
  for (const exports of Object.values(flows)) {
    const names = new Map(exports.map(e=>[e.Name,e]));
    const known = [...new Set(exports.map(e=>base(e.Properties?.QuestData)).filter(id=>questName[id]))];
    const context = start => {
      const visited = new Set(); let node=start, quest=null, objective=null, completed=false;
      while (node && !visited.has(node)) {
        visited.add(node);
        const p=node.Properties || {};
        if (/^QFT_CompleteQuest/.test(node.Type)) completed=true;
        if (!quest && questName[base(p.QuestData)]) quest=base(p.QuestData);
        if (!objective && node.Type==='QFT_SetQuestObjective_C') objective=p.TextName || null;
        node=names.get((p.ParentNode?.ObjectName || '').split(':').pop().replace(/'$/,''));
      }
      if (!quest && known.length===1) quest=known[0];
      return quest ? {quest:questName[quest],questId:quest,objective,completed} : null;
    };
    for (const node of exports) {
      if (!['QFT_GiveItemToPlayer_C','QFT_GiveItemsToPlayer_C','QFT_GiveCraftingRecipe_C'].includes(node.Type)) continue;
      const p=node.Properties || {};
      const ctx=context(node);
      if (!ctx) { unresolved++; continue; }
      if (node.Type==='QFT_GiveCraftingRecipe_C') {
        for (const ref of p['Summon Item Recipes'] || []) for (const output of recipeOutputs.get(base(ref)) || [])
          add(output,{kind:'quest-recipe',recipe:base(ref),...ctx});
      } else {
        const rewards=node.Type==='QFT_GiveItemsToPlayer_C' ? (Array.isArray(p.ItemData) ? p.ItemData : []) : [{ItemData:p.ItemData,Count:p.Amount ?? null}];
        for (const reward of rewards) {
          const output=item(reward.ItemData);
          if (output) add(output,{kind:'quest-item',qty:reward.Count ?? null,...ctx});
        }
      }
    }
  }
  return { items:Object.values(entities).filter(e=>e.acquisition?.length).length, unresolvedQuestNodes:unresolved };
}
module.exports={buildAcquisition};
