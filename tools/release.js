// Build locally first, then upload all assets to a draft before making the release visible.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const ROOT = path.resolve(__dirname, '..');
const REPO = 'calinadrian/rdal';

function releaseNotes(subjects) {
  const groups = { New: [], Fixed: [], Improved: [] };
  for (const subject of subjects) {
    const s = subject.trim();
    if (!s || /^v?\d+\.\d+\.\d+$/.test(s)) continue;
    groups[/^(add|new\b|feat[(:])/i.test(s) ? 'New' : /^fix/i.test(s) ? 'Fixed' : 'Improved'].push(s);
  }
  return Object.entries(groups).filter(([, list]) => list.length)
    .map(([title, list]) => '### ' + title + '\n' + list.map(s => '- ' + s).join('\n')).join('\n\n') || '### Improved\n- Maintenance release';
}

function main() {
  const run = (exe, args, optional = false) => {
    const result = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      if (optional) return null;
      throw Error(result.error?.message || result.stderr || result.stdout || exe + ' failed');
    }
    return result.stdout.trim();
  };
  const git = (...args) => run('git', args);
  const ghPath = process.env.GH_CLI || path.join(process.env.ProgramFiles || 'C:/Program Files', 'GitHub CLI', 'gh.exe');
  const gh = (...args) => run(fs.existsSync(ghPath) ? ghPath : 'gh', args);
  // Authentication must succeed before creating tags or uploading anything. No tokens in command output.
  try { gh('api', 'user', '--jq', '.login'); }
  catch { throw Error('GitHub publishing requires authentication. Run gh auth login (Windows: & "C:/Program Files/GitHub CLI/gh.exe" auth login), then retry.'); }
  const { version } = require('../package.json');
  const tag = 'v' + version;
  if (git('status', '--porcelain')) throw Error('Commit your changes first: the release must match its tagged commit.');
  if (!git('branch', '--show-current')) throw Error('Check out a branch before releasing.');
  git('fetch', '--tags', 'origin');
  const existingTag = git('tag', '--list', tag);
  if (existingTag && git('rev-parse', tag + '^{commit}') !== git('rev-parse', 'HEAD')) throw Error(tag + ' already points to another commit. Bump the version.');
  const release = run(fs.existsSync(ghPath) ? ghPath : 'gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft'], true);
  if (release && !JSON.parse(release).isDraft) throw Error(tag + ' is already published. Bump the version.');
  const previous = git('tag', '--list', 'v*', '--sort=-v:refname', '--merged', 'HEAD').split(/\r?\n/).find(t => t && t !== tag);
  const subjects = git('log', '--no-merges', '--pretty=%s', previous ? previous + '..HEAD' : 'HEAD').split(/\r?\n/);
  // dist\prod holds only the release being published (older ones are on GitHub); dist\dev-test is for test builds.
  const prod = path.join(ROOT, 'dist', 'prod');
  // The last release's app may be open from dist\prod: stop before anything there is removed.
  const running = run('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -like '${prod.replace(/'/g, "''")}\\*' } | Select-Object -First 1 -ExpandProperty Path`], true);
  if (running) throw Error('Close the app running from ' + running + ' first: the release rebuilds dist\\prod.');
  fs.rmSync(prod, { recursive: true, force: true });
  const notesFile = path.join(prod, 'release-notes.md');
  fs.mkdirSync(prod, { recursive: true });
  fs.writeFileSync(notesFile, releaseNotes(subjects) + '\n');
  // No publication happens until a complete installer and manifest exist.
  const build = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--publish', 'never', '-c.directories.output=dist/prod', '-c.releaseInfo.releaseNotesFile=' + notesFile], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (build.error || build.status !== 0) throw Error('Installer build failed; nothing was published.');
  const installer = path.join(prod, 'Dragonwilds-AtlasLoot-Setup-' + version + '.exe');
  const manifest = path.join(prod, 'latest.yml');
  const assets = [installer, installer + '.blockmap', manifest];
  for (const file of assets) if (!fs.statSync(file).size) throw Error('Missing or empty asset: ' + file);
  const info = yaml.load(fs.readFileSync(manifest, 'utf8'));
  const hash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  if (info.version !== version || info.path !== path.basename(installer) || info.sha512 !== hash) throw Error('The update manifest does not match the installer.');
  if (!existingTag) git('tag', '-a', tag, '-m', 'Release ' + tag);
  git('push', 'origin', 'HEAD', 'refs/tags/' + tag);
  if (!release) gh('release', 'create', tag, '--repo', REPO, '--draft', '--verify-tag', '--title', 'Dragonwilds AtlasLoot ' + version, '--notes-file', notesFile);
  gh('release', 'upload', tag, ...assets, '--repo', REPO, '--clobber');
  gh('release', 'edit', tag, '--repo', REPO, '--notes-file', notesFile, '--draft=false', '--latest');
  console.log('Released ' + tag + ': https://github.com/' + REPO + '/releases/tag/' + tag);
}

module.exports = { releaseNotes };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
