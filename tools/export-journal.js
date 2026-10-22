// Export only the artwork referenced by recipe journal entries and the creature pages (World → Fauna /
// Factions entries unlocked by killing an AI), using the game's own textures.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const raw = path.join(__dirname, 'Extractor/out/raw');
const journal = JSON.parse(fs.readFileSync(path.join(raw, 'journal.json')));
const creaturePage = e => e.Type === 'JournalEntryWorldData' && e.Properties?.UnlockCondition?.AIData;
const images = [...new Set(Object.values(journal).flat().filter(e => e.Type === 'JournalEntryRecipeData' || creaturePage(e))
  .map(e => e.Properties?.Image?.AssetPathName).filter(p => p && p !== 'None'))];
const list = path.join(raw, 'journal-images.txt');
fs.writeFileSync(list, images.join('\n'));
const result = spawnSync(path.join(__dirname, 'Extractor/bin/out/Extractor.exe'),
  ['texture', path.join(root, 'data/journal'), '--max=384', '@' + list], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (result.error || result.status !== 0) throw result.error || Error(result.stderr);
const failures = result.stderr.split(/\r?\n/).filter(line => line.startsWith('ERR '));
console.log(`Journal artwork: ${images.length} references, ${failures.length} unavailable`);
if (failures.length) console.log(failures.join('\n'));
// The app never shows journal art larger than about 440px, so ship it as 640px WebP.
const webp = spawnSync(path.join(__dirname, 'Extractor/bin/out/Extractor.exe'),
  ['webp', path.join(root, 'data/journal'), '--max=640', '--quality=90'], { encoding: 'utf8' });
if (webp.error || webp.status !== 0) throw webp.error || Error(webp.stderr);
console.log(webp.stderr.trim().split(/\r?\n/).pop());
