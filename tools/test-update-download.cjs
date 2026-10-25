// Download the real built installer through electron-updater. Never run the installer.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { createUpdates } = require('../app/updates');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const profile = require('./test-profile.cjs').testProfile('update-download');
app.setPath('userData', profile);
const version = require('../package.json').version;
const installer = `Dragonwilds-AtlasLoot-Setup-${version}.exe`;
const dist = path.join(root, 'dist', 'dev-test'); // npm run package
const hash = file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
    if (!['latest.yml', installer].includes(name)) { res.writeHead(404); res.end(); return; }
    const file = path.join(dist, name);
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  const timer = setTimeout(() => { console.error('Installer download test timed out'); app.exit(1); }, 60000);
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    let quitHandler;
    const adapter = {
      version: '0.1.0', name: 'AtlasLoot update test', isPackaged: true,
      userDataPath: profile, baseCachePath: profile,
      appUpdateConfigPath: path.join(dist, 'win-unpacked/resources/app-update.yml'),
      whenReady: async () => {},
      onQuit: fn => { quitHandler = fn; },
      quit: () => { throw Error('Test must never quit into an installer'); },
    };
    const updater = new NsisUpdater(null, adapter);
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.disableDifferentialDownload = true;
    updater.disableWebInstaller = true;
    updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/` });
    updater.logger = { info() {}, warn() {}, error: console.error, debug() {} };
    const statuses = [];
    const updates = createUpdates({ current: adapter.version, updater, publish: state => statuses.push(state.status) });
    const downloaded = once(updater, 'update-downloaded');
    updates.check();
    await downloaded;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.get().status, 'ready');
    assert.equal(updates.get().version, version);
    assert(statuses.includes('downloading'));
    assert.equal(hash(updater.installerPath), hash(path.join(dist, installer)));
    assert.equal(typeof quitHandler, 'function', 'Normal-quit installation hook is registered');
    console.log(`Real updater download passed: 0.1.0 → ${version}, installer SHA-512 matches, ready to restart. No installation performed.`);
    clearTimeout(timer); server.close(); app.exit(0);
  } catch (error) { console.error(error); server.close(); app.exit(1); }
});
