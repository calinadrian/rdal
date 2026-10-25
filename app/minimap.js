// WoW-style minimap: a small round window in a corner of the game while it runs, with the tracked quests listed
// under it. It never takes focus and lets clicks through to the game, except on its name bar (drag to move,
// double-click to put it back), zoom buttons and the quest list's heading (fold it away). The main window works
// out what it shows (minimap:scene); this relays it to the minimap window.
const path = require('path');
const electron = require('electron');
const { BrowserWindow, ipcMain } = electron;

const SIZES = [160, 200, 260];
const WIDTH = 264; // room for the quest list, which is wider than the small and medium minimaps

// settings() returns the current settings; update(patch) changes and saves them.
function createMinimap({ settings, update, icon }) {
  let win = null;
  let gameFocused = false;
  let ready = false, active = false, latestPlayer = null;
  let scene = { ok: false };
  let content = 0; // the page's height with its quest list, as the minimap window reports it
  const size = () => SIZES.includes(settings().minimapSize) ? settings().minimapSize : 200;
  const pointer = require('./minimap-pointer').createMinimapPointer({ window: () => win,
    cursor: () => electron.screen.getCursorScreenPoint() });
  function questWidth() {
    let saved = {};
    try { saved = JSON.parse(settings().ui?.displaySizes || '{}'); } catch {}
    const percent = Number(scene.displaySizes?.questWidth ?? saved.questWidth ?? 100);
    return Math.max(size(), WIDTH - 16) * (Number.isFinite(percent) ? Math.min(200, Math.max(70, Math.round(percent / 10) * 10)) : 100) / 100;
  }
  function bounds() {
    // The window grows with the quest list; only the name bar and minimap are kept on screen.
    let width = Math.max(size() + 16, Math.round(questWidth()) + 16);
    const dial = size() + 48, height = Math.max(dial, content);
    const saved = settings().minimapPosition, screen = electron.screen; // usable once the app is ready
    const area = (saved ? screen.getDisplayMatching({ ...saved, width, height }) : screen.getPrimaryDisplay()).workArea;
    width = Math.min(width, area.width - 32);
    // Top-right corner by default; a dragged position is kept on whichever screen it is on (or the nearest).
    const x = saved ? saved.x : area.x + area.width - width - 16, y = saved ? saved.y : area.y + 16;
    return { width, height,
      x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - dial)) };
  }
  const options = () => ({ size: size(), rotate: !!settings().minimapRotate, zoom: settings().minimapZoom, questsFolded: !!settings().minimapQuestsFolded });

  // Shown while the setting is on and the game runs; closed otherwise.
  function sync(gameRunning) {
    if (!settings().minimap || !gameRunning) { pointer.active(false); win?.destroy(); win = null; ready = active = false; return; }
    if (win) {
      win.setBounds(bounds());
      win.webContents.send('minimap:options', options());
      return;
    }
    const mm = win = new BrowserWindow({
      ...bounds(),
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, show: false, icon, title: 'AtlasLoot minimap',
      webPreferences: { preload: path.join(__dirname, 'minimap-preload.js'), contextIsolation: true },
    });
    mm.setAlwaysOnTop(true, 'screen-saver');
    pointer.setRegions([]);
    pointer.active(false);
    mm.loadFile(path.join(__dirname, 'ui', 'minimap.html'));
    mm.webContents.on('did-finish-load', () => {
      mm.webContents.send('minimap:options', options());
      mm.webContents.send('minimap:scene', scene);
      mm.webContents.send('minimap:active', active);
    });
    mm.once('ready-to-show', () => { ready = true; visibility(); });
    mm.on('closed', () => { if (win === mm) { pointer.active(false); win = null; ready = active = false; } });
  }

  ipcMain.on('minimap:scene', (_, next) => {
    scene = next;
    if (win && !win.isDestroyed() && win.getBounds().width !== bounds().width) win.setBounds(bounds());
    if (win && !win.isDestroyed() && active) win.webContents.send('minimap:scene', scene);
  });
  ipcMain.on('minimap:regions', (event, regions) => { if (event.sender === win?.webContents) pointer.setRegions(regions); });
  ipcMain.on('minimap:interactive', (event, on) => { if (event.sender === win?.webContents) pointer.capture(on); });
  ipcMain.on('minimap:move', (_, x, y) => win?.setPosition(Math.round(x), Math.round(y)));
  ipcMain.on('minimap:place', (_, reset) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    update({ minimapPosition: reset ? undefined : { x, y } });
    win.setBounds(bounds());
  });
  ipcMain.on('minimap:zoom', (_, zoom) => { if (Number.isInteger(zoom)) update({ minimapZoom: zoom }); });
  ipcMain.on('minimap:fold', (_, folded) => update({ minimapQuestsFolded: !!folded }));
  ipcMain.on('minimap:height', (_, height) => {
    if (!Number.isFinite(height) || Math.round(height) === content) return;
    content = Math.round(height);
    if (win) win.setBounds({ ...win.getBounds(), height: bounds().height });
  });

  // Out of the way while the app's map covers the game's (as the game hides its own minimap with its map).
  let suspended = false;
  function visibility() {
    if (!win || win.isDestroyed()) return;
    const next = ready && !suspended && gameFocused;
    if (next === active) return;
    active = next;
    win.webContents.send('minimap:active', active);
    if (active) {
      win.webContents.send('minimap:scene', scene);
      win.webContents.send('minimap:player', latestPlayer);
      win.showInactive();
    } else win.hide();
    pointer.active(active);
  }
  function suspend(on) {
    suspended = on;
    visibility();
  }
  function focus(on) {
    gameFocused = on;
    visibility();
  }

  // Your position straight from the tracker, so the minimap keeps moving with you even while the main window is
  // slow to work out the rest of the scene (a modest PC, or the window in the background behind the game).
  function player(sample) {
    latestPlayer = sample.ok ? { x: sample.x, y: sample.y, yaw: sample.yaw } : null;
    if (win && !win.isDestroyed() && active) win.webContents.send('minimap:player', latestPlayer);
  }

  return { sync, suspend, focus, player, bounds, window: () => win };
}

module.exports = { createMinimap };
