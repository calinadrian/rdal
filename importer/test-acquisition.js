const assert=require('assert/strict');
const {buildAcquisition}=require('./acquisition');
const base=ref=>typeof ref==='string' ? ref : ref?.ObjectPath?.split('/').pop().split('.')[0] || null;
const names={GEAR:'Armour',VESTIGE:'Old scroll',PACK:'Reward pack'};
const entities=Object.fromEntries([...Object.values(names),'Quest A','Quest B'].map(name=>[name,{name}]));
const ref=id=>({ObjectPath:'/Game/'+id+'.0'});
buildAcquisition({entities,base,item:r=>names[base(r)],questName:{QA:'Quest A',QB:'Quest B'},
  recipeBulk:{r:[{Name:'R',Properties:{ItemsCreated:[{ItemData:ref('GEAR')} ]}}]},
  itemBulk:{i:[{Name:'VESTIGE',Properties:{RecipesToUnlock:[ref('R')]}},{Name:'PACK',Properties:{DropData:{ItemsToDrop:[{ItemDataClass:ref('GEAR'),MinToDrop:1,MaxToDrop:1,ProbabilityOfDrop:0.5}]}}}]},
  flows:{f:[
    {Name:'objective',Type:'QFT_SetQuestObjective_C',Properties:{QuestData:ref('QA'),TextName:'Step'}},
    {Name:'requirement',Type:'QFR_PlayerHasQuest_C',Properties:{QuestData:ref('QB')}},
    {Name:'give',Type:'QFT_GiveCraftingRecipe_C',Properties:{'Summon Item Recipes':[ref('R')],ParentNode:{ObjectName:"Node'Flow:objective'"}}},
    {Name:'ambiguous',Type:'QFT_GiveItemToPlayer_C',Properties:{ItemData:ref('VESTIGE')}},
  ]}});
assert(entities.Armour.acquisition.some(a=>a.kind==='study'&&a.item==='Old scroll'));
assert(entities.Armour.acquisition.some(a=>a.kind==='quest-recipe'&&a.quest==='Quest A'&&a.objective==='Step'));
assert(!entities.Armour.acquisition.some(a=>a.quest==='Quest B'));
assert(!entities['Old scroll'].acquisition, 'Ambiguous quest branches must not become reward claims');
assert.equal(entities.Armour.acquisition.find(a=>a.kind==='open').pct,50);
assert(entities['Old scroll'].unlocks.includes('Armour'));
assert(entities['Quest A'].rewards.some(r=>r.item==='Armour'&&r.kind==='quest-recipe'));
console.log('PASS: recipe study edges, quest branch attribution, ambiguous source exclusion, pack contents and reverse rewards');
