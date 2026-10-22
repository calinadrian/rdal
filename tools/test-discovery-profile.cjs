const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : root;
const profile = require('./test-profile.cjs').testProfile('discovery-profile'); // removed after the test ends
fs.mkdirSync(profile, { recursive: true });
function run(js) {
  const result = spawnSync(require('electron'), ['--no-sandbox', target], { cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, ATLAS_TEST_PROFILE: profile, ATLAS_SNAPSHOT: path.join(profile, 'proof.png'), ATLAS_SNAPSHOT_WAIT: '200', ATLAS_SNAPSHOT_JS: js } });
  if (result.status !== 0) throw result.error || Error(result.stderr + result.stdout);
}
run(`(() => {
  MapDiscovery.setMode('lore', 'undiscovered'); MapDiscovery.setMode('shrine', 'all');
  const lore = db.map.markers.find(m => m.c === 'lore');
  MapDiscovery.ingest({ character: 'C'.repeat(32), journal: lore.discovery.ids, shrines: [], pois: [] }, db.map.markers);
  MapDiscovery.mark(db.map.markers.find(m => m.discovery?.kind === 'pois'), true);
  questMapMode = 'selected'; questMapStepMode = 'current'; selectedMapQuests.add('Ratcatcher'); selectedMapQuests.add("Cook's Assistant"); saveQuestMapFilter();
  MapView.setVentTypes(['Fire', 'Water']);
})()`);
const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')));
assert.deepEqual(JSON.parse(settings.ui.mapDiscoveryModes), { lore: 'undiscovered', shrine: 'all' });
assert.equal(JSON.parse(settings.ui.mapDiscoverySnapshot).character, 'C'.repeat(32));
assert.equal(JSON.parse(settings.ui.mapDiscoveryMarked)['C'.repeat(32)].length, 1);
assert.deepEqual(JSON.parse(settings.ui.questMapFilter), { mode: 'selected', selected: ['Ratcatcher', "Cook's Assistant"], steps: 'current' });
assert.deepEqual(JSON.parse(settings.ui.ventTypes), ['Fire', 'Water']);
// The second launch must hydrate from settings.json even without its browser storage mirror.
const local = path.join(profile, 'Local Storage');
const moved = path.join(profile, 'old-browser-storage');
assert(path.resolve(local).startsWith(path.resolve(profile) + path.sep));
assert(path.resolve(moved).startsWith(path.resolve(profile) + path.sep));
if (fs.existsSync(local)) fs.renameSync(local, moved);
run(`(() => {
  const lore = db.map.markers.find(m => m.c === 'lore');
  if (MapDiscovery.mode('lore') !== 'undiscovered' || MapDiscovery.mode('shrine') !== 'all'
    || MapDiscovery.state(lore) !== 'discovered' || MapDiscovery.visible(lore)) throw Error('Disk-only discovery recovery failed');
  if (!MapDiscovery.manuallyMarked(db.map.markers.find(m => m.discovery?.kind === 'pois'))) throw Error('Disk-only manual mark recovery failed');
  if (questMapMode !== 'selected' || questMapStepMode !== 'current' || !selectedMapQuests.has('Ratcatcher') || !selectedMapQuests.has("Cook's Assistant")) throw Error('Disk-only quest selection recovery failed');
  if (!MapView.isVentTypeEnabled('Fire') || !MapView.isVentTypeEnabled('Water') || MapView.isVentTypeEnabled('Earth')) throw Error('Disk-only vent selection recovery failed');
})()`);
console.log('PASS: independent discovery choices and recorded progress survive a full restart using settings.json only');
