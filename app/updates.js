// Keep the update lifecycle separate from Electron so event ordering and retries are testable.
const cheerio = require('cheerio');

function releaseSections(raw) {
  let text = Array.isArray(raw) ? raw.map((r) => r.note || '').join('\n') : raw || '';
  if (/<[a-z]/i.test(text)) {
    const $ = cheerio.load(text);
    $('script, style').remove();
    $('h1,h2,h3,h4,h5,h6').each((_, el) => $(el).replaceWith($('<span>').text(`\n## ${$(el).text()}\n`)));
    $('li').each((_, el) => $(el).replaceWith($('<span>').text(`\n- ${$(el).text()}\n`)));
    $('br').replaceWith('\n');
    $('p').each((_, el) => $(el).append('\n'));
    text = $.root().text();
  }
  const sections = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const heading = /^#+\s*(.+)/.exec(line);
    const entry = /^[-*•]\s*(.+)/.exec(line);
    if (heading) sections.push({ title: heading[1], items: [] });
    else {
      if (!sections.length) sections.push({ title: '', items: [] });
      sections[sections.length - 1].items.push(entry ? entry[1] : line);
    }
  }
  return sections.filter((s) => s.items.length);
}

function createUpdates({ current, updater = null, publish = () => {}, beforeInstall = () => {} }) {
  let state = { current, status: updater ? 'idle' : 'dev' };
  const set = (patch) => { state = { ...state, ...patch }; publish(state); };
  const fail = (error) => set({ status: 'error', checkedAt: Date.now(), message:
    /net::|ENOTFOUND|ETIMEDOUT|ECONN|EAI_AGAIN/i.test(error.message)
      ? 'No connection to GitHub. Check your connection and try again.'
      : 'Update failed. Check for updates to try again.' });
  if (updater) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // Relaunch only for the explicit install() action below.
    updater.autoRunAppAfterInstall = false;
    updater.on('checking-for-update', () => set({ status: 'checking', message: null }));
    updater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now(), version: null, notes: [] }));
    updater.on('update-available', (info) => set({ status: 'downloading', percent: 0,
      version: info.version, notes: releaseSections(info.releaseNotes), checkedAt: Date.now() }));
    updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent) || 0)) }));
    updater.on('update-downloaded', (info) => set({ status: 'ready', percent: 100,
      version: info.version, notes: info.releaseNotes == null ? state.notes : releaseSections(info.releaseNotes) }));
    updater.on('error', fail);
  }
  return {
    get: () => state,
    check() {
      if (!updater || ['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return state;
      set({ status: 'checking', message: null });
      // Also handle synchronous failures and rejected checks that do not emit an error event.
      Promise.resolve().then(() => updater.checkForUpdates()).catch(fail);
      return state;
    },
    install() {
      if (!updater || state.status !== 'ready') return;
      set({ status: 'installing' });
      try { beforeInstall(); updater.quitAndInstall(true, true); } catch (error) { fail(error); }
    },
  };
}

module.exports = { releaseSections, createUpdates };
