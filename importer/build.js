// Crawls the wiki (via a source) and builds the overlay database.
const { parsePage, parseZones } = require('./parse');

const key = (name) => (name || '').toLowerCase().trim();

/**
 * @param source  {getPage(title), listCategory(cat)}
 * @param opts    {maxPages, onProgress(msg, done, total)}
 */
async function buildDb(source, { maxPages = 3000, onProgress = () => {} } = {}) {
  const pages = new Map(); // key(name) -> parsed page
  const alias = new Map(); // key(requested title) -> canonical name
  const queued = new Set();
  const queue = [];
  const enqueue = (t) => {
    if (!t || queued.has(key(t))) return;
    queued.add(key(t));
    queue.push(t);
  };

  onProgress('Reading monster list…', 0, 1);
  const monstersPage = await source.getPage('Monsters');
  const zones = monstersPage ? parseZones(monstersPage.html) : [];
  zones.forEach((z) => z.monsters.forEach((m) => enqueue(m.page)));

  for (const cat of ['Monsters', 'Items']) {
    onProgress(`Listing category ${cat}…`, 0, 1);
    try {
      (await source.listCategory(cat)).forEach(enqueue);
    } catch (e) {
      onProgress(`Could not list ${cat}: ${e.message}`, 0, 1);
    }
  }

  let done = 0;
  let failed = 0;
  while (queue.length && done < maxPages) {
    const title = queue.shift();
    done++;
    onProgress(title, done, done + queue.length);
    let raw;
    try {
      raw = await source.getPage(title);
    } catch (e) {
      failed++;
      continue;
    }
    if (!raw) continue;
    const p = parsePage(raw);
    alias.set(key(title), p.name);
    if (pages.has(key(p.name))) continue;
    pages.set(key(p.name), p);
    // Follow everything that can drop, be crafted from, or be crafted.
    p.drops.forEach((d) => enqueue(d.page));
    p.sources.forEach((s) => enqueue(s.page));
    p.recipes.forEach((r) => [...r.materials, ...r.outputs].forEach((m) => enqueue(m.page)));
  }

  return assemble(pages, alias, zones, { source: source.name, crawled: done, failed, truncated: queue.length > 0 });
}

function assemble(pages, alias, zones, meta) {
  const canon = (name) => {
    if (!name) return name;
    const a = alias.get(key(name));
    if (a) return a;
    const p = pages.get(key(name));
    return p ? p.name : name;
  };
  const entities = {};
  const ensure = (name, icon) => {
    const n = canon(name);
    if (!entities[n]) entities[n] = { name: n, kind: 'item', icon: null, droppedBy: [], recipes: [], usedIn: [], drops: [], shops: [], location: [] };
    if (icon && !entities[n].icon) entities[n].icon = icon;
    return entities[n];
  };

  for (const p of pages.values()) {
    const e = ensure(p.name);
    Object.assign(e, {
      kind: p.kind, type: p.type, desc: p.desc, image: p.image, level: p.level,
      weakness: p.weakness, location: p.location, categories: p.categories,
      shops: p.shops.map((s) => canon(s.page || s.name)),
    });
  }

  const addSource = (item, src) => {
    if (!item.droppedBy.some((s) => key(s.from) === key(src.from) && s.rarity === src.rarity)) item.droppedBy.push(src);
  };

  for (const p of pages.values()) {
    const e = entities[canon(p.name)];
    e.drops = p.drops.map((d) => {
      const item = ensure(d.page || d.name, d.icon);
      addSource(item, { from: e.name, qty: d.qty, rarity: d.rarity, pct: d.pct, group: d.group });
      return { item: item.name, qty: d.qty, rarity: d.rarity, pct: d.pct, group: d.group };
    });
    for (const s of p.sources) addSource(e, { from: canon(s.page || s.name), qty: s.qty, rarity: s.rarity, pct: s.pct, group: s.group });
    for (const r of p.recipes) {
      const recipe = {
        facility: r.facility,
        skills: r.skills,
        materials: r.materials.map((m) => ({ item: ensure(m.page || m.name, m.icon).name, qty: m.qty })),
        outputs: r.outputs.map((o) => ({ item: ensure(o.page || o.name, o.icon).name, qty: o.qty })),
      };
      // A recipe can appear on several pages; store it once per output item.
      for (const o of recipe.outputs) {
        const out = entities[o.item];
        const sig = JSON.stringify([recipe.facility, recipe.materials]);
        if (!out.recipes.some((x) => JSON.stringify([x.facility, x.materials]) === sig)) out.recipes.push(recipe);
      }
    }
  }

  // Reverse index: what each material is used in.
  for (const e of Object.values(entities)) {
    for (const r of e.recipes) {
      for (const m of r.materials) {
        const mat = entities[m.item];
        if (mat && !mat.usedIn.some((u) => u.item === e.name)) mat.usedIn.push({ item: e.name, qty: m.qty, facility: r.facility });
      }
    }
  }

  // Icons: prefer the infobox image if no small icon was seen in a table.
  for (const e of Object.values(entities)) e.icon = e.icon || e.image || null;

  const outZones = zones.map((z) => ({
    name: z.name,
    monsters: [...new Set(z.monsters.map((m) => canon(m.page)))],
  }));
  // Monsters whose infobox names a location missing from the zone tables.
  for (const e of Object.values(entities)) {
    if (e.kind !== 'monster') continue;
    for (const loc of e.location) {
      const z = outZones.find((z) => key(z.name) === key(loc));
      if (z && !z.monsters.includes(e.name)) z.monsters.push(e.name);
    }
  }

  return {
    meta: { ...meta, generatedAt: new Date().toISOString(), pages: pages.size, entities: Object.keys(entities).length },
    zones: outZones,
    entities,
  };
}

module.exports = { buildDb };
