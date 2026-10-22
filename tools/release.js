// Publishes the current version to GitHub Releases (run: npm version patch, then npm run release).
// Installed copies find the new release on their next launch and offer to restart into it.
// Needs the GitHub CLI signed in (gh auth login) with push access to calinadrian/rdal.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd, env) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
const read = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

const { version } = require('../package.json');
if (read('git status --porcelain')) throw Error('Commit your changes first: the release is tagged from the current commit.');
if (read(`git tag --list v${version}`) === '') run(`git tag v${version}`);
run('git push --follow-tags origin HEAD');
// Release notes from the commit subjects since the previous release, grouped the way the app's
// "Update available" dialog shows them. npm version's own "x.y.z" commits are left out.
const previous = read(`git tag --list "v*" --sort=-v:refname --merged v${version}`).split(/\r?\n/).find((t) => t && t !== `v${version}`);
const subjects = read(`git log --no-merges --pretty=%s ${previous ? `${previous}..` : ''}v${version}`)
  .split(/\r?\n/).filter((s) => s && !/^v?\d+\.\d+\.\d+$/.test(s));
const groups = { New: [], Fixed: [], Improved: [] };
for (const s of subjects) groups[/^add|^new\b/i.test(s) ? 'New' : /^fix/i.test(s) ? 'Fixed' : 'Improved'].push(s);
const notes = Object.entries(groups).filter(([, list]) => list.length)
  .map(([title, list]) => `### ${title}\n${list.map((s) => `- ${s}`).join('\n')}`).join('\n\n') || '### Improved\n- Maintenance release';
const notesFile = path.join(ROOT, 'dist', 'release-notes.md');
fs.mkdirSync(path.dirname(notesFile), { recursive: true });
fs.writeFileSync(notesFile, notes + '\n');
console.log(notes);
// The installer carries data/ and the tool binaries, which are not in the repo: build from this checkout.
run(`npx electron-builder --win --publish always -c.releaseInfo.releaseNotesFile="${notesFile}"`, { GH_TOKEN: read('gh auth token') });
console.log(`Released v${version}`);
