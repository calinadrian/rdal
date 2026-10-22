// Read-only probes for reverse-engineering live UI state:
//   --find <classRegex>                 list live objects whose class (or a super class) matches
//   --watch <classRegex> <seconds>      print numeric properties of those objects whenever they change
using System.Text.RegularExpressions;

namespace Dumper;

public sealed class Probe
{
    readonly Engine _e;
    readonly Layout _l;
    readonly Memory _m;

    public Probe(Engine e, Layout l) { _e = e; _l = l; _m = e.M; }

    // Class chain names of an object's class.
    IEnumerable<string> Chain(ulong cls)
    {
        for (ulong c = cls; c != 0; c = _m.Ptr(c + (ulong)_l.SuperStruct)) yield return _e.ObjName(c);
    }

    public List<ulong> Find(string pattern, bool print)
    {
        var re = new Regex(pattern);
        var found = new List<ulong>();
        foreach (var (_, o) in _e.Objects())
        {
            if ((_m.I32(o + Engine.OFlags) & 0x10) != 0) continue; // skip class defaults
            ulong cls = _e.ClassOf(o);
            var cn = _e.ObjName(cls);
            if (!re.IsMatch(cn)) continue;
            var kind = _e.ObjName(_e.ClassOf(cls));
            if (kind is "Class" or "ScriptStruct" or "Function" or "Enum" || cn.EndsWith("Class")) continue;
            found.Add(o);
            if (print) Console.WriteLine($"0x{o:X} {cn} <{string.Join(" < ", Chain(cls).Skip(1).Take(4))}>  {_e.PathName(o)}");
        }
        return found;
    }

    // Numeric leaves of an object: (label, address, type). Recurses into structs and one level into object refs named Slot.
    List<(string Label, ulong Addr, string Type)> Leaves(ulong obj, ulong structOrClass, string prefix, int depth)
    {
        var res = new List<(string, ulong, string)>();
        for (ulong c = structOrClass; c != 0; c = _m.Ptr(c + (ulong)_l.SuperStruct))
            for (ulong f = _m.Ptr(c + (ulong)_l.ChildProperties); f != 0; f = _m.Ptr(f + (ulong)_l.FieldNext))
            {
                var name = _e.FName(f + (ulong)_l.FieldName);
                var type = _e.FName(_m.Ptr(f + (ulong)_l.FieldClass));
                ulong addr = obj + (ulong)_m.I32(f + (ulong)_l.PropOffset);
                switch (type)
                {
                    case "FloatProperty": case "DoubleProperty": case "IntProperty":
                        res.Add((prefix + name, addr, type)); break;
                    case "BoolProperty":
                        break;
                    case "StructProperty" when depth < 3:
                        res.AddRange(Leaves(addr, _m.Ptr(f + (ulong)_l.PropBase), prefix + name + ".", depth + 1)); break;
                    case "ObjectProperty" when name == "Slot" && depth == 0:
                        ulong slot = _m.Ptr(addr);
                        if (slot != 0) res.AddRange(Leaves(slot, _e.ClassOf(slot), "Slot.", depth + 1));
                        break;
                }
            }
        return res;
    }

    string Read((string Label, ulong Addr, string Type) l) => l.Type switch
    {
        "FloatProperty" => _m.Read<float>(l.Addr).ToString("0.###"),
        "DoubleProperty" => _m.Read<double>(l.Addr).ToString("0.###"),
        _ => _m.I32(l.Addr).ToString(),
    };

    // Live objects whose path contains a substring (e.g. everything inside a widget tree).
    public List<ulong> FindByPath(string sub)
    {
        var found = new List<ulong>();
        foreach (var (_, o) in _e.Objects())
        {
            if ((_m.I32(o + Engine.OFlags) & 0x10) != 0) continue;
            var p = _e.PathName(o);
            if (p.Contains(sub) && p.StartsWith("/Engine/Transient")) found.Add(o);
        }
        return found;
    }

    // Raw float/double changes inside an object's memory (catches native, non-reflected members).
    public void RawWatch(string pattern, int seconds)
    {
        // "addr:0xA,0xB" watches exact objects plus every object they point to directly.
        var objs = pattern.StartsWith("addr:")
            ? pattern[5..].Split(',').Select(s => Convert.ToUInt64(s, 16)).ToList()
            : Find(pattern, true).Where(o => _e.PathName(o).StartsWith("/Engine/Transient")).ToList();
        if (pattern.StartsWith("addr:"))
            foreach (var o in objs.ToList())
                for (int i = 0x28; i < _m.I32(_e.ClassOf(o) + (ulong)_l.PropertiesSize); i += 8)
                {
                    ulong p = _m.Ptr(o + (ulong)i);
                    if (p == 0 || objs.Contains(p) || _e.ClassOf(p) == 0) continue;
                    var cn = _e.ObjName(_e.ClassOf(p));
                    if (string.IsNullOrEmpty(cn) || !Regex.IsMatch(cn, @"^\w+$")) continue;
                    objs.Add(p);
                    Console.WriteLine($"+0x{i:X} -> 0x{p:X} {cn} {_e.PathName(p)}");
                }
        var size = objs.ToDictionary(o => o, o => Math.Clamp(_m.I32(_e.ClassOf(o) + (ulong)_l.PropertiesSize), 0x40, 0x4000));
        var last = new Dictionary<ulong, byte[]>();
        var end = DateTime.Now.AddSeconds(seconds);
        while (DateTime.Now < end)
        {
            _m.ClearCache();
            var t = DateTime.Now.ToString("HH:mm:ss.f");
            foreach (var o in objs)
            {
                var b = _m.Bytes(o, size[o]);
                if (last.TryGetValue(o, out var old) && old.Length == b.Length)
                    for (int i = 0; i + 4 <= b.Length; i += 4)
                    {
                        if (BitConverter.ToInt32(b, i) == BitConverter.ToInt32(old, i)) continue;
                        float f = BitConverter.ToSingle(b, i), fo = BitConverter.ToSingle(old, i);
                        string dbl = i % 8 == 0 && i + 8 <= b.Length ? $"  dbl {BitConverter.ToDouble(b, i):0.###} (was {BitConverter.ToDouble(old, i):0.###})" : "";
                        Console.WriteLine($"{t} RAW 0x{o:X} {_e.ObjName(_e.ClassOf(o))}+0x{i:X}: f {f:0.###} (was {fo:0.###}){dbl}");
                    }
                last[o] = b;
            }
            Console.Out.Flush();
            Thread.Sleep(200);
        }
    }

    public void Watch(string pattern, int seconds)
    {
        var objs = pattern.StartsWith("path:") ? FindByPath(pattern[5..]) : Find(pattern, true);
        Console.WriteLine($"{objs.Count} objects");
        var leaves = objs.ToDictionary(o => o, o => Leaves(o, _e.ClassOf(o), "", 0));
        var last = new Dictionary<string, string>();
        var end = DateTime.Now.AddSeconds(seconds);
        bool first = true;
        int tick = 0;
        while (DateTime.Now < end)
        {
            _m.ClearCache();
            // The game recreates map widgets every time the map opens: pick up new instances.
            if (++tick % 8 == 0 && !pattern.StartsWith("path:"))
            {
                _e.Refresh();
                foreach (var o in Find(pattern, false).Where(o => !leaves.ContainsKey(o)))
                {
                    objs.Add(o);
                    leaves[o] = Leaves(o, _e.ClassOf(o), "", 0);
                    Console.WriteLine($"{DateTime.Now:HH:mm:ss.f} NEW 0x{o:X} {_e.ObjName(_e.ClassOf(o))} {_e.PathName(o)}");
                }
            }
            var t = DateTime.Now.ToString("HH:mm:ss.f");
            foreach (var o in objs)
                foreach (var l in leaves[o])
                {
                    var key = $"0x{o:X}:{l.Label}";
                    var v = Read(l);
                    if (last.TryGetValue(key, out var old) && old == v) continue;
                    last[key] = v;
                    if (!first) Console.WriteLine($"{t} {_e.ObjName(_e.ClassOf(o))} {l.Label} = {v} (was {old})");
                }
            if (first) Console.WriteLine($"{t} watching {objs.Count} objects, {leaves.Values.Sum(x => x.Count)} values");
            first = false;
            Console.Out.Flush();
            Thread.Sleep(250);
        }
    }
}
