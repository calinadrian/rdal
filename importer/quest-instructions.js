// Handwritten clarifications from the installed objectives, item checks and conversations.
// Entry tags identify the actual interaction, never a nearby actor or a guessed location.
const entry = suffix => 'QuestFlow.Entry.' + suffix;
const step = (instruction, notes = [], entries = []) => ({ instruction, notes, entries: entries.map(entry) });
// The standing stones' clues: Emberwood village west of the tower, Silverthorn Keep to the east, and the vault behind the waterfall.
const seals = ['One is in the heart of Emberwood village, one at Silverthorn Keep (guarded by its last protector), and one inside Vekchenven Kara, the vault behind the tainted waterfall near the Lake of Lost Souls.'];
const sealEntries = ['DeathQuestMain.Seals.Emberwood', 'DeathQuestMain.Seals.Silverthorn', 'DeathQuestMain.Seals.Waterfall'];
const instructions = {
  Quest_AMelodyRemebered: {
    Objective1: step('Bring an Inspiring Ring of Runecrafting to the Jewellery Box and insert it into the ring slot.', ['The ring is consumed by the box. Open its item entry below to check the recipe and how to obtain it.'], ['AMelodyRemebered']),
    Objective2: step('Bring an Amulet of Magic to the Jewellery Box and insert it into the second slot.', ['The amulet is consumed by the box.'], ['AMelodyRemebered']),
  },
  Quest_AnimalMagnetism: {
    None: step('Read the Advert-Inna-Bottle beside Manktongue to learn what he needs.', [], ['AnimalMagnetism.Advert']),
    Objective2: step('Speak to Manktongue about the Advert-Inna-Bottle.'),
    Objective3: step('Bring Manktongue an Undead Chicken, a magnetised iron bar and a Bundle of Undead Twigs.', ['For the magnet, bring Pulpknuckle 1 Iron Bar and 5 Law Runes. Use the item entries below for the other supplies.']),
    Objective4: step('Return to Manktongue and speak to him to finish making the device.'),
  },
  Quest_CooksAssistant: {
    Objective1: step('Bring Slopfinger all three ingredients: 4 Eggs, 6 Wheat and a Bucket of Milk.'),
    Objective2: step('Interact with the Goblin Stove beside Slopfinger to bake the cake.'),
    Objective3: step('Take the signed cake to Manktongue and speak to him.'),
    Objective4: step('Return to Slopfinger with the freshly cooked cake and speak to him.'),
    Objective5: step('Speak to Slopfinger again to give him the good news and finish the quest.'),
  },
  Quest_ElderGarou: { None: step('Build a home around Caratacus the Elder, at his current location.', ['The building must surround Caratacus; building a home elsewhere will not fulfil this objective.']) },
  Quest_DragonSlayer: {
    'Claim a bed': step('Build a shelter in Bramblemead Village, place a bed inside it and claim the bed.'),
    'Return to the Wise old man after claimed bed': step('Return to the Wise Old Man in Bramblemead Village after claiming your bed.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    'Find and hunt a deer': { ...step('Hunt a Deer, collect one Deer Antler and bring it to the Wise Old Man in Bramblemead Village.', [], ['FTUEQuests.FTUEQ1EntryWOM']), mapSources: ['Deer Brynmoor','Deer'] },
    'Investigate the castle': step('Fight your way into the goblin castle and look for Cathan.'),
    'Locate cathan in the vault': step('Find the blue-flame door in Bloodblight Swamp, enter the vault and look for Cathan.'),
    'Return to the Wise old man': step('Return to the Wise Old Man in Bramblemead Village and tell him what you found.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    'Venture into Ghornfell': step('Prepare your gear, enter the Ghornfell Highlands and search for Cathan.'),
    'Look for evidence of Cathan at the tower': step('Search Velgar’s Tower in Ghornfell for evidence of Cathan.'),
    'Craft the summon horn': step('Craft a Challenge Horn using 1 Dragon Tooth, 5 Bronze Bars and 1 Bloodwood Sap.', ['Use the Challenge Horn entry below for the crafting station and material sources.']),
    'Challenge Velgar': step('Take the Challenge Horn to the dragonkin altar at Velgar’s Tower. Use it to summon Velgar, then defeat him.'),
    'Return to the Wise old man after killing velgar': step('Collect Velgar’s Head and bring it to the Wise Old Man outside Velgar’s Lair.'),
  },
  Quest_FH_CollectorsCalling: {
    FindSkeletonShortbow: step('Learn the Undead Ranger’s Bow recipe from a vault effigy, craft the bow, then bring it to Doric in Fellhollow.', ['Open the bow below for its recipe and confirmed recipe location.'], ['WitherWard.Doric']),
    FindShadowSword: step('Obtain the Shadow Sword recipe from a zogre, craft the weapon and bring it to Doric in Fellhollow.', [], ['WitherWard.Doric']),
    FindNecromancerStaff: step('Learn the Necromancer’s Staff recipe from a vault effigy, craft the staff, then bring it to Doric in Fellhollow.', ['Open the staff below for its recipe and confirmed recipe location.'], ['WitherWard.Doric']),
    SpeakToDoric: step('Return to Doric in Fellhollow and speak to him.', [], ['WitherWard.Doric']),
  },
  Quest_FH_NightoftheSpectralBoom: {
    FindSpectralChinchompaSkulls: step('Hunt Spectral Chinchompas in Fellhollow. Collect 10 skulls and bring them to Vannaka.'),
    SpeaktoVannaka: step('Speak to Vannaka in Fellhollow after gathering the Spectral Chinchompa Skulls.'),
  },
  Quest_SW_MainQuest: {
    AccessSW: step('Travel into the Scorned Wilderness to continue the quest.'),
    SpeakZilyana: step('Find Zilyana in the Scorned Wilderness and speak to her.'),
    ReturnToZilyana: step('Finish preparing your equipment and supplies, then speak to Zilyana to continue.'),
    DefeatKuldra: step('Find and defeat Kuldra, then collect Kuldra’s Head.'),
    BringHead: step('Return to Zilyana with Kuldra’s Head and speak to her.'),
  },
  Quest_FTUE_FS: { Objective1: step('Find the Wise Old Man in Bramblemead Village and speak to him.', [], ['FTUEQuests.FTUEQ1EntryWOM']) },
  Quest_FTUE_LO: {
    'Speak to Zanik': step('Follow the road from the temple down to the river and speak to Zanik.', [], ['FTUEQuests.FTUERMEntryZanik']),
    'Chop wood': step('Chop ash trees until you have 50 Ash Logs, then bring the logs to Zanik beside the river.', [], ['FTUEQuests.FTUERMEntryZanik']),
  },
  Quest_FTUE_RC: {
    Objective1: step('Speak to Vannaka near the Windmill.', [], ['FTUEQuests.FTUERCEntryVannaka']),
    Objective2: { ...step('Kill rats for their meat, then cook one Rat Roast successfully.', ['Open Rat Roast below for its cooking recipe. A failed or burnt attempt does not complete this objective.']), mapSources: ['Giant Rat'], sourceRegions: ['Bramblemead Valley'] },
  },
  Quest_FTUE_RtftJ: {
    Objective1: step('Collect Dirty Water from the nearby ponds, then bring it back to Doric outside the temple.', [], ['FTUEQuests.FTUERtftJEntryDoric']),
    Objective2: step('Build a Crafting Table, use it to craft a Stone Club, then bring the club to Doric.', [], ['FTUEQuests.FTUERtftJEntryDoric']),
    Objective3: step('Take the Stone Club to Doric outside the temple and speak to him.', [], ['FTUEQuests.FTUERtftJEntryDoric']),
  },
  Quest_FTUE_Farming: {
    SpeakToWOM1: step('Speak to the Wise Old Man in Bramblemead Village about Farming.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    BuildGardenPlot: step('Build a Garden Plot at your chosen farming site.'),
    PlantSeeds: step('Interact with your Garden Plot and plant Wheat Seeds.'),
    SpeakToWOM2: step('Return to the Wise Old Man in Bramblemead Village to learn about watering and harvesting.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    FullyWaterPlot: step('Water the planted Garden Plot until its watering requirement is full.'),
    HarvestPlot: step('Wait for the Wheat to finish growing, then harvest it from your Garden Plot.'),
    SpeakToWOM3: step('Return to the Wise Old Man in Bramblemead Village.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    GetCompost: step('Collect Compost from a Compost Bin.'),
    ApplyCompostToPlot: step('Apply Compost to your Garden Plot until its compost requirement is full.'),
    HarvestCrop: step('Plant seeds in a Farming Plot, water them, wait for the crop to mature, then harvest it.'),
    FinishQuest: step('Return to the Wise Old Man in Bramblemead Village after harvesting your crop.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
  },
  Quest_DR_FTUE_Fishing: {
    SpeakToWom: step('Speak to the Wise Old Man in Bramblemead Village about Fishing.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
    StartFishing: step('Go to a fishing spot near the Wise Old Man in Bramblemead Village and catch a Sardine.'),
    ReturnToTheWOM: step('Return to the Wise Old Man in Bramblemead Village after catching the Sardine.', [], ['FTUEQuests.FTUEQ1EntryWOM']),
  },
  Quest_DeathQuestMain: {
    UnlockGate: step('Interact with the strange door near Ashien’s Watch and say “Mors, introitum quaero!” to open it.'),
    SearchTheStructure: step('Go inside the temple and speak to Death.', [], ['DeathQuestMain.Death']),
    SpeakToMysteriousFigure: step('Speak to Death inside the temple.', [], ['DeathQuestMain.Death']),
    SpeakToPostiePete: step('Speak to Postie Pete at the entrance to Fellhollow.', [], ['DeathQuestMain.PostiePete.FellhollowEntrance']),
    GoThroughDoorToFH: step('Become Soul Rifted in the red area near Postie Pete, then pass through the gate into Fellhollow.', ['Once through the gate, go straight to a Purification Pool to remove Soul Rift.']),
    FindACleansingPool: step('Find a glowing Purification Pool in Fellhollow and use it to remove Soul Rift.'),
    InvestigateStandingStones: step('Find Cathan at the standing stones in Fellhollow and speak to him.', [], ['DeathQuestMain.Cathan']),
    BreakTheThreeSeals: step('Break the three Curse Seals the standing stones told you about and take a curse fragment from each.', seals, sealEntries),
    BreakRemainingtwoSeals: step('Break the two Curse Seals you have not broken yet and take their curse fragments.', seals, sealEntries),
    BreakTheFinalSeal: step('Break the last Curse Seal and take its curse fragment.', seals, sealEntries),
    ChallangeImaru: step('Enter the Shattered Spire and defeat Imaru.'),
    ReturnToDeath: step('Bring Imaru’s Head to Death and speak to him.', [], ['DeathQuestMain.Death']),
  },
  Quest_FH_MirrorMirror: {
    FindSilverThread: step('Bring Dragon Blood, Spectral Silver Thread and the ritual spellbook back to the Mirror.', ['For the thread, bring Edna in central Dragon’s Run 1 Silver Bar, 1 Fine Thread, 1 Sacred Oil and 6 Soul Fragments. The spellbook is in the windmill at Emberwood Village.'], ['FH_MirrorMirror', 'FH_MirrorMirror.Seamstress', 'FH_MirrorMirror.ReadBook']),
    LightCandles: step('Use the soul spark from the Mirror to relight the memorial candles across Ashenfall.'),
    ReturnToNPC: step('Return to the Mirror and speak to its inhabitant.', [], ['FH_MirrorMirror']),
  },
  Quest_FH_WhatRemainsIsWritten: {
    ObjectiveZero: step('Take the sinister text to Abraxus the Eternal in Fellhollow.'),
    FindBooks: step('Find Abraxus’ five missing books in eastern Fellhollow, then bring all five back to him.'),
    FindBooksAndReturn: step('Find Abraxus’ five missing books in eastern Fellhollow, then bring all five back to him.'),
    FoundBooks: step('Return to Abraxus the Eternal with the five missing books.'),
    FindScrolls: step('Defeat Leonard the Bound, the Pride of the Avernic and the Binding of Ib to recover Abraxus’ scrolls.'),
    FindScrollsAndReturn: step('Defeat Leonard the Bound, the Pride of the Avernic and the Binding of Ib, collect their scrolls, then return to Abraxus.'),
    FoundScrolls: step('Bring the recovered scrolls back to Abraxus the Eternal.'),
  },
  Quest_FH_GhostQuest: {
    BackToZanik: step('Return to Zanik in Fellhollow after helping the three ghosts.'),
    BackToZanikNotSpokenToZanik: step('Find Zanik in Fellhollow and tell her about the spirits you encountered.'),
  },
  Quest_FH_WitherBeast: {
    HuntBeast: { ...step('Defeat Nature Spirits in Fellhollow’s willow groves and loot 3 Primordial Hearts.', [
      'Already spoken to Vannaka? Leave his camp and look for white, glowing terrorbirds beside willow-grove ponds. Each drops 1 Primordial Heart; loot it after the fight.',
      'Look in southern Witchwillow Range, northwest of the druid circle near Emberwood, or around Dragon’s Run. Use the region buttons below to highlight the recorded spawn sites. The game data also includes sites in Hope’s Fall and Silverthorn Keep.',
      'Once you have 3 hearts in your inventory, return to Vannaka in Bleakfields Valley, west of Cathan, and finish his dialogue to unlock the Terrorbird mount.',
    ]), sourceOnly: true, resources: ['Primordial Heart'], mapSources: ['Nature Spirit'] },
    BringHeart: step('Return to Vannaka in Bleakfields Valley with 3 Primordial Hearts and finish his dialogue to unlock the Terrorbird mount.', ['His camp is west of Cathan. After the ritual, hold your Mount key (Alt by default on PC) to summon your Terrorbird.'], ['FHWitherBeast.Vannaka']),
    BringHeartNotStarted: step('Take the Primordial Heart you found to Vannaka at his camp west of Cathan in Bleakfields Valley.', ['This is the alternate start if you found a heart before speaking to him. You need 3 Primordial Hearts in total to finish the hunt and unlock the Terrorbird mount.'], ['FHWitherBeast.Vannaka']),
  },
  Quest_Heartstrings: { 'follow the blue-leafed trees': step('Follow the blue-leaved trees east through Ghornfell and read each memorial along the path.', ['The memorial on the mesa points to a single blue tree to the east. Continue reading the memorials along the route; keep inventory space free for the final reward.'], ['Heartstrings.MemorialTree2', 'Heartstrings.MemorialTree3', 'Heartstrings.MemorialMesa', 'Heartstrings.MemorialFinal']) },
  Quest_GoblinDiplomacy: {
    Objective1: step('Search both the ruins northeast of Zanik and the guild to her south for the two amulet pieces.'),
    Objective2a: step('Search the ruins northeast of Zanik for an amulet piece.'),
    Objective2b: step('Search the guild south of Zanik for an amulet piece.'),
    Objective3: step('Search Bloodblight Swamp for the missing amulet piece.', ['Zanik’s dialogue points to the swamp near the northeastern ruins. Bilegut and Wormelbow mention a Garou living in a cave there.']),
    Objective4: step('Bring both amulet pieces back to Zanik.', [], ['GoblinDiplomacy.ZanikGD']),
    Objective5: step('Find the remaining amulet piece at the ruins northeast of Zanik or the guild to her south. Search the place you have not cleared yet.'),
    Objective6: step('Take the Bandosian amulet to Zanik so she can identify it.', [], ['GoblinDiplomacy.ZanikGD']),
  },
  Quest_DogDays: {
    Objective2: step('Defeat a Garou King in a Highland stronghold and collect the King’s Token.'),
    Objective5: step('Bring the Purified King’s Token to Vannaka in the Ghornfell Highlands.'),
  },
  Quest_BrinkOfExtinction: {
    Objective1: step('Bring Zi 1 Cactus Steak and 3 Raw Beltfish in the Umbral Sands.'),
    Objective3: step('Return to Zi in the Burning Spire region after touching all four pedestals.'),
    Objective4: step('Go to the Cave of Screams, west behind the sunken pyramid, and speak to the KotHaar Bouncer.', ['Zi explains the password: count the total words spoken by the bouncer. The word count is the password.']),
    Objective5: step('Read the KotHaar numbering book, then return to the KotHaar Bouncer and answer using its number system.'),
    Objective6: step('Return to the KotHaar Bouncer outside the Cave of Screams and speak to him.'),
  },
  Quest_Contact: {
    Objective1: step('Enter the Kalphite Hive and speak to the Vault Guardian Prime.'),
    Objective2: step('Find the three missing Vault Guardians and recover a Crystal Helix fragment from each.'),
    'Objective2.1': step('Follow the footprints in the sand to find who left them.'),
    Objective3: step('Return to the Vault Guardian Prime with the Crystal Helix fragments.'),
    Objective4: step('Use the Crystal Helix at the magical barrier inside the Kalphite Hive.'),
    Objective5: step('Speak to Zanik in the Kalphite Hive’s Shortcut Chamber.', [], ['Contact.ZanikInChamber']),
    Objective6: step('Destroy all four crystals in the Kalphite Hive’s Shortcut Chamber.'),
    Objective7: step('Return to Zanik in the Shortcut Chamber after destroying the crystals.', [], ['Contact.ZanikInChamber']),
  },
  Quest_GreatBodyRobbery: {
    Objective2: step('Return to Doctor Fenkenstrain at his tower and speak to him.'),
    Objective3: step('Speak to Doctor Fenkenstrain in his tower to continue the experiment.'),
    Objective4: step('Bring Doctor Fenkenstrain 1 Weak Antipoison, 1 Weak Focused Attack Potion and 1 Weak Lumberjack Potion.'),
    Objective5: step('Carry the bottle Fenkenstrain gave you and get struck by lightning, then return the filled bottle to him.', ['The bottle must be in your inventory when the lightning strikes.']),
    'Objecrive3.5': step('Interact with the body on the examination table in Doctor Fenkenstrain’s tower to perform the autopsy.'),
    Objective6: step('Speak to Doctor Fenkenstrain at his tower to continue the experiment.'),
    Objective7: step('Interact with the examination table and attach Doctor Fenkenstrain’s head to his new body.'),
    Objective8: step('Put the Lightning-in-a-bottle into the Strange Machine in Doctor Fenkenstrain’s lab.', [], ['GreatBodyRobbery.Lightning']),
    Objective9: step('Speak to Doctor Fenkenstrain after powering the machine.'),
    AddPartsToTable: step('Take the three recovered body parts to the examination table in Fenkenstrain’s tower and place them on it.'),
  },
  Quest_SQ1_ThinkingWithPortals: {
    DR_SQ1_Temple: step('Search the Cathedral in Dowdun Keep for evidence of the mugger-mage.'),
    DR_SQ1_Garrison: step('Search the Garrisons in Dowdun Keep for evidence of the mugger-mage.'),
    DR_SQ1_Aquifer: step('Go underground to the Demon Gate of Dowdun Keep and search for evidence of the mugger-mage.'),
    DR_SQ1_ReturnToDoric: step('Return to Doric at the Dowdun Reach Nexus and speak to him.', [], ['BlackKnightsFortress.Doric']),
  },
  Quest_SQ2_AnimalLover: { DR_SQ2_EntryJournal: step('Bring the recovered Journal to Vannaka in Dowdun Reach.'), DR_SQ2_ReturnToVannaka: step('Return to Vannaka in Dowdun Reach with all three Journal Pages.') },
  Quest_SQ3_Nevermore: { DR_SQ3_FindIngredients: step('Bring Zanik all three ingredients: Dragon Blood, a Twilight Lily and Unholy Water.'), DR_SQ3_FinalBeat: step('Return to Zanik in Dowdun Reach and tell her what you found.') },
  Quest_FH_LettersForTheDead: { ObjectiveZero: step('Speak to Postie Pete near the entrance to Fellhollow to start looking for the lost letters.', [], ['DeathQuestMain.PostiePete.FellhollowEntrance']), ObjectiveReturn: step('Return to Postie Pete at the Fellhollow entrance after delivering the letters.', [], ['DeathQuestMain.PostiePete.FellhollowEntrance']) },
  Quest_UmS_MainQuest1_TribeA_Task1: { GatherIngredients: step('Bring Lagra the Butcher 3 Raw Farm Meat, 3 Kalphite Shell Fragments and 3 Cactus Steaks.', [], ['UmS_MainQuest.TribeAGarou.TaskGiver1']) },
  Quest_UmS_MainQuest1_TribeA_Task2: { FindMoonstone: step('Search beneath Gypsum deposits in the rocky areas west of Alcarrid Camp. Collect three Moonstones.'), ReturnToShopkeeper: step('Return to Domri the Merchant in Alcarrid Camp with the three Moonstones.', [], ['UmS_MainQuest.TribeAGarou.TaskGiver2']) },
  Quest_UmS_MainQuest1_TribeA_Task3: { BringBars: step('Smelt or obtain 3 Adamant Bars, then bring them to Valas the Blacksmith.', [], ['UmS_MainQuest.TribeAGarou.TaskGiver3']) },
  Quest_UmS_MainQuest1_TribeB_Task1: {
    FindTheClues: step('Read your Saga, follow its clue to a stone slab, and interact with the slab to record its passage.'),
    LocateTheGateway: step('Read the updated Saga and follow its final clue to the last stone slab.'),
    ReturnToBard: step('Return to Laguna the Bard after recording the Saga’s stone slabs.', [], ['UmS_MainQuest.TribeBGarou.TaskGiver1']),
  },
  Quest_UmS_MainQuest1_TribeB_Task2: { ReturnToArchaeologist: step('Return to Lehran the Archaeologist in Uzzer Camp with all four Forbidden Scrolls.', [], ['UmS_MainQuest.TribeBGarou.TaskGiver2']) },
  Quest_UmS_MainQuest1_TribeB_Task3: { ReturnToShangruuh: step('Return to Shangruuh in Uzzer Camp after convincing all three councillors.', [], ['UmS_MainQuest.TribeBGarou.TaskGiver3']) },
  Quest_UmS_MainQuest1_TribeC_Task1: {
    FollowBeast: step('Follow the Dearg Due south from the camp through the sandstorm until you find Efina.'),
    GiveWater: step('Bring Clean Water to Efina the Lost and speak to her.', [], ['UmS_MainQuest.TribeCGarou.Task1']),
    Return: step('Return to Manathep the Bereaved and tell her what happened to Efina.', [], ['UmS_MainQuest.TribeCGarou.TaskGiver1']),
  },
  Quest_UmS_MainQuest1_TribeC_Task2: {
    FindDragon: step('Search east of the camp for Hedric’s scouts, track down the dragon and collect its heart.'),
    SearchLocation: step('Search the village east of the camp for the lost scouts. Examine the scout bodies and scorch marks.', [], ['UmS_MainQuest.TribeCGarou.TaskGiver2.ScoutBody', 'UmS_MainQuest.TribeCGarou.TaskGiver2.Clue1', 'UmS_MainQuest.TribeCGarou.TaskGiver2.Clue2']),
    ReturnToGarou: step('Bring the dragon heart back to Hedric the Hunter.', [], ['UmS_MainQuest.TribeCGarou.TaskGiver2']),
  },
  Quest_UmS_MainQuest: {
    EnterUmS: step('Leave Dowdun Reach through the passage into the Umbral Sands.'),
    LookForLife: step('Explore the desert beyond the passage from Dowdun Reach and look for inhabitants.'),
    FindGarou: step('Go south to the Moon Garou settlement and speak to the Alcarrid Elder.', [], ['UmS_MainQuest.FirstGarou.GarouCamp']),
    SpeakToGarouElder: step('Speak to the Alcarrid Elder, then complete tasks for the camp’s residents to earn their trust.', [], ['UmS_MainQuest.FirstGarou.GarouCamp']),
    InvestigateGarouProblem: step('Search the area near the Moon Garou settlement for the problem the camp has reported.'),
    ReturnToFirstGarou: step('Return to Shangruuh, the Alcarrid Envoy in the passage from Dowdun Reach.', [], ['UmS_MainQuest.FirstGarou.UmbralStart']),
    FindThreeKeys: step('Visit the three Moon Garou camps. Complete each camp’s tasks and speak to its Elder to receive a Mirror Lens.'),
    FindLastKey: step('Complete tasks for the last Moon Garou camp and speak to its Elder to receive the final Mirror Lens.'),
    RepairTheMirrors: step('Bring the three Mirror Lenses to the Mirror Relay and place one lens in each mirror.', [], ['UmS_MainQuest.Mirrors.Mirror1', 'UmS_MainQuest.Mirrors.Mirror2', 'UmS_MainQuest.Mirrors.Mirror3']),
    SpeakToIcthlarin: step('Speak to Icthlarin at the Mirror Relay.', [], ['UmS_MainQuest.Icthlarin.Mirror']),
    FightFuzan: step('Enter the Fight Caves and defeat Fuzan.'),
    SlayFuzan: step('Travel through the Fight Caves, defeat Fuzan and collect his head.'),
    ReturnToIcthlarin: step('Bring Fuzan’s Head to Icthlarin at the Mirror Relay.', [], ['UmS_MainQuest.Icthlarin.Mirror']),
  },
};

function clarifyObjective(id, objective) {
  if (instructions[id]?.[objective.key]) return instructions[id][objective.key];
  const counter = /\b(\d+)\s*\/\s*(\d+)\b/.exec(objective.text);
  const remaining = counter ? Number(counter[2]) - Number(counter[1]) : null;
  const count = counter ? `${counter[1]} of ${counter[2]} recorded in this objective.` : '';
  if (id === 'Quest_DeathQuestMain' && /ReachedStandingStones|InteractedWithStone/.test(objective.key))
    return step('Read each of the three standing stones in Fellhollow to learn where the curse fragments are hidden.', [count || 'Read the stones’ inscriptions before looking for the fragments.'], ['DeathQuestMain.StandingStones.EmberwoodStone', 'DeathQuestMain.StandingStones.SilverThornLodgeStone', 'DeathQuestMain.StandingStones.WaterfallStone']);
  if (id === 'Quest_BrinkOfExtinction' && /^Objective2/.test(objective.key)) return step(`Ride your magic carpet to the four large black pedestals and touch each one to complete the Gauntlet of Fire.`, [count, 'You can visit the pedestals in any order.'].filter(Boolean));
  if (id === 'Quest_FH_GhostQuest' && /^FindGhosts/.test(objective.key)) return step('Find the three ghosts in Fellhollow, speak to each and fulfil their requests.', [count],
    ['FH_GhostQuest.GhostOne', 'FH_GhostQuest.GhostTwo', 'FH_GhostQuest.GhostThree']);
  if (id === 'Quest_FH_LettersForTheDead' && counter) return step('Find the missing letters in Fellhollow and deliver them to the postboxes for Postie Pete.', [count]);
  if (id === 'Quest_GreatBodyRobbery' && /^BodyParts/.test(objective.key)) return step('Dig up three body parts from graves around Bloodblight Swamp, then take them to Fenkenstrain’s tower.', [count]);
  if (id === 'Quest_SQ2_AnimalLover' && counter) return step('Find the three missing Journal Pages in Dowdun Reach, then return them to Vannaka.', [count]);
  if (id === 'Quest_Contact' && /^CrystalShard/.test(objective.key)) return step('Find the remaining missing Vault Guardians and recover their Crystal Helix fragments.', [count]);
  if (id === 'Quest_DR_MainQuest' && /Collect the Shards/.test(objective.text)) return step('Collect the 13 Dreaming Stone Shards around Dowdun Reach.', [count, 'The numbered variants of this objective are collection counts, not separate tasks.']);
  if (id === 'Quest_UmS_MainQuest1_TribeB_Task1' && /None|FindRemainingClues/.test(objective.key)) return step('Read the updated Saga, follow its next clue and record the passage on the next stone slab.');
  if (id === 'Quest_UmS_MainQuest1_TribeB_Task2' && counter) return step('Dig up four Forbidden Scrolls in the Garou ruins, then return to Lehran in Uzzer Camp.', [count]);
  if (id === 'Quest_UmS_MainQuest1_TribeB_Task3' && counter) return step('Speak to the three Uzzer councillors and convince each to abandon the Mark Day Festival.', [count, 'The map shows all three councillors; individual conversations are not tracked here.'], ['UmS_MainQuest.TribeBGarou.Task3.Noble1', 'UmS_MainQuest.TribeBGarou.Task3.Noble2', 'UmS_MainQuest.TribeBGarou.Task3.Noble3']);
  if (/^Quest_UMS_MappingTheSands2?$/.test(id)) {
    if (objective.key === 'Objective2') return step('Return to Anamcara, the Moon Sprite Shaman in Alcarrid Camp.', [], ['UmS_MappingTheSands.MoonSpriteShaman']);
    const total = id.endsWith('2') ? 8 : 3;
    return step(`Climb the tall landmarks ${total === 3 ? 'near Alcarrid Camp' : 'around the Umbral Sands'} and interact with ${total} Moon Sprites.`, [remaining === 0 ? 'All required sprites are recorded. Return to the Moon Sprite Shaman in Alcarrid Camp.' : count].filter(Boolean));
  }
  if (id === 'Quest_UmS_MainQuest' && /^FirstGarouEarnReputation/.test(objective.key)) return step(objective.key.endsWith('MaxReputation') ? 'Return to the Alcarrid Elder after completing the camp’s tasks.' : 'Complete tasks for the Alcarrid camp’s residents to earn their trust.', ['Use the camp’s side quests: Rag and Bone Garou, Rogue Trader and The Mirror Crack’d.']);
  return null;
}

const labels = {
  'FTUEQuests.FTUEQ1EntryWOM': 'Wise Old Man',
  'DeathQuestMain.WomAtGFExit': 'Wise Old Man · Ashien’s Watch',
  'UmS_MainQuest.TribeAGarou.TaskGiver1': 'Lagra the Butcher',
  'UmS_MainQuest.TribeAGarou.TaskGiver2': 'Domri the Merchant',
  'UmS_MainQuest.TribeAGarou.TaskGiver3': 'Valas the Blacksmith',
  'UmS_MainQuest.TribeBGarou.TaskGiver1': 'Laguna the Bard',
  'UmS_MainQuest.TribeBGarou.TaskGiver2': 'Lehran the Archaeologist',
  'UmS_MainQuest.TribeCGarou.TaskGiver1': 'Manathep the Bereaved',
  'UmS_MainQuest.TribeCGarou.TaskGiver2': 'Hedric the Hunter',
  'UmS_MainQuest.TribeCGarou.Task1': 'Efina the Lost',
  'UmS_MainQuest.FirstGarou.GarouCamp': 'Alcarrid Elder',
};
function readableTarget(actor) {
  const suffix = actor.entry?.replace('QuestFlow.Entry.', '');
  if (labels[suffix]) return labels[suffix];
  const mirror = /^UmS_MainQuest.Mirrors.Mirror(\d+)$/.exec(suffix);
  if (mirror) return `Mirror Relay · mirror ${mirror[1]}`;
  const noble = /^UmS_MainQuest.TribeBGarou.Task3.Noble(\d+)$/.exec(suffix);
  if (noble) return `Uzzer councillor ${noble[1]}`;
  const slab = /^UmS_MainQuest.TribeBGarou.Task1.TallRock(\d+)$/.exec(suffix);
  if (slab) return `Saga stone slab ${slab[1]}`;
  return null;
}
module.exports = { clarifyObjective, readableTarget };
