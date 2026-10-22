// Quest order from the quest-flow graphs: which quests must be finished (or running) before
// another is handed out, and which quests no live flow hands out at all.
// A prerequisite counts only when every route to the "give quest" node passes it.
const ref = p => ((p?.QuestData || p?.['Quest Data'])?.ObjectName || '').match(/QuestData'([^']+)'/)?.[1] || null;
const refs = p => [].concat(p?.QuestData || p?.['Quest Data'] || []).map(r => (r?.ObjectName || '').match(/QuestData'([^']+)'/)?.[1]).filter(Boolean);

function questChain(flows) {
  const nodes = new Map(); // `${file}|${guid}` -> { file, ex, out: [], own: { done:Set, given:Set }, gives: [] }
  const entries = new Map(); // entry tag -> node keys
  const roots = [];
  for (const [file, ex] of Object.entries(flows)) {
    const byName = new Map(ex.map(e => [e.Name, e]));
    const key = g => `${file}|${g}`;
    const db = ex.find(e => e.Type === 'ConversationDatabase');
    for (const entry of db?.Properties?.EntryTags || []) {
      const tag = entry.EntryTag?.TagName;
      const dest = (entry.DestinationList || []).map(key);
      if (tag) entries.set(tag, [...(entries.get(tag) || []), ...dest]);
      roots.push([tag, dest]);
    }
    for (const e of ex) {
      const p = e.Properties || {};
      if (!p.Compiled_NodeGUID) continue;
      const own = { done: new Set(), given: new Set() };
      for (const s of p.SubNodes || []) {
        const sub = byName.get((s.ObjectName || '').split(':').pop().replace(/'$/, ''));
        const q = ref(sub?.Properties);
        if (!q || sub.Type !== 'QFR_HasQuestState_C') continue;
        if (sub.Properties.QuestState === 'EQuestState::Complete') own.done.add(q);
        else if (sub.Properties.QuestState === 'EQuestState::Given') own.given.add(q);
      }
      const after = { done: new Set(), given: new Set() };
      if (/^QFT_CompleteQuests?_C$/.test(e.Type)) for (const q of e.Type === 'QFT_CompleteQuest_C' ? [ref(p)] : refs(p)) if (q) after.done.add(q);
      nodes.set(key(p.Compiled_NodeGUID), { out: (p.OutputConnections || []).map(key), remote: p.RemoteEntryTag?.TagName || null,
        own, after, gives: e.Type === 'QFT_GiveQuest_C' && ref(p) ? [ref(p)] : [], file });
    }
  }
  for (const n of nodes.values()) if (n.remote) n.out.push(...(entries.get(n.remote) || []));
  // Entries that another flow links to inherit that flow's progress; the rest are started by the world (NPCs, triggers).
  const linked = new Set([...nodes.values()].map(n => n.remote).filter(Boolean));
  // Forward data flow: In = intersection of predecessors' Out; Out = In + own requirements + completions.
  const preds = new Map();
  for (const [k, n] of nodes) for (const o of n.out) if (nodes.has(o)) (preds.get(o) || preds.set(o, []).get(o)).push(k);
  const rootSet = new Set(roots.filter(([tag]) => !linked.has(tag)).flatMap(([, dest]) => dest));
  const state = new Map(); // key -> { done:Set, given:Set } (absent = not reached yet)
  const union = (...s) => new Set(s.flatMap(x => [...x]));
  const meet = (a, b) => a ? { done: new Set([...a.done].filter(x => b.done.has(x))), given: new Set([...a.given].filter(x => b.given.has(x))) } : b;
  const outOf = (n, inn) => ({ done: union(inn.done, n.own.done, n.after.done), given: union(inn.given, n.own.given, n.own.done, n.after.done) });
  const queue = [...rootSet];
  for (const r of rootSet) state.set(r, { done: new Set(), given: new Set() });
  let guard = 0;
  while (queue.length && guard++ < 2e6) {
    const k = queue.shift(), n = nodes.get(k);
    if (!n) continue;
    const out = outOf(n, state.get(k));
    for (const o of n.out) {
      if (!nodes.has(o) || rootSet.has(o)) continue;
      const before = state.get(o);
      const next = meet(before, out);
      if (!before || next.done.size !== before.done.size || next.given.size !== before.given.size) { state.set(o, next); queue.push(o); }
    }
  }
  const quests = {};
  for (const [k, n] of nodes) for (const q of n.gives) {
    const inn = state.get(k);
    if (!inn) { (quests[q] ||= { flows: new Set(), done: null, given: null, orphan: 0 }).orphan++; continue; }
    const before = { done: union(inn.done, n.own.done), given: union(inn.given, n.own.given) };
    const r = quests[q] ||= { flows: new Set(), done: null, given: null, orphan: 0 };
    r.flows.add(n.file.split('/').pop().replace(/\.uasset$/, ''));
    r.done = r.done ? new Set([...r.done].filter(x => before.done.has(x))) : before.done;
    r.given = r.given ? new Set([...r.given].filter(x => before.given.has(x))) : before.given;
  }
  const result = {};
  for (const [q, r] of Object.entries(quests)) {
    if (!r.done) { result[q] = { flows: [], afterCompleting: [], duringQuest: [], unreachable: true }; continue; }
    r.done.delete(q); r.given.delete(q);
    for (const d of r.done) r.given.delete(d);
    result[q] = { flows: [...r.flows].sort(), afterCompleting: [...r.done].sort(), duringQuest: [...r.given].sort() };
  }
  return result;
}

// Marks quests the current game can no longer hand out and builds the quest order graph
// (one node per quest asset, since some names are reused). Only explicit flow edges are used.
function applyQuestChain(entities, chain) {
  const quests = Object.values(entities).filter(e => e.kind === 'quest');
  const version = new Map(); // id -> { entity, data }
  for (const e of quests) for (const v of [e, ...(e.versions || []).filter(v => v.id !== e.id)]) if (v.id) version.set(v.id, { entity: e, data: v });
  // A quest is retired when no flow gives it, or only after a quest that is itself retired.
  const retired = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const id of version.keys()) {
      const c = chain[id];
      if (retired.has(id) || (c && !c.unreachable && !c.afterCompleting.some(r => retired.has(r)))) continue;
      retired.add(id); changed = true;
    }
  }
  const reason = id => {
    const c = chain[id];
    const name = r => version.get(r)?.data.name || r;
    if (!c || c.unreachable) return 'No character, quest or event in the current game hands this quest out.';
    const liveNames = new Set([...version.keys()].filter(v => !retired.has(v)).map(name));
    const gone = [...new Set(c.afterCompleting.filter(r => retired.has(r)).map(r => liveNames.has(name(r)) ? `the old “${name(r)}”` : `“${name(r)}”`))];
    return `It is only handed out after ${gone.join(', ')}, which the current game no longer gives. It belonged to an older version of the tutorial.`;
  };
  const live = [...version.keys()].filter(id => !retired.has(id) && !version.get(id).entity.hidden);
  // Keep only direct edges: drop A -> C when A -> B -> C also exists.
  const before = new Map(live.map(id => [id, (chain[id]?.afterCompleting || []).filter(r => live.includes(r))]));
  const reach = (id, seen = new Set()) => { for (const r of before.get(id) || []) if (!seen.has(r)) { seen.add(r); reach(r, seen); } return seen; };
  const edges = [];
  for (const [id, reqs] of before) for (const r of reqs) if (!reqs.some(o => o !== r && reach(o).has(r))) edges.push({ from: r, to: id });
  // Reused names get a hint: the first objective no same-named quest shares.
  const nodes = live.map(id => {
    const { entity, data } = version.get(id);
    const plain = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const others = live.filter(o => o !== id && version.get(o).data.name === data.name).flatMap(o => (version.get(o).data.objectives || []).map(x => plain(x.text)));
    const own = (data.objectives || []).map(x => x.text);
    const hint = others.length ? (own.find(t => !others.includes(plain(t))) || own[0] || '').trim().replace(/\.$/, '') : null;
    return { id, name: data.name, entity: entity.name, type: data.type, region: data.region, hint };
  });
  for (const e of quests) {
    const ids = [e.id, ...(e.versions || []).map(v => v.id)].filter(Boolean);
    if (ids.every(id => retired.has(id))) e.availability = { status: 'unavailable', reason: reason(e.id) };
    else if (e.availability?.status === 'unavailable') delete e.availability;
  }
  return { nodes, edges, retired: [...retired].filter(id => version.has(id)).map(id => ({ id, name: version.get(id).data.name, reason: reason(id) })) };
}

module.exports = { questChain, applyQuestChain };
