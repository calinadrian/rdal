const assert = require('assert/strict');
const fs = require('fs'), path = require('path');
const { questStartEntries } = require('../importer/quest-guidance');
const db = require('../data/db.json');
const flows = require('./Extractor/out/raw/quest-flows.json');
const base = ref => {
  const s = typeof ref === 'string' ? ref : ref?.ObjectPath || ref?.ObjectName || '';
  const quoted = s.match(/'([^']+)'/);
  return (quoted ? quoted[1] : s).split(/[/:]/).pop().replace(/\.uasset$/, '').replace(/\.[^.]*$/, '').replace(/_C$/, '') || null;
};
// A remote dialogue may give a quest. A later branch that requires that quest
// to already be active/completed must never turn into a pickup.
const node = (Name, Type, Properties) => ({ Name, Type, Properties });
const ref = id => ({ ObjectPath: '/Game/' + id + '.0' });
const synthetic = {
  a: [
    node('start', 'ConversationEntryPointNode', { EntryTag: { TagName: 'Pickup' }, OutputConnections: ['link'] }),
    node('link', 'ConversationLinkNode', { Compiled_NodeGUID: 'link', RemoteEntryTag: { TagName: 'Remote' } }),
    node('later', 'ConversationEntryPointNode', { EntryTag: { TagName: 'LaterStep' }, OutputConnections: ['guard'] }),
    node('guard', 'QFT_Blank_C', { Compiled_NodeGUID: 'guard', SubNodes: [{ ObjectName: "QFR_HasQuestState_C'a:requireActive'" }], OutputConnections: ['link'] }),
    node('requireActive', 'QFR_HasQuestState_C', { QuestData: ref('Quest_Test'), QuestState: 'EQuestState::Given' }),
    node('objective', 'ConversationEntryPointNode', { EntryTag: { TagName: 'ObjectiveOnly' }, OutputConnections: ['set'] }),
    node('set', 'QFT_SetQuestObjective_C', { Compiled_NodeGUID: 'set', QuestData: ref('Quest_Test'), TextName: 'FirstObjective' }),
  ],
  b: [
    node('database', 'ConversationDatabase', { EntryTags: [{ EntryTag: { TagName: 'Remote' }, DestinationList: ['give'] }] }),
    node('give', 'QFT_GiveQuest_C', { Compiled_NodeGUID: 'give', QuestData: ref('Quest_Test') }),
  ],
};
const sample = questStartEntries(synthetic, base);
assert(sample.get('Pickup').has('Quest_Test'), 'Follow remote quest-giving dialogue');
assert(!sample.get('LaterStep').has('Quest_Test'), 'Reject branches requiring an already accepted quest');
assert(!sample.get('ObjectiveOnly').has('Quest_Test'), 'An objective assignment is not quest acceptance');

const starts = questStartEntries(flows, base);
const quests = Object.values(db.entities).filter(q => q.kind === 'quest');
const report = [];
for (const q of quests) {
  const versions = [q, ...(q.versions || []).filter(v => v.id !== q.id)];
  for (const v of versions) {
    const markers = db.map.markers.filter(m => m.questId === v.id);
    const pickups = markers.filter(m => m.qstart);
    assert.deepEqual(v.guide.starts.slice().sort(), pickups.map(m => m.sourceId).sort(), v.id + ': guide and markers agree');
    for (const m of pickups) {
      assert.equal(m.precision, 'interaction');
      assert(starts.get(m.entry)?.has(v.id), v.id + ': pickup must actually give this quest');
    }
    report.push({ quest: q.name, id: v.id, starts: pickups.map(m => ({ target: m.target, region: m.region, sourceId: m.sourceId, entry: m.entry })),
      excludedLocations: markers.length - pickups.length,
      ...(pickups.length ? {} : { reason: v.availability?.reason || q.availability?.reason || (q.hidden ? 'Hidden game entry' : 'No fixed quest-giving actor exported; objective locations are not substituted') }) });
  }
}
const targets = name => report.find(q => q.quest === name).starts.map(m => m.target);
assert.deepEqual(targets('Mirror Mirror'), ['Mirror']);
assert.deepEqual(targets('Mapping the Sands II'), ['Moon Sprite Shaman - Anamcara']);
assert.deepEqual(targets('Biohazard'), ['Zanik']);
assert.deepEqual(targets('Doric\'s Quest'), ['Doric']);
assert.deepEqual(targets('Things That Go Boom In The Night'), ['Vannaka']);
assert.deepEqual(targets('Growing Pains'), []);
assert.deepEqual(targets('Shrimp Catcher'), []);
fs.writeFileSync(path.join(__dirname, '../test-fixtures/quest-start-audit.json'), JSON.stringify({ quests: quests.length, versions: report.length, entries: report }, null, 2) + '\n');
console.log(`PASS: all ${quests.length} quests / ${report.length} versions audited; confirmed acceptance paths, remote dialogue, active-quest guards and no objective-only pickups`);
