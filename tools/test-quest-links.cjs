const assert = require('assert/strict');
const { questLocationSteps } = require('../importer/quest-locations');
const flows = require('./Extractor/out/raw/quest-flows.json');
const links = questLocationSteps(flows);
assert.deepEqual([...links.get('Quest_FTUE_RC|Vannaka_Objective_FTUE_RC')], ['Objective1']);
assert.deepEqual([...links.get('Quest_FTUE_RC|Vannaka_NPC_FTUE_RC')], ['Objective2']);
assert.deepEqual([...links.get('Quest_FTUE_RC|Windmill_Area_FTUE_RC')], ['Objective2']);
const parent = name => ({ ObjectName: `Node'Flow:${name}'` });
const fixture = [
  { Name: 'step', Type: 'QFT_SetQuestObjective_C', Properties: { QuestData: { ObjectPath: '/Game/Quest_Test.0' }, TextName: 'Step2' } },
  { Name: 'show', Type: 'QFT_UpdateQuestLocation_C', Properties: { Revealed: true, 'Quest Location Name': 'Target', ParentNode: parent('step') } },
  { Name: 'hide', Type: 'QFT_UpdateQuestLocation_C', Properties: { 'Quest Location Name': 'Hidden', ParentNode: parent('step') } },
  { Name: 'complete', Type: 'QFT_CompleteQuest_C', Properties: { ParentNode: parent('step') } },
  { Name: 'after', Type: 'QFT_UpdateQuestLocation_C', Properties: { Revealed: true, 'Quest Location Name': 'AfterCompletion', ParentNode: parent('complete') } },
  { Name: 'cycle', Type: 'QFT_UpdateQuestLocation_C', Properties: { Revealed: true, 'Quest Location Name': 'Cycle', ParentNode: parent('cycle') } },
];
const result = questLocationSteps({ fixture });
assert.equal(result.size, 1, 'Hidden locations, completed branches and cycles must not acquire a step');
assert.deepEqual([...result.get('Quest_Test|Target')], ['Step2']);
console.log('PASS: source-linked start and return locations, hidden updates, completion boundaries and cyclic references');
