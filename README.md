# Dragonwilds AtlasLoot

An AtlasLoot-style overlay for **RuneScape: Dragonwilds** (works with the Xbox Game Pass version):
loot tables with exact drop chances, every recipe by crafting station, chests, vendors, quests,
and a world map with monster spawns, chests, quest locations, ores and plants — plus your live position.

All data is read from **your installed game files** (read-only). Nothing is injected into or written to the game.

## Install on Windows

1. Open the [latest release](https://github.com/calinadrian/rdal/releases/latest).
2. Expand **Assets** and download **`Dragonwilds-AtlasLoot-Setup-<version>.exe`**.
3. Double-click the downloaded installer. It installs for your Windows account; administrator access
   is not required.
4. Open **Dragonwilds AtlasLoot** from the Start menu or its desktop shortcut.
5. Launch **RuneScape: Dragonwilds**. Use **Borderless / Windowed** mode if you want the overlay
   visible over the game. Press **Ctrl+Shift+L** to show or hide AtlasLoot.

The installer is for **64-bit Windows** and includes the app and bundled game data. You do not need
Node.js or development tools to use it.

**Updates:** the installed app checks on launch and every 6 hours, downloads new versions in the
background, and offers **Update now** with release notes. The app reopens automatically when installation finishes.
Choose **Maybe later** to install and reopen when the app next quits. Click the version in the bottom-right corner to check for updates or reopen
a ready update. You can also use **Settings → Check for updates**. Your saved preferences are kept.

## Use

- For development, `npm install` once, then `npm start` or `Start AtlasLoot.vbs` runs straight from the source.
- It runs as a **separate window** (put it on a second monitor) and notices when the game starts: it opens
  automatically and shows your live position. ⚙ Settings can switch it to an always-on-top **overlay**
  and make it **start with Windows**, waiting in the tray until the game launches.
- **Ctrl+Shift+L** shows/hides it (change it in ⚙ Settings).
- UI preferences save automatically to the app's profile: map categories, creature pool, Follow me,
  map zoom/position, last open view, column widths and wishlist. Window settings are kept there too,
  including maximized state. Reopening or updating the app preserves them.
- **M in the game** switches it to the map without taking focus (as an overlay it pops up, and M or Esc closes it).
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
- Quest and recipe panels label saved progress with its last-read time. Unknown progress stays explicitly unknown; active quests put the current objective and its confirmed locations first.
- **Quests** offers persistent progress filters shared by the sidebar and overview. Search a quest name, place, item or objective;
  active quest rows show the rewritten next action with **Continue guide** and a direct objective map button.
- **Track quest** pins a quest to the WoW-style quest tracker, shown on the map and at the top of the quest overview.
  Each tracked quest lists its current objective with what to do: places to go, creatures to slay and items to loot
  (with the creatures that drop them and the amount the objective asks for). Every line has a **Map** button. Tracked
  targets stay on the map whatever the filters: numbered gold rings mark places to go, and shaded areas mark where
  kill targets and drop sources spawn. Quests you accept are tracked automatically and drop off when completed.
  Kill and loot counters are not in the game's quest log, so the tracker shows the amount needed, not your progress.
- Select a quest to open its full-width guide. **What to do next** comes first, with supplies, item/creature sources, and map actions.
  **Full walkthrough** or **All objective guidance** expands below it. Quests with alternate objectives or collection counters use a reference guide;
  they do not claim that preceding entries are complete. Missing or unrecognised progress never falls back to a supposed current task.
  **Pin** buttons highlight the actual interaction object; dungeon targets open the matching interior and floor, while **Entrance** buttons show how to reach that dungeon from outside.
  **Show quest area** is explicitly a general location. Steps without fixed coordinates explain how to use crafting, gathering, contacts, or dialogue clues instead.
  **Dialogue clues & quest contacts** exposes relevant conversations from the installed game. “Highlighting the Problem” includes the password statue inside Thishepen Kara, the outdoor wizard statue, all three charging pedestals, Windstep advice, and the password; its additional route advice links to the community wiki.
- Creatures show the game's own **journal pictures** (World → Fauna / Factions, exported to `data/journal`):
  above their drops, in the detail panel, as their icons in lists, on the live map and in the Nearby list.
  Each journal page names the creature whose kill unlocks it; regional variants (Scorned Wilderness, Dowdun Reach,
  challenge modes) use their base creature's page. 97 of the 100 monster entries have a picture; Kalphite Soldier,
  Garou Exile and Garou Lightning Berserker have no journal page and show the generic creature icon.
- **Quests** reads your quest log live from the game (and remembers it when the game is closed): quests are grouped
  into In progress, Ready to start, No progress recorded and Completed. Unknown progress stays unknown.
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
- Quest map markers show a **gold circle with ?** for a confirmed first objective and **step numbers** for linked locations;
  your current step is blue. Hover for the objective text, or click to see the selected location and jump
  between the quest's locations in the detail panel. A **dot** means the exported quest flow does not confirm
  a step for that marker. Starts refer to the first objective location; quest prerequisites still apply.
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
  shows every confirmed location for the current objective, plus first-objective pickups for unstarted quests;
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
- **Dungeon maps**: the game has none, so the app draws parchment floor plans from the game's own geometry.
  Going through a dungeon door switches the map to that dungeon, and dungeons with stacked floors have a
  **Level** picker that follows you up and down stairs. Click an entrance on the world map, or use the map picker,
  to look inside any dungeon. Spawns, chests and other markers inside show on the right level.
  Choose **All floors** to see the full layout together, or select a level: ivory paths show that floor,
  with other floors in a subdued fill. Browsing a dungeon from outside starts with All floors; live entry
  still follows your current level. A manually selected overview stays open when you move between floors.
  Dungeon **Filters** open on demand, and the detail panel appears when you select an entry, leaving more room for the plan.
  Floor outlines use smooth illustrated contours, warm parchment and shaded wall rims. Thin mesh spurs
  and detached debris are removed from the drawing; narrow room connections and useful marked dead ends are retained.
  Floor extraction preserves narrow stairs and joins height bands before discarding unsupported geometry.
- Play in **Borderless / Windowed** mode so the overlay can sit on top.

## After a game update

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

⚙ Settings → **Update from game files** (ideally with the game running). This:

1. runs `tools/Dumper` to regenerate `Mappings.usmap` from the running game (read-only memory reading),
2. runs `tools/extract-all.ps1` (CUE4Parse) to export items, recipes, loot, spawns, chests, quests, icons and the map,
3. runs `importer/game.js` to build `data/db.json`.

## Releasing

The repo holds only the source. Everything extracted from the game (`data/`, the tools' `out/` folders)
and the built tool binaries ship only inside the installer, so releases are built from a checkout that has them.

1. Commit your changes, then `npm version patch` (or `minor`) to bump the version.
2. `npm run release`: checks authentication, builds and verifies the installer, pushes the commit and
   its `v<version>` tag, uploads the installer, blockmap and `latest.yml` to a draft, then publishes it.
   Needs the GitHub CLI signed in (`gh auth login`; on Windows the script also finds the standard
   `C:\Program Files\GitHub CLI\gh.exe` installation). A failed upload leaves a draft that can be
   retried with the same command. Published versions must be followed by a new version number.

`npm run package` builds the same installer into `dist/` without publishing.

Updater verification (the Electron tests use isolated profiles and never run the installer):

```powershell
node --test tools/test-updates.cjs
node node_modules/electron/cli.js tools/test-update-ui.cjs dist/win-unpacked/resources/app
node node_modules/electron/cli.js tools/test-update-download.cjs
```

Build with `npm run package` before the last two commands. The download test serves the built installer
over loopback and checks the real updater's download, SHA-512 verification and ready-to-install state.

## Tools

| Path | What it is |
|---|---|
| `tools/Dumper` | Our external, read-only UE5 reader: writes `Mappings.usmap` + `sdk.json`, and with `--track` streams the player position and M/Esc key presses (game window only, keys are passed through). |
| `tools/Extractor` | CUE4Parse-based exporter (`survey`, `json`, `bulk`, `world`, `texture` modes). |
| `tools/ext/c4p` | [CUE4Parse](https://github.com/FabianFG/CUE4Parse), Apache-2.0. |
| `tools/build.ps1` | Builds both tools. The C# compiler can't handle this folder's long path, so it builds in `%LOCALAPPDATA%\dwal` (which also holds the .NET SDK) and copies the binaries back. |
| `importer/game.js` | Joins the raw exports into the overlay database. |
| `importer/*` (wiki) | The older wiki importer, kept as a fallback. |

Unreleased content (`FutureMajorVersion` plugin) is deliberately skipped.
