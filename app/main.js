// App host: a normal window (or an always-on-top overlay) that wakes up when the game runs.
const { app, BrowserWindow, globalShortcut, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildDb } = require('../importer/build');
const { wikiSource, waybackSource, withCache, nodeFetchText } = require('../importer/sources');
const { WIKI } = require('../importer/parse');

const ROOT = path.join(__dirname, '..');
// Development launches and packaged builds share one profile outside the installation folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Dragonwilds AtlasLoot'));
// Isolated profile for full-process persistence tests through the existing snapshot hook.
if (process.env.ATLAS_SNAPSHOT && process.env.ATLAS_TEST_PROFILE) app.setPath('userData', process.env.ATLAS_TEST_PROFILE);
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
// mode: 'window' = normal app window (e.g. on a second monitor); 'overlay' = always on top of the game.
// minimap: a WoW-style round map in a corner of the game while it runs (minimapPosition once dragged).
const DEFAULTS = {
  hotkey: 'Control+Shift+L', opacity: 0.94, bounds: { width: 1180, height: 720 }, mapOnM: true,
  mode: 'window', showOnGame: true, hideOnGameExit: false, autoStart: false,
  minimap: false, minimapSize: 200, minimapRotate: false, minimapZoom: 2,
};
const DUMPER = path.join(ROOT, 'tools', 'Dumper', 'bin', 'out', 'Dumper.exe');
const GAME_EXES = ['RSDragonwilds-WinGDK-Shipping.exe', 'RSDragonwilds-Win64-Shipping.exe'];
const ICON = path.join(__dirname, 'icon.png');
const startHidden = process.argv.includes('--hidden') && !process.argv.includes('--updated'); // Updates reopen visibly, including a previously hidden startup.

let win;
let tray;
let focusHandoff;
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
const saveSettings = () => {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
};

function cancelHandoff() {
  focusHandoff?.kill();
  focusHandoff = null;
}
function handoff({ closeMap = false, complete } = {}) {
  // Hiding a foreground Electron window does not reliably reactivate the game on Windows.
  // Start the helper while we still own the foreground, so it inherits activation permission.
  cancelHandoff();
  const handoff = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'focus-game.ps1'), ...(closeMap ? ['-CloseMap'] : [])], { windowsHide: true, timeout: 5000 }, (error) => {
    if (focusHandoff !== handoff) return;
    focusHandoff = null;
    if (error && !error.killed) console.warn('Could not return keyboard focus to Dragonwilds:', error.message);
    complete?.();
  });
  focusHandoff = handoff;
}
const applyMode = () => overlayHost.applyMode({ force: true });
const reveal = options => overlayHost.reveal(options);
const conceal = () => overlayHost.conceal();
const toggle = () => overlayHost.toggle();

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  return globalShortcut.register(accel, toggle);
}

function createWindow() {
  win = new BrowserWindow({
    ...settings.bounds,
    minWidth: 760,
    minHeight: 460,
    frame: false,
    transparent: false,
    backgroundColor: '#1c1c1c',
    show: false,
    icon: ICON,
    title: 'Dragonwilds AtlasLoot',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  applyMode();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => {
    if (settings.maximized) win.maximize();
    if (!startHidden || process.env.ATLAS_SNAPSHOT) reveal({ focus: false });
  });
  win.webContents.on('did-finish-load', () => { samples.reset(); win.webContents.send('game', { running: gameRunning }); });
  // Test hook: ATLAS_SNAPSHOT=out.png [ATLAS_SNAPSHOT_JS=code] renders, captures, and quits.
  if (process.env.ATLAS_SNAPSHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 800));
      if (process.env.ATLAS_SNAPSHOT_JS) {
        const result = await win.webContents.executeJavaScript(process.env.ATLAS_SNAPSHOT_JS);
        if (process.env.ATLAS_SNAPSHOT_REPORT) fs.writeFileSync(process.env.ATLAS_SNAPSHOT_REPORT, JSON.stringify(result, null, 2));
      }
      await new Promise((r) => setTimeout(r, Number(process.env.ATLAS_SNAPSHOT_WAIT) || 1500));
      fs.writeFileSync(process.env.ATLAS_SNAPSHOT, (await win.webContents.capturePage()).toPNG());
      app.exit(0);
    });
  }
  // While it covers the game's map the window is not where you put it: nothing is remembered then.
  const remember = () => { if (gameMap.shown() || gameMap.restoring()) return; if (!win.isMaximized()) settings.bounds = win.getBounds(); saveSettings(); };
  win.on('maximize', () => { if (gameMap.shown() || gameMap.restoring()) return; settings.maximized = true; saveSettings(); });
  win.on('unmaximize', () => { if (gameMap.shown() || gameMap.restoring()) return; settings.maximized = false; remember(); });
  win.on('moved', remember);
  win.on('resized', remember);
  // Links open in the normal browser, never inside the overlay.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// The WoW-style minimap window over the game (minimap.js), fed by the main window.
const minimap = require('./minimap').createMinimap({
  settings: () => settings,
  update: (patch) => { settings = { ...settings, ...patch }; saveSettings(); },
  icon: ICON,
});
const syncMinimap = () => minimap.sync(gameRunning);
// The app's map stands in for the game's own map (game-map.js), told by the tracker when that map opens and closes.
const gameMap = require('./game-map').createGameMap({ window: () => win, settings: () => settings, applyMode, minimap });
const overlayHost = require('./overlay').createOverlay({ window: () => win, settings: () => settings, gameMap, handoff, cancelHandoff });
let foreground = { game: false, atlas: false }, focusWatcher = null;
function watchFocus() {
  if (app.isQuitting || focusWatcher) return;
  const watcher = focusWatcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'watch-game-focus.ps1'), '-AtlasPid', String(process.pid)], { windowsHide: true });
  let pending = '';
  watcher.stdout.on('data', chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
      try { foreground = JSON.parse(line); } catch { continue; }
      gameMap.focus(foreground.game);
      overlayHost.follow(foreground);
      minimap.focus(foreground.game);
    }
  });
  watcher.stderr.on('data', () => {});
  watcher.on('error', error => console.warn('Game focus watcher:', error.message));
  watcher.on('exit', () => {
    if (focusWatcher !== watcher) return;
    focusWatcher = null;
    foreground = { game: false, atlas: false };
    gameMap.focus(false); overlayHost.follow(foreground); minimap.focus(false);
    if (!app.isQuitting) setTimeout(watchFocus, 3000).unref();
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(`Dragonwilds AtlasLoot (${settings.hotkey})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: toggle },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggle);
}

// Fetches through a hidden browser window so the wiki sees a normal browser.
// If the site shows an interactive check, the window is shown for the user to complete it.
function browserFetcher() {
  let bw;
  let ready;
  const open = () => {
    if (ready) return ready;
    bw = new BrowserWindow({ show: false, width: 900, height: 700, title: 'Dragonwilds Wiki', webPreferences: { sandbox: true } });
    ready = (async () => {
      await bw.loadURL(WIKI + '/w/Special:Version').catch(() => {});
      for (let i = 0; i < 120; i++) {
        const t = bw.webContents.getTitle();
        if (!/just a moment|attention required|verify/i.test(t)) break;
        if (i === 4) bw.show(); // challenge needs the person
        await new Promise((r) => setTimeout(r, 1000));
      }
      bw.hide();
    })();
    return ready;
  };
  const fetchText = async (url) => {
    await open();
    return bw.webContents.executeJavaScript(
      `fetch(${JSON.stringify(url)}, {credentials: 'include'}).then(async r => ({status: r.status, text: await r.text()}))`,
    );
  };
  fetchText.close = () => bw && !bw.isDestroyed() && bw.destroy();
  return fetchText;
}

// Game detection: a cheap process check every few seconds starts/stops the tracker
// and brings the app up when the game launches.
let gameRunning = false;
function isGameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      resolve(!err && GAME_EXES.some((exe) => out.toLowerCase().includes(`"${exe.toLowerCase()}"`)));
    });
  });
}
async function watchGame() {
  const running = await isGameRunning();
  if (running !== gameRunning) {
    gameRunning = running;
    win?.webContents.send('game', { running });
    syncMinimap();
    if (running) {
      startTracker();
      if (settings.showOnGame) reveal({ focus: false });
    } else {
      tracker?.kill();
      if (settings.hideOnGameExit) win.hide();
    }
  }
  if (!app.isQuitting) setTimeout(watchGame, 3000);
}

// Live position, whether the game's map is open, and in-game key presses from the read-only tracker (runs while the game does).
let tracker = null;
// Samples go to the main window one at a time, merged while it is busy (samples.js).
const samples = require('./samples').createSamples({ window: () => win });
function startTracker() {
  if (app.isQuitting || tracker || !gameRunning) return;
  if (!fs.existsSync(DUMPER)) {
    if (app.isPackaged) samples.send({ ok: false, offline: true, error: 'its tracker (Dumper.exe) is missing; antivirus software may have removed it' });
    return;
  }
  // A small young-generation budget keeps the tracker near 70 MB for hours instead of growing by the CPU's cache size.
  tracker = spawn(DUMPER, ['--track'], { windowsHide: true, env: { ...process.env, DOTNET_GCgen0size: '0x400000' } });
  let buf = '';
  tracker.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.key) gameMap.key(msg.key);
      else if (win && !win.isDestroyed()) {
        gameMap.follow(msg.ok ? msg.map ?? null : false, !!msg.focus, !!msg.teleport);
        overlayHost.follow(foreground);
        minimap.player(msg);
        samples.send(msg);
      }
    }
  });
  // Its last words say why it stopped (no access to the game, the game still loading, ...).
  let lastError = '', started = Date.now(), sampled = false;
  tracker.stdout.once('data', () => { sampled = true; });
  tracker.stderr.on('data', (d) => {
    const lines = String(d).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const exception = /^System\.[\w.]*Exception( \(\d+\))?:\s*/;
    const reason = lines.find(l => l.startsWith('Unhandled exception.') || exception.test(l));
    if (reason) lastError = reason.replace(/^Unhandled exception\.\s*/, '').replace(exception, '').slice(0, 200);
  });
  const self = tracker;
  const failed = (error) => {
    if (tracker !== self) return; // 'error' and 'exit' can both come
    tracker = null;
    // Every start reads the whole game module again: one that keeps failing waits longer each time (up to a minute).
    trackerRetry = sampled || Date.now() - started > 60000 ? 5000 : Math.min(60000, trackerRetry * 2);
    if (win && !win.isDestroyed()) { gameMap.follow(false, false); minimap.player({ ok: false }); samples.send({ ok: false, offline: true, error: sampled ? '' : error }); }
    setTimeout(startTracker, trackerRetry);
  };
  // Not started at all (blocked or removed by antivirus software, for one): no 'exit' follows.
  tracker.on('error', (e) => { if (!self.pid) failed(e.message); });
  // In plain words; a game still loading is just waiting for your character.
  tracker.on('exit', () => failed(/GWorld not found/.test(lastError) ? ''
    : /OpenProcess failed \(error 5\)|Access is denied/.test(lastError) ? 'Windows denied access to the game. If the game runs as administrator, run AtlasLoot as administrator too'
    : lastError || 'its tracker stopped'));
}
let trackerRetry = 2500;

// Full refresh from the installed game: mappings (if the game is running), raw extract, database build.
function run(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const log = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(onLine);
    p.stdout.on('data', log);
    p.stderr.on('data', log);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}
async function importFromGame() {
  const say = (msg) => win.webContents.send('import-progress', { msg, done: 0, total: 0 });
  if (fs.existsSync(DUMPER)) await run(DUMPER, [path.join(ROOT, 'tools', 'Dumper', 'out')], say).catch(() => say('Game not running: keeping existing mappings'));
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'extract-all.ps1')], say);
  await run(process.execPath, [path.join(ROOT, 'importer', 'game.js')], say);
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).meta;
}

let importing = false;
async function runImport(kind) {
  if (importing) return { ok: false, error: 'An import is already running.' };
  importing = true;
  if (kind === 'game') {
    try { return { ok: true, meta: await importFromGame() }; }
    catch (e) { return { ok: false, error: e.message }; }
    finally { importing = false; }
  }
  const fetcher = kind === 'wiki' ? browserFetcher() : nodeFetchText;
  try {
    const base = kind === 'wiki' ? wikiSource(fetcher) : waybackSource(fetcher);
    const source = withCache(base, path.join(app.getPath('userData'), 'cache', kind), kind === 'wiki');
    const db = await buildDb(source, {
      onProgress: (msg, done, total) => win.webContents.send('import-progress', { msg, done, total }),
    });
    if (db.meta.pages < 20) throw new Error(`Only ${db.meta.pages} pages could be read — is the wiki reachable?`);
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    // An archive import only replaces data that did not come from the live wiki.
    let current = null;
    try { current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).meta; } catch {}
    if (current?.source === 'game') throw new Error('Current data comes from the game files; wiki data was not applied.');
    if (kind !== 'wiki' && current?.source === 'wiki') throw new Error('Current data is from the live wiki and is newer; archive data was not applied.');
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    return { ok: true, meta: db.meta };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    importing = false;
    fetcher.close?.();
  }
}

ipcMain.handle('db:get', () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null));
ipcMain.handle('db:import', (_, kind) => runImport(kind));
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('preferences:get', () => settings.ui || {});
function commitPreferences(patch) {
  const allowed = new Set(['wishlist', 'columns', 'mapFollow', 'liveCreaturePool', 'liveCreatureFilter', 'mapCategories', 'mapViewport', 'navigation', 'mapDiscoveryModes', 'mapDiscoverySnapshot', 'mapDiscoveryMarked', 'questMapFilter', 'questGroups', 'ventTypes', 'resourceTypes', 'recipeProgressSnapshot', 'armourChoices', 'trackedQuests', 'trackerCollapsed', 'worldFiltersOpen', 'dungeonFiltersOpen', 'displaySizes']);
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([key, value]) => allowed.has(key) && typeof value === 'string' && value.length < (key==='recipeProgressSnapshot' ? 262144 : 32768)));
  settings.ui = { ...settings.ui, ...clean };
  saveSettings();
  return true;
}
ipcMain.handle('preferences:set', (_, patch) => commitPreferences(patch));
// A checkbox change must reach disk before the renderer can immediately request app exit.
ipcMain.on('preferences:commit', (event, patch) => {
  try { commitPreferences(patch); event.returnValue = { ok: true }; }
  catch (error) { event.returnValue = { ok: false, error: error.message }; }
});
ipcMain.handle('settings:set', (_, patch) => {
  if (patch.hotkey && patch.hotkey !== settings.hotkey) {
    if (!registerHotkey(patch.hotkey)) { registerHotkey(settings.hotkey); return { ok: false, error: `Could not register ${patch.hotkey}` }; }
    tray?.setToolTip(`Dragonwilds AtlasLoot (${patch.hotkey})`);
  }
  settings = { ...settings, ...patch };
  saveSettings();
  applyMode();
  if (Object.keys(patch).some((key) => key.startsWith('minimap'))) syncMinimap();
  if ('autoStart' in patch) setAutoStart(settings.autoStart);
  return { ok: true, settings };
});
// While Settings records a new hotkey, the current one must not hide the window.
ipcMain.on('hotkey:pause', (_, paused) => { if (paused) globalShortcut.unregisterAll(); else registerHotkey(settings.hotkey); });
ipcMain.on('win:hide', conceal);
ipcMain.on('win:quit', () => app.quit());
ipcMain.on('open:wiki', (_, title) => shell.openExternal(`${WIKI}/w/${encodeURIComponent(title.replace(/ /g, '_'))}`));

// Start with Windows: launched hidden, the app appears once the game starts.
// The packaged exe is the app itself; a dev checkout runs electron.exe with the project folder.
const launchArgs = app.isPackaged ? [] : [ROOT];

function setAutoStart(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [...launchArgs, '--hidden'] });
}

// Start menu + desktop shortcuts so the app launches like any other program.
function ensureShortcuts() {
  const ico = path.join(__dirname, 'icon.ico');
  const link = { target: process.execPath, args: launchArgs.map((a) => `"${a}"`).join(' '), cwd: path.dirname(process.execPath), icon: ico, iconIndex: 0, description: 'Loot, recipes and map for RuneScape: Dragonwilds', appUserModelId: 'DragonwildsAtlasLoot' };
  const places = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')];
  for (const dir of places) {
    const file = path.join(dir, 'Dragonwilds AtlasLoot.lnk');
    try { shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', link); } catch {}
  }
}

// Installed copies download releases in the background and install on restart or normal quit.
const updates = require('./updates').createUpdates({
  current: app.getVersion(),
  updater: app.isPackaged && !process.env.ATLAS_SNAPSHOT ? require('electron-updater').autoUpdater : null,
  publish: (state) => { if (win && !win.isDestroyed()) win.webContents.send('update', state); },
  beforeInstall: () => { app.isQuitting = true; },
});
function watchUpdates() {
  updates.check();
  setInterval(() => updates.check(), 6 * 60 * 60 * 1000).unref();
}
ipcMain.handle('update:get', () => updates.get());
ipcMain.handle('update:check', () => updates.check());
ipcMain.on('update:install', () => updates.install());

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('DragonwildsAtlasLoot');
app.on('second-instance', () => win && reveal());
app.whenReady().then(() => {
  createWindow();
  createTray();
  if (!registerHotkey(settings.hotkey)) console.warn('Hotkey unavailable:', settings.hotkey);
  // A dev checkout must not repoint the installed app's shortcuts at electron.exe.
  if (!process.env.ATLAS_SNAPSHOT) { if (app.isPackaged) ensureShortcuts(); setAutoStart(settings.autoStart); }
  if (!process.env.ATLAS_SNAPSHOT && app.isPackaged) watchUpdates();
  if (!process.env.ATLAS_SNAPSHOT) watchGame();
  if (!process.env.ATLAS_SNAPSHOT) watchFocus();
});
app.on('before-quit', () => { app.isQuitting = true; focusHandoff?.kill(); focusWatcher?.kill(); tracker?.kill(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault?.());
