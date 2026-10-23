// Real app processes: slider input -> synchronous disk write -> immediate exit -> disk-only restart.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const workspace = path.resolve(__dirname, '..'), root = path.resolve(process.argv[2] || workspace);
const profile = require('./test-profile.cjs').testProfile('display-sizes');
const report = path.join(profile, 'report.json');
function run(name, code, image = 'display-sizes.png') {
  const result = spawnSync(require('electron'), ['--no-sandbox', root], { cwd: workspace, encoding: 'utf8', timeout: 25000,
    env: { ...process.env, ATLAS_TEST_PROFILE: profile, ATLAS_SNAPSHOT: path.join(workspace, 'test-fixtures', image),
      ATLAS_SNAPSHOT_REPORT: report, ATLAS_SNAPSHOT_WAIT: '200', ATLAS_SNAPSHOT_JS: `(async () => {
        const check = (ok, message) => { if (!ok) throw Error(message); };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const slide = (key, value) => { const el = document.getElementById('size-' + key); el.value = value; el.dispatchEvent(new Event('input')); };
        ${code}
        return 'ok';
      })()` } });
  if (result.error || result.status !== 0) throw Error((result.error?.message || '') + '\n' + result.stderr + result.stdout);
  console.log('PASS: ' + name);
}
run('independent live sizes, default reset and immediate exit', `
  state.module = 'map'; setMapMode(true); renderModules(); initMap(); setTracked('The Wild Hunt', true);
  await wait(200);
  const button = document.querySelector('#map-add-waypoint');
  const baseButton = parseFloat(getComputedStyle(button).fontSize);
  const baseTracker = document.querySelector('.quest-tracker').getBoundingClientRect().height;
  slide('minimapButtons', 160); await wait(100);
  check(Math.abs(parseFloat(getComputedStyle(button).fontSize) / baseButton - 1) < .01, 'Full-map buttons keep their size');
  check(MapAppearance.sizes().minimapText === 100 && MapAppearance.sizes().questText === 100, 'Other sliders stay unchanged');
  slide('minimapText', 80); check(MapAppearance.sizes().minimapText === 80, 'Text size changes');
  slide('questText', 160); await wait(100);
  check(document.querySelector('.quest-tracker').getBoundingClientRect().height === baseTracker, 'Full-map quest tracker keeps its size');
  check(MapView.minimapScene(1).displaySizes.questText === 160, 'Offline minimap receives size preferences');
  document.querySelector('#size-reset').click();
  check(Object.values(MapAppearance.sizes()).every(v => v === 100), 'Reset returns all sizes to default');
  slide('questWidth', 180); slide('minimapIcons', 140); slide('minimapButtons', 150); slide('minimapText', 120); slide('questText', 160);
  atlas.quit();
`);
const settingsFile = path.join(profile, 'settings.json');
assert.deepEqual(JSON.parse(JSON.parse(fs.readFileSync(settingsFile)).ui.displaySizes), {minimapButtons:150, minimapIcons:140, minimapText:120, questText:160,questWidth:180});
const browserStorage = path.join(profile, 'Local Storage');
if (fs.existsSync(browserStorage)) fs.renameSync(browserStorage, path.join(profile, 'storage-before-restart'));
run('restore from settings.json and preview settings', `
  check(JSON.stringify(MapAppearance.sizes()) === JSON.stringify({minimapButtons:150,minimapIcons:140,minimapText:120,questText:160,questWidth:180}), 'Sizes restore from disk');
  check(document.querySelector('#size-questText').value === '160', 'Slider restores');
  check(document.querySelector('#size-minimapText-value').textContent === '120%', 'Percentage restores');
  document.querySelector('#btn-settings').click(); await wait(150);
  document.querySelector('.display-size-settings').scrollIntoView({block:'center'});
  return MapAppearance.sizes();
`, 'display-sizes-settings.png');
assert.equal(JSON.parse(fs.readFileSync(report)).questText, 160);
run('large map layout and quest text', `
  state.module = 'map'; setMapMode(true); renderModules(); initMap(); setTracked('The Wild Hunt', true);
  slide('minimapButtons', 160); slide('minimapText', 160); slide('questText', 160); await wait(200);
  const map = document.querySelector('#mapview').getBoundingClientRect();
  for (const el of document.querySelectorAll('.map-tools button')) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    check(r.right <= map.right + 1 && r.left >= map.left - 1, 'Button stays in map: ' + el.id);
    check(el.scrollHeight <= el.clientHeight + 2, 'Button text fits: ' + el.id);
  }
  check(document.body.scrollWidth <= innerWidth, 'No horizontal overflow');
`, 'display-sizes-map-large.png');
run('small sizes and persisted reset', `
  slide('minimapButtons',80); slide('minimapText',80); slide('questText',80);
  check(MapAppearance.sizes().minimapText === 80, 'Small text applies');
  document.querySelector('#size-reset').click(); atlas.quit();
`);
assert(Object.values(JSON.parse(JSON.parse(fs.readFileSync(settingsFile)).ui.displaySizes)).every(v => v === 100));
console.log('Display sizes survived immediate quit and disk-only restart; min/max, live changes and reset passed.');
