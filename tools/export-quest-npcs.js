// Preserve structured per-instance NPC visibility instead of WorldScan's abbreviated property text.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const out = path.join(__dirname, 'Extractor/out');
const world = JSON.parse(fs.readFileSync(path.join(out, 'world_actors.json')));
const files = fs.readFileSync(path.join(out, 'files.txt'), 'utf8').split(/\r?\n/);
const cells = new Map(files.filter(f => f.endsWith('.umap')).map(f => [path.basename(f, '.umap'), f]));
const npcs = world.filter(a => /^BP_NPC_/.test(a.cls));
const temp = path.join(__dirname, '../cache/quest-npc-cells');
fs.mkdirSync(temp, { recursive: true });
const result = {};
for (const level of new Set(npcs.filter(a => a.props.NPCVisibilitySettings).map(a => a.level))) {
  const pkg = cells.get(level);
  if (!pkg) throw Error('Missing NPC cell: ' + level);
  const file = path.join(temp, level + '.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const run = spawnSync(path.join(__dirname, 'Extractor/bin/out/Extractor.exe'), ['json', temp, pkg], { encoding: 'utf8' });
  if (run.error || run.status !== 0 || !fs.existsSync(file)) throw run.error || Error(run.stderr || 'NPC export failed');
  const exports = JSON.parse(fs.readFileSync(file));
  for (const e of exports) {
    const v = e.Properties?.NPCVisibilitySettings;
    if (!v) continue;
    const source = npcs.find(a => a.level === level && a.name === e.Name);
    if (!source) continue;
    result[source.name] = {
      questId: (v.QuestData?.ObjectPath || '').split('/').pop().replace(/\.[^.]*$/, ''),
      flag: v.VisibilityQuestBoolName,
      mode: v.QuestBoolVisibilitySetting?.split('::').pop(),
    };
  }
}
fs.writeFileSync(path.join(out, 'raw/quest-npcs.json'), JSON.stringify(result));
console.log(`NPC visibility: ${Object.keys(result).length} rules from placed NPCs`);
