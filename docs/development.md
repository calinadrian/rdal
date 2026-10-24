# Development and releases

[← README](../README.md)

## Run from source

```powershell
npm install
npm start
```

After installing dependencies, `Start AtlasLoot.vbs` also launches the app.
The repository contains source only. Full functionality requires extracted game data
and built tools; these are bundled with the Windows installer.

## Refresh game data
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
| `tools/Extractor` | CUE4Parse-based exporter (`survey`, `json`, `bulk`, `world`, `texture` modes; `floorplan` maps the dungeons from the navigation mesh, and `floorplan-style` redraws them from the cached layouts without the game). |
| `tools/ext/c4p` | [CUE4Parse](https://github.com/FabianFG/CUE4Parse), Apache-2.0. |
| `tools/build.ps1` | Builds both tools. The C# compiler can't handle this folder's long path, so it builds in `%LOCALAPPDATA%\dwal` (which also holds the .NET SDK) and copies the binaries back. |
| `importer/game.js` | Joins the raw exports into the overlay database. |
| `importer/*` (wiki) | The older wiki importer, kept as a fallback. |

Unreleased content (`FutureMajorVersion` plugin) is deliberately skipped.
