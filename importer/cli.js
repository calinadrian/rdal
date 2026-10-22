// Command-line importer: node importer/cli.js --source=wayback|wiki [--max=N] [--fresh] [--offline]
const fs = require('fs');
const path = require('path');
const { buildDb } = require('./build');
const { wikiSource, waybackSource, withCache, nodeFetchText } = require('./sources');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const kind = args.source || 'wayback';
const root = path.join(__dirname, '..');
const base = kind === 'wiki' ? wikiSource(nodeFetchText) : waybackSource(nodeFetchText);
const source = withCache(base, path.join(root, 'cache', kind), !!args.fresh, !!args.offline);

buildDb(source, {
  maxPages: Number(args.max) || 3000,
  onProgress: (msg, done, total) => process.stdout.write(`\r[${done}/${total}] ${msg}`.padEnd(90).slice(0, 90)),
}).then((db) => {
  let out = path.join(root, 'data', 'db.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Never replace live-wiki data with archive data.
  try {
    if (kind !== 'wiki' && JSON.parse(fs.readFileSync(out, 'utf8')).meta.source === 'wiki') out = out.replace('db.json', `db.${kind}.json`);
  } catch {}
  fs.writeFileSync(out, JSON.stringify(db));
  console.log(`\nWrote ${out}:`, db.meta);
}).catch((e) => {
  console.error('\nImport failed:', e.message);
  process.exit(1);
});
