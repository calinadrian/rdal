# User guide

[← README](../README.md)

## Using AtlasLoot

- It runs as a **separate window** (put it on a second monitor) and notices when the game starts: it opens
  automatically and shows your live position. ⚙ Settings can switch it to an always-on-top **overlay**
  and make it **start with Windows**, waiting in the tray until the game launches.
- **Ctrl+Shift+L** shows/hides it (change it in ⚙ Settings).
- UI preferences save automatically to the app's profile: map categories, creature pool, Follow me,
  map zoom/position, last open view, column widths and wishlist. Window settings are kept there too,
  including maximized state. Reopening or updating the app preserves them.
### Game map and minimap

- **Opening the game's map** (M, or the menu's Map tab) brings up AtlasLoot's map in its place: it covers the game's
  screen with just the map while the game's map is open and disappears with it (M or Esc in the game). It never takes
  the keyboard, so the game keeps it; the mouse pans, zooms and hovers. It only follows the game's real map, so
  nothing opens while you are alt-tabbed or typing, and switching away from the game puts it away. Afterwards the app
  is as you left it, on the same page: an overlay stays hidden, and a window goes back where it was (minimized if it
  was on the game's screen). The show/hide hotkey closes both maps and opens the ordinary AtlasLoot overlay;
  press it again to close the overlay and return keyboard control to the game. The overlay and minimap hide
  when you switch to another application and return when you return to the game, unless you explicitly closed the overlay.
  It opens on you, still and uncluttered: **Quests · Explore · Gather · Everything** at the top choose what it shows
  in one click (**Customize** opens the full filters), your tracked quests sit top right (click one to see where to
  go), and **+ / − / centre on me** sit bottom right. Hovering a place says what it is, what it is for and what a
  click does.
- ⚙ Settings → **Show a minimap in the corner of the game** adds a WoW-style round minimap over the game while it runs
  (top-right by default; Small, Medium or Large). It follows your position and facing, north up or turned with the
  camera, and names the region or dungeon floor you are in. It shows what the map shows around you with the same
  filters: places, spawns, live creatures, other players, and your quests' target areas and tracked numbered gold
  rings, with an arrow on the rim pointing at each tracked objective that is out of view. The day and local time sit
  on the bottom of the rim, and like WoW your tracked quests are listed under the minimap, numbered as on the map,
  each with what to do next (click **Quests** to fold the list away). Clicks go through it to the game; **+** and
  **−** zoom, dragging the name bar moves it, and double-clicking the bar puts it back in the corner.
- Select a map marker for a gold direction arrow and live distance on the map and minimap. **Show locations** picks the nearest matching location on your current floor when possible; click another marker to change destination. The arrow follows your facing direction and reports arrival within 10 m. **Stop** ends navigation. Guidance uses a direct bearing, with dungeon/floor transitions labeled separately.
- Use **Add waypoint**, then click the map to place your own pin; Escape cancels placement. You can also right-click the map to place it directly. Click your pin again or use **Stop** to remove it. For dungeon icons, **left-click** selects the entrance as your destination and **right-click** opens the dungeon map. Custom pins on dungeon maps retain their floor; on an all-floors overview they use your current floor when inside that dungeon, otherwise Level 1.
- Settings → **Minimap sizes** adjusts minimap buttons, icons, clock/location text, and the quests below the minimap independently from 80% to 160%. **Quest list width** ranges from 70% to 200%, independently of text size. Changes save immediately, including when closing Settings without pressing Save. **Reset sizes** restores 100% for every control.
### Search and item details

- In item/monster/chest/quest panels, **Show locations** and named map links highlight where to find the selected entry.
- **Search everything** searches across the database; each section has a separately labeled filter, result count, and **Clear filter** button.
  **Clear search** returns to the page you searched from. Breadcrumbs and **Back** help you retrace item, source, recipe, and map links while keeping filters and scroll positions.
- Item details open when selected and have **Close details**. In compact windows they use the reading pane, with their own Back and breadcrumb controls.
  **Show locations**, **View recipe**, and **Add to wishlist** provide direct actions; descriptions expand on demand.
- Weapon stats show base attack damage from the current power-level tables and the item's referenced attacks.
  Melee values name the damage type (such as Slash, Stab or Crush) and show the normal combo range.
  Bows separate full-draw and quick-shot damage; crossbows show shot damage. Magic weapons label their rune damage multiplier.
  These values exclude ammunition, character skills, critical hits and target resistance; they are not live damage predictions.
- Processing recipes include station-upgrade requirements and the upgrade's build materials.
  Fine Cloth uses a Loom with a nearby Loom Harness: 3 Fine Thread and 1 Gold Bar make 1 Fine Cloth.
- Both world and dungeon maps use **Filters**, with a count of settings changed from the defaults and **Reset filters**.
  The map explains when filters, zoom, or missing live creature data leave no markers visible. The Map and Floor selectors identify what you are viewing.
### Quest journal and tracking

- Quest and recipe panels label saved progress with its last-read time. Unknown progress stays explicitly unknown; active quests put the current objective and its confirmed locations first.
- **Quests** opens the **Quest journal**: one section each for In progress, Ready to start, Not started and Completed, with
  how many quests you have finished. The first two are open; click a section (here or in the sidebar) to fold or open it, and
  your choice is remembered. Filtering opens every section. Search a quest name, place, item or objective; each row says what
  to do next (and "1 of 3 done" when the step has several places); click anywhere on a row to open its guide. A row's one control is **Track**.
- **Track** (or **Track quest** in a guide) pins a quest to the WoW-style quest tracker, listed under the minimap and on the map.
  Each tracked quest lists its current objective with what to do: places to go, creatures to slay and items to loot
  (with the creatures that drop them and the amount the objective asks for). Every line has a **Map** button. Tracked
  targets stay on the map whatever the filters: numbered gold rings mark places to go, and shaded areas mark where
  kill targets and drop sources spawn. Quests you accept are tracked automatically and drop off when completed.
  Like WoW (or Questie), every active quest marks the creatures its current objective asks you to hunt or loot
  from, tracked or not: each recorded spawn gets a red ring (gold for drop sources) and a shaded area on the map
  and minimap, whatever the filters. Untracked quests' targets just have no tracker number.
  Kill and loot counters are not in the game's quest log, so the tracker shows the amount needed, not your progress.
- Select a quest to open its guide, laid out like a quest journal page: the quest's type, region and tier, its title, your
  progress, **Track quest** and the wishlist. Then one card says what to do now (**Step 2 of 4** on linear quests, **How to start**
  before you begin) and lists the places for that step as a tick list, each with a **Map** button. Places you have finished
  (a ghost laid to rest, a Curse Seal broken, a standing stone read) are ticked off from the quest's own flags in your game,
  leave the tracker and map, and the card counts them ("1 of 3 done"); **Show all on map** frames the rest. Places inside a dungeon
  open the matching interior and floor, and **Entrance** shows how to get in. Hunting steps list the creatures with
  **Show where they live**, and **You need** lists the supplies, each opening its recipes and sources or its own **Map**.
  **Rewards** follow, then folded sections: **All steps**, **Story**, **Every place in this quest**, **Hints from conversations** and
  **Related quests & people**. Quests with alternate objectives or collection counters use a reference guide;
  they do not claim that preceding entries are complete. Missing or unrecognised progress never falls back to a supposed current task.
  Steps without fixed coordinates explain how to use crafting, gathering, contacts, or conversation hints instead.
  **Hints from conversations** exposes relevant conversations from the installed game. “Highlighting the Problem” includes the password statue inside Thishepen Kara, the outdoor wizard statue, all three charging pedestals, Windstep advice, and the password; its additional route advice links to the community wiki.
- Creatures show the game's own **journal pictures** (World → Fauna / Factions, exported to `data/journal`):
  above their drops, in the detail panel, as their icons in lists, on the live map and in the Nearby list.
  Each journal page names the creature whose kill unlocks it; regional variants (Scorned Wilderness, Dowdun Reach,
  challenge modes) use their base creature's page. 97 of the 100 monster entries have a picture; Kalphite Soldier,
  Garou Exile and Garou Lightning Berserker have no journal page and show the generic creature icon.
- **Quests** reads your quest log live from the game (and remembers it when the game is closed): quests are grouped
  into In progress, Ready to start, Not started and Completed. Unknown progress stays unknown. Besides each quest's step it reads
  the quest's flags and counters and which quest areas the game's own map shows: when a step has no exact place to interact
  with, its areas follow the game's map (ones it hides drop out, ones it shows for that quest come in), so the guide, tracker
  and minimap move on as soon as you do something in the game.
  Linear walkthroughs show the current step; alternate objectives and counters are kept separate from completion claims.
  Quest locations list each step and name steps that have no
  marked place. Each quest shows a **recommended tier**: the power level of the map regions its locations are in
  (quests without map locations show their area's usual level, marked "est."). Lists are sorted from the lowest tier.
  On the map, completed quests disappear, active ones get a blue frame and
  givers of quests you can take get a gold one.
- **Quest order** shows the quest chains (which quest the game gives you after which) as numbered steps, followed by
  the quests that need no earlier quest. Links come only from the game's quest-flow scripts. Quests that no current
  flow hands out, or only after a quest that is itself no longer given (the old tutorial's Right Tool for the Job and
  Seeking Shelter), are listed under **Removed from the game** with the reason and left out of the counts.
- Quest map markers show a **gold circle with ?** at confirmed quest-giving interactions and **step numbers** for linked locations;
  your current step is blue. Hover for the objective text, or click to see the selected location and jump
  between the quest's locations in the detail panel. A **dot** means the exported quest flow does not confirm
  a step for that marker. Unaccepted quests show only their confirmed starting interactions, even when tracked or highlighted;
  objective locations appear after acceptance. Some quests have multiple valid starts; quest prerequisites still apply.
### Map filters and discovery

- **Lore** and **Shrines & pools** each have their own **All / Undiscovered only** selector under the
  category in the map legend. Choices and the last recorded player progress are remembered. Lore uses
  unlocked journal entries, health shrines use shrine unlocks, and pools use confirmed discovery records.
  Unconfirmed locations stay visible; the legend shows how many records are still unconfirmed.
  Click a lore, shrine or pool marker to **Mark discovered** manually (or undo your mark). This is also
  how to track visited pools when the game has no discovery record for them. Manual marks are character-specific.
- Under **Quests** in the map legend, choose **All quests**, **Selected quests** (search and check one or
  several), or **My active quests** (updates from the live quest log, using saved progress while offline).
  The mode and selected list are remembered. Completed quests stay hidden in All mode; you can explicitly
  include one in Selected mode. **Show on map** includes the requested quest if your current filter excludes it.
  The separate **Steps** selector switches between **All steps** and **Current step only**. Current-only
  shows every confirmed location for the current objective, plus confirmed quest pickups for unstarted quests;
  unlinked steps stay hidden. Both settings are remembered. Clicking a specific earlier/later location in the
  quest details switches to All steps so the location you requested can be shown.
- **Anima vents** has a checkbox for each rune type, plus **All types / Clear**. Select one or several;
  your choices are remembered. Centered native rune symbols sit inside thin type-colored circles with transparent centers.
- Map: drag to pan, wheel to zoom. **Follow me** keeps you in the middle until you turn it off (a drag lets you
  look around, then it glides back after 3 s; zooming stays centred on you). It is remembered between launches. Ores & plants appear when zoomed in.
  Markers use the game's own map icons. **Live creatures** around you are glowing paws (amber, red when in
  combat, with a ring when suspicious), and the legend lists the nearest ones; click one with drops to see its loot.
  Open the dropdown under **Live creatures** and check any creature types to build a pool for the live map
  and Nearby. Search the list, choose **All creatures**, or **Clear** the pool. Your choices are remembered between launches.
### Dungeon maps

- **Dungeon maps**: the game has none, so the app draws parchment floor plans from the game's own navigation mesh:
  the floor creatures and players actually walk on, so rooms, doorways, bridges and stairs join up as they do in the game.
  Going through a dungeon door switches the map to that dungeon, and dungeons with stacked floors have a
  **Level** picker that follows you up and down stairs. Click an entrance on the world map, or use the map picker,
  to look inside any dungeon. Spawns, chests and other markers inside show on the right level.
  Choose **All floors** to see the full layout together, or select a level: ivory paths show that floor,
  with other floors in a subdued fill and dotted gaps in the wall where stairs carry on to them. Browsing a dungeon from outside starts with All floors; live entry
  still follows your current level. A manually selected overview stays open when you move between floors.
  Dungeon **Filters** open on demand, and the detail panel appears when you select an entry, leaving more room for the plan.
  Plans are drawn like a surveyed map: inked walls with hatched rock around them, a faint 5 m grid and a scale bar,
  tread lines where stairs and ramps climb, fine lines along ledges, and shading for slopes.
  Only floor joined to the dungeon's spawns, chests and exits is mapped. Invisible collision planes, and areas reached
  only through a gap in the rock far from anything in the dungeon, are left out. Floor that runs on past the mapped
  area fades out instead of ending in a wall.
- Play in **Borderless / Windowed** mode so the overlay can sit on top.

## Crafting and equipment

Crafting opens the game's actual recipe journal: its 12 categories, item groups, original illustrations
and full notes are linked directly from the journal assets. Select **Stations** to browse recipes by
workbench instead. **Read journal entry** in an item's detail panel opens its full journal page.
Select a material to follow its journal entry, sources and uses; Alt+Left returns to the previous page.
The journal filter searches all categories. The station filter accepts station names or item names.
Every recipe answers three questions in the same order: **You need** (materials), **Make it at**
(station; click it to see everything made there) and **Unlock**. **How to Craft** expands the
whole chain into numbered Collect and Craft steps, from raw materials to the finished item.
Armour tradeoffs retain negative values;
food and drink show their exported sustenance, hydration and other available values. Stats come
from item properties and referenced game tables; values that are absent are left out. These are
base values, before character skills and equipment modifiers.
Ammo damage uses the exported quickshot/full-draw attack values and the ammo damage fraction;
Stone Arrow displays +5–12, matching the in-game journal. Missing item defaults are not invented.

**Armour & Shields** groups matching head/body/leg pieces into named sets. Each set shows combined
defence, resistances, vital shield and weight, with a per-piece breakdown. Alternative helmets use a
variant picker and count once in the totals. Two-piece outfits include only their available pieces;
shields and standalone clothing remain individual entries. Light/medium/heavy armour bonuses come
from the game's effect definitions and appear separately from base totals. Click a piece for its full
journal entry and crafting materials; **View armour set** returns to its set overview.

**How to obtain** follows explicit recipe unlocks, quest grants and reward-pack contents from the game
assets. Vestiges and patterns link to the recipes they unlock; affected items link back to the vestige,
its recorded vendor and currency cost, drops or quest source. Sets show the route for each selected
piece. Quest details list items and recipes granted during that quest. Quest grants are attributed to
their flow branch, and unconfirmed sources are labelled rather than guessed. Recipe vestiges and
patterns can also be browsed under **Special** in the journal.

Recipes distinguish **Automatic** (material discovery), **Must be learned**, **Quest reward**, **Skill perk** and
**Unlock unconfirmed**. Explicit vestige, quest, perk and placed effigy/book references take priority
over standard material-discovery recipes. **Show on map** follows the actual acquisition chain,
including chest drops, learning points and vendor locations. Location buttons name the region or
dungeon and open the appropriate floor plan. Quest buttons show quest locations, using the linked
objective when available; they do not claim an unconfirmed reward pickup spot. Automatic recipes
offer a collapsible list of material map sources. Alt+Left returns from a source map to the item or set.

**Learned / Unlearned** tags read the current character's actual unlocked-recipe sets from the
running game, including automatic and temporary unlocks. Item lists mark both states; recipe
cards and set pieces show their status, and set headings show how many selected pieces are learned.
Character/session changes clear unconfirmed progress. Unreadable data stays unknown; an offline
snapshot is explicitly labelled **saved**. Journal visibility and completed quests do not stand in
for the character's unlocked-recipe records.

**Unavailable** marks confirmed unused or retired items separately from character progress.
Their item pages explain why and link to the checked source; retained recipes are labelled
historical, without automatic-unlock instructions. Every import audits all items and writes
`data/item-availability-audit.json`, including source evidence and unresolved cases. Missing
loot, map or station data alone never marks an item unavailable. An unassigned crafting station
is labelled unconfirmed rather than implying that it uses the build menu.
