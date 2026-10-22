// Player-specific discovery records. Missing/unreadable data stays null, never an empty completion list.
namespace Dumper;

public sealed class DiscoveryReader
{
    readonly Engine _e;
    readonly Memory _m;
    readonly int _playerState, _ownerGuid, _journal, _entries, _progress, _shrines, _poiPlayers, _recipes, _temporaryRecipes;
    ulong _poiActor, _world;
    DateTime _nextScan;

    public DiscoveryReader(Engine e, Func<string, string, int> prop)
    {
        _e = e; _m = e.M;
        int Offset(string type, string name) { try { return prop(type, name); } catch { return -1; } }
        _playerState = Offset("/Script/Engine.Controller", "PlayerState");
        _ownerGuid = Offset("/Script/Dominion.DominionPlayerState", "OwnerGuid");
        _journal = Offset("/Script/Dominion.DominionPlayerController", "JournalComponent");
        _entries = Offset("/Script/Dominion.JournalComponent", "UnlockedJournalEntries");
        _progress = Offset("/Script/Dominion.DominionPlayerController", "ProgressComponent");
        _shrines = Offset("/Script/Dominion.ProgressComponent", "ShrinesUnlocked");
        _recipes = Offset("/Script/Dominion.ProgressComponent", "RecipesUnlocked");
        _temporaryRecipes = Offset("/Script/Dominion.ProgressComponent", "RecipesUnlockedThatShouldNotPersist");
        _poiPlayers = Offset("/Script/Dominion.PoiDiscoverySystemActor", "PoiDiscoverySystemDataPerPlayer");
    }

    byte[]? Array(ulong at, int stride, int limit)
    {
        if (at < 0x10000) return null;
        var header = _m.Bytes(at, 16);
        if (header.Length != 16) return null;
        ulong data = BitConverter.ToUInt64(header, 0);
        int count = BitConverter.ToInt32(header, 8), max = BitConverter.ToInt32(header, 12);
        if (count < 0 || count > limit || max < count || max > limit || (count > 0 && !Memory.LooksLikePtr(data))) return null;
        return count == 0 ? System.Array.Empty<byte>() : _m.Bytes(data, count * stride) is var bytes && bytes.Length == count * stride ? bytes : null;
    }

    static string GuidAt(byte[] bytes, int at) => string.Concat(Enumerable.Range(0, 4).Select(i => BitConverter.ToUInt32(bytes, at + i * 4).ToString("X8")));
    string? GuidAt(ulong at) { var b = _m.Bytes(at, 16); return b.Length == 16 ? GuidAt(b, 0) : null; }
    List<string>? Guids(ulong at)
    {
        var bytes = Array(at, 16, 20000);
        return bytes == null ? null : Enumerable.Range(0, bytes.Length / 16).Select(i => GuidAt(bytes, i * 16)).ToList();
    }
    bool InWorld(ulong obj, ulong world)
    {
        for (int i = 0; obj != 0 && i < 8; i++, obj = _e.Outer(obj)) if (obj == world) return true;
        return false;
    }

    // UE5 TSet<UObject*>: TSparseArray elements (16-byte slots) and allocation bits.
    // Free slots are not recipes. A malformed/unreadable set is unknown, never empty.
    List<string>? RecipeSet(ulong at)
    {
        var h = _m.Bytes(at, 56);
        if (h.Length != 56) return null;
        ulong data=BitConverter.ToUInt64(h,0);
        int count=BitConverter.ToInt32(h,8), capacity=BitConverter.ToInt32(h,12);
        int bits=BitConverter.ToInt32(h,40), maxBits=BitConverter.ToInt32(h,44), free=BitConverter.ToInt32(h,52);
        if(count<0 || count>20000 || capacity<count || capacity>40000 || bits!=count || maxBits<bits || maxBits>40000 || free<0 || free>count) return null;
        if(count==0) return new();
        if(!Memory.LooksLikePtr(data)) return null;
        int words=(bits+31)/32;
        ulong bitData=BitConverter.ToUInt64(h,32);
        var flags=bitData==0 ? h.Skip(16).Take(16).ToArray() : _m.Bytes(bitData,words*4);
        if(flags.Length<words*4) return null;
        var slots=_m.Bytes(data,count*16);
        if(slots.Length!=count*16) return null;
        var names=new List<string>();
        for(int i=0;i<count;i++)
        {
            if((BitConverter.ToUInt32(flags,(i/32)*4)&(1u<<(i%32)))==0) continue;
            ulong entry=BitConverter.ToUInt64(slots,i*16);
            if(!Memory.LooksLikePtr(entry)) return null;
            var name=_e.ObjName(entry);
            if(string.IsNullOrWhiteSpace(name) || name=="None" || !_e.ObjName(_e.ClassOf(entry)).EndsWith("RecipeData")) return null;
            names.Add(name);
        }
        return names.Count==count-free ? names : null;
    }

    public object? Read(ulong controller, ulong world)
    {
        if (_playerState < 0 || _ownerGuid < 0) return null;
        ulong ps = _m.Ptr(controller + (ulong)_playerState);
        if (ps == 0) return null;
        var character = GuidAt(ps + (ulong)_ownerGuid);
        if (character == null || character.All(c => c == '0')) return null;
        List<string>? journal = null, shrines = null, pois = null, recipes = null;
        if (_journal >= 0 && _entries >= 0)
        {
            ulong component = _m.Ptr(controller + (ulong)_journal);
            var bytes = component == 0 ? null : Array(component + (ulong)_entries, 8, 20000);
            if (bytes != null)
            {
                journal = new();
                for (int i = 0; i < bytes.Length; i += 8)
                {
                    ulong entry = BitConverter.ToUInt64(bytes, i);
                    if (!Memory.LooksLikePtr(entry)) { journal = null; break; }
                    var name = _e.ObjName(entry);
                    if (string.IsNullOrWhiteSpace(name) || name == "None") { journal = null; break; }
                    journal.Add(name);
                }
            }
        }
        if (_progress >= 0 && _shrines >= 0)
        {
            ulong component = _m.Ptr(controller + (ulong)_progress);
            if (component != 0) shrines = Guids(component + (ulong)_shrines);
            if(component!=0 && _recipes>=0 && _temporaryRecipes>=0)
            {
                var known=RecipeSet(component+(ulong)_recipes);
                var temporary=RecipeSet(component+(ulong)_temporaryRecipes);
                if(known!=null && temporary!=null) recipes=known.Concat(temporary).Distinct().ToList();
            }
        }
        if (_poiPlayers >= 0)
        {
            if (_world != world) { _world = world; _poiActor = 0; _nextScan = DateTime.MinValue; }
            if ((_poiActor == 0 || !InWorld(_poiActor, world)) && DateTime.Now >= _nextScan)
            {
                _nextScan = DateTime.Now.AddSeconds(20);
                _poiActor = _e.Objects().Select(o => o.Obj).FirstOrDefault(o =>
                    (_m.I32(o + Engine.OFlags) & 0x10) == 0 && _e.ObjName(_e.ClassOf(o)) == "PoiDiscoverySystemActor" && InWorld(o, world));
            }
            var players = _poiActor == 0 ? null : Array(_poiActor + (ulong)_poiPlayers, 32, 1000);
            if (players != null)
                for (int i = 0; i < players.Length; i += 32)
                    if (GuidAt(players, i) == character)
                    {
                        // DiscoveredPois is the TArray header at +16 in this player's record.
                        ulong data = _m.Ptr(_poiActor + (ulong)_poiPlayers);
                        pois = Guids(data + (ulong)i + 16);
                        break;
                    }
        }
        return new { character, session = _m.Pid + ":" + world.ToString("X"), journal, shrines, pois, recipes };
    }
}
