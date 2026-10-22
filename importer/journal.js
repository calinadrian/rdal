// Resolve the journal's own category -> group -> entry -> item references.
function buildJournal(bulk, { base, text, item, entities, imagePath = id => `journal/${id}.png` }) {
  const exports = Object.values(bulk).flat();
  const byId = new Map(exports.map(e => [e.Name, e]));
  const category = byId.get('JOURNAL_Category_Recipes');
  const categories = [];
  let entries = 0;
  for (const sub of category?.Properties?.SubCategories || []) {
    const source = byId.get(base(sub.Value));
    if (!source) continue;
    const p = source.Properties;
    const name = text(p.Name);
    if (!name) continue;
    const groups = [];
    for (const g of p.Groups || [{ DisplayName: p.Name, Entries: p.Entries }]) {
      const names = [];
      for (const ref of g.Entries || []) {
        const entry = byId.get(base(ref));
        if (entry?.Type !== 'JournalEntryRecipeData') continue;
        const ep = entry.Properties;
        const n = item(ep.ItemData);
        if (!n || !entities[n]) continue;
        const image = base(ep.Image);
        const details = {
          id: entry.Name, category: name, group: text(g.DisplayName), title: text(ep.DisplayName) || n,
          notes: (ep.PageDescriptions || []).map(page => text(page.Description)).filter(Boolean),
          image: image ? imagePath(image) : null,
          recipeId: base(ep.RecipeData),
        };
        // The first listed entry is the journal's canonical page for a shared item.
        if (!entities[n].journal?.id) { entities[n].journal = { ...entities[n].journal, ...details }; entries++; }
        if (!names.includes(n)) names.push(n);
      }
      if (names.length) groups.push({ name: text(g.DisplayName) || name, items: names });
    }
    if (groups.length) categories.push({ id: source.Name, name, groups });
  }
  // Masterworks are also weapons/shields. Keep the native masterwork catalogue,
  // while making the same entries discoverable in their normal equipment groups.
  const masterworks=categories.find(c=>c.name==='Masterworks');
  for(const n of masterworks?.groups.flatMap(g=>g.items) || []) {
    const e=entities[n];e.journal.masterwork=true;
    const parts=(e.category || '').split(' / ');
    const last=parts.at(-1);
    const groupNames={Staff:'Staves',Shortbow:'Shortbows',Longbow:'Longbows',Crossbow:'Crossbows',Warhammer:'Warhammers',Club:'Clubs',Dagger:'Daggers',Wand:'Wands',Greataxe:'Greataxes',Mace:'Maces'};
    const shield=e.type==='Shields';
    const target=categories.find(c=>c.name===(shield ? 'Armour & Shields' : 'Weapons'));
    const groupName=shield ? 'Shields' : last==='Sword' ? (parts.includes('2H') ? 'Greatswords' : 'Swords') : groupNames[last] || 'Miscellaneous';
    const group=target?.groups.find(g=>g.name===groupName);
    if(group && !group.items.includes(n))group.items.push(n);
  }
  return { categories, entries };
}
module.exports = { buildJournal };
