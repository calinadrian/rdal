// Exercise the shipped renderer/preload with controlled updater IPC, without installing anything.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const shots = path.resolve(__dirname, '../test-fixtures');
app.setPath('userData', require('./test-profile.cjs').testProfile('update-ui'));
let preferences = {}, checks = 0, installs = 0;
const base = { current: '0.1.0', checkedAt: Date.now() };
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ hotkey: 'Control+Shift+L', mode: 'window', mapOnM: true, opacity: 0.94 }));
ipcMain.handle('preferences:get', () => preferences);
ipcMain.on('preferences:commit', (event, patch) => { preferences = { ...preferences, ...patch }; event.returnValue = { ok: true }; });
ipcMain.handle('update:get', () => ({ ...base, status: 'latest' }));
ipcMain.handle('update:check', () => { checks++; return { ...base, status: 'checking' }; });
ipcMain.on('update:install', () => { installs++; });
const notes = [
  { title: 'New', items: ['Check for updates directly from Settings', 'See update progress in the status bar'] },
  { title: 'Fixed', items: ['Keep version tags in sync with GitHub releases', 'Recover from interrupted update checks'] },
  { title: 'Improved', items: Array.from({ length: 7 }, (_, i) => `Update reliability improvement ${i + 1}`) },
];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const timer = setTimeout(() => { console.error('Update UI test timed out'); app.exit(1); }, 60000);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer:', message); });
  const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const send = async patch => { win.webContents.send('update', { ...base, ...patch }); await wait(); };
  const snap = async (name, selector) => {
    const rect = selector ? await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`) : undefined;
    const capture = await win.webContents.capturePage(rect);
    assert(!capture.isEmpty(), `${name} is empty`);
    fs.writeFileSync(path.join(shots, `update-${name}.png`), capture.toPNG());
  };
  try {
    await win.loadFile(path.join(root, 'app/ui/index.html'));
    win.showInactive();
    for (let i = 0; i < 60 && !(await js(`document.querySelector('#status-update').textContent.includes('v0.1.0')`)); i++) await wait();
    assert.match(await js(`$('#status-update').textContent`), /v0.1.0/);
    await snap('latest', '.statusbar');
    await js(`$('#status-update').click()`); await wait();
    assert.equal(checks, 1);
    await send({ status: 'downloading', version: '0.1.1', percent: 42 });
    assert.match(await js(`$('#status-update').textContent`), /42%/);
    await snap('downloading', '.statusbar');
    await send({ status: 'ready', version: '0.1.1', notes });
    assert(await js(`$('#update-dialog').open`));
    assert.equal(await js(`$('#update-notes').querySelectorAll('li').length`), 8);
    assert.match(await js(`$('.update-more').textContent`), /3 more/);
    assert(!(await js(`$('#update-notes').textContent.includes('null')`)));
    await snap('dialog');
    await js(`$('.update-later').click()`); await wait();
    assert(!(await js(`$('#update-dialog').open`)));
    await send({ status: 'ready', version: '0.1.1', notes });
    assert(!(await js(`$('#update-dialog').open`)), 'Deferred version must stay deferred');
    await snap('ready', '.statusbar');
    await js(`$('#status-update').click()`); await wait();
    assert(await js(`$('#update-dialog').open`));
    await js(`$('#update-now').click()`); await wait();
    assert.equal(installs, 1);
    await send({ status: 'installing', version: '0.1.1' });
    assert(!(await js(`$('#update-dialog').open`)));
    await send({ status: 'ready', version: '0.1.1', notes: [{ title: 'Fixed', items: ['One change'] }] });
    await js(`$('#status-update').click()`); await wait();
    assert.equal(await js(`$('#update-notes').textContent`), 'FixedOne change');
    await js(`$('.update-close').click()`); await wait();
    assert(!(await js(`$('#update-dialog').open`)));
    await js(`$('#btn-settings').click()`); await wait();
    assert(!(await js(`$('#update-restart').hidden`)));
    await js(`$('#update-meta').scrollIntoView()`); await snap('settings');
    await send({ status: 'error', message: 'No connection to GitHub. Check your connection and try again.' });
    assert(!(await js(`$('#update-check').disabled`)));
    await js(`$('#update-check').click()`); await wait();
    assert.equal(checks, 2);
    await js(`$('#settings').close()`);
    win.setSize(760, 460); await wait(250);
    await send({ status: 'ready', version: '0.1.2', notes });
    assert(await js(`(() => { const r = $('#status-update').getBoundingClientRect(); return r.right <= innerWidth && r.x >= 0; })()`));
    await js(`$('#update-now').scrollIntoView()`); await wait();
    assert(await js(`(() => { const r = $('#update-now').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()`));
    await snap('compact');
    clearTimeout(timer);
    console.log('Update UI passed: progress, notes, defer/reopen, restart, retry and compact window; nonempty screenshots saved.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
