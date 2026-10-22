// Builds data/db.json from the raw game exports in tools/Extractor/out (see tools/extract-all.ps1).
// Usage: node importer/game.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'tools', 'Extractor', 'out', 'raw');
const load = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
// Exported pictures are WebP (tools/Extractor webp); PNG still works for data exported before that.
const picture = (dir, name) => ['webp', 'png'].map((ext) => `${dir}/${name}.${ext}`).find((p) => fs.existsSync(path.join(ROOT, 'data', p))) || null;
// Item icons and the world map: keep the old .png path when nothing was exported, as before.
const iconPath = (name) => picture('icons', name) || `icons/${name}.png`;
const { questLocationSteps } = require('./quest-locations');
let questSteps = new Map();
try { questSteps = questLocationSteps(load('quest-flows.json')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const exportsOf = (bulk) => Object.entries(bulk).map(([pkg, ex]) => ({ id: base(pkg), pkg, ex }));

// "/Game/.../ITEM_X.ITEM_X", "/Game/.../ITEM_X.0", "ItemData'ITEM_X'", ".../ITEM_X.uasset" -> "ITEM_X"
function base(ref) {
  if (!ref) return null;
  const s = typeof ref === 'string' ? ref : ref.AssetPathName || ref.ObjectPath || ref.ObjectName || '';
  const q = s.match(/'([^']+)'/);
  const p = (q ? q[1] : s).split(/[/:]/).pop();
  return p.replace(/\.uasset$/, '').replace(/\.[^.]*$/, '').replace(/_C$/, '') || null;
}
// String tables (quest names/objectives are stored by key): "ST_X" -> { key: text }.
const stringTables = {};
try {
  for (const ex of Object.values(load('stringtables.json')))
    for (const e of ex) if (e.StringTable) stringTables[e.Name] = e.StringTable.KeysToEntries || {};
} catch {}
const text = (t) => (t && (t.LocalizedString || t.SourceString || t.CultureInvariantString
  || (t.TableId && stringTables[base(t.TableId)]?.[t.Key]))) || null;
const animaVents = {};
try {
  for (const exports of Object.values(load('anima-vents.json'))) for (const e of exports) {
    if (e.Type !== 'AnimaVentData') continue;
    const p = e.Properties;
    const type = e.Name.replace(/^AVD_/, '');
    const hex = p.AnimaVentVFX?.LightColor?.Hex;
    animaVents[e.Name] = { type, name: text(p.DisplayName) || `${type} Anima Vent`,
      color: /^[\da-f]{6}$/i.test(hex || '') ? '#' + hex : '#a0a0a0',
      icon: `mapicons/T_Rune_${type === 'Fire' ? 'Fire1' : type}.png` };
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\s*v\d+$/i, '').replace(/\s+/g, ' ').trim();
const qtyText = (min, max) => (min === max ? String(min) : `${min}–${max}`);
const pctText = (p) => (p >= 100 ? 'Always' : `${+p.toFixed(p < 1 ? 2 : 1)}%`);

const entities = {};
function ensure(name, kind) {
  if (!entities[name]) entities[name] = { name, kind, type: null, desc: null, icon: null, drops: [], droppedBy: [], recipes: [], usedIn: [], shops: [], location: [] };
  return entities[name];
}

/* ---------- Items ---------- */
const itemName = {}; // ITEM id -> display name
const { itemStats } = require('./item-stats');
const { itemEffects } = require('./item-effects');
let statTables = {};
try { statTables = load('item-stats.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const statRows = Object.fromEntries(Object.entries(statTables).map(([pkg, ex]) => [base(pkg), Object.assign({}, ...ex.map(e => e.Rows || {}))]));
const statRow = handle => handle?.RowName && statRows[base(handle.DataTable)]?.[handle.RowName];
let journalCombat = {};
try { journalCombat = load('journal-combat.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const attackDamage = name => Object.values(journalCombat).flat().find(e => e.Name === `Default__${name}_C`)?.Properties?.DamageAmount;
const combatStats = { arrowMin: attackDamage('BP_Player_Shortbow_Quickshot'), arrowMax: attackDamage('BP_Player_Bow_FullDraw'), bolt: attackDamage('BP_Player_Crossbow_Quickshot') };
let weaponCombat = {};
try { weaponCombat = load('weapon-combat.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
combatStats.weaponDamage = require('./weapon-damage').buildWeaponCombat({ ...journalCombat, ...weaponCombat }, base);
const ITEM_TYPE = { WearableEquipmentData: 'Armour', HeldEquipmentData: 'Weapons & tools', ShieldData: 'Shields', TrinketItemData: 'Trinkets',
  RangedAmmoData: 'Ammunition', MagicAmmoData: 'Runes', FishingBaitAmmoData: 'Bait', SeedHeldEquipmentData: 'Seeds', HeldTreeSeedData: 'Seeds',
  FuelItemData: 'Fuel', JournalItemData: 'Journal', FishingRodHeldEquipmentData: 'Weapons & tools', SpadeToolEquipmentData: 'Weapons & tools',
  HarvestToolEquipmentData: 'Weapons & tools', HeldContainerEquipmentData: 'Containers', WhetstoneItemData: 'Whetstones' };

let unlockItemBulk = {}, extraRecipeBulk = {};
try { unlockItemBulk = load('unlock-items.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { extraRecipeBulk = load('extra-recipes.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const itemBulk = { ...load('items.json'), ...unlockItemBulk };
const recipeBulk = { ...load('recipes.json'), ...extraRecipeBulk };
for (const { id, pkg, ex } of exportsOf(itemBulk)) {
  const e = ex.find((x) => x.Name === id || x.Name === `Default__${id}_C`) || ex.find((x) => x.Properties && x.Properties.Name);
  const p = e && e.Properties;
  const name = p && text(p.Name);
  if (!name || /Deprecated|Test|Debug/i.test(pkg)) continue;
  let n = name;
  if (entities[n] && entities[n].id !== id) n = /RecipeUnlocker/.test(e.Type) ? `${name} (recipe pattern)` : `${name} (${words(id.replace(/^ITEM_/, ''))})`;
  const it = ensure(n, 'item');
  itemName[id] = n;
  const cat = p.Category && p.Category.TagName && p.Category.TagName !== 'None' ? p.Category.TagName.split('.').slice(1).map(words).join(' / ') : null;
  const consumable = /Consumables_(Food|Drink|Potion)/.exec(e.Type);
  Object.assign(it, {
    id,
    type: p.RecipesToUnlock ? 'Recipe unlock' : p.BuildingPieceToUnlock ? 'Construction plan' : consumable ? consumable[1] : ITEM_TYPE[e.Type] || cat || 'Materials',
    category: cat,
    desc: text(p.FlavourText) || text(p.Description) || null,
    icon: p.Icon && p.Icon.AssetPathName && p.Icon.AssetPathName !== 'None' ? iconPath(base(p.Icon.AssetPathName)) : null,
    weight: p.Weight ?? null,
    stack: p.MaxStackSize ?? null,
    journal: itemStats(p, statRow, base, combatStats),
    ...(e.Type === 'TrinketItemData' ? itemEffects(p, text) : {}),
  });
}
const item = (ref) => itemName[base(ref)] || null;
let journalBulk = {};
try { journalBulk = load('journal.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const { buildJournal } = require('./journal');
const journal = buildJournal(journalBulk, { base, text, item, entities, imagePath: (id) => picture('journal', id) });
let armourEffects = {};
try { armourEffects = load('armour-bonuses.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const { buildArmourSets } = require('./armour-sets');
const armourSets = buildArmourSets(entities, armourEffects, { text });

/* ---------- Stations, vendors, recipes ---------- */
const tables = load('tables.json');
const table = (re) => Object.entries(tables).filter(([k]) => re.test(k)).flatMap(([, ex]) => ex.filter((e) => e.Rows).map((e) => e.Rows));
const recipeWhere = {}; // RECIPE id -> [station names]
const addWhere = (ref, station) => {
  if (/^Test /.test(station)) return;
  const r = base(ref);
  (recipeWhere[r] ||= []).includes(station) || recipeWhere[r].push(station);
};

for (const rows of table(/DT_CraftingStationsDataTable/))
  for (const [row, r] of Object.entries(rows))
    for (const lab of r.LabeledRecipes || []) for (const c of lab.Collection || []) addWhere(c, words(row));
for (const rows of table(/DT_ProcessingStationDataTable/))
  for (const [row, r] of Object.entries(rows)) for (const c of r.Recipes || []) addWhere(c, words(row));
const vendors = new Set();
const vendorInfo = {};
for (const rows of table(/DT_VendorDataTable/))
  for (const [row, r] of Object.entries(rows)) {
    const facility=`Vendor: ${words(row)}`;
    vendorInfo[facility]={name:text(r.DisplayNameOverride) || words((r.VendorTag?.TagName || row).replace(/^Vendor\./,'')),
      region:row==='Fellhollow' ? 'Fellhollow' : row==='DowdunReach' ? 'Dowdun Reach' : /UmS_/.test(row) ? 'Umbral Sands' : null};
    vendors.add(facility);
    for (const lab of r.LabeledRecipes || []) for (const c of lab.Collection || []) addWhere(c, `Vendor: ${words(row)}`);
  }

let recipeCount = 0;
for (const { id, pkg, ex } of exportsOf(recipeBulk)) {
  if (/Deprecated|Test|Debug/i.test(pkg)) continue;
  // These are journal reference records for gathered/quest items, not crafting recipes.
  if (/^RECIPE_Journal_/.test(id)) continue;
  const p = (ex.find((x) => x.Properties && x.Properties.ItemsCreated) || {}).Properties;
  if (!p) continue;
  const outputs = (p.ItemsCreated || []).map((c) => ({ item: item(c.ItemData), qty: c.Count })).filter((o) => o.item);
  const materials = (p.ItemsConsumed || []).map((c) => ({ item: item(c.ItemData), qty: c.Count })).filter((m) => m.item);
  if (!outputs.length) continue;
  const skill = p.SkillUsedToCraft ? words(base(p.SkillUsedToCraft).replace(/^SKILL_/, '')) : null;
  for (const facility of recipeWhere[id] || ['Build menu / other']) {
    const recipe = { id, facility, skills: skill ? [{ skill, xp: null }] : [], materials, outputs, manualUnlockOnly: !!p.bIgnoreAutomaticUnlocks };
    for (const o of outputs) {
      ensure(o.item, 'item').recipes.push(recipe);
      if (facility.startsWith('Vendor: ')) entities[o.item].shops.includes(facility) || entities[o.item].shops.push(facility);
    }
    for (const m of materials) {
      const u = ensure(m.item, 'item').usedIn;
      for (const o of outputs) if (!u.some((x) => x.item === o.item && x.facility === facility)) u.push({ item: o.item, qty: m.qty, facility });
    }
    recipeCount++;
  }
}

/* ---------- Loot tables ---------- */
const lootRows = {}; // "TableName/Row" and "Row" -> row
for (const [k, ex] of Object.entries(tables)) {
  if (!/DT_LootDropTable/.test(k)) continue;
  for (const e of ex) for (const [row, r] of Object.entries(e.Rows || {})) { lootRows[`${base(k)}/${row}`] = r; lootRows[row] ||= r; }
}
const enemyRows = {};
for (const rows of table(/DT_(Composite)?EnemyLootDropTable/)) Object.assign(enemyRows, rows);

function lootFor(enemyRow) {
  const r = enemyRows[enemyRow];
  if (!r) return [];
  const levels = r.TablesByPowerLevel || [];
  const drops = [];
  for (const lvl of levels) {
    const group = levels.length > 1 ? `Power level ${lvl.MinimumPowerLevel}+` : null;
    for (const h of lvl.TableHandles || []) {
      const t = lootRows[`${base(h.DataTable)}/${h.RowName}`] || lootRows[h.RowName];
      if (!t) continue;
      const rowChance = t.DropChance ?? 100;
      for (const res of t.Resources || []) {
        const it = item(res.SpawnedItemData);
        if (!it) continue;
        const pct = (res.DropChance ?? 100) * rowChance / 100;
        drops.push({ item: it, qty: qtyText(res.MinimumDropAmount, res.MaximumDropAmount), pct, rarity: pctText(pct), group });
      }
    }
  }
  return drops;
}

/* ---------- Monsters ---------- */
const aiBulk = load('ai.json');
const aiName = {};
for (const [pkg, ex] of Object.entries(aiBulk)) {
  const cdo = ex.find((e) => e.Name.startsWith('Default__'));
  if (/_Data\.uasset$/.test(pkg) && cdo) aiName[base(pkg)] = text(cdo.Properties.AIName);
}
// Creature picture: the game's own journal page art (World → Fauna / Factions), exported to data/journal.
// A journal page names the AI data class whose kill unlocks it, which is how a creature finds its picture.
const parentOf = {}, dataOf = {};
for (const [pkg, ex] of Object.entries(aiBulk)) {
  const cls = ex.find((e) => e.Type === 'BlueprintGeneratedClass');
  const sup = cls?.Super || cls?.SuperStruct;
  if (sup) parentOf[base(pkg)] = base(sup.ObjectPath || sup.ObjectName);
  const cdo = ex.find((e) => e.Name.startsWith('Default__'));
  if (cdo?.Properties?.AIDataClass) dataOf[base(pkg)] = base(cdo.Properties.AIDataClass);
}
const nameKey = (s) => (s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
const pageByData = {}, pageByName = {};
for (const e of Object.values(journalBulk).flat()) {
  const p = e.Type === 'JournalEntryWorldData' && e.Properties;
  const image = p && base(p.Image);
  const file = image && picture('journal', image);
  if (!p?.UnlockCondition?.AIData || !file) continue;
  pageByData[base(p.UnlockCondition.AIData)] = file;
  const key = nameKey(text(p.DisplayName));
  if (key) pageByName[key] ||= file;
}
// Own data class first, then the parent blueprints' (regional variants such as _SW often inherit their
// base creature), then the base creature named without its region/variant tag (_Dowdun, _Flaming…),
// then the journal page with the same name.
const VARIANT_TAG = /_(DowdunReach|Dowdun|ScornedWilderness|SW|Flaming|Lightning|ChallengeMode)(?=_|$)/g;
function journalImageOf(cls, name) {
  const seen = new Set();
  for (let c = cls; c && !seen.has(c); c = parentOf[c]) {
    seen.add(c);
    // Characters without an AIDataClass of their own follow the game's naming: BP_AI_X_Character ↔ BP_AI_X_Data.
    for (let d = dataOf[c] || (c.endsWith('_Data') ? c : c.replace(/_Character$/, '_Data')); d && !seen.has('data:' + d); d = parentOf[d]) {
      seen.add('data:' + d);
      if (pageByData[d]) return pageByData[d];
    }
  }
  const plain = cls.replace(VARIANT_TAG, '');
  if (plain !== cls) {
    const found = journalImageOf(plain, null) || (dataOf[cls] && pageByData[dataOf[cls].replace(VARIANT_TAG, '')]);
    if (found) return found;
  }
  return (name && pageByName[nameKey(name)]) || null;
}
const npcImages = {};
const monsterOf = {}; // BP_AI_X_Character -> monster entity name
for (const [pkg, ex] of Object.entries(aiBulk)) {
  if (!/_Character(_\w+)?\.uasset$/.test(pkg)) continue;
  const cdo = ex.find((e) => e.Name.startsWith('Default__'));
  const lootComp = ex.find((e) => e.Properties && e.Properties.EnemyTableRowHandle);
  const row = lootComp && lootComp.Properties.EnemyTableRowHandle.RowName;
  const dataId = cdo && cdo.Properties.AIDataClass && base(cdo.Properties.AIDataClass);
  let name = (dataId && aiName[dataId]) || (row && words(row)) || words(base(pkg).replace(/^BP_AI_|_Character$/g, ''));
  const image = journalImageOf(base(pkg), name);
  if (image) npcImages[base(pkg)] = image;
  if (!row) { monsterOf[base(pkg)] = name; continue; }
  if (entities[name] && entities[name].kind !== 'monster') name = `${name} (creature)`;
  if (entities[name] && entities[name].lootRow && entities[name].lootRow !== row) name = `${name} (${words(row)})`;
  const m = ensure(name, 'monster');
  monsterOf[base(pkg)] = name;
  if (image && !m.image) m.image = image;
  if (m.lootRow) continue;
  m.lootRow = row;
  m.drops = lootFor(row);
  const hp = ex.find((e) => e.Properties && e.Properties.MaxHealth != null);
  m.health = hp ? hp.Properties.MaxHealth : null;
  const aff = (ex.find((e) => e.Properties && e.Properties.DamageTypeAffinities) || {}).Properties;
  const kinds = (want) => (aff ? aff.DamageTypeAffinities.filter((a) => a.Value.endsWith(want)).map((a) => a.Key.TagName.split('.').pop()) : []);
  m.weakness = kinds('Weakness').join(', ') || null;
  m.resistance = kinds('Resistance').join(', ') || null;
  m.type = 'Monster';
}

/* ---------- Chests ---------- */
const prefabRows = Object.assign({}, ...table(/DT_LootChests_Prefabs/));
const setRows = Object.assign({}, ...table(/DT_LootChest_Sets/));
const chestRowOf = {}; // chest class id -> prefab row
for (const [pkg, ex] of Object.entries(load('chests.json'))) {
  const m = JSON.stringify(ex).match(/"RowName":"([^"]+)"/);
  if (m) chestRowOf[base(pkg)] = m[1];
}
const setDrops = (row, group, scale = 1) => (setRows[row]?.SpawnableItems || []).map((s) => {
  const it = item(s.SpawnedItemData);
  const pct = (s.DropChance ?? 100) * scale;
  return it && { item: it, qty: qtyText(s.MinimumDropAmount, s.MaximumDropAmount), pct, rarity: pctText(pct), group };
}).filter(Boolean);
const chestName = (row) => `Chest: ${words(row.replace(/_Chest$/, '')).replace(/Tier(\d)/, 'Tier $1')}`;
for (const [row, r] of Object.entries(prefabRows)) {
  const c = ensure(chestName(row), 'container');
  c.type = 'Chest';
  for (const h of r.GuaranteedItemSets || []) c.drops.push(...setDrops(h.RowName, 'Guaranteed sets'));
  for (const s of r.GuaranteedStandaloneItems || []) {
    const it = item(s.SpawnedItemData || s.ItemData);
    if (it) c.drops.push({ item: it, qty: qtyText(s.MinimumDropAmount ?? 1, s.MaximumDropAmount ?? 1), pct: 100, rarity: 'Always', group: 'Guaranteed' });
  }
  const extra = JSON.stringify(r.AdditionalItemSets || []).match(/"RowName":"([^"]+)"/g) || [];
  const group = `Extra rolls (${qtyText(r.MinAdditionalSetRolls ?? 0, r.MaxAdditionalSetRolls ?? 0)})`;
  for (const m of extra) c.drops.push(...setDrops(m.slice(11, -1), group));
}

// Reverse index: who drops what.
for (const e of Object.values(entities))
  for (const d of e.drops) {
    const it = ensure(d.item, 'item');
    if (!it.droppedBy.some((s) => s.from === e.name && s.group === d.group)) it.droppedBy.push({ from: e.name, qty: d.qty, rarity: d.rarity, pct: d.pct, group: d.group });
  }

/* ---------- Quests ---------- */
const world = JSON.parse(fs.readFileSync(path.join(RAW, '..', 'world_actors.json'), 'utf8'));
const referencedQuests = new Set(world.filter(a => a.cls === 'BP_QuestLocation_C').map(a => base((a.props.Quest || '').split(' ')[0])));
const questName = {};
// Prefer the version used by placed quest locations. Keep other versions for live saves that use them.
const questVersions = {};
const questExports = exportsOf(load('quests.json')).sort((a, b) => Number(referencedQuests.has(b.id)) - Number(referencedQuests.has(a.id)) || a.pkg.localeCompare(b.pkg));
for (const { id, ex } of questExports) {
  const p = (ex.find((e) => e.Properties && e.Properties.QuestName) || {}).Properties;
  if (!p || !text(p.QuestName)) continue;
  const name = text(p.QuestName);
  const q = { name };
  questName[id] = name;
  q.id = id;
  q.type = p.bIsMainQuest ? 'Main quest' : p.bIsTaskQuest ? 'Task' : 'Side quest';
  q.desc = text(p.QuestDescription) || text(p.CompletedQuestDescription);
  q.completedDesc = text(p.CompletedQuestDescription);
  q.region = p.QuestRegion ? words(p.QuestRegion.split('::').pop()) : null;
  q.hidden = !!p.bHideInQuestList || /^\[PH\]/.test(q.name); // [PH] = unfinished placeholder quests
  // Objectives in quest order; the live log names the current one by key.
  q.objectives = (p.Objectives || []).map((o) => ({ key: o.Key, text: text(o.Value.Description) || words(o.Key), hint: text(o.Value.Hint) }));
  (questVersions[name] ||= []).push(q);
}
for (const [name, versions] of Object.entries(questVersions)) {
  const q = ensure(name, 'quest');
  Object.assign(q, versions[0]);
  if (versions.length > 1) q.versions = versions;
}
const { buildAcquisition } = require('./acquisition');
const acquisition = buildAcquisition({ itemBulk, recipeBulk, flows:load('quest-flows.json'), entities, item, base, questName });
const { questChain, applyQuestChain } = require('./quest-chain');
const questOrder = applyQuestChain(entities, questChain(load('quest-flows.json')));
const optionalBulk=name=>{try{return load(name);}catch(error){if(error.code!=='ENOENT')throw error;return {};}};
const {recipeDiscovery}=require('./recipe-discovery');
const recipeSources=recipeDiscovery({entities,recipeBulk,dispensers:optionalBulk('recipe-dispensers.json'),instances:optionalBulk('acquisition-world.json'),
  world,perks:optionalBulk('recipe-perks.json'),base,text,item});
const specialJournal = journal.categories.find(c => c.id === 'Journal_SC_Recipe_Materials_Special');
if (specialJournal) {
  const unlocks = Object.values(entities).filter(e=>e.type==='Recipe unlock').map(e=>e.name).sort((a,b)=>a.localeCompare(b));
  if (unlocks.length) specialJournal.groups.push({name:'Recipe vestiges & patterns',items:unlocks});
}

/* ---------- World: regions + markers ---------- */
const level = load('L_World.json');
const poolLandmarks = level.filter(e => e.Type === 'GameplayObjectRegistry')
  .flatMap(e => e.Properties?.Landmarks || []).filter(m => m.Category === 'ELandmarkCategory::CleansingPool');
const normalizeGuid = value => String(value || '').split(' ')[0].replace(/-/g, '').toUpperCase();
let npcVisibility = {};
try { npcVisibility = load('quest-npcs.json'); } catch {}
const placedNpcs = world.filter(a => /^BP_NPC_/.test(a.cls));
const actorPos = Object.fromEntries(world.map((a) => [a.name, a]));
const regions = [];
for (const r of level.filter((e) => e.Name.startsWith('BP_MapRegion_C'))) {
  const name = text(r.Properties.RegionName);
  const spline = level.find((e) => e.Type === 'SplineComponent' && JSON.stringify(e.Outer || '').includes(r.Name));
  const pts = spline?.Properties?.SplineCurves?.Position?.Points || spline?.Properties?.SplineCurves?.position?.Points;
  const at = actorPos[r.Name] || { x: 0, y: 0 };
  if (!name || !pts) continue;
  regions.push({ name, level: r.Properties.PowerLevel ?? null, poly: pts.map((p) => [Math.round(at.x + p.OutVal.X), Math.round(at.y + p.OutVal.Y)]) });
}
const inside = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const regionAt = (x, y) => regions.find((r) => inside(x, y, r.poly))?.name || null;

const spawnAI = {};
for (const [pkg, ex] of Object.entries(load('spawnpoints.json'))) {
  const cdo = ex.find((e) => e.Name.startsWith('Default__'));
  if (cdo && cdo.Properties.AIClass) spawnAI[base(pkg)] = base(cdo.Properties.AIClass);
}

// icon: path under data/. style: 'badge' = drawn as is (the game's own map badges),
// 'glyph' = white game glyph on a disc of the category colour, 'item' = item icon on a dark disc.
const CATS = [
  { id: 'monster', label: 'Monster spawns', color: '#b47aea', icon: null, style: 'circle' },
  { id: 'creature', label: 'Creature spawns', color: '#7a6448', icon: 'mapicons/T_Map_Icon_Animal.png', style: 'glyph' },
  { id: 'chest', label: 'Chests', color: '#f0c040', icon: iconPath('T_Icon_Dragon_chest'), style: 'item' },
  { id: 'quest', label: 'Quests', color: '#40a0ff', icon: 'mapicons/T_NavIcons_QuestMarker.png', style: 'badge' },
  { id: 'travel', label: 'Travel', color: '#ffffff', icon: 'mapicons/T_LodestoneMapIcon.png', style: 'badge' },
  { id: 'shrine', label: 'Shrines & pools', color: '#ff6060', icon: 'mapicons/T_HealthAltar_Map_Discovered.png', style: 'badge' },
  { id: 'agility', label: 'Agility courses', color: '#e08040', icon: 'mapicons/T_Agility_NewCourse.png', style: 'badge' },
  { id: 'ore', label: 'Ores & rocks', color: '#8a8aa0', icon: 'mapicons/T_Map_Icon_Ore.png', style: 'glyph' },
  { id: 'gather', label: 'Plants & gathering', color: '#4caf50', icon: 'mapicons/T_Map_Icon_Plant.png', style: 'glyph' },
  { id: 'fishing', label: 'Fishing', color: '#40d0d0', icon: iconPath('T_Icon_Fish_Beltfish'), style: 'item' },
  { id: 'lore', label: 'Lore', color: '#d080ff', icon: iconPath('T_Icon_Scroll'), style: 'item' },
  { id: 'recipe', label: 'Recipe learning & vendors', color: '#c9ad75', icon: iconPath('T_Icon_Scroll'), style: 'item' },
  { id: 'vent', label: 'Anima vents', color: '#e060b0', icon: 'mapicons/T_DR_Icon_Compass_FragmentCrystal.png', style: 'glyph' },
  { id: 'salvage', label: 'Salvage', color: '#a06a30', icon: 'mapicons/T_Map_Icon_Pin.png', style: 'glyph' },
];
const clean = (cls) => words(cls.replace(/^BP_/, '').replace(/_C$/, '')
  .replace(/(^|_)(OreNode|MiningRock|Spawner|Small|Medium|Large|Static|Persistant|Persistent|World|Base|DR|FH|SW|Shock|v\d+|[A-Z]\d|\d+|[a-dA-D])(?=_|$)/g, ''));
function categorize(a) {
  const c = a.cls;
  if (c.startsWith('BP_SpawnPoint_')) {
    const m = monsterOf[spawnAI[base(c)]] || words(c.replace(/^BP_SpawnPoint_|_C$/g, ''));
    // Monsters have loot tables; wildlife without one gets the creature icon.
    return entities[m] ? { c: 'monster', n: m, ref: m } : { c: 'creature', n: m };
  }
  if (/LootChest|BuriedChest|Treasure_Chest/.test(c)) {
    const row = chestRowOf[base(c)];
    const n = row ? chestName(row) : 'Chest';
    return { c: 'chest', n, ref: entities[n] ? n : null };
  }
  if (c === 'BP_QuestLocation_C') {
    const questId = base((a.props.Quest || '').split(' ')[0]);
    const q = questName[questId];
    const qlocation = (a.props.QuestLocationName || '').replace(/ \([^)]*\)$/, '');
    const side = q && entities[q].type !== 'Main quest';
    // NPC locations are the people you talk to (quest givers and turn-ins); the rest are objective areas.
    const npc = /::NPC/.test(a.props.Type || '');
    // Location names are often abbreviations (FTUE_RC, GM, WS): keep only ones that read like a person's name.
    let who = words((a.props.QuestLocationName || '').split(' ')[0].split('_').pop().replace(/^NPC(?=[A-Z])/, '')).replace(/\s*NPC$/, '');
    if (who.length < 4 || /\s[A-Z]$|^(Farm|Magic|Dog Days)$/.test(who) || (q && q.includes(who))) who = 'Quest giver';
    const npcName = n => words(n.cls.replace(/^BP_NPC_/, '').split('_').filter(t => !/^(FTUE|Quest|Dowdun|Fellhollow|UmS|SW|NPC|v\d+|\d+)$/i.test(t))[0] || 'Quest giver');
    const nearbyNpc = npc ? placedNpcs.filter(n => Math.hypot(n.x - a.x, n.y - a.y) < 2000
      && ((a.props.QuestLocationName || '').toLowerCase().includes(npcName(n).toLowerCase()) || Math.hypot(n.x - a.x, n.y - a.y) < 400))
      .sort((n, m) => Math.hypot(n.x - a.x, n.y - a.y) - Math.hypot(m.x - a.x, m.y - a.y))[0] : null;
    if (nearbyNpc && who === 'Quest giver') who = npcName(nearbyNpc);
    return {
      c: 'quest', n: q ? `${q}${npc ? ` · ${who}` : ''}` : 'Quest location', ref: q || null, questId, qnpc: npc || undefined,
      qlocation, qsteps: [...(questSteps.get(questId + '|' + qlocation) || [])],
      ...(nearbyNpc && npcVisibility[nearbyNpc.name] && { npcVisibility: npcVisibility[nearbyNpc.name] }),
      ...(side && { i: 'mapicons/T_NavIcons_QuestMarker_Secondary.png' }),
    };
  }
  if (/OreNode|MiningRock|RuneEssenceGeyser|SoulStone|PoisonRock/.test(c)) return { c: 'ore', n: clean(c) };
  if (/FishingNode/.test(c)) return { c: 'fishing', n: /_Net_/.test(c) ? 'Fishing spot (net)' : 'Fishing spot (rod)' };
  if (/Fishing/.test(c)) return { c: 'fishing', n: 'Fishing spot' };
  if (/LoreItem/.test(c)) {
    const ids = [a.props.JournalEntry, a.props.JournalEntry_VelgarsWrath]
      .map(value => base((value || '').split(' ')[0])).filter(Boolean);
    return { c: 'lore', n: 'Lore', discovery: { kind: 'journal', ids } };
  }
  if (/AnimaVent/.test(c)) {
    const vent = animaVents[base(a.props.AnimaVentData)];
    return vent ? { c: 'vent', n: vent.name, ventType: vent.type, color: vent.color, i: vent.icon }
      : { c: 'vent', n: 'Anima vent (type unconfirmed)', color: '#a0a0a0' };
  }
  if (/Salvage/.test(c)) return { c: 'salvage', n: clean(c) };
  if (c === 'BP_HealthShrine_C') return { c: 'shrine', n: 'Health shrine',
    discovery: { kind: 'shrines', ids: [normalizeGuid(a.props.UniqueShrineIdentifier)].filter(Boolean) } };
  if (c === 'BP_CleansingPool_Vines_C') {
    const landmark = poolLandmarks.find(m => Math.hypot(m.Location.X - a.x, m.Location.Y - a.y, m.Location.Z - a.z) < 10);
    return { c: 'shrine', n: 'Cleansing pool', i: 'mapicons/T_IG_Icon_Compass_CleansingPool.png',
      discovery: { kind: 'pois', ids: landmark ? [normalizeGuid(landmark.Identifier)] : [],
        absenceMeansUndiscovered: landmark?.bNeedsToBeDiscovered === true } };
  }
  if (/^BP_AgilityCourseStarter/.test(c)) return { c: 'agility', n: 'Agility course' };
  if (/Lodestone/.test(c)) return { c: 'travel', n: 'Lodestone' };
  if (/KebbitBurrow/.test(c)) return { c: 'travel', n: 'Kebbit burrow shortcut', i: 'mapicons/T_NavIcons_AtlasBurrow.svg' };
  if (/Teleporter|Portal/.test(c)) return { c: 'travel', n: clean(c), i: 'mapicons/T_NavIcons_Eldergate.png' };
  if (/^BP_Spawner_|Bush|Plant_|ThornyRoot|Mushroom|Vine|Flax|Herb/.test(c)) return { c: 'gather', n: clean(c) };
  return null;
}

const MAP = { minX: 198000 - 210000, minY: 91450 - 210000, size: 420000 };
const onMap = (a) => a.x >= MAP.minX && a.x <= MAP.minX + MAP.size && a.y >= MAP.minY && a.y <= MAP.minY + MAP.size;

// Dungeons (tools/dungeon-regions.js) with the floor plans the Extractor drew for them (data/dungeons).
// Their actors get the dungeon's id as `d` and are drawn on its plan instead of the world map.
let dungeons = [];
try {
  const plans = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dungeons', 'floorplans.json'), 'utf8'));
  const NAMES = { SW: 'Scorned Wilderness', Fuzan: "Fuzan's Lair", 'Kuldra Interior': 'Inside Kuldra' };
  let unnamed = 0;
  dungeons = load('dungeon-regions.json').map((r) => {
    // One plan per storey, lowest first; they share a frame. `heights` is a coarse floor-height grid
    // (cm, null = no floor) used to tell which storey a position is on.
    const levels = plans.filter((p) => p.id === r.id).sort((a, b) => a.level - b.level);
    if (!levels.length) return null;
    const plan = levels[0];
    // floorplans.json names the PNG the Extractor drew; the pipeline then converts it to WebP.
    const planImage = (file) => picture('dungeons', file.replace(/\.png$/, '')) || 'dungeons/' + file;
    return {
      id: r.id, name: NAMES[r.name] || r.name || `Hidden chamber ${++unnamed}`,
      image: planImage(plan.image),
      overview: plan.overview ? planImage(plan.overview) : null,
      frame: { minX: plan.minX, minY: plan.minY, res: plan.res, w: plan.w, h: plan.h },
      levels: levels.map((l) => ({ image: planImage(l.image), zLo: l.zLo, zHi: l.zHi, heights: l.heights })),
      bounds: { minX: r.minX, maxX: r.maxX, minY: r.minY, maxY: r.maxY, minZ: r.minZ, maxZ: r.maxZ },
      entrances: r.entrances.filter(onMap).map((e) => ({ x: e.x, y: e.y })),
    };
  }).filter(Boolean);
  // Same name twice (two halves of one place): number them so the picker can tell them apart.
  for (const d of dungeons) {
    const same = dungeons.filter((o) => o.name === d.name);
    if (same.length > 1) d.name += ` (${same.indexOf(d) + 1})`;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const dungeonAt = (a) => dungeons.find(({ bounds: b }) => a.x >= b.minX && a.x <= b.maxX && a.y >= b.minY && a.y <= b.maxY && a.z >= b.minZ && a.z <= b.maxZ);
const entranceTo = (a) => dungeons.find((d) => d.entrances.some((e) => Math.hypot(e.x - a.x, e.y - a.y) < 50));

const markers = [];
for (const a of world) {
  const dungeon = dungeonAt(a);
  const into = !dungeon && entranceTo(a);
  // Some entrances are not teleporters (Nightmare Crucible conduits), so they have no category of their own.
  let m = categorize(a) || (into && { c: 'travel' });
  if (!m || !(dungeon || onMap(a))) continue;
  if (into) m = { ...m, n: `${into.name} entrance`, i: 'mapicons/T_NavIcons_AtlasDungeon.svg', enter: into.id };
  const region = dungeon ? dungeon.name : regionAt(a.x, a.y);
  markers.push({ ...m, x: a.x, y: a.y, z: a.z, region, ...(dungeon && { d: dungeon.id }) });
  if (m.ref && region) {
    const e = entities[m.ref];
    if (!e.location.includes(region)) e.location.push(region);
  }
}

// Some quests place interactive quest-bound objects without BP_QuestLocation actors.
for(const a of world.filter(a=>a.cls!=='BP_QuestLocation_C' && a.props.Quest)) {
  const questId=base((a.props.Quest || '').split(' ')[0]);
  const name=questName[questId];if(!name)continue;
  const dungeon=dungeonAt(a);if(!dungeon&&!onMap(a))continue;
  if(markers.some(m=>m.ref===name && Math.hypot(m.x-a.x,m.y-a.y)<100))continue;
  markers.push({c:'quest',n:`${name} · ${clean(a.cls)}`,ref:name,questId,qlocation:a.name,qsteps:[],
    x:a.x,y:a.y,z:a.z,region:dungeon ? dungeon.name : regionAt(a.x,a.y),...(dungeon&&{d:dungeon.id})});
}
for(const source of recipeSources) {
  const a=source.actor,dungeon=dungeonAt(a);
  if(!dungeon&&!onMap(a))continue;
  const region=dungeon ? dungeon.name : regionAt(a.x,a.y);
  markers.push({c:'recipe',n:`${source.label} · ${source.name}`,ref:source.name,sourceId:a.name,recipe:source.recipe,
    x:a.x,y:a.y,z:a.z,region,...(dungeon&&{d:dungeon.id})});
}
for(const [facility,info] of Object.entries(vendorInfo)) {
  const matcher=info.name==='Death' ? /^BP_NPC_Death_C$/ : info.name==='Postie Pete' ? /BP_NPC_PostiePete_Dowdun_C/ : null;
  if(!matcher)continue;
  for(const a of world.filter(a=>matcher.test(a.cls))) {
    const dungeon=dungeonAt(a);if(!dungeon&&!onMap(a))continue;
    markers.push({c:'recipe',n:`Vendor · ${info.name}`,vendor:facility,x:a.x,y:a.y,z:a.z,
      region:dungeon ? dungeon.name : regionAt(a.x,a.y),...(dungeon&&{d:dungeon.id})});
  }
}
const { buildQuestGuidance } = require('./quest-guidance');
const questGuidanceAudit = buildQuestGuidance({ entities, flows: load('quest-flows.json'),
  interactions: optionalBulk('quest-interactions.json'), markers, base, text, dungeonAt, regionAt, onMap, npcVisibility });
acquisition.items=Object.values(entities).filter(e=>e.acquisition?.length).length;
const zones = [...regions, ...dungeons].map((r) => ({
  name: r.name,
  level: r.level ?? null,
  monsters: [...new Set(markers.filter((m) => m.c === 'monster' && m.ref && m.region === r.name).map((m) => m.ref))],
})).filter((z) => z.monsters.length).sort((a, b) => (a.level ?? 99) - (b.level ?? 99));

const availabilityAudit = require('./item-availability').auditAvailability(entities, markers);
const db = {
  meta: { source: 'game', generatedAt: new Date().toISOString(), entities: Object.keys(entities).length, pages: 0, recipes: recipeCount, markers: markers.length },
  zones,
  entities,
  journal,
  armourSets,
  acquisition,
  questChain: questOrder,
  questGuidanceAudit,
  availabilityAudit: { reviewedAt: availabilityAudit.reviewedAt, total: availabilityAudit.total, counts: availabilityAudit.counts },
  vendors: vendorInfo,
  map: {
    image: picture('map', 'T_WorldMap_Landmass') || 'map/T_WorldMap_Landmass.png',
    // World X maps to image u, world Y to image v (checked against 21k actor positions).
    bounds: MAP,
    categories: CATS,
    regions: regions.map((r) => ({ name: r.name, level: r.level, poly: r.poly })),
    markers,
    // Floor plans of the dungeons: world X/Y -> pixel ((x - minX) / res, (y - minY) / res) on `image`.
    dungeons,
    // Live creature class (BP_AI_X_Character) -> display name, for the tracker's npcs.
    npcNames: monsterOf,
    // Live creature class -> journal picture (path under data/).
    npcImages,
  },
};
db.meta.pages = Object.keys(entities).length;
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'db.json'), JSON.stringify(db));
fs.writeFileSync(path.join(ROOT, 'data', 'item-availability-audit.json'), JSON.stringify(availabilityAudit, null, 2));
const count = (k) => Object.values(entities).filter((e) => e.kind === k).length;
console.log(`db.json: ${count('item')} items, ${count('monster')} monsters, ${count('container')} chests, ${count('quest')} quests, ` +
  `${recipeCount} recipes, ${zones.length} zones, ${regions.length} regions, ${dungeons.length} dungeons, ${markers.length} markers`);
