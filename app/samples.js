// Tracker samples to the main window, one at a time: while the window is still busy with the last one (a modest PC,
// or the window in the background behind the game), newer ones merge into the next, so it never falls behind the
// game however long you play. Readings that come with only some samples (creatures and players, quests, lodestones,
// discovery) keep their latest. A page that never answers (still loading) is sent the next one after two seconds.
const { ipcMain } = require('electron');

const READINGS = [['npcs', 'players'], ['quests', 'questLocations'], ['lodestones'], ['discovery']];

// window() is the main window.
function createSamples({ window }) {
  let pending = null, sent = 0;
  function flush() {
    const win = window();
    if (!pending || !win || win.isDestroyed() || Date.now() - sent < 2000) return;
    sent = Date.now();
    win.webContents.send('player', pending);
    pending = null;
  }
  function send(sample) {
    const older = pending;
    pending = { ...sample };
    if (older?.ok && sample.ok) for (const group of READINGS) if (sample[group[0]] == null) for (const key of group) pending[key] = older[key];
    flush();
  }
  ipcMain.on('player:done', () => { sent = 0; flush(); });
  // A reloaded page answers nothing it was sent before.
  return { send, reset: () => { sent = 0; } };
}

module.exports = { createSamples };
