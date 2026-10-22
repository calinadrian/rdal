const assert = require('assert/strict');
const db = require('../data/db.json');
const actors = require('./Extractor/out/raw/quest-interactions.json');
const { flowInteractions } = require('../importer/quest-guidance');
const { resourceText } = require('../importer/quest-guidance');
assert(!/\bstone\b/.test(resourceText('read the standing stones and return to the dreaming stone then find a stone slab')));
assert(/\bstone\b/.test(resourceText('bring 20 stone to the standing stones')), 'A real material requirement must survive the quest-object exclusion');
const byActor = new Map(actors.map(a => [a.id, a]));
const originalActors = new Map(require('./Extractor/out/world_actors.json').map(a => [a.name, a]));
for (const actor of actors) {
  const original = originalActors.get(actor.id);
  // C# rounds half-centimetres to even; JavaScript rounds them upward.
  if (original) assert(['x', 'y', 'z'].every(axis => Math.abs(actor[axis] - original[axis]) <= 1), 'Structured export must agree with the independent world scan within rounding precision');
}
const quests = Object.values(db.entities).filter(q => q.kind === 'quest');
for (const q of quests.flatMap(q => [q, ...(q.versions || [])])) {
  assert(q.guide, q.id + ': guide missing');
  assert.deepEqual(q.guide.steps.map(s => s.key), q.objectives.map(o => o.key), q.id + ': objective identity/order changed');
  for (const step of q.guide.steps) {
    assert(step.instruction.trim(), q.id + ': instruction missing');
    for (const id of step.targets) assert(db.map.markers.some(m => m.questId === q.id && m.qlocation === id && m.qsteps.includes(step.key)), q.id + ': target belongs to another objective/version');
  }
}
for (const marker of db.map.markers.filter(m => m.c === 'quest' && m.precision === 'interaction')) {
  const source = byActor.get(marker.sourceId);
  assert(source && source.cls !== 'BP_QuestLocation_C', 'Broad areas must not be presented as exact interactions');
  assert.deepEqual([marker.x, marker.y, marker.z], [source.x, source.y, source.z], 'Interaction coordinates must match the game actor');
}
const q = db.entities['Highlighting the Problem'];
assert.equal(q.guide.steps.length, 4);
assert(q.guide.steps[0].instruction.includes('Pthentorok'));
assert.equal(q.guide.steps[2].targets.length, 3);
const password = db.map.markers.find(m => m.questId === q.id && m.target === 'Password statue');
assert(password && db.map.dungeons.find(d => d.id === password.d)?.name === 'Thishepen Kara');
assert(q.guide.steps[0].targets.includes(password.sourceId));
const wizard = db.map.markers.find(m => m.questId === q.id && m.target?.startsWith('Wizard statue'));
assert(wizard && !wizard.d && wizard.qsteps.includes(q.objectives[1].key) && wizard.qsteps.includes(q.objectives[3].key));
assert.equal(new Set(q.guide.steps[2].targets.map(id => { const a = byActor.get(id); return `${a.x}|${a.y}`; })).size, 3);
const melody = db.entities['A Melody Remembered'];
assert(melody.guide.steps[0].instruction.includes('Inspiring Ring of Runecrafting'));
assert(melody.guide.steps[0].resources.includes('Inspiring Ring of Runecrafting'));
assert(melody.guide.steps[1].instruction.includes('Amulet of Magic'));
const fsQuest = db.entities['First Steps'];
assert(fsQuest.guide.steps[0].targets.some(id => db.map.markers.some(m => m.sourceId === id && m.target === 'Wise Old Man')),
  'First Steps must pin its own Wise Old Man, not the NPC who grants the next quest');
const rune = db.entities['Rune Mysteries'];
assert(rune.guide.steps.every(s => s.targets.some(id => db.map.markers.some(m => m.sourceId === id && m.target === 'Zanik'))));
assert(db.entities['The Great Body Robbery'].guide.steps.find(s => s.key === 'Objective5').instruction.includes('get struck by lightning'));
assert(db.entities['Mark Day'].guide.steps.find(s => s.key === 'ConvinceNoble.1').targets.length === 3);
for (const name of ['Rag and Bone Garou', "The Mirror Crack'd", 'Beast in the Sand', 'Scaling Difficulties']) {
  assert(db.map.markers.filter(m => m.ref === name && m.precision === 'interaction').every(m => !m.target.includes('[PH]')), 'Remove placeholder names from actionable pins');
}
assert(db.entities['Withering Heights'].guide.sequence === 'reference', 'Collection counter variants are not a linear completion checklist');
assert(db.entities['Things That Go Boom In The Night'].guide.steps[0].mapSources.includes('Spectral Chinchompa'), 'Expose existing world spawn data when no fixed quest marker exists');
assert(db.entities['Animal Magnetism'].guide.steps.find(s => s.key === 'Objective3').resources.includes('Bundle of Undead Twigs'));
for (const name of ['Withering Heights', "Black Knight's Fortress", 'Saga of the Adventurer']) {
  assert(db.entities[name].guide.steps.every(s => !s.resources.includes('Stone')), `${name}: quest objects must not become ordinary Stone supplies`);
}
const base = r => r?.ObjectPath?.split('/').pop().split('.')[0];
const fixture = {
  flow: [
    { Type: 'ConversationEntryPointNode', Name: 'entry', Properties: { EntryTag: { TagName: 'Test.Entry' }, Compiled_NodeGUID: 'a', OutputConnections: ['b'] } },
    { Type: 'QFT_SetQuestObjective_C', Name: 'step', Properties: { QuestData: { ObjectPath: '/Quest_Actual.0' }, Compiled_NodeGUID: 'b', SubNodes: [{ ObjectName: "Requirement'Flow:prerequisite'" }] } },
    { Type: 'QFR_HasQuestState_C', Name: 'prerequisite', Properties: { QuestData: { ObjectPath: '/Quest_Previous.0' }, QuestState: 'EQuestState::Complete' } },
  ],
};
const context = flowInteractions(fixture, base, value => value?.LocalizedString).get('Test.Entry');
assert.deepEqual([...context.quests], ['Quest_Actual'], 'Prerequisite quests must not acquire every downstream interaction');
console.log(`PASS: ${quests.length} quest entries and all versions have ordered guidance; exact pins use real actor coordinates; dungeon statue, three pedestals and quest-ID isolation`);
