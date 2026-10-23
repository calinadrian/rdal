// Finds the live objects the tracker follows that the game replaces as it goes (the quest UI, the lodestone
// registry, the POI discovery actor, the game's map panels). The game holds hundreds of thousands of objects, so
// walking them all at once would stall the position stream for seconds on a slow PC: the walk goes a slice per
// sample instead, every wanted class checked at once. A look waits a while before the next one, longer each time
// it finds nothing (a joining player's game may never have the object), unless the world changed or the look is
// urgent (M pressed).
namespace Dumper;

public sealed class ObjectSweep
{
    // Something looked for: what matches (object, class), and what the latest full lap over the objects found.
    public sealed class Want
    {
        internal readonly Func<ulong, ulong, bool> Match;
        internal readonly List<ulong> Lap = new();
        internal int Left = -1;      // objects still to visit in this lap, -1 while not looking
        internal int Misses;         // looks in a row that found nothing
        internal DateTime Rest;      // no new look before this
        public IReadOnlyList<ulong> Found { get; internal set; } = Array.Empty<ulong>();
        internal Want(Func<ulong, ulong, bool> match) => Match = match;
    }

    const int Slice = 10_000;        // objects per sample: about five seconds for a lap over the whole game
    readonly Engine _e;
    readonly Memory _m;
    readonly List<Want> _wants = new();
    int _at;                         // next object index, going round and round while anything is looked for

    public ObjectSweep(Engine e) { _e = e; _m = e.M; }

    public Want Add(Func<ulong, ulong, bool> match) { var w = new Want(match); _wants.Add(w); return w; }

    // Looks for w from wherever the walk is, once round all objects, unless it is already looking or resting.
    public void Need(Want w, bool urgent = false)
    {
        if (w.Left >= 0 || (!urgent && DateTime.Now < w.Rest)) return;
        _e.Refresh();
        w.Lap.Clear();
        w.Left = _e.NumObjects;
    }

    // A new world: everything may be somewhere else now, so looks need not wait.
    public void Wake() { foreach (var w in _wants) { w.Misses = 0; w.Rest = DateTime.MinValue; } }

    // One slice of the walk (once per sample).
    public void Step()
    {
        var looking = _wants.Where(w => w.Left >= 0).ToList();
        for (int n = 0; n < Slice && looking.Count > 0; n++)
        {
            if (_at >= _e.NumObjects) { _at = 0; _e.Refresh(); }
            ulong o = _e.Object(_at++);
            // Class defaults are never what is looked for.
            ulong cls = o == 0 || (_m.I32(o + Engine.OFlags) & 0x10) != 0 ? 0 : _e.ClassOf(o);
            for (int i = looking.Count - 1; i >= 0; i--)
            {
                var w = looking[i];
                if (cls != 0 && w.Match(o, cls)) w.Lap.Add(o);
                if (--w.Left > 0) continue;
                w.Left = -1;
                w.Found = w.Lap.ToList();
                w.Misses = w.Found.Count == 0 ? w.Misses + 1 : 0;
                w.Rest = DateTime.Now.AddSeconds(20 << Math.Clamp(w.Misses - 1, 0, 3)); // 20 s, up to 160 s after misses
                looking.RemoveAt(i);
            }
        }
    }
}
