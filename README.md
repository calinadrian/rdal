# Dragonwilds AtlasLoot

A loot, crafting, quest and live map companion for **RuneScape: Dragonwilds**, including the Xbox Game Pass version.

**[Download for Windows](https://github.com/calinadrian/rdal/releases/latest)** · [User guide](docs/user-guide.md) · [Development](docs/development.md)

## What it does

- **Find loot** — browse monsters, chests and vendors, with exact drop chances.
- **Plan your crafting** — see materials, stations, unlock requirements and the steps from raw resources to finished gear.
- **Follow quests** — read your current objective, track quests and find their targets on the map.
- **Explore the world** — view resources, spawns, your live position and dungeon floor plans, with waypoints and direction arrows.
- **Keep a minimap nearby** — enable an optional in-game minimap with quest tracking.

Use it in a separate window, on a second monitor, or as an always-on-top overlay.
The app reads your installed game files and live game state; it does not inject into or write to the game.

## Install on Windows

**Requires 64-bit Windows.** The installer includes the app and game data; no Node.js or development tools needed.

1. Open the [latest release](https://github.com/calinadrian/rdal/releases/latest), expand **Assets**, and download `Dragonwilds-AtlasLoot-Setup-<version>.exe`.
2. Run the installer. Administrator access is not required.
3. Open **Dragonwilds AtlasLoot** from the Start menu or desktop shortcut, then launch the game.

For the overlay, play in **Borderless / Windowed** mode.

## Quick controls

| Action | Control |
| --- | --- |
| Show or hide AtlasLoot | **Ctrl+Shift+L** (change in Settings) |
| Open the companion map | Open the game's map with **M** or its Map tab |
| Close the companion map | Close the game's map with **M** or **Esc** |
| Move / zoom the map | Drag / mouse wheel |
| Place a waypoint | Right-click the map, or choose **Add waypoint** |
| Find an item's sources | Select it, then **Show locations** |
| Enable the minimap or overlay | **Settings** |

Filters, wishlist, map view and window preferences save automatically.

## Learn more

- [Map, minimap and navigation](docs/user-guide.md#game-map-and-minimap)
- [Search and item details](docs/user-guide.md#search-and-item-details)
- [Quest journal and tracking](docs/user-guide.md#quest-journal-and-tracking)
- [Map filters and discovery](docs/user-guide.md#map-filters-and-discovery)
- [Dungeon maps](docs/user-guide.md#dungeon-maps)
- [Crafting, equipment and recipe unlocks](docs/user-guide.md#crafting-and-equipment)

## Updates

The installed app checks for updates on launch and every six hours. Choose **Update now**
when one is ready, or **Maybe later** to install when the app next quits. Your preferences are kept.

To check manually, click the version in the bottom-right corner or use **Settings → Check for updates**.
After a game update, use **Settings → Update from game files** to refresh the database.

## Development

See [Development and releases](docs/development.md) for source setup, data extraction,
packaging, publishing and tool references.
