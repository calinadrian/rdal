const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates, releaseSections } = require('../app/updates');
const { releaseNotes } = require('./release');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('release bodies handle GitHub HTML, entities, markdown, missing notes and multi-release notes', () => {
  assert.deepEqual(releaseSections('<h3>Fixed</h3><ul><li>Keep <code>A &amp; B</code> &#8212; working</li></ul><script>bad()</script>'),
    [{ title: 'Fixed', items: ['Keep A & B — working'] }]);
  assert.deepEqual(releaseSections([{ note: '### New\n- One' }, { note: '### Fixed\n* Two' }]),
    [{ title: 'New', items: ['One'] }, { title: 'Fixed', items: ['Two'] }]);
  assert.deepEqual(releaseSections(null), []);
  assert.deepEqual(releaseSections('<h3>Fixed</h3><ul><li>Keep &lt;tag&gt; labels</li></ul>'),
    [{ title: 'Fixed', items: ['Keep <tag> labels'] }]);
  assert.deepEqual(releaseSections('Plain release notes'), [{ title: '', items: ['Plain release notes'] }]);
  assert.match(releaseNotes(['0.1.1', 'feat: New feature', 'Fix a crash', 'Improve map']), /### New\n- feat: New feature\n\n### Fixed\n- Fix a crash\n\n### Improved\n- Improve map/);
});

function fixture() {
  const updater = new EventEmitter();
  let checks = 0, installs = 0;
  updater.checkForUpdates = async () => { checks++; };
  updater.quitAndInstall = (...args) => { assert.deepEqual(args, [true, true]); installs++; };
  const updates = createUpdates({ current: '0.1.0', updater });
  return { updater, updates, checks: () => checks, installs: () => installs };
}

test('checks are serialized; ready updates install only once and keep notes if download omits them', async () => {
  const f = fixture();
  f.updates.install();
  assert.equal(f.installs(), 0);
  assert.equal(f.updates.check().status, 'checking');
  f.updates.check();
  await tick();
  assert.equal(f.checks(), 1);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  f.updater.emit('update-available', { version: '0.1.1', releaseNotes: '### Fixed\n- A crash' });
  f.updater.emit('download-progress', { percent: 42.4 });
  assert.equal(f.updates.get().percent, 42);
  f.updates.check();
  assert.equal(f.checks(), 1);
  f.updater.emit('update-downloaded', { version: '0.1.1' });
  assert.equal(f.updates.get().status, 'ready');
  assert.equal(f.updates.get().notes[0].items[0], 'A crash');
  f.updates.install();
  f.updates.install();
  assert.equal(f.updates.get().status, 'installing');
  assert.equal(f.installs(), 1);
});

test('network failure, rejected checks and failed installation allow recovery', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw Error('net::ERR_INTERNET_DISCONNECTED'); };
  f.updates.check(); await tick();
  assert.equal(f.updates.get().status, 'error');
  assert.match(f.updates.get().message, /connection/);
  f.updater.checkForUpdates = async () => f.updater.emit('update-not-available', {});
  f.updates.check(); await tick();
  assert.equal(f.updates.get().status, 'latest');
  assert.deepEqual(f.updates.get().notes, []);
  f.updater.emit('update-downloaded', { version: '0.1.1' });
  f.updater.quitAndInstall = () => f.updater.emit('error', Error('Installer failed'));
  f.updates.install();
  assert.equal(f.updates.get().status, 'error');
  f.updates.check(); await tick();
  assert.equal(f.updates.get().status, 'latest');
});

test('development copies never check or install', () => {
  const updates = createUpdates({ current: '0.1.1' });
  assert.equal(updates.check().status, 'dev');
  updates.install();
  assert.equal(updates.get().status, 'dev');
});
