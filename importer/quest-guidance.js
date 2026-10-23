// Quest instructions and exact interaction pins share identity by quest ID and objective key.
// Dialogue entry tags establish quest relevance; proximity and export order never establish a step.
const referenceName = value => (value?.ObjectName || '').split(':').pop().replace(/'$/, '');
const normal = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sentence = value => String(value || '').replace(/<[^>]+>/g, '').replace(/^\[TEMP\]\s*/i, '').replace(/\s+/g, ' ').trim();
const { clarifyObjective, readableTarget } = require('./quest-instructions');

// Follow compiled dialogue links across databases. A location is a pickup only if
// it can give the quest without first requiring that same quest to be underway.
function questStartEntries(flows, base) {
  const nodes = new Map(), entries = new Map(), questIds = new Set();
  for (const [file, exports] of Object.entries(flows)) {
    const names = new Map(exports.map(e => [e.Name, e]));
    const key = guid => file + '|' + guid;
    const addEntry = (tag, destinations) => {
      if (tag) entries.set(tag, [...new Set([...(entries.get(tag) || []), ...destinations])]);
    };
    for (const e of exports) {
      const p = e.Properties || {};
      if (p.Compiled_NodeGUID) nodes.set(key(p.Compiled_NodeGUID), { e, names, key });
      if (e.Type === 'ConversationEntryPointNode') addEntry(p.EntryTag?.TagName, (p.OutputConnections || []).map(key));
      if (e.Type === 'ConversationDatabase') for (const entry of p.EntryTags || [])
        addEntry(entry.EntryTag?.TagName, (entry.DestinationList || []).map(key));
      if (e.Type === 'QFT_GiveQuest_C') {
        const id = base(p.QuestData); if (id) questIds.add(id);
      }
    }
  }
  const result = new Map();
  for (const [tag, destinations] of entries) {
    const gives = new Set();
    for (const id of questIds) {
      const visited = new Set(), pending = [...destinations];
      while (pending.length) {
        const key = pending.pop(), node = nodes.get(key);
        if (!node || visited.has(key)) continue;
        visited.add(key);
        const p = node.e.Properties || {};
        const guards = (p.SubNodes || []).map(ref => node.names.get(referenceName(ref))).filter(Boolean);
        if (guards.some(g => g.Type === 'QFR_HasQuestState_C' && base(g.Properties?.QuestData || g.Properties?.['Quest Data']) === id
          && /::(Given|Complete)$/.test(g.Properties?.QuestState || ''))) continue;
        if (node.e.Type === 'QFT_GiveQuest_C' && base(p.QuestData) === id) { gives.add(id); break; }
        if (/^QFT_CompleteQuests?_C$/.test(node.e.Type) && [].concat(p.QuestData || p['Quest Data'] || []).some(ref => base(ref) === id)) continue;
        pending.push(...(p.OutputConnections || []).map(node.key));
        if (p.RemoteEntryTag?.TagName) pending.push(...(entries.get(p.RemoteEntryTag.TagName) || []));
      }
    }
    result.set(tag, gives);
  }
  return result;
}
// These are named quest objects, not mentions of the building material Stone.
// Mask the whole phrase before looking for items inside the objective prose.
function resourceText(content, targets = []) {
  let value = content.replace(/\b(?:standing stones?|dreaming stone(?: shards?)?|stone slabs?)\b/g, ' ');
  for (const target of targets) {
    const label = normal(target);
    if (!label.includes(' ')) continue;
    for (const suffix of ['', 's']) value = (' ' + value + ' ').split(' ' + label + suffix + ' ').join(' ').trim();
  }
  return value;
}

function flowInteractions(flows, base, text) {
  const entries = new Map();
  for (const exports of Object.values(flows)) {
    const names = new Map(exports.map(e => [e.Name, e]));
    const byGuid = new Map(exports.filter(e => e.Properties?.Compiled_NodeGUID).map(e => [e.Properties.Compiled_NodeGUID, e]));
    const changesQuest = type => /^QFT_(GiveQuest|SetQuestObjective|CompleteQuests?)_C$/.test(type);
    const ownQuests = new Set(exports.filter(e => changesQuest(e.Type)).flatMap(e => [].concat(e.Properties?.QuestData || e.Properties?.['Quest Data'] || [])).map(base).filter(Boolean));
    for (const entry of exports.filter(e => e.Type === 'ConversationEntryPointNode')) {
      const tag = entry.Properties?.EntryTag?.TagName;
      if (!tag) continue;
      const context = entries.get(tag) || { quests: new Set(), gives: new Set(), dialogue: [], sets: new Set(), tests: new Set(), counted: new Set() };
      const visited = new Set(), pending = [[entry, null]];
      while (pending.length) {
        const [node, lastBool] = pending.pop();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        const p = node.Properties || {};
        for (const ref of changesQuest(node.Type) ? [].concat(p.QuestData || p['Quest Data'] || []) : []) {
          const id = base(ref);
          if (id) {
            context.quests.add(id);
            if (node.Type === 'QFT_GiveQuest_C') context.gives.add(id);
          }
        }
        // Quest bools this interaction sets, tests, and counts (a counter goes up right after the bool is set).
        let last = lastBool;
        if (node.Type === 'QFT_SetQuestBool_C' && p.NewValue === true && p.BoolName) { last = `${base(p.QuestData)}:${p.BoolName}`; context.sets.add(last); }
        if (node.Type === 'QFT_ModifyQuestInt_C' && last) context.counted.add(last);
        for (const ref of p.SubNodes || []) {
          const test = names.get(referenceName(ref));
          if (test?.Type === 'QFR_TestQuestBool_C') context.tests.add(`${base(test.Properties?.['Quest Data'])}:${test.Properties?.['Quest Bool Name']}`);
        }
        if (node.Type === 'QFT_PromptMessage_C') {
          const message = sentence(text(p.Message));
          if (message && /\b(need|must|bring|find|head|return|collect|craft|make|reach|inside|vault|north|east|west|south|password|statue|pedestal|require|speak|talk|gather|mine|plant|harvest)\b/i.test(message))
            context.dialogue.push(message);
        }
        for (const child of p.OutputConnections || []) pending.push([byGuid.get(child), last]);
        for (const ref of p.SubNodes || []) pending.push([names.get(referenceName(ref)), last]);
      }
      context.dialogue = [...new Set(context.dialogue)];
      if (!context.quests.size && ownQuests.size === 1) context.quests.add([...ownQuests][0]);
      entries.set(tag, context);
    }
  }
  return entries;
}

// The quest bool that says an interaction is finished ("Quest_X:Bool"): one it sets and also tests, so the game
// skips it next time, preferring the one a counter follows (GhostOneComplete, VillageStoneDone, SilverthornSealBroken).
// Otherwise the one bool only this interaction sets (Sprite1Found, TookScroll1, HasMoonStone1).
function doneFlag(context, setters) {
  // Flags that only record the quest's introduction say nothing about finishing this interaction.
  const sets = [...(context?.sets || [])].filter(flag => !/:(IntroDialogueDone|IntroDone|IsQuestAccepted)$/.test(flag));
  const guarded = sets.filter(flag => context.tests.has(flag));
  const counted = guarded.filter(flag => context.counted.has(flag));
  const own = (guarded.length ? guarded : sets).filter(flag => setters.get(flag) === 1);
  return counted.length === 1 ? counted[0] : guarded.length === 1 ? guarded[0] : own.length === 1 ? own[0] : null;
}

// Reviewed against the installed quest flow and actor entry tags. Route advice is attributed.
const HTP = 'Quest_HighlightingTheProblem';
const htpSteps = {
  'Investigate for clues about the statue': {
    instruction: 'Enter Thishepen Kara and interact with the glowing dragonkin statue to learn the password Pthentorok.',
    notes: ['The vault entrance is at the base of the cliff near the Runecrafting Guild. Inside, use Windstep to reach the elevated path on the right in the room with four giant rats. You do not need to finish the vault.'],
    entries: ['VaultKnowledgeStatue'],
  },
  'Search the runecrafting guild for wizard statue': {
    instruction: 'Return to the wizard statue at the Runecrafting Guild and choose “Pthentorok” to receive the uncharged Mysterious Orb.',
    notes: ['This is the outdoor wizard statue, not the dragonkin statue inside the vault. Leave space in your inventory for the orb.'],
    entries: ['SaradominStatue'],
  },
  'Charge the orb': {
    instruction: 'Carry the Mysterious Orb to all three tower pedestals around the Runecrafting Guild and interact with each one.',
    notes: ['Use Windstep and the surrounding ruins to reach the tower tops. Each pedestal can charge the orb once; visiting the same one again does not replace a missing pedestal.'],
    entries: ['Pedestal1', 'Pedestal2', 'Pedestal3'],
  },
  'Return to statue': {
    instruction: 'Take the fully charged Mysterious Orb back to the outdoor wizard statue at the Runecrafting Guild.',
    notes: ['Interact with the statue to finish the quest and learn the Staff of Light recipe.'],
    entries: ['SaradominStatue'],
  },
};
const reviewedSteps = {
  [HTP]: htpSteps,
  Quest_GraniteMauled: {
    Objective1: { instruction: 'Enter Skeklac Kara below Ashien’s Watch and interact with the statue to obtain the dwarven weapon blueprint.', entries: ['RecieveBlueprint'] },
    Objective2: { instruction: 'Find Doric near Ashien’s Watch. He can translate the dwarven writing on the blueprint.', entries: ['Doric'] },
    Objective3: { instruction: 'Bring the weapon blueprint to Doric in Ashien’s Watch and speak to him to finish the quest.', entries: ['Doric'] },
  },
  Quest_FH_WitherWard: {
    FindRecipe: { instruction: 'Enter Skekven Kara and interact with the statue inside the vault to recover its dwarven writing.', entries: ['ReceiveBlueprint'] },
    ReturnToDoric: { instruction: 'Take the dwarven writing back to Doric in Fellhollow and ask him to translate it.', entries: ['Doric'] },
    LookForDoric: { instruction: 'Find Doric in Fellhollow. Speak to him about translating the dwarven writing.', entries: ['Doric'] },
  },
  Quest_DogDays: {
    Objective1: { instruction: 'Read the ritual lore at the Garou camps beneath the giant wyrm bones in the Ghornfell Highlands.', entries: ['LoreEntry'] },
    Objective3: { instruction: 'Return to the Garou ritual lore beneath the giant wyrm bones and read how to purify the King’s Token.', entries: ['LoreEntry'] },
    Objective4: { instruction: 'Take the King’s Token to Lougrim’s Shrine and interact with the shrine to perform the purification ritual.', entries: ['Shrine'] },
    Objective6: { instruction: 'Find Vannaka in the Ghornfell Highlands and speak to him about Garou rituals.', entries: ['Vannaka'] },
  },
  Quest_RestlessGhosts: {
    'Found ghost amulet': { instruction: 'Read the remembrance shrine, then look for restless spirits at night. The Amulet of Ghostspeak lets you communicate with them.', entries: ['TempleMemorialEntry'] },
    'Put ghosts to rest': { instruction: 'Visit the four restless spirits at night, speak to each one with the Amulet of Ghostspeak, and fulfil their requests to lay them to rest.', entries: ['Ghost1Entry', 'Ghost2Entry', 'Ghost3Entry', 'Ghost4Entry'] },
  },
};
function interactionLabel(a) {
  const readable = readableTarget(a);
  if (readable) return readable;
  if (/HighLightingTheProblem/i.test(a.entry || '')) {
    if (a.entry.endsWith('.VaultKnowledgeStatue')) return 'Password statue';
    if (a.entry.endsWith('.SaradominStatue')) return 'Wizard statue · Runecrafting Guild';
    const number = /\.Pedestal(\d+)$/.exec(a.entry)?.[1];
    if (number) return `Tower pedestal ${number}`;
  }
  const label = sentence(a.label);
  if (label && !/^\[(TEMP|PH)\]|^NPC$|^None$/i.test(label)) return label;
  if (/UmS_Leader_Tribe[BC]/.test(a.cls)) return 'Moon Garou Elder';
  return a.cls.replace(/^BP_NPC_|^BP_|_C$/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function buildQuestGuidance({ entities, flows, interactions, markers, base, text, dungeonAt, regionAt, onMap, npcVisibility = {} }) {
  const contexts = flowInteractions(flows, base, text);
  const starts = questStartEntries(flows, base);
  const setters = new Map();
  for (const context of contexts.values()) for (const flag of context.sets) setters.set(flag, (setters.get(flag) || 0) + 1);
  const quests = new Map();
  for (const q of Object.values(entities).filter(e => e.kind === 'quest')) {
    for (const version of [q, ...(q.versions || [])]) {
      const list = quests.get(version.id) || [];
      list.push(version); quests.set(version.id, list);
    }
  }
  const reviewedFor = (id, objective) => reviewedSteps[id]?.[objective.key] || clarifyObjective(id, objective);
  const forcedEntries = new Map();
  for (const [id, versions] of quests) for (const objective of versions[0].objectives || []) {
    for (const entry of reviewedFor(id, objective)?.entries || []) if (entry.startsWith('QuestFlow.Entry.')) {
      if (!forcedEntries.has(entry)) forcedEntries.set(entry, new Set());
      forcedEntries.get(entry).add(id);
    }
  }
  const targetMarkers = new Map(), clues = new Map();
  for (const actor of Array.isArray(interactions) ? interactions : []) {
    if (/QuestLocation|QuestTrigger|Volume/.test(actor.cls)) continue;
    const context = contexts.get(actor.entry);
    const ids = new Set([...(context?.quests || []), ...(starts.get(actor.entry) || []), ...(forcedEntries.get(actor.entry) || []), base(actor.quest)].filter(id => quests.has(id)));
    const dungeon = dungeonAt(actor);
    if (!dungeon && !onMap(actor)) continue;
    for (const id of ids) {
      const q = quests.get(id)[0], label = interactionLabel(actor);
      // Keep exact actors separate from the game's broad quest-area markers.
      const marker = { c: 'quest', n: `${q.name} · ${label}`, ref: q.name, questId: id,
        qlocation: actor.id, qsteps: [], target: label, precision: 'interaction', entry: actor.entry,
        sourceId: actor.id, ...(starts.get(actor.entry)?.has(id) && { qstart: true }), x: actor.x, y: actor.y, z: actor.z,
        region: dungeon ? dungeon.name : regionAt(actor.x, actor.y), ...(dungeon && { d: dungeon.id }),
        ...(npcVisibility[actor.id] && { npcVisibility: npcVisibility[actor.id] }),
        ...(doneFlag(context, setters) && { doneWhen: doneFlag(context, setters) }),
        i: 'mapicons/T_NavIcons_QuestMarker_Secondary.png' };
      const list = targetMarkers.get(id) || []; list.push(marker); targetMarkers.set(id, list);
      markers.push(marker);
      if (context?.dialogue.length) {
        const list = clues.get(id) || [];
        list.push({ target: label, sourceId: actor.id, lines: context.dialogue }); clues.set(id, list);
      }
    }
  }
  let steps = 0, mapped = 0, exact = 0, clarified = 0;
  const resourceEntities = Object.values(entities).filter(e => e.name.length >= 4 && ['item', 'monster'].includes(e.kind))
    .sort((a, b) => b.name.length - a.name.length);
  const sourceNames = [...new Set(markers.filter(m => ['creature','monster'].includes(m.c)).map(m => m.n))].sort((a, b) => b.length - a.length);
  const mentions = (content, name) => [' ' + normal(name) + ' ', ' ' + normal(name) + 's '].find(form => content.includes(form));
  for (const [id, versions] of quests) {
    const q = versions[0], targets = targetMarkers.get(id) || [];
    const guide = { sequence: [HTP, 'Quest_GraniteMauled', 'Quest_FH_WitherWard', 'Quest_RestlessGhosts', 'Quest_DogDays', 'Quest_AnimalMagnetism'].includes(id) ? 'linear' : 'reference',
      starts: targets.filter(m => m.qstart).map(m => m.sourceId),
      preparation: id === HTP ? ['Bring Windstep to reach the password statue and the tower pedestals. Keep one inventory slot free for the orb.'] : [],
      sources: id === HTP ? [{ title: 'Quest walkthrough', url: 'https://dragonwilds.runescape.wiki/w/Highlighting_the_Problem' }] : id === 'Quest_FH_WitherBeast' ? [{ title: 'The Wild Hunt walkthrough', url: 'https://dragonwilds.runescape.wiki/w/The_Wild_Hunt' }] : [],
      steps: (q.objectives || []).map(objective => {
        const reviewed = reviewedFor(id, objective);
        const content = normal([objective.text, objective.hint, reviewed?.instruction, ...(reviewed?.notes || [])].filter(Boolean).join(' '));
        const matchesLabel = marker => {
          const label = normal(marker.target);
          return label.length >= 4 && !/^(statue|book|note|letter|shrine|memorial|pedestal|quest giver|ghost|door|chest|scroll|altar)$/.test(label)
            && (' ' + content + ' ').includes(' ' + label + ' ');
        };
        // Hunting destinations come from spawn data, not the quest giver's area pin.
        if (reviewed?.sourceOnly) for (const marker of markers.filter(m => m.questId === id)) marker.qsteps = (marker.qsteps || []).filter(key => key !== objective.key);
        const bound = reviewed?.sourceOnly ? [] : targets.filter(m => reviewed?.entries?.length
          ? reviewed.entries.some(entry => entry === m.entry || entry === m.entry?.split('.').pop()) : matchesLabel(m));
        for (const m of bound) if (!m.qsteps.includes(objective.key)) m.qsteps.push(objective.key);
        const locations = markers.filter(m => m.questId === id && m.qsteps?.includes(objective.key));
        const exactLocations = locations.filter(m => m.precision === 'interaction');
        steps++; if (locations.length) mapped++; if (exactLocations.length) exact++; if (reviewed) clarified++;
        // A named interaction such as Standing Stone must not generate Stone's 439 source links.
        const interactionNames = targets.map(m => m.target).filter(name => !resourceEntities.some(e => normal(e.name) === normal(name)));
        let remaining = ' ' + resourceText(content, interactionNames) + ' ';
        const resources = [];
        for (const entity of resourceEntities) {
          // "The third stone" in a puzzle is still not a material requirement.
          if (entity.name === 'Stone' && !/\b(?:(?:\d+|some|more|enough)\s+stones?|(?:gather|mine|collect|bring|obtain|use|need|requires?)\s+stones?)\b/.test(remaining)) continue;
          const form = mentions(remaining, entity.name);
          if (form) { resources.push(entity.name); remaining = remaining.split(form).join(' '); }
        }
        const mapSources = (reviewed?.mapSources || []).filter(name => sourceNames.includes(name));
        // Only the task names its prey. Supporting notes can mention unrelated mounts or enemies.
        let sourceContent = ' ' + normal([objective.text, reviewed?.instruction].filter(Boolean).join(' ')) + ' ';
        const hunting = /\b(kill|kills|killing|defeat|hunt|hunting|slay|fight|challenge)\b/.test(sourceContent);
        for (const name of sourceNames) if (hunting && !reviewed?.mapSources && mentions(sourceContent, name)) {
          if (!mapSources.includes(name)) mapSources.push(name);
          for (const suffix of ['', 's']) sourceContent = sourceContent.split(' ' + normal(name) + suffix + ' ').join(' ');
        }
        // "Hunt Spectral Chinchompas" names the spectral variant, not the ordinary Chinchompa.
        const variantOf = name => !mapSources.includes(name) && mapSources.some(source => (' ' + normal(source) + ' ').includes(' ' + normal(name) + ' '));
        return { key: objective.key, instruction: reviewed?.instruction || sentence(objective.text),
          notes: reviewed?.notes || (objective.hint ? [sentence(objective.hint)] : []),
          targets: (exactLocations.length ? exactLocations : locations).map(m => m.qlocation),
          resources: reviewed?.resources || resources.filter(name => !variantOf(name)), mapSources,
          ...(reviewed?.sourceRegions && {sourceRegions:reviewed.sourceRegions}) };
      }), clues: [...new Map((clues.get(id) || []).map(c => [c.target + '|' + c.lines.join('|'), c])).values()] };
    for (const version of versions) version.guide = guide;
  }
  return { quests: quests.size, steps, clarified, mapped, exact, interactionPins: [...targetMarkers.values()].reduce((sum, a) => sum + a.length, 0) };
}
module.exports = { buildQuestGuidance, flowInteractions, questStartEntries, doneFlag, resourceText };
