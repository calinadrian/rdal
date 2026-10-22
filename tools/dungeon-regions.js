// Finds the game's dungeons in world_actors.json: interiors are built off the landmass or deep under it
// and reached through teleporters. Writes raw/dungeon-regions.json for the Extractor's floorplan mode.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'Extractor/out');
const world = JSON.parse(fs.readFileSync(path.join(out, 'world_actors.json')));

// Same frame as importer/game.js. Anything outside it, or this far below the surface, is an interior.
const MAP = { minX: -12000, minY: -118550, size: 420000 };
const UNDERGROUND = -30000;
const LINK = 5000;    // actors closer than this (50 m) belong to the same dungeon
const MIN_ACTORS = 6; // smaller groups are stray props, not places
const PAD = 4000;     // geometry reaches past the outermost gameplay actors

const onMap = a => a.x >= MAP.minX && a.x <= MAP.minX + MAP.size && a.y >= MAP.minY && a.y <= MAP.minY + MAP.size;
const inside = world.filter(a => (!onMap(a) || a.z < UNDERGROUND) && !/^BP_MapRegion_C$|Tree_|Scatter_/.test(a.cls));

// Single-linkage clustering on a grid.
const parent = inside.map((_, i) => i);
const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
const grid = new Map();
const key = (x, y) => `${Math.floor(x / LINK)},${Math.floor(y / LINK)}`;
inside.forEach((a, i) => { const k = key(a.x, a.y); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
inside.forEach((a, i) => {
  const gx = Math.floor(a.x / LINK), gy = Math.floor(a.y / LINK);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
    const b = inside[j];
    if (j > i && Math.hypot(a.x - b.x, a.y - b.y) < LINK && Math.abs(a.z - b.z) < 6000) parent[find(i)] = find(j);
  }
});
const groups = new Map();
inside.forEach((a, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(a); });

// Teleporters name their destination. Strip direction words to get the place: "V_Takla Kara_Exit" -> "Takla Kara".
const destination = a => (a.props?.TeleportDestinationName || '').replace(/ \(NameProperty\)$/, '');
const stem = n => n.replace(/\s*\([^)]*\)/g, '')
  .replace(/_?(Exit|Entrance|Entry|EntranceTeleport|ExitTeleport|InnerGate|Arena|Return_\d+)$/i, '').trim();
const pretty = s => s.replace(/^(UmS|UMS|DR|SW|V)_/g, '').replace(/^V_/, '').replace(/_/g, ' ')
  .replace(/([a-z])([A-Z\d])/g, '$1 $2').replace(/\s+/g, ' ').trim();
const teleporters = world.filter(a => destination(a));

const regions = [];
for (const actors of groups.values()) {
  if (actors.length < MIN_ACTORS) continue;
  const xs = actors.map(a => a.x), ys = actors.map(a => a.y), zs = actors.map(a => a.z).sort((p, q) => p - q);
  // Ignore the odd actor parked far below the floor when picking the height band.
  const zLo = zs[Math.floor(zs.length * 0.02)], zHi = zs[Math.ceil(zs.length * 0.98) - 1];
  const r = {
    minX: Math.min(...xs) - PAD, maxX: Math.max(...xs) + PAD,
    minY: Math.min(...ys) - PAD, maxY: Math.max(...ys) + PAD,
    minZ: zLo - 1500, maxZ: zHi + 1500,
    floorMinZ: zLo - 1500, floorMaxZ: zHi + 800, // gameplay actors stand on the floors; rock tops sit above them
  };
  const own = teleporters.filter(t => t.x >= r.minX && t.x <= r.maxX && t.y >= r.minY && t.y <= r.maxY && t.z >= r.minZ && t.z <= r.maxZ);
  const stems = [...new Set(own.map(t => stem(destination(t))))];
  // The entrance is a teleporter outside this area that shares a stem with one inside it.
  const entrances = teleporters.filter(t => !own.includes(t) && stems.includes(stem(destination(t))))
    .map(t => ({ x: t.x, y: t.y, z: t.z, to: destination(t) }));
  const name = stems.length ? pretty(stems.sort((p, q) => p.length - q.length)[0]) : null;
  // Where gameplay things stand: the floor plan keeps only floors that something stands on.
  const points = actors.filter(a => !/Torch|Light|Trap|NoMount|Reverb|Volume|Marker/.test(a.cls)).map(a => [a.x, a.y, a.z]);
  regions.push({ ...r, actors: actors.length, name, stems, entrances, points });
}
regions.sort((a, b) => b.actors - a.actors);
regions.forEach((r, i) => { r.id = 'D' + String(i + 1).padStart(2, '0'); });
fs.writeFileSync(path.join(out, 'raw/dungeon-regions.json'), JSON.stringify(regions, null, 1));
console.log(`Dungeons: ${regions.length} areas`);
for (const r of regions) console.log(`  ${r.id} ${r.name || '?'} (${r.actors} actors, ${Math.round((r.maxX - r.minX) / 100)}x${Math.round((r.maxY - r.minY) / 100)} m, z ${r.minZ}..${r.maxZ}, ${r.entrances.length} entrances)`);
