// Publishes the current version to GitHub Releases (run: npm version patch, then npm run release).
// Installed copies find the new release on their next launch and offer to restart into it.
// Needs the GitHub CLI signed in (gh auth login) with push access to calinadrian/rdal.
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd, env) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
const read = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

const { version } = require('../package.json');
if (read('git status --porcelain')) throw Error('Commit your changes first: the release is tagged from the current commit.');
if (read(`git tag --list v${version}`) === '') run(`git tag v${version}`);
run('git push --follow-tags origin HEAD');
// The installer carries data/ and the tool binaries, which are not in the repo: build from this checkout.
run('npx electron-builder --win --publish always', { GH_TOKEN: read('gh auth token') });
console.log(`Released v${version}`);
