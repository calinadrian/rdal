// Throwaway browser profiles for the UI tests, removed once the test process has ended.
// An Electron app cannot delete its own profile while it exits (Chromium's helper processes still hold
// files open on Windows), so a small detached process waits for the test to end, whether it passed,
// failed, timed out or crashed, and deletes the folder then.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CACHE = path.resolve(__dirname, '..', 'cache');
const PREFIX = 'test-profile-';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });

// cache/test-profile-<name>-<pid>, deleted after this process exits.
function testProfile(name) {
  // Profiles from runs that were killed before their cleaner could finish.
  for (const entry of fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []) {
    const pid = Number(entry.startsWith(PREFIX) && entry.match(/-(\d+)$/)?.[1]);
    if (pid && pid !== process.pid && !alive(pid)) try { remove(path.join(CACHE, entry)); } catch {}
  }
  const dir = path.join(CACHE, `${PREFIX}${name}-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  // process.execPath is electron.exe inside Electron tests; ELECTRON_RUN_AS_NODE makes it run the script as Node.
  spawn(process.execPath, [__filename, '--remove-after', String(process.pid), dir], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
  return dir;
}

module.exports = { testProfile };

// Cleaner mode: node test-profile.cjs --remove-after <pid> <dir>
if (require.main === module && process.argv[2] === '--remove-after') {
  const pid = Number(process.argv[3]), dir = path.resolve(process.argv[4] || '');
  // Only ever a test profile inside cache/.
  if (path.dirname(dir) !== CACHE || !path.basename(dir).startsWith(PREFIX)) process.exit(1);
  const started = Date.now();
  const wait = setInterval(() => {
    if (alive(pid) && Date.now() - started < 30 * 60 * 1000) return;
    clearInterval(wait);
    // A moment for Chromium's helper processes to let go of their files.
    setTimeout(() => { try { remove(dir); } catch {} }, 1000);
  }, 300);
}
