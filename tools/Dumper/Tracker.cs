// Streams the local player's position as JSON lines (read-only, ~10 Hz).
// GWorld -> OwningGameInstance -> LocalPlayers[0] -> PlayerController -> AcknowledgedPawn -> RootComponent
using System.Buffers.Binary;
using System.Text.Json;

namespace Dumper;

public sealed class Tracker
{
    readonly Engine _e;
    readonly Layout _l;
    readonly Memory _m;
    readonly Action<string> _log;
    ulong _gworld; // address of the GWorld global
    int _oGameInstance, _oLocalPlayers, _oPlayerController, _oPawn, _oControllerPawn = -1, _oRoot, _oRelLoc, _oControlRot, _oPersistentLevel;
    DiscoveryReader? _discovery;
    ObjectSweep _sweep = null!;
    ObjectSweep.Want _questApis = null!, _registries = null!, _panels = null!;
    ulong _world;

    public Tracker(Engine e, Layout l, Action<string> log) { _e = e; _l = l; _m = e.M; _log = log; }

    // Whether a class is, or derives from, the class of that name (the game subclasses its native classes in
    // blueprints, e.g. BP_Components_QuestProgress_C).
    readonly Dictionary<(ulong, string), bool> _isA = new();
    bool IsA(ulong cls, string name)
    {
        if (cls == 0) return false;
        if (_isA.TryGetValue((cls, name), out var yes)) return yes;
        // A stale pointer reads as garbage: a real class chain is never this deep.
        ulong c = cls;
        for (int depth = 0; c != 0 && !yes && depth < 64; depth++, c = _m.Ptr(c + (ulong)_l.SuperStruct)) yes = _e.ObjName(c) == name;
        return _isA[(cls, name)] = yes;
    }

    // Offset of a property, searching up the class chain.
    int Prop(string classPath, string name)
    {
        for (ulong c = _e.FindObject(classPath); c != 0; c = _m.Ptr(c + (ulong)_l.SuperStruct))
            for (ulong f = _m.Ptr(c + (ulong)_l.ChildProperties); f != 0; f = _m.Ptr(f + (ulong)_l.FieldNext))
                if (_e.FName(f + (ulong)_l.FieldName) == name) return _m.I32(f + (ulong)_l.PropOffset);
        throw new Exception($"{classPath}.{name} not found");
    }

    public void Init(byte[] module)
    {
        _oGameInstance = Prop("/Script/Engine.World", "OwningGameInstance");
        _oPersistentLevel = Prop("/Script/Engine.World", "PersistentLevel");
        _oLocalPlayers = Prop("/Script/Engine.GameInstance", "LocalPlayers");
        _oPlayerController = Prop("/Script/Engine.Player", "PlayerController");
        _oPawn = Prop("/Script/Engine.PlayerController", "AcknowledgedPawn");
        try { _oControllerPawn = Prop("/Script/Engine.Controller", "Pawn"); } catch { }
        _oControlRot = Prop("/Script/Engine.Controller", "ControlRotation");
        _oRoot = Prop("/Script/Engine.Actor", "RootComponent");
        _oRelLoc = Prop("/Script/Engine.SceneComponent", "RelativeLocation");
        try
        {
            _oGameState = Prop("/Script/Engine.World", "GameState");
            _oPlayerArray = Prop("/Script/Engine.GameStateBase", "PlayerArray");
            _oPawnPrivate = Prop("/Script/Engine.PlayerState", "PawnPrivate");
            _oPlayerName = Prop("/Script/Engine.PlayerState", "PlayerNamePrivate");
            _oRelRot = Prop("/Script/Engine.SceneComponent", "RelativeRotation");
        }
        catch { }
        try
        {
            _oQuestComp = Prop("/Script/Dominion.QuestUIAPI", "LocalPlayerQuestProgressComponent");
            _oQuests = Prop("/Script/Dominion.QuestProgressComponent", "Quests");
        }
        catch { _oQuestComp = -1; }
        try { _oVisibility = Prop("/Script/Dominion.QuestProgressComponent", "VisibilityTrackers"); } catch { _oVisibility = -1; }
        try { _oLodestones = Prop("/Script/Dominion.GameplayObjectRegistry", "Lodestones"); } catch { _oLodestones = -1; }
        try { _oVisibilityProp = Prop("/Script/UMG.Widget", "Visibility"); } catch { _oVisibilityProp = -1; }
        _sweep = new ObjectSweep(_e);
        _questApis = _sweep.Add((o, cls) => IsA(cls, "QuestUIAPI"));
        _registries = _sweep.Add((o, cls) => IsA(cls, "GameplayObjectRegistry"));
        _panels = _sweep.Add((o, cls) => IsA(cls, "MapWidget") && _e.PathName(o).StartsWith("/Engine/Transient"));
        _discovery = new DiscoveryReader(_e, Prop, _sweep, IsA);
        try { (_oActive, _activeMask) = BoolProp("/Script/CommonUI.CommonActivatableWidget", "bIsActive"); } catch { _oActive = -1; }

        // GWorld: the module global that points at a live World with a game instance.
        var worlds = _e.Objects().Select(x => x.Obj)
            .Where(o => _e.ObjName(_e.ClassOf(o)) == "World" && (_m.I32(o + Engine.OFlags) & 0x10) == 0
                        && _m.Ptr(o + (ulong)_oPersistentLevel) != 0 && _m.Ptr(o + (ulong)_oGameInstance) != 0)
            .ToHashSet();
        for (int o = 0; o + 8 <= module.Length && _gworld == 0; o += 8)
            if (worlds.Contains(BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o)))) _gworld = _m.ModuleBase + (ulong)o;
        if (_gworld == 0) throw new Exception("GWorld not found (load into a world first)");
        _log($"GWorld at module+0x{_gworld - _m.ModuleBase:X}");
        // A sample reads far fewer pages than the type lookups above: keep the cache (and this process) small from here on.
        _m.MaxPages = 8192;
    }

    // FString: TCHAR* data, int count (including the terminator).
    string FString(ulong addr)
    {
        ulong data = _m.Ptr(addr);
        int count = _m.I32(addr + 8);
        if (data == 0 || count <= 1 || count > 256) return "";
        var bytes = _m.Bytes(data, (count - 1) * 2);
        return System.Text.Encoding.Unicode.GetString(bytes);
    }

    // Other players in your world, from the game state's player list (name, position, facing). Reading just
    // these, rather than every actor in the level, keeps each look a few dozen reads however busy the world is.
    List<object>? Players(ulong world, ulong player)
    {
        if (_oGameState < 0 || _oPlayerArray < 0 || _oPawnPrivate < 0) return null;
        ulong state = _m.Ptr(world + (ulong)_oGameState);
        if (state == 0) return null;
        ulong data = _m.Ptr(state + (ulong)_oPlayerArray);
        int count = _m.I32(state + (ulong)_oPlayerArray + 8);
        if (count < 0 || count > 64 || (count > 0 && data == 0)) return null;
        var res = new List<object>();
        for (int i = 0; i < count; i++)
        {
            ulong ps = _m.Ptr(data + (ulong)(i * 8));
            ulong pawn = ps == 0 ? 0 : _m.Ptr(ps + (ulong)_oPawnPrivate);
            if (pawn == 0 || pawn == player) continue;
            ulong root = _m.Ptr(pawn + (ulong)_oRoot);
            if (root == 0) continue;
            double x = _m.Read<double>(root + (ulong)_oRelLoc), y = _m.Read<double>(root + (ulong)_oRelLoc + 8), z = _m.Read<double>(root + (ulong)_oRelLoc + 16);
            if (x == 0 && y == 0) continue;
            string name = _oPlayerName > 0 ? FString(ps + (ulong)_oPlayerName) : "";
            double yaw = _oRelRot > 0 ? _m.Read<double>(root + (ulong)_oRelRot + 8) : 0;
            res.Add(new { n = name, x = Math.Round(x), y = Math.Round(y), z = Math.Round(z), yaw = Math.Round(yaw, 1) });
        }
        return res;
    }
    int _oGameState = -1, _oPlayerArray = -1, _oPawnPrivate = -1, _oPlayerName = -1, _oRelRot = -1;
    int _tick;

    // Quest log: QuestUIAPI.LocalPlayerQuestProgressComponent -> Quests (TArray<FQuestProgress>, 0x38 each:
    // Data @0, State @8 (Ungiven/Given/Complete), CurrentObjective FName @0xC, QuestInts @0x18, QuestBools @0x28).
    int _oQuestComp = -1, _oQuests = -1, _oVisibility = -1;
    ulong _questApi;
    ulong QuestComponent()
    {
        if (_oQuestComp < 0) return 0;
        ulong Comp(ulong api) => api == 0 || !IsA(_e.ClassOf(api), "QuestUIAPI") ? 0
            : _m.Ptr(api + (ulong)_oQuestComp) is var c && IsA(_e.ClassOf(c), "QuestProgressComponent") ? c : 0;
        ulong comp = Comp(_questApi);
        if (comp != 0) return comp;
        // The UI API object is recreated with the world: look for it again.
        _questApi = _questApis.Found.FirstOrDefault(o => Comp(o) != 0);
        if (_questApi == 0) _sweep.Need(_questApis);
        return Comp(_questApi);
    }

    // TArray of { FName, value } pairs, 12 bytes each (FQuestBool, FQuestInt, FLocationVisibilityTracker).
    Dictionary<string, T>? NamedValues<T>(ulong array, Func<ulong, T> value)
    {
        ulong data = _m.Ptr(array);
        int count = _m.I32(array + 8);
        if (count < 0 || count > 4096 || (count > 0 && data == 0)) return null;
        var res = new Dictionary<string, T>();
        for (int j = 0; j < count; j++)
        {
            ulong entry = data + (ulong)(j * 12);
            var name = _e.FName(entry);
            if (!string.IsNullOrEmpty(name) && name != "None") res[name] = value(entry + 8);
        }
        return res;
    }

    List<object>? Quests(ulong comp)
    {
        if (comp == 0) return null;
        ulong data = _m.Ptr(comp + (ulong)_oQuests);
        int num = Math.Clamp(_m.I32(comp + (ulong)_oQuests + 8), 0, 2000);
        var res = new List<object>();
        for (int i = 0; i < num; i++)
        {
            ulong q = data + (ulong)(i * 0x38);
            ulong qd = _m.Ptr(q);
            if (qd == 0) continue;
            var ints = NamedValues(q + 0x18, a => _m.I32(a));
            var bools = NamedValues(q + 0x28, a => _m.Read<byte>(a) != 0);
            res.Add(new { id = _e.ObjName(qd), s = _m.Read<byte>(q + 8), o = _e.FName(q + 0xC), b = bools, i = ints is { Count: > 0 } ? ints : null });
        }
        return res;
    }

    // The quest locations the game has shown or hidden on its own map (QFT_UpdateQuestLocation), by location name.
    // Locations never updated keep their placed default (bShownByDefault).
    Dictionary<string, bool>? QuestLocations(ulong comp) =>
        comp == 0 || _oVisibility < 0 ? null : NamedValues(comp + (ulong)_oVisibility, a => _m.Read<byte>(a) != 0);

    // FBoolProperty keeps FieldSize, ByteOffset, ByteMask, FieldMask after the FProperty: (byte offset, mask).
    (int, byte) BoolProp(string classPath, string name)
    {
        for (ulong c = _e.FindObject(classPath); c != 0; c = _m.Ptr(c + (ulong)_l.SuperStruct))
            for (ulong f = _m.Ptr(c + (ulong)_l.ChildProperties); f != 0; f = _m.Ptr(f + (ulong)_l.FieldNext))
                if (_e.FName(f + (ulong)_l.FieldName) == name)
                    return (_m.I32(f + (ulong)_l.PropOffset) + _m.Read<byte>(f + (ulong)_l.PropBase + 1), _m.Read<byte>(f + (ulong)_l.PropBase + 3));
        throw new Exception($"{classPath}.{name} not found");
    }

    // The game's own map: the Map panel of the in-game menu (a native MapWidget, CommonUI activatable) is active
    // exactly while it shows, whether opened with M or from the menu's tabs. The menu is built the first time it
    // opens and rebuilt with the world, so the live panels are looked for again when missing or gone, straight
    // away after M is pressed in the game. null while no panel is known.
    int _oActive = -1;
    byte _activeMask;
    List<(ulong Obj, ulong Cls)> _mapPanels = new();
    volatile bool _mapRescan;
    public void MapKeyPressed() => _mapRescan = true;
    bool? MapOpen()
    {
        if (_oActive < 0) return null;
        if (_mapPanels.Count == 0 || _mapPanels.Any(p => _e.ClassOf(p.Obj) != p.Cls))
        {
            // The panels of the latest look that are still there; another look when some are missing.
            var found = _panels.Found.Select(o => (Obj: o, Cls: _e.ClassOf(o))).ToList();
            var live = found.Where(p => IsA(p.Cls, "MapWidget")).ToList();
            if (live.Count == 0 || live.Count < found.Count) { _sweep.Need(_panels, _mapRescan); _mapRescan = false; }
            if (live.Count > 0 && !live.SequenceEqual(_mapPanels))
                _log($"Map panels: {string.Join(", ", live.Select(p => $"0x{p.Obj:X} {_e.ObjName(p.Cls)}"))} (bIsActive at +0x{_oActive:X} mask 0x{_activeMask:X})");
            _mapPanels = live;
            if (live.Count == 0) return null;
        }
        return _mapPanels.Any(p => (_m.Read<byte>(p.Obj + (ulong)_oActive) & _activeMask) != 0);
    }

    // Offset of a property on a live object's class (or its supers), -1 when it has none.
    readonly Dictionary<(ulong, string), int> _propOn = new();
    int PropOn(ulong cls, string name)
    {
        if (_propOn.TryGetValue((cls, name), out var o)) return o;
        o = -1;
        for (ulong c = cls; c != 0 && o < 0; c = _m.Ptr(c + (ulong)_l.SuperStruct))
            for (ulong f = _m.Ptr(c + (ulong)_l.ChildProperties); f != 0 && o < 0; f = _m.Ptr(f + (ulong)_l.FieldNext))
                if (_e.FName(f + (ulong)_l.FieldName) == name) o = _m.I32(f + (ulong)_l.PropOffset);
        return _propOn[(cls, name)] = o;
    }

    // Opening the map at a lodestone (E) shows the map's lodestone panel (the teleport cost): the player is choosing
    // where to teleport, so the overlay must leave the game's map alone. UWidget.Visibility: Visible, Collapsed,
    // Hidden, HitTestInvisible, SelfHitTestInvisible.
    int _oVisibilityProp = -1;
    bool MapTeleporting()
    {
        if (_oActive < 0 || _oVisibilityProp < 0) return false;
        foreach (var (obj, cls) in _mapPanels)
        {
            if ((_m.Read<byte>(obj + (ulong)_oActive) & _activeMask) == 0) continue;
            int o = PropOn(cls, "LodestoneWidget");
            ulong widget = o < 0 ? 0 : _m.Ptr(obj + (ulong)o);
            if (widget != 0 && _m.Read<byte>(widget + (ulong)_oVisibilityProp) is 0 or 3 or 4) return true;
        }
        return false;
    }

    // Every lodestone in the world, built ones included, from the GameplayObjectRegistry actor's Lodestones
    // (TArray<FLodestoneData>, 64 bytes each: Location, RespawnLocation, Guid). Looked up again with the world.
    int _oLodestones = -1;
    ulong _registry;
    List<object>? Lodestones()
    {
        if (_oLodestones < 0) return null;
        if (!IsA(_e.ClassOf(_registry), "GameplayObjectRegistry"))
        {
            _registry = _registries.Found.FirstOrDefault(o => IsA(_e.ClassOf(o), "GameplayObjectRegistry"));
            if (_registry == 0) { _sweep.Need(_registries); return null; }
        }
        ulong data = _m.Ptr(_registry + (ulong)_oLodestones);
        int count = _m.I32(_registry + (ulong)_oLodestones + 8);
        if (count < 0 || count > 1000 || (count > 0 && data == 0)) return null;
        var res = new List<object>();
        for (int i = 0; i < count; i++)
        {
            ulong d = data + (ulong)(i * 64);
            res.Add(new { x = Math.Round(_m.Read<double>(d)), y = Math.Round(_m.Read<double>(d + 8)), z = Math.Round(_m.Read<double>(d + 16)) });
        }
        return res;
    }

    public object Sample()
    {
        _m.ClearCache();
        ulong world = _m.Ptr(_gworld);
        // A slice of the look for objects that are missing, before the position so that is as fresh as can be.
        if (world != _world) { _world = world; _sweep.Wake(); }
        _sweep.Step();
        ulong gi = world == 0 ? 0 : _m.Ptr(world + (ulong)_oGameInstance);
        ulong lps = gi == 0 ? 0 : _m.Ptr(gi + (ulong)_oLocalPlayers);
        ulong lp = lps == 0 ? 0 : _m.Ptr(lps);
        ulong pc = lp == 0 ? 0 : _m.Ptr(lp + (ulong)_oPlayerController);
        ulong pawn = pc == 0 ? 0 : _m.Ptr(pc + (ulong)_oPawn);
        // A joining player's controller can be slow to acknowledge its character: the possessed pawn is the same one.
        if (pawn == 0 && pc != 0 && _oControllerPawn > 0) pawn = _m.Ptr(pc + (ulong)_oControllerPawn);
        ulong root = pawn == 0 ? 0 : _m.Ptr(pawn + (ulong)_oRoot);
        if (root == 0) return new { ok = false, world = world == 0 ? null : _e.ObjName(world) };
        double x = _m.Read<double>(root + (ulong)_oRelLoc), y = _m.Read<double>(root + (ulong)_oRelLoc + 8), z = _m.Read<double>(root + (ulong)_oRelLoc + 16);
        double yaw = _m.Read<double>(pc + (ulong)_oControlRot + 8);
        // Other players, refreshed about twice a second.
        var players = _tick % 4 == 0 ? Players(world, pawn) : null;
        // Quest log and the game's revealed quest locations, every ~3 s (they only change when a quest moves on).
        ulong questComp = _tick % 20 == 0 ? QuestComponent() : 0;
        var quests = Quests(questComp);
        var questLocations = quests == null ? null : QuestLocations(questComp);
        var discovery = _tick % 20 == 0 ? _discovery?.Read(pc, world) : null;
        // Lodestones change only when someone builds or removes one.
        var lodestones = _tick % 20 == 0 ? Lodestones() : null;
        _tick++;
        // Whether the game's map is showing and the game window has the keyboard, for the overlay map.
        bool? map = MapOpen();
        // Opened at a lodestone to teleport: the game's map is the one to use.
        bool teleport = map == true && MapTeleporting();
        bool focus = KeyWatch.GameFocused(_m.Pid);
        return new { ok = true, world = _e.ObjName(world), x = Math.Round(x), y = Math.Round(y), z = Math.Round(z), yaw = Math.Round(yaw, 1), map, teleport, focus, players, quests, questLocations, lodestones, discovery };
    }

    public void Run(int intervalMs, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            Console.WriteLine(JsonSerializer.Serialize(Sample()));
            Thread.Sleep(intervalMs);
        }
    }
}
