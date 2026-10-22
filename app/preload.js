const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  getDb: () => ipcRenderer.invoke('db:get'),
  runImport: (kind) => ipcRenderer.invoke('db:import', kind),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (patch) => {
    const result = ipcRenderer.sendSync('preferences:commit', patch);
    return result?.ok ? Promise.resolve(true) : Promise.reject(new Error(result?.error || 'Preferences were not saved'));
  },
  pauseHotkey: (paused) => ipcRenderer.send('hotkey:pause', paused),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit'),
  openWiki: (title) => ipcRenderer.send('open:wiki', title),
  onProgress: (fn) => ipcRenderer.on('import-progress', (_, p) => fn(p)),
  onShown: (fn) => ipcRenderer.on('shown', fn),
  onShowMap: (fn) => ipcRenderer.on('show-map', fn),
  onPlayer: (fn) => ipcRenderer.on('player', (_, p) => fn(p)),
  onGame: (fn) => ipcRenderer.on('game', (_, g) => fn(g)),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (fn) => ipcRenderer.on('update', (_, u) => fn(u)),
});
