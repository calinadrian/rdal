# Pulls everything the overlay needs out of the installed game (read-only).
# Requires tools\Dumper\out\Mappings.usmap (run the Dumper once while the game is running).
$ErrorActionPreference = 'Continue' # the extractor logs progress on stderr
$x = Join-Path $PSScriptRoot 'Extractor\bin\out\Extractor.exe'
$out = Join-Path $PSScriptRoot 'Extractor\out\raw'
New-Item -ItemType Directory -Force $out | Out-Null

function Bulk($name, $pathRe, $typeRe) {
    if ($typeRe) { & $x bulk $out $name $pathRe $typeRe } else { & $x bulk $out $name $pathRe }
}

Bulk items       '/ITEM_[^/]*\.uasset$'
Bulk unlock-items '/DA_Consumable_[^/]*\.uasset$'
Bulk extra-recipes '/DA_Recipe_[^/]*\.uasset$' 'RecipeData'
Bulk recipe-dispensers '/BP_.*RecipeDispenser[^/]*\.uasset$'
Bulk recipe-perks '/PerksV2/.*\.uasset$'
Bulk journal     '/UI/JournalData/.*\.uasset$'
Bulk armour-bonuses '/Gameplay/GameplayEffects/ArmorSets/.*\.uasset$'
Bulk journal-combat '/Gameplay/Character/Player/Attacks/(Bow|Crossbow|Shortbow)/.*\.uasset$'
& node (Join-Path $PSScriptRoot 'export-journal.js')
if ($LASTEXITCODE -ne 0) { throw 'Journal artwork export failed' }
Bulk item-stats  '/(DT_(WearableEquipment|PlayerWeaponPowerLevels|PlayerDamageNegation|FoodSustenance|DrinkHydration|RestEndurance|VitalShield(_V2)?|Toxicity_V2|Wither_V2))\.uasset$'
Bulk recipes     '/RECIPE_[^/]*\.uasset$'
Bulk quests      '/Gameplay/Quests/.*Quest_[^/]*\.uasset$|/Content/Gameplay/Quests/[^/]*\.uasset$' 'QuestData'
Bulk quest-flows '/QF_[^/]*\.uasset$'
Bulk anima-vents '/AVD_[^/]*\.uasset$'
Bulk stringtables 'Quests?/.*/ST_[^/]*\.uasset$'   # quest names/objectives referenced by key
Bulk skills      '/Skills/SKILL_[^/]*\.uasset$'
Bulk tables      '/(DT_(EnemyLootDropTable|LootDropTable|CompositeEnemyLootDropTable|LootChest|CraftingStations|ProcessingStation|VendorDataTable)[^/]*)\.uasset$'
Bulk spawnpoints '/SpawnPoints/BP_SpawnPoint_[^/]*\.uasset$' '^Default__'
Bulk ai          '/Gameplay/AI/.*/BP_AI_[^/]*_(Character|Data)\.uasset$|/GameFeatures/.*/BP_AI_[^/]*_(Character|Data)\.uasset$' '^Default__|LootDrop|AI Attributes|Health Component|CharacterMesh0|BlueprintGeneratedClass'
Bulk chests      '/Spawners/Chests/.*\.uasset$' '^Default__'
& $x json $out RSDragonwilds/Content/Maps/World/L_World.umap
& $x world (Split-Path $out)
& node (Join-Path $PSScriptRoot 'export-acquisition-world.js')
if ($LASTEXITCODE -ne 0) { throw 'Acquisition world export failed' }
# Dungeon floor plans: find the interiors from the placed actors, then draw their geometry from above.
& node (Join-Path $PSScriptRoot 'dungeon-regions.js')
if ($LASTEXITCODE -ne 0) { throw 'Dungeon region search failed' }
$dungeons = Join-Path (Split-Path $PSScriptRoot) 'data\dungeons'
Remove-Item -Recurse -Force $dungeons -ErrorAction SilentlyContinue
& $x floorplan $dungeons (Join-Path $out 'dungeon-regions.json')
# Same size, WebP instead of PNG: the parchment plans shrink about eightfold.
& $x webp $dungeons --quality=90
if ($LASTEXITCODE -ne 0) { throw 'Floor plan WebP conversion failed' }

# Item icons and map images go straight into the overlay's data folder.
$data = Join-Path (Split-Path $PSScriptRoot) 'data'
$iconJson = (Get-Content (Join-Path $out 'items.json') -Raw) + (Get-Content (Join-Path $out 'unlock-items.json') -Raw)
$icons = [regex]::Matches($iconJson, '"Icon":\{"AssetPathName":"(/[^"]+)"') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$list = Join-Path $out 'icon_list.txt'
Set-Content -Path $list -Value $icons -Encoding ascii
& $x texture (Join-Path $data 'icons') --max=64 "@$list"
& $x texture (Join-Path $data 'map') --max=8192 /Game/Art/UI/Map/T_WorldMap_Landmass.T_WorldMap_Landmass /Game/Art/UI/Map/T_Map_Dowdun_Underground.T_Map_Dowdun_Underground
# Icons and the world map ship as WebP too (map and icons are about a third of the PNG size).
& $x webp (Join-Path $data 'icons') --quality=90
if ($LASTEXITCODE -ne 0) { throw 'Icon WebP conversion failed' }
& $x webp (Join-Path $data 'map') --quality=90
if ($LASTEXITCODE -ne 0) { throw 'Map WebP conversion failed' }
# The game's own map/compass icons for the map markers.
$nav = 'T_Map_Icon_Animal', 'T_Map_Icon_Ore', 'T_Map_Icon_Plant', 'T_Map_Icon_Tree', 'T_Map_Icon_Pin', 'T_NavIcons_QuestMarker', 'T_NavIcons_QuestMarker_Secondary',
  'T_NavIcons_DungeonEntrance', 'T_NavIcons_Eldergate', 'T_NavIcons_MapTower', 'T_NavIcons_BossAlter', 'T_NavIcons_Marker', 'T_NavIcons_NMC', 'T_NavIcons_Player_Self',
  'T_NavIcons_Gravestone', 'T_NavIcons_Bed', 'T_NavIcons_FightCaves', 'T_DR_Icon_Compass_FragmentCrystal', 'T_IG_Icon_Compass_CleansingPool' |
  ForEach-Object { "/Game/Art/UI/NavIcons/$_.$_" }
$nav += '/Game/Art/UI/Icons/T_LodestoneMapIcon.T_LodestoneMapIcon', '/Game/Art/UI/Map/T_HealthAltar_Map_Discovered.T_HealthAltar_Map_Discovered',
  '/Game/Art/UI/Map/T_Agility_NewCourse.T_Agility_NewCourse', '/Game/Art/UI/Map/T_Map_Primary_Quest_Icon_NPC.T_Map_Primary_Quest_Icon_NPC'
& $x texture (Join-Path $data 'mapicons') --max=128 @nav
$runeIcons = 'Air', 'Water', 'Earth', 'Fire', 'Nature', 'Law', 'Astral' | ForEach-Object {
    "/Game/Art/UI/HUD/Compass_Icons/T_Rune_${_}_Regular.T_Rune_${_}_Regular"
}
& $x texture (Join-Path $data 'mapicons') --max=64 @runeIcons
$runeGlyphs = 'Air', 'Water', 'Earth', 'Fire1', 'Nature', 'Law', 'Astral' | ForEach-Object {
    "/Game/Art/UI/Craft/Runecrafting/T_Rune_${_}.T_Rune_${_}"
}
& $x texture (Join-Path $data 'mapicons') --max=128 @runeGlyphs

& node (Join-Path $PSScriptRoot 'export-quest-npcs.js')
if ($LASTEXITCODE -ne 0) { throw 'Quest NPC export failed' }
& node (Join-Path $PSScriptRoot 'export-quest-guidance.js')
if ($LASTEXITCODE -ne 0) { throw 'Quest interaction export failed' }
Write-Host "Raw data in $out"
