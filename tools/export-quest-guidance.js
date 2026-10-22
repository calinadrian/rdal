// Read precise interaction tags and positions from placed actors, including instance overrides.
// The compact world scan abbreviates structs and older scans omit NPCs with "Light" in their name.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'Extractor/out'), raw = path.join(out, 'raw');
const world = JSON.parse(fs.readFileSync(path.join(out, 'world_actors.json')));
const files = fs.readFileSync(path.join(out, 'files.txt'), 'utf8').split(/\r?\n/);
const extractor = path.join(__dirname, 'Extractor/bin/out/Extractor.exe');
function run(args) {
  const result = spawnSync(extractor, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0 || /(?:FAIL|ERR)\s|\([1-9]\d* failed\)/.test(result.stderr || '')) throw result.error || Error(result.stderr);
}
run(['bulk', raw, 'quest-actors', '/Gameplay/NPCs/.*\\.uasset$']);
const classes = JSON.parse(fs.readFileSync(path.join(raw, 'quest-actors.json')));
const levels = new Set(world.filter(a => Object.keys(a.props).some(key => /Conversation|^Quest$|^QuestData$/.test(key))).map(a => a.level));
// The streaming index also lists actors absent from older compact scans.
const worldExports = JSON.parse(fs.readFileSync(path.join(raw, 'L_World.json')));
for (const e of worldExports.filter(e => e.Type === 'WorldPartitionLevelStreamingPolicy')) {
  for (const entry of e.Properties?.SubObjectsToCellRemapping || []) if (/^BP_NPC_|Quest|Pedestal/.test(entry.Key)) levels.add(entry.Value);
}
for (const q of world.filter(a => a.cls === 'BP_QuestLocation_C')) {
  for (const a of world) if (Math.hypot(a.x - q.x, a.y - q.y) < 5000 && Math.abs(a.z - q.z) < 6000) levels.add(a.level);
}
const packages = files.filter(p => p.endsWith('.umap') && !p.includes('FutureMajorVersion') && levels.has(path.basename(p, '.umap')));
const dir = path.join(root, 'cache/quest-guidance-cells'); fs.mkdirSync(dir, { recursive: true });
const missing = process.argv.includes('--cached') ? packages.filter(p => !fs.existsSync(path.join(dir, path.basename(p, '.umap') + '.json'))) : packages;
for (let i = 0; i < missing.length; i += 24) run(['json', dir, ...missing.slice(i, i + 24)]);
const tag = value => value?.TagName && value.TagName !== 'None' ? value.TagName : null;
const text = value => typeof value === 'string' ? value : value?.LocalizedString || value?.SourceString || null;
const defaults = new Map();
for (const es of Object.values(classes)) {
  const cdo = es.find(e => e.Name.startsWith('Default__'));
  if (!cdo) continue;
  const participant = es.find(e => e.Type === 'DomConversationParticipant')?.Properties || {};
  defaults.set(cdo.Type, { entry: tag(cdo.Properties?.['Conversation Entry Tag']) || tag(participant.EntryPointTag),
    label: text(cdo.Properties?.DisplayName) || text(participant.DisplayName), participant: tag(participant.ParticipantTag) });
}
const actors = [];
for (const pkg of packages) {
  const es = JSON.parse(fs.readFileSync(path.join(dir, path.basename(pkg, '.umap') + '.json')));
  const resolve = ref => {
    if (path.basename((ref?.ObjectPath || '').replace(/\.\d+$/, '')) !== path.basename(pkg, '.umap')) return null;
    const index = /\.(\d+)$/.exec(ref?.ObjectPath || '');
    return index ? es[+index[1]] : null;
  };
  for (const e of es) {
    const p = e.Properties || {};
    if (!e.Type.endsWith('_C') || !(/PersistentLevel'?$/.test(e.Outer || '') || e.Outer?.ObjectName?.includes('PersistentLevel'))) continue;
    const d = defaults.get(e.Type) || {};
    const participant = resolve(p.DomConversationParticipant)?.Properties || {};
    const entry = tag(p['Conversation Entry Tag']) || tag(participant.EntryPointTag)
      || tag(p.ConversationOnClosedTag) || tag(p.ConversationOnInteractionTag) || d.entry;
    if (!entry && !p.Quest && !p.QuestData) continue;
    const rootComponent = resolve(p.RootComponent);
    const loc = rootComponent?.Properties?.RelativeLocation;
    const source = world.find(a => a.name === e.Name);
    if (!loc && !source) continue;
    actors.push({ id: e.Name, cls: e.Type, entry, label: text(p.DisplayName) || d.label || (/LoreItem/.test(e.Type) ? 'Quest lore' : null),
      participant: tag(participant.ParticipantTag) || d.participant,
      quest: p.Quest || p.QuestData || null,
      x: Math.round(loc?.X ?? source.x), y: Math.round(loc?.Y ?? source.y), z: Math.round(loc?.Z ?? source.z),
      level: path.basename(pkg, '.umap') });
  }
}
fs.writeFileSync(path.join(raw, 'quest-interactions.json'), JSON.stringify(actors));
console.log(`Quest interactions: ${actors.length} exact actors from ${packages.length} levels`);
