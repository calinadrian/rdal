function recipeDiscovery({entities,recipeBulk,dispensers,instances,world,perks,base,text,item}) {
  const outputs=new Map();
  for(const exports of Object.values(recipeBulk))for(const e of exports)if(e.Properties?.ItemsCreated)
    outputs.set(e.Name,e.Properties.ItemsCreated.map(o=>item(o.ItemData)).filter(Boolean));
  const add=(name,route)=>{const list=entities[name].acquisition ||= [];if(!list.some(a=>JSON.stringify(a)===JSON.stringify(route)))list.push(route);};
  const defaults=new Map(Object.entries(dispensers).map(([pkg,exports])=>[base(pkg),exports.find(e=>e.Name.startsWith('Default__'))?.Properties || {}]));
  const sources=[];
  for(const actor of world.filter(a=>/RecipeDispenser/.test(a.cls))) {
    const p={...defaults.get(actor.cls.replace(/_C$/,'')),...instances[actor.name]};
    if(!Array.isArray(p.Recipes))continue;
    const label=text(p.DisplayName) || 'Recipe learning point';
    for(const ref of p.Recipes){const recipe=base(ref);for(const name of outputs.get(recipe)||[]) {
      add(name,{kind:'world-recipe',recipe,sourceId:actor.name,label});
      sources.push({actor,name,recipe,label});
    }}
  }
  for(const exports of Object.values(perks)) {
    const perk=exports.find(e=>e.Type==='SkillPerkData');
    if(!perk)continue;
    for(const e of exports.filter(e=>e.Type==='SkillPerkModule_Recipes'))for(const ref of e.Properties?.RecipesToUnlock || []) {
      const recipe=base(ref);for(const name of outputs.get(recipe)||[])add(name,{kind:'skill-recipe',recipe,
        perk:text(perk.Properties.PerkName) || perk.Name,requirements:perk.Properties.PerkUnlockInfo || null});
    }
  }
  for(const entity of Object.values(entities))for(const recipe of entity.recipes || []) {
    if(recipe.facility?.startsWith('Vendor: '))continue;
    const explicit=(entity.acquisition || []).filter(a=>a.recipe===recipe.id);
    recipe.unlockKinds=[...new Set(explicit.map(a=>a.kind==='study'||a.kind==='world-recipe' ? 'learning' : a.kind==='quest-recipe' ? 'quest' : a.kind==='skill-recipe' ? 'skill' : null).filter(Boolean))];
    if(!recipe.unlockKinds.length)recipe.unlockKinds=[recipe.manualUnlockOnly || !recipe.materials.length ? 'unconfirmed' : 'materials'];
  }
  return sources;
}
module.exports={recipeDiscovery};
