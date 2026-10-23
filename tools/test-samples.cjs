// Tracker samples to a slow main window (app/samples.js): one at a time, merged while the page is busy, so it never
// falls behind however fast the tracker reads; readings that come with only some samples survive the merge.
const { app, BrowserWindow } = require('electron');
const path = require('path'), assert = require('assert/strict');
const target = path.resolve(process.argv.filter(a => !a.startsWith('--'))[2] || path.resolve(__dirname, '..'));
app.setPath('userData', require('./test-profile.cjs').testProfile('samples'));
const timer = setTimeout(() => { console.error('Samples test timed out'); app.exit(1); }, 30000);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code);
  try {
    await win.loadURL('data:text/html,<title>samples</title>');
    // A page that takes 400 ms over each sample, like a modest PC with the window behind the game.
    await js(`window.got = []; window.atlas.onPlayer(p => { const t = Date.now(); while (Date.now() - t < 400); got.push(p); }); true`);
    const samples = require(path.join(target, 'app/samples.js')).createSamples({ window: () => win });

    // Two seconds of tracker output at its usual pace: creatures every 4th sample, quests every 20th.
    for (let i = 0; i < 14; i++) {
      samples.send({ ok: true, x: i, y: 0, yaw: 0, npcs: i % 4 ? null : [{ c: 'Deer', i }], players: i % 4 ? null : [],
        quests: i === 5 ? [{ id: 'Q', s: 1 }] : null, questLocations: i === 5 ? { L: true } : null });
      await wait(150);
    }
    await wait(1200);
    const got = await js('got');
    assert(got.length >= 3 && got.length <= 8, 'A busy page gets fewer, merged samples instead of a growing queue: ' + got.length);
    assert.equal(got.at(-1).x, 13, 'The page ends on the latest position');
    assert(got.some(p => p.quests?.[0]?.id === 'Q' && p.questLocations?.L), 'The quest reading survives a merge with later samples');
    assert(got.some(p => p.npcs?.[0]?.i === 12), 'The latest creatures arrive even when merged into a later position');
    assert.deepEqual(got.map(p => p.x), [...got.map(p => p.x)].sort((a, b) => a - b), 'Samples arrive in order');

    // Leaving the game is never mixed with an older position.
    await js('got = []');
    samples.send({ ok: true, x: 20, y: 0, yaw: 0, npcs: [{ c: 'Deer' }], players: [] });
    samples.send({ ok: true, x: 21, y: 0, yaw: 0 });
    samples.send({ ok: false, offline: true });
    await wait(900);
    const last = (await js('got')).at(-1);
    assert(last.offline && !last.npcs && last.x === undefined, 'Going offline replaces what was waiting: ' + JSON.stringify(last));

    // A page that never answers still gets news, once every two seconds.
    await win.loadURL('data:text/html,<title>deaf</title>');
    samples.reset();
    let sent = 0;
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel, ...args) => { if (channel === 'player') sent++; return send(channel, ...args); };
    for (let i = 0; i < 20; i++) { samples.send({ ok: true, x: i, y: 0, yaw: 0 }); await wait(150); }
    assert(sent >= 2 && sent <= 3, 'Without answers a sample still goes out every two seconds: ' + sent);
    console.log('PASS: a slow window gets merged samples in order and ends on the latest; quest and creature readings survive merging; going offline replaces waiting samples; a silent page still gets one every two seconds');
    clearTimeout(timer); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timer); app.exit(1); }
});
