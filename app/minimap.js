// WoW-style minimap: a small round window in a corner of the game while it runs. It never takes focus and lets
// clicks through to the game, except on its name bar (drag to move, double-click to put it back) and zoom
// buttons. The main window works out what it shows (minimap:scene); this relays it to the minimap window.
const path = require('path');
const electron = require('electron');
const { BrowserWindow, ipcMain } = electron;

const SIZES = [160, 200, 260];

// settings() returns the current settings; update(patch) changes and saves them.
function createMinimap({ settings, update, icon }) {
  let win = null;
  let scene = { ok: false };
  const size = () => SIZES.includes(settings().minimapSize) ? settings().minimapSize : 200;
  function bounds() {
    const width = size() + 16, height = size() + 38;
    const saved = settings().minimapPosition, screen = electron.screen; // usable once the app is ready
    const area = (saved ? screen.getDisplayMatching({ ...saved, width, height }) : screen.getPrimaryDisplay()).workArea;
    // Top-right corner by default; a dragged position is kept on whichever screen it is on (or the nearest).
    const x = saved ? saved.x : area.x + area.width - width - 16, y = saved ? saved.y : area.y + 16;
    return { width, height,
      x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - height)) };
  }
  const options = () => ({ size: size(), rotate: !!settings().minimapRotate, zoom: settings().minimapZoom });

  // Shown while the setting is on and the game runs; closed otherwise.
  function sync(gameRunning) {
    if (!settings().minimap || !gameRunning) { win?.destroy(); win = null; return; }
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
    mm.setIgnoreMouseEvents(true, { forward: true });
    mm.loadFile(path.join(__dirname, 'ui', 'minimap.html'));
    mm.webContents.on('did-finish-load', () => {
      mm.webContents.send('minimap:options', options());
      mm.webContents.send('minimap:scene', scene);
    });
    mm.once('ready-to-show', () => mm.showInactive());
    mm.on('closed', () => { if (win === mm) win = null; });
  }

  ipcMain.on('minimap:scene', (_, next) => {
    scene = next;
    if (win && !win.isDestroyed()) win.webContents.send('minimap:scene', scene);
  });
  ipcMain.on('minimap:interactive', (_, on) => win?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('minimap:move', (_, x, y) => win?.setPosition(Math.round(x), Math.round(y)));
  ipcMain.on('minimap:place', (_, reset) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    update({ minimapPosition: reset ? undefined : { x, y } });
    win.setBounds(bounds());
  });
  ipcMain.on('minimap:zoom', (_, zoom) => { if (Number.isInteger(zoom)) update({ minimapZoom: zoom }); });

  return { sync, bounds, window: () => win };
}

module.exports = { createMinimap };
