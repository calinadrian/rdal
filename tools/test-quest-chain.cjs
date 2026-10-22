// Quest order and retired quests come only from explicit quest-flow links (run: node tools/test-quest-chain.cjs).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { questChain, applyQuestChain } = require('../importer/quest-chain');
const root = path.resolve(__dirname, '..');
const flows = JSON.parse(fs.readFileSync(path.join(root, 'tools/Extractor/out/raw/quest-flows.json'), 'utf8'));
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'), 'utf8'));
const chain = questChain(flows);
assert.deepEqual(chain.Quest_FTUE_Q2.afterCompleting, ['Quest_FTUE_Q1'], 'Right Tool for the Job is only given after the old First Steps');
assert.equal(chain.Quest_FTUE_Q1, undefined, 'No flow gives the old First Steps');
const order = applyQuestChain(db.entities, chain);
assert.equal(db.entities['Right Tool for the Job'].availability.status, 'unavailable');
assert.equal(db.entities['Seeking Shelter'].availability.status, 'unavailable');
assert.equal(db.entities['First Steps'].availability, undefined, 'First Steps still has live versions');
const edge = (a, b) => order.edges.some(e => e.from === a && e.to === b);
for (const [a, b] of [['Quest_FTUE_GS', 'Quest_FTUE_RtftJ'], ['Quest_FTUE_RtftJ', 'Quest_FTUE_RC'], ['Quest_FTUE_RC', 'Quest_FTUE_LO'],
  ['Quest_FTUE_LO', 'Quest_FTUE_RM'], ['Quest_FTUE_RM', 'Quest_FTUE_FS'], ['Quest_DR_MainQuest', 'Quest_UmS_MainQuest']]) assert(edge(a, b), `${a} -> ${b}`);
assert(!edge('Quest_FTUE_RtftJ', 'Quest_FTUE_FS'), 'Transitive links are reduced to direct ones');
assert(!order.nodes.some(n => n.id === 'Quest_FTUE_Q2'), 'Retired quests are left out of the order graph');
assert.equal(order.nodes.filter(n => n.hint).length, 4, 'Reused quest names carry a distinguishing hint');
console.log(`PASS: ${order.edges.length} quest links, ${order.retired.length} retired quest assets`);
