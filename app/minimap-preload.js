// The minimap window's bridge: the scene and options main.js sends, moving or zooming the minimap, folding its
// quest list and the page's height (the window grows with the list).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('minimap', {
  onScene: (fn) => ipcRenderer.on('minimap:scene', (_, s) => fn(s)),
  onOptions: (fn) => ipcRenderer.on('minimap:options', (_, o) => fn(o)),
  interactive: (on) => ipcRenderer.send('minimap:interactive', on),
  move: (x, y) => ipcRenderer.send('minimap:move', x, y),
  place: (reset) => ipcRenderer.send('minimap:place', reset),
  zoom: (level) => ipcRenderer.send('minimap:zoom', level),
  fold: (folded) => ipcRenderer.send('minimap:fold', folded),
  height: (px) => ipcRenderer.send('minimap:height', px),
});
