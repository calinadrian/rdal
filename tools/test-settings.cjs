// Full main-process restart test; removes only this run's isolated browser storage between launches.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const appRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const profile = require('./test-profile.cjs').testProfile('settings'); // removed after the test ends
fs.mkdirSync(profile, { recursive: true });
const run = (phase, js) => {
  const result = spawnSync(require('electron'), ['--no-sandbox', appRoot], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, ATLAS_TEST_PROFILE: profile, ATLAS_SNAPSHOT: path.join(root, 'test-fixtures/settings-restored.png'), ATLAS_SNAPSHOT_WAIT: '800', ATLAS_SNAPSHOT_JS: `(async () => { ${js} })()` },
  });
  if (result.error || result.status !== 0) throw result.error || Error(result.stderr + result.stdout);
  console.log(`PASS: process ${phase}`);
};
run('1 saves settings', `
  state.module = 'map'; setMapMode(true); renderModules();
  await new Promise(r => setTimeout(r, 500));
  for (const c of db.map.categories) MapView.setEnabled(c.id, ['ore', 'gather'].includes(c.id));
  MapView.setFollow(false); MapView.zoom(2);
  Preferences.setJSON('columns', { '--w-detail': 480 });
  wish.add('Wolf'); saveWish(); showItem('Wolf');
  setTracked('The Wild Hunt', true); trackerCollapsed = true; Preferences.set('trackerCollapsed', '1');
  $('#map-filters').click();
  await atlas.setSettings({ opacity: 0.82, mapOnM: false });
  await atlas.getPreferences();
`);
let settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')));
assert.equal(settings.opacity, 0.82);
assert.equal(settings.mapOnM, false);
assert(JSON.parse(settings.ui.mapCategories).includes('ore'));
assert(JSON.parse(settings.ui.mapViewport).scale > 0);
assert.deepEqual(JSON.parse(settings.ui.trackedQuests), ['The Wild Hunt']);
assert.equal(settings.ui.trackerCollapsed, '1');
assert.equal(settings.ui.worldFiltersOpen, '1');
// Move generated storage aside within this test profile; keep the authoritative settings.json.
const browserStorage = path.resolve(profile, 'Local Storage');
assert(browserStorage.startsWith(profile + path.sep));
if (fs.existsSync(browserStorage)) fs.renameSync(browserStorage, path.join(profile, 'browser-storage-before-restart'));
run('2 restores from settings.json without browser storage', `
  const check = (ok, message) => { if (!ok) throw Error(message); };
  check(state.module === 'map' && state.detail === 'Wolf', 'Navigation was not restored');
  check(document.body.classList.contains('map-mode'), 'Last open map was not restored');
  check(MapView.isEnabled('ore') && MapView.isEnabled('gather') && !MapView.isEnabled('chest'), 'Category choices were not restored');
  check(!MapView.isFollowing() && Preferences.get('mapFollow') === '0', 'Follow off was not restored');
  check(wish.has('Wolf'), 'Wishlist was not restored');
  check(isTracked('The Wild Hunt') && trackedQuests.length === 1, 'Tracked quests were not restored');
  check(trackerCollapsed && document.querySelector('#quest-tracker .quest-tracker.collapsed'), 'Collapsed quest tracker was not restored');
  check(!document.querySelector('#map-legend').hidden, 'Open map filters were not restored');
  check(document.documentElement.style.getPropertyValue('--w-detail') === '480px', 'Pane width was not restored');
  const settings = await atlas.getSettings(); check(settings.opacity === 0.82 && !settings.mapOnM, 'Application settings were not restored');
  await new Promise(r => setTimeout(r, 500));
  const before = Preferences.json('mapViewport', null); MapView.zoom(1);
  const after = Preferences.json('mapViewport', null);
  check(Math.abs(before.scale - after.scale) < 1e-6 && Math.abs(before.u - after.u) < 1e-6 && Math.abs(before.v - after.v) < 1e-6, 'Map position or zoom was not restored');
  for (const c of db.map.categories.map(c => c.id)) MapView.setEnabled(c, false);
  await atlas.getPreferences();
`);
run('3 retains deliberately empty filters', `
  if (db.map.categories.map(c => c.id).some(c => MapView.isEnabled(c))) throw Error('All-off categories reset to defaults');
  if (MapView.isFollowing()) throw Error('Follow preference reset');
  const chestBox = document.querySelector('#count-chest').closest('label').querySelector('input');
  if (chestBox.checked) throw Error('Chests checkbox disagrees with saved off preference');
  await atlas.getPreferences();
`);
console.log('Settings survived three app processes, including disk-only recovery and empty selections.');
run('4 clicks Chests off and quits immediately', `
  // Restore a typical map first, then use the real DOM checkbox, without awaiting a save/flush.
  for (const c of ['monster', 'chest', 'quest', 'travel', 'shrine', 'agility']) MapView.setEnabled(c, true);
  renderLegend();
  const chestBox = document.querySelector('#count-chest').closest('label').querySelector('input');
  if (!chestBox.checked) throw Error('Checkbox must start on');
  chestBox.click();
  if (chestBox.checked || MapView.isEnabled('chest')) throw Error('Checkbox click did not turn chests off');
  selectModule('quests');
  onQuestLog([{ id: 'Quest_FTUE_RC', s: 2 }]);
  document.querySelector('#content .quest-group-heading[data-group="done"]').click();
  MapView.setResourceTypes('ore', ['Gold']);
  MapView.setResourceTypes('gather', []);
  MapView.setResourceTypes('tree', ['Oak tree']);
  atlas.quit();
`);
settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')));
assert(!JSON.parse(settings.ui.mapCategories).includes('chest'), 'Immediate quit lost Chests off');
assert(JSON.parse(settings.ui.mapCategories).includes('monster'), 'Other category choices were lost');
assert(JSON.parse(settings.ui.questGroups).includes('done'), 'Immediate quit lost the opened quest section');
assert.deepEqual(JSON.parse(settings.ui.resourceTypes), { ore: ['Gold'], gather: [], tree: ['Oak tree'] }, 'Immediate quit lost resource selections');
run('5 keeps the visible Chests checkbox off after restart', `
  if (!questGroupsOpen.has('done')) throw Error('Opened quest section was not restored');
  if (document.querySelector('#content .quest-group-heading[data-group="done"]').getAttribute('aria-expanded') !== 'true') throw Error('Visible quest section disagrees with saved preference');
  selectModule('map');
  const chestBox = document.querySelector('#count-chest').closest('label').querySelector('input');
  if (chestBox.checked || MapView.isEnabled('chest')) throw Error('Chests came back on');
  if (!MapView.isEnabled('monster')) throw Error('Unrelated categories changed');
  if (!MapView.isResourceTypeEnabled('ore', 'Gold') || MapView.isResourceTypeEnabled('ore', 'Iron')) throw Error('Gold-only selection was not restored');
  if (!MapView.isResourceFiltered('gather') || MapView.isResourceTypeEnabled('gather', 'Flax')) throw Error('Empty plant selection was not restored');
  if (!MapView.isResourceTypeEnabled('tree', 'Oak tree') || MapView.isResourceTypeEnabled('tree', 'Ash tree')) throw Error('Tree selection was not restored');
`);
