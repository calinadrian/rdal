// Turns rendered Dragonwilds Wiki page HTML into plain data.
// Works on both `action=parse` output and full archived page HTML.
const cheerio = require('cheerio');

const WIKI = 'https://dragonwilds.runescape.wiki';

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function absUrl(src) {
  if (!src) return null;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return WIKI + src.replace(/^\/web\/\d+\w*_\/https?:\/\/[^/]+/, '');
  return src.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\w*_\//, '');
}

// Page title a link points at, or null for non-article links.
function linkTitle($a) {
  const href = $a.attr('href') || '';
  const m = href.match(/\/w\/([^?#]+)/);
  if (!m) return $a.hasClass('selflink') ? clean($a.text()) : null;
  const t = decodeURIComponent(m[1]).replace(/_/g, ' ');
  return /^(File|Category|Special|Template|Update|Help|User|RuneScape):/.test(t) ? null : t;
}

// Name + page of the main thing in a table cell (last text link wins over icon link).
function cellRef($, td) {
  const $td = $(td);
  let page = null;
  $td.find('a').each((_, a) => {
    const t = linkTitle($(a));
    if (t && clean($(a).text())) page = t;
  });
  if (!page) $td.find('a').each((_, a) => { page = page || linkTitle($(a)); });
  const icon = $td.find('img').first().attr('src');
  return { name: clean($td.text()) || page, page, icon: absUrl(icon) };
}

function num(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Rarity text such as "Always", "2/100" or "5.56/100" -> percent.
function rarityPercent(text, $td) {
  const span = $td && $td.find('[data-drop-percent]').attr('data-drop-percent');
  if (span) return num(span);
  if (/^always$/i.test(text)) return 100;
  const m = text.match(/^([\d.,]+)\s*\/\s*([\d.,]+)$/);
  if (m) return (num(m[1]) / num(m[2])) * 100;
  const p = text.match(/^([\d.]+)\s*%$/);
  return p ? num(p[1]) : null;
}

// Top-level nodes of each h2 section, keyed by heading id.
function sections($, $root) {
  const out = {};
  let cur = null;
  $root.children().each((_, el) => {
    const $el = $(el);
    const h2 = $el.is('h2') ? $el : $el.hasClass('mw-heading2') ? $el.find('h2') : null;
    if (h2 && h2.length) {
      cur = { title: clean(h2.text()), nodes: [] };
      out[h2.attr('id') || cur.title] = cur;
    } else if (cur) {
      cur.nodes.push(el);
    }
  });
  return out;
}

function headers($, table) {
  return $(table).find('tr').first().find('th').map((_, th) => clean($(th).text())).get();
}

// Item/Source | Quantity | Rarity tables, grouped by the h3 above them.
function rarityTables($, nodes, firstHeader) {
  const rows = [];
  let group = null;
  for (const el of nodes) {
    const $el = $(el);
    const h3 = $el.is('h3') ? $el : $el.find('h3');
    if (h3.length && !$el.is('table')) { group = clean(h3.first().text()); continue; }
    const tables = $el.is('table') ? $el : $el.find('table');
    tables.each((_, t) => {
      const h = headers($, t);
      if (h[0] !== firstHeader || !h.includes('Rarity')) return;
      const qi = h.indexOf('Quantity');
      const ri = h.indexOf('Rarity');
      $(t).find('tr').slice(1).each((_, tr) => {
        const tds = $(tr).children('td');
        if (tds.length < h.length) return;
        const ref = cellRef($, tds[0]);
        const rarity = clean($(tds[ri]).text());
        rows.push({
          ...ref,
          qty: qi >= 0 ? clean($(tds[qi]).text()) : '',
          rarity,
          pct: rarityPercent(rarity, $(tds[ri])),
          group,
        });
      });
    });
  }
  return rows;
}

// Recipe template tables: Requirements / Facility / Skill / Material / Output blocks.
function recipes($, nodes) {
  const out = [];
  for (const el of nodes) {
    $(el).find('table').addBack('table').each((_, t) => {
      if (!$(t).find('th.recipe-title').length) return;
      const r = { variant: $(t).closest('.tabbertab').attr('data-title') || null, facility: null, skills: [], materials: [], outputs: [] };
      let mode = null;
      $(t).find('tr').each((_, tr) => {
        const ths = $(tr).children('th').map((_, th) => clean($(th).text())).get();
        const tds = $(tr).children('td');
        if (ths.length) {
          mode = { Skill: 'skills', Material: 'materials', Output: 'outputs' }[ths[0]] || null;
          return;
        }
        if (tds.length < 2) return;
        const label = clean($(tds[0]).text());
        if (label === 'Facility') { r.facility = cellRef($, tds[1]).name; return; }
        if (!mode) return;
        const ref = cellRef($, tds[0]);
        if (mode === 'skills') r.skills.push({ skill: ref.name, xp: num($(tds[1]).text()) });
        else r[mode].push({ ...ref, qty: num($(tds[1]).text()) ?? clean($(tds[1]).text()) });
      });
      if (r.outputs.length || r.materials.length) out.push(r);
    });
  }
  return out;
}

function infobox($, $root) {
  const box = $root.find('.infobox').first();
  if (!box.length) return { fields: {}, image: null };
  const fields = {};
  box.find('.infobox-row-container').each((_, row) => {
    if ($(row).closest('.infobox-switch-resources').length) return;
    const label = clean($(row).find('.infobox-row-label').first().text());
    if (!label || fields[label]) return;
    const $v = $(row).find('.infobox-row-value').first();
    const items = $v.find('li');
    fields[label] = items.length ? items.map((_, li) => clean($(li).text())).get() : clean($v.text());
  });
  const img = box.find('.infobox-image img').first().attr('src');
  return { fields, image: absUrl(img) };
}

// Shops table (if any) under "Shop locations": first column is the seller.
function shops($, nodes) {
  const out = [];
  let inShops = false;
  for (const el of nodes) {
    const $el = $(el);
    const h3 = $el.find('h3').addBack('h3');
    if (h3.length) { inShops = /shop/i.test(h3.text()); continue; }
    if (!inShops) continue;
    $el.find('table').addBack('table').each((_, t) => {
      $(t).find('tr').slice(1).each((_, tr) => {
        const td = $(tr).children('td')[0];
        if (td) out.push(cellRef($, td));
      });
    });
  }
  return out;
}

const asList = (v) => (Array.isArray(v) ? v : v ? v.split(/\s*,\s*/) : []);

/**
 * @param {{title: string, html: string, categories: string[]}} page
 */
function parsePage({ title, html, categories = [] }) {
  const $ = cheerio.load(html);
  let $root = $('#mw-content-text .mw-parser-output').first();
  if (!$root.length) $root = $('.mw-parser-output').first();
  if (!$root.length) $root = $('body');
  $root.find('.navbox, .mw-editsection, .crafting-tree, style, script').remove();

  const { fields, image } = infobox($, $root);
  const secs = sections($, $root);
  const sec = (...ids) => ids.map((id) => secs[id]).find(Boolean)?.nodes || [];

  const drops = rarityTables($, sec('Drops', 'Loot', 'Contents', 'Rewards'), 'Item');
  const isMonster = categories.includes('Monsters');
  const isItem = !isMonster && (categories.includes('Items') || 'Weight' in fields || 'Stack limit' in fields);
  const firstPara = clean($root.children('p').filter((_, p) => clean($(p).text()).length > 20).first().text());

  return {
    name: title,
    kind: isMonster ? 'monster' : isItem ? 'item' : 'other',
    type: typeof fields.Type === 'string' ? fields.Type : null,
    desc: (typeof fields.Description === 'string' && fields.Description) || firstPara || null,
    image,
    level: fields['Power Level'] || fields['Combat'] || null,
    weakness: typeof fields.Weakness === 'string' ? fields.Weakness : null,
    location: asList(fields.Location),
    categories,
    drops,
    recipes: recipes($, sec('Recipe', 'Recipes', 'Creation')),
    sources: rarityTables($, sec('Item_sources', 'Sources'), 'Source'),
    shops: shops($, sec('Item_sources', 'Sources')),
  };
}

// Monsters page: one h2 per zone, each with a table whose first column links monsters.
function parseZones(html) {
  const $ = cheerio.load(html);
  let $root = $('.mw-parser-output').first();
  if (!$root.length) $root = $('body');
  $root.find('.mw-editsection').remove();
  const zones = [];
  for (const [id, s] of Object.entries(sections($, $root))) {
    if (/update_history|^see_also/i.test(id)) continue;
    const monsters = [];
    for (const el of s.nodes) {
      $(el).find('table').addBack('table').each((_, t) => {
        const h = headers($, t);
        if (h[0] !== 'Name') return;
        $(t).find('tr').slice(1).each((_, tr) => {
          const td = $(tr).children('td')[0];
          if (!td) return;
          const ref = cellRef($, td);
          if (ref.page) monsters.push({ name: ref.name, page: ref.page, level: clean($($(tr).children('td')[1]).text()) });
        });
      });
    }
    if (monsters.length) zones.push({ name: s.title, monsters });
  }
  return zones;
}

// Links listed on a category page (for sources that cannot query the API).
function parseCategoryPage(html) {
  const $ = cheerio.load(html);
  const grab = (sel) => $(sel).find('a').map((_, a) => linkTitle($(a))).get().filter(Boolean);
  return { pages: grab('#mw-pages .mw-category'), subcats: $('#mw-subcategories a').map((_, a) => {
    const m = ($(a).attr('href') || '').match(/\/w\/Category:([^?#]+)/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
  }).get().filter(Boolean) };
}

// Pulls title/categories/content out of a full (non-API) page.
function fromFullPage(html) {
  const cats = html.match(/"wgCategories":(\[[^\]]*\])/);
  const title = html.match(/"wgTitle":"((?:[^"\\]|\\.)*)"/);
  return {
    title: title ? JSON.parse(`"${title[1]}"`) : null,
    categories: cats ? JSON.parse(cats[1]) : [],
    html,
  };
}

module.exports = { parsePage, parseZones, parseCategoryPage, fromFullPage, absUrl, WIKI };
