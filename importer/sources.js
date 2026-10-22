// Page sources for the importer. Each source is built on a `fetchText(url) -> {status, text}`
// so the same code runs from Node (CLI) or through a hidden Electron browser window.
const fs = require('fs');
const path = require('path');
const { fromFullPage, parseCategoryPage, WIKI } = require('./parse');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (t) => t.replace(/ /g, '_');

// Retries on rate limits / server errors with backoff.
async function fetchRetry(fetchText, url, { tries = 4, delay = 400 } = {}) {
  for (let i = 0; ; i++) {
    const res = await fetchText(url);
    if (res.status === 200 || res.status === 404 || i >= tries) return res;
    await sleep(delay * 2 ** (i + 1) * (res.status === 429 ? 5 : 1));
  }
}

// Disk cache so re-imports only fetch what is missing.
// `offline` builds only from what is already cached.
function withCache(source, dir, fresh, offline = false) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (t) => path.join(dir, encodeURIComponent(t.toLowerCase()) + '.json');
  return {
    ...source,
    ...(offline && {
      // Every cached page, so nothing fetched earlier is left out.
      listCategory: async (cat) => cat !== 'Items' ? [] : fs.readdirSync(dir)
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
        .filter(Boolean).map((p) => p.title),
    }),
    async getPage(title) {
      const f = file(title);
      if (!fresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
      if (offline) return null;
      const page = await source.getPage(title);
      fs.writeFileSync(f, JSON.stringify(page));
      return page;
    },
  };
}

// Live wiki: MediaWiki API.
function wikiSource(fetchText, { delay = 250 } = {}) {
  const api = async (params) => {
    await sleep(delay);
    const url = `${WIKI}/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    const res = await fetchRetry(fetchText, url);
    if (res.status !== 200) throw new Error(`wiki API ${res.status} for ${params.page || params.cmtitle || ''}`);
    return JSON.parse(res.text);
  };
  return {
    name: 'wiki',
    async getPage(title) {
      const r = await api({ action: 'parse', page: title, prop: 'text|categories', redirects: '1' });
      if (r.error) return null;
      return {
        title: r.parse.title,
        html: r.parse.text,
        categories: (r.parse.categories || []).filter((c) => !c.hidden).map((c) => c.category.replace(/_/g, ' ')),
      };
    },
    async listCategory(cat) {
      const out = [];
      let cont = {};
      do {
        const r = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:' + cat, cmlimit: '500', cmnamespace: '0', ...cont });
        out.push(...r.query.categorymembers.map((m) => m.title));
        cont = r.continue || null;
      } while (cont);
      return out;
    },
  };
}

// Internet Archive snapshots of wiki pages (for when the wiki itself is unavailable).
function waybackSource(fetchText, { delay = 1500 } = {}) {
  const get = async (title) => {
    await sleep(delay);
    const res = await fetchRetry(fetchText, `https://web.archive.org/web/2026id_/${WIKI}/w/${encodeURIComponent(slug(title))}`, { delay: 1500 });
    return res.status === 200 ? res.text : null;
  };
  return {
    name: 'wayback',
    async getPage(title) {
      // Redirect titles ("Goblin archer") are rarely archived; the target usually is Title Case.
      const titled = title.replace(/(^|\s)(\p{Ll})/gu, (m, s, c) => s + c.toUpperCase());
      const html = (await get(title)) || (titled !== title ? await get(titled) : null);
      if (!html) return null;
      const p = fromFullPage(html);
      return { ...p, title: p.title || title };
    },
    async listCategory(cat, seen = new Set()) {
      if (seen.has(cat)) return [];
      seen.add(cat);
      const html = await get('Category:' + cat);
      if (!html) return [];
      const { pages, subcats } = parseCategoryPage(html);
      for (const sc of subcats) pages.push(...(await this.listCategory(sc, seen)));
      return pages;
    },
  };
}

// Plain Node fetch (works for the Wayback Machine; the wiki may require a browser).
async function nodeFetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'DragonwildsAtlasLoot/0.1 (personal overlay; https://dragonwilds.runescape.wiki)' } });
  let buf = Buffer.from(await r.arrayBuffer());
  // Archived pages are sometimes stored still gzipped, without a Content-Encoding header.
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = require('zlib').gunzipSync(buf);
  return { status: r.status, text: buf.toString('utf8') };
}

module.exports = { wikiSource, waybackSource, withCache, nodeFetchText };
