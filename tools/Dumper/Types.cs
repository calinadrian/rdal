// Discovers UStruct/FProperty/UEnum member offsets from well-known engine types,
// then walks every class, struct and enum in the running game.
using System.Text;
using System.Text.Json;

namespace Dumper;

public sealed class Layout
{
    public int SuperStruct, ChildProperties, PropertiesSize;
    public int FieldClass = 8, FieldNext, FieldName;
    public int ArrayDim, ElementSize, PropOffset, PropBase; // PropBase = sizeof(FProperty)
    public int EnumNames;

    public static Layout Discover(Engine e, Action<string> log)
    {
        var m = e.M;
        var L = new Layout();
        ulong find(string p) => e.FindObject(p) is var o and not 0 ? o : throw new Exception($"{p} not found");
        ulong cStruct = find("/Script/CoreUObject.Struct"), cClass = find("/Script/CoreUObject.Class");
        ulong vec = find("/Script/CoreUObject.Vector"), xf = find("/Script/CoreUObject.Transform"), quat = find("/Script/CoreUObject.Quat");

        L.SuperStruct = Scan(0x28, 0x80, 8, o => m.Ptr(cClass + (ulong)o) == cStruct, "UStruct::SuperStruct");

        // ChildProperties: first FField of Vector is named "X".
        for (int o = L.SuperStruct + 8; o < 0x90 && L.ChildProperties == 0; o += 8)
        {
            ulong f = m.Ptr(vec + (ulong)o);
            if (!Memory.LooksLikePtr(f)) continue;
            for (int n = 0x18; n <= 0x40; n += 8)
                if (e.FName(f + (ulong)n) == "X") { L.ChildProperties = o; L.FieldName = n; break; }
        }
        if (L.ChildProperties == 0) throw new Exception("UStruct::ChildProperties not found");
        ulong fx = m.Ptr(vec + (ulong)L.ChildProperties);
        L.FieldNext = Scan(0x10, L.FieldName, 8, o => m.Ptr(fx + (ulong)o) is var p && Memory.LooksLikePtr(p) && e.FName(p + (ulong)L.FieldName) == "Y", "FField::Next");
        ulong fy = m.Ptr(fx + (ulong)L.FieldNext), fz = m.Ptr(fy + (ulong)L.FieldNext);
        string elemType = e.FName(m.Ptr(fx + (ulong)L.FieldClass));
        int elemSize = elemType == "DoubleProperty" ? 8 : 4;

        L.PropertiesSize = Scan(L.ChildProperties + 8, L.ChildProperties + 0x20, 4, o => m.I32(vec + (ulong)o) == elemSize * 3 && m.I32(xf + (ulong)o) == elemSize * 12, "UStruct::PropertiesSize");
        L.ArrayDim = Scan(L.FieldName + 8, L.FieldName + 0x30, 4, o => m.I32(fx + (ulong)o) == 1 && m.I32(fx + (ulong)o + 4) == elemSize, "FProperty::ArrayDim");
        L.ElementSize = L.ArrayDim + 4;
        L.PropOffset = Scan(L.ElementSize + 4, L.ElementSize + 0x30, 4, o => m.I32(fx + (ulong)o) == 0 && m.I32(fy + (ulong)o) == elemSize && m.I32(fz + (ulong)o) == elemSize * 2, "FProperty::Offset_Internal");

        // sizeof(FProperty): Transform.Rotation is a StructProperty pointing at Quat.
        ulong rot = 0;
        for (ulong f = m.Ptr(xf + (ulong)L.ChildProperties); f != 0 && rot == 0; f = m.Ptr(f + (ulong)L.FieldNext))
            if (e.FName(f + (ulong)L.FieldName) == "Rotation") rot = f;
        L.PropBase = Scan(L.PropOffset + 4, 0xC0, 8, o => m.Ptr(rot + (ulong)o) == quat, "sizeof(FProperty)");

        // UEnum::Names: TArray<TPair<FName, int64>> whose first entry looks like "EnumName::Value".
        ulong anEnum = e.Objects().Select(x => x.Obj).First(o => e.ObjName(e.ClassOf(o)) == "Enum" && e.ObjName(o).StartsWith("E"));
        L.EnumNames = Scan(0x30, 0x80, 8, o =>
        {
            ulong data = m.Ptr(anEnum + (ulong)o);
            int num = m.I32(anEnum + (ulong)o + 8), max = m.I32(anEnum + (ulong)o + 12);
            if (!Memory.LooksLikePtr(data) || num < 2 || num > max || max > 100000) return false;
            // Entries are {FName, int64 value}: names are identifiers, values small.
            for (int i = 0; i < Math.Min(num, 4); i++)
            {
                var n = e.FName(data + (ulong)i * 16);
                if (!System.Text.RegularExpressions.Regex.IsMatch(n, @"^[A-Za-z_][\w:]*$") || (ulong)m.Read<long>(data + (ulong)i * 16 + 8) > 0xFFFFFFFF) return false;
            }
            return true;
        }, "UEnum::Names");

        log($"Layout: Super=0x{L.SuperStruct:X} Children=0x{L.ChildProperties:X} Size=0x{L.PropertiesSize:X} " +
            $"FField.Next=0x{L.FieldNext:X} Name=0x{L.FieldName:X} ArrayDim=0x{L.ArrayDim:X} Offset=0x{L.PropOffset:X} " +
            $"sizeof(FProperty)=0x{L.PropBase:X} Enum.Names=0x{L.EnumNames:X} ({elemType} vectors)");
        return L;
    }

    static int Scan(int from, int to, int step, Func<int, bool> test, string what)
    {
        for (int o = from; o < to; o += step) if (test(o)) return o;
        throw new Exception($"{what} not found");
    }
}

public sealed record PropType(string Type, string? Struct = null, string? Enum = null, PropType? Inner = null, PropType? Value = null);
public sealed record Prop(string Name, int ArrayDim, int Offset, int Size, PropType Type);
public sealed record StructDef(string Name, string? Super, string Path, bool IsClass, int Size, List<Prop> Props);
public sealed record EnumDef(string Name, List<string> Values);

public sealed class Types
{
    public List<StructDef> Structs = new();
    public List<EnumDef> Enums = new();
}

public sealed class TypeDumper
{
    readonly Engine _e;
    readonly Layout _l;
    readonly Action<string> _log;
    readonly Memory _m;
    readonly Dictionary<ulong, string> _kind = new(); // class object -> "struct" | "class" | "enum" | ""

    public TypeDumper(Engine e, Layout l, Action<string> log) { _e = e; _l = l; _log = log; _m = e.M; }

    // What kind of type object an object is, judged by its class's inheritance chain.
    string Kind(ulong cls)
    {
        if (_kind.TryGetValue(cls, out var k)) return k;
        k = "";
        for (ulong c = cls; c != 0; c = _m.Ptr(c + (ulong)_l.SuperStruct))
        {
            var n = _e.ObjName(c);
            if (n == "Function") break;
            if (n == "Enum") { k = "enum"; break; }
            if (n == "Class") { k = "class"; break; }
            if (n == "ScriptStruct") { k = "struct"; break; }
        }
        return _kind[cls] = k;
    }

    public Types Dump()
    {
        var t = new Types();
        var seenS = new HashSet<string>();
        var seenE = new HashSet<string>();
        foreach (var (_, o) in _e.Objects())
        {
            if ((_m.I32(o + Engine.OFlags) & 0x10) != 0) continue; // class default objects
            var kind = Kind(_e.ClassOf(o));
            if (kind == "") continue;
            var name = _e.ObjName(o);
            if (kind == "enum")
            {
                if (seenE.Add(name)) t.Enums.Add(ReadEnum(o, name));
                continue;
            }
            if (!seenS.Add(name)) continue;
            ulong sup = _m.Ptr(o + (ulong)_l.SuperStruct);
            t.Structs.Add(new StructDef(name, sup != 0 ? _e.ObjName(sup) : null, _e.PathName(o), kind == "class",
                _m.I32(o + (ulong)_l.PropertiesSize), ReadProps(o)));
        }
        _log($"Found {t.Structs.Count} classes/structs, {t.Enums.Count} enums, {t.Structs.Sum(s => s.Props.Count)} properties");
        return t;
    }

    EnumDef ReadEnum(ulong o, string name)
    {
        ulong data = _m.Ptr(o + (ulong)_l.EnumNames);
        int num = Math.Clamp(_m.I32(o + (ulong)_l.EnumNames + 8), 0, 100000);
        var vals = new List<string>(num);
        for (int i = 0; i < num; i++)
        {
            var v = _e.FName(data + (ulong)i * 16);
            int c = v.LastIndexOf("::", StringComparison.Ordinal);
            vals.Add(c >= 0 ? v[(c + 2)..] : v);
        }
        return new EnumDef(name, vals);
    }

    List<Prop> ReadProps(ulong st)
    {
        var props = new List<Prop>();
        for (ulong f = _m.Ptr(st + (ulong)_l.ChildProperties); f != 0 && props.Count < 4096; f = _m.Ptr(f + (ulong)_l.FieldNext))
            props.Add(new Prop(_e.FName(f + (ulong)_l.FieldName), Math.Max(1, _m.I32(f + (ulong)_l.ArrayDim)),
                _m.I32(f + (ulong)_l.PropOffset), _m.I32(f + (ulong)_l.ElementSize), ReadType(f)));
        return props;
    }

    ulong Base(ulong f, int extra = 0) => _m.Ptr(f + (ulong)(_l.PropBase + extra));
    string FieldClassName(ulong f) => _e.FName(_m.Ptr(f + (ulong)_l.FieldClass));
    bool IsField(ulong p) => Memory.LooksLikePtr(p) && FieldClassName(p).EndsWith("Property");

    // Inner property pointer: usually at sizeof(FProperty), but tolerate a flags field first.
    ulong InnerProp(ulong f, int slot = 0)
    {
        ulong p = Base(f, slot * 8);
        return IsField(p) ? p : Base(f, slot * 8 + 8);
    }

    PropType ReadType(ulong f, int depth = 0)
    {
        var cls = FieldClassName(f);
        if (depth > 4) return new PropType("Unknown");
        switch (cls)
        {
            case "StructProperty": return new PropType(cls, Struct: _e.ObjName(Base(f)));
            case "ArrayProperty":
            case "SetProperty":
            case "OptionalProperty": return new PropType(cls, Inner: ReadType(InnerProp(f), depth + 1));
            case "MapProperty":
            {
                ulong k = InnerProp(f), v = _m.Ptr(k == Base(f) ? f + (ulong)_l.PropBase + 8 : f + (ulong)_l.PropBase + 16);
                return new PropType(cls, Inner: ReadType(k, depth + 1), Value: IsField(v) ? ReadType(v, depth + 1) : new PropType("Unknown"));
            }
            case "EnumProperty":
            {
                ulong u = InnerProp(f);
                ulong en = _m.Ptr((u == Base(f) ? f + (ulong)_l.PropBase : f + (ulong)_l.PropBase + 8) + 8);
                return new PropType(cls, Enum: en != 0 ? _e.ObjName(en) : null, Inner: IsField(u) ? ReadType(u, depth + 1) : new PropType("ByteProperty"));
            }
            case "ByteProperty":
            {
                ulong en = Base(f);
                return en != 0 && Memory.LooksLikePtr(en)
                    ? new PropType("EnumProperty", Enum: _e.ObjName(en), Inner: new PropType("ByteProperty"))
                    : new PropType(cls);
            }
            case "ObjectPtrProperty": return new PropType("ObjectProperty");
            case "ClassPtrProperty": return new PropType("ClassProperty");
            case "MulticastSparseDelegateProperty": return new PropType("MulticastDelegateProperty");
            default: return new PropType(cls);
        }
    }
}

public static class UsmapWriter
{
    // Must match CUE4Parse's EPropertyType order.
    static readonly string[] TypeOrder =
    {
        "ByteProperty", "BoolProperty", "IntProperty", "FloatProperty", "ObjectProperty", "NameProperty", "DelegateProperty",
        "DoubleProperty", "ArrayProperty", "StructProperty", "StrProperty", "TextProperty", "InterfaceProperty",
        "MulticastDelegateProperty", "WeakObjectProperty", "LazyObjectProperty", "AssetObjectProperty", "SoftObjectProperty",
        "UInt64Property", "UInt32Property", "UInt16Property", "Int64Property", "Int16Property", "Int8Property", "MapProperty",
        "SetProperty", "EnumProperty", "FieldPathProperty", "OptionalProperty", "Utf8StrProperty", "AnsiStrProperty",
        "ClassProperty", "MulticastInlineDelegateProperty", "SoftClassProperty",
    };

    public static void Write(string path, Types t)
    {
        var names = new List<string>();
        var index = new Dictionary<string, int>();
        int N(string? s)
        {
            if (s == null) return -1;
            if (Encoding.UTF8.GetByteCount(s) > 255) s = s[..120]; // Initial format stores 1-byte lengths
            if (!index.TryGetValue(s, out var i)) { i = names.Count; names.Add(s); index[s] = i; }
            return i;
        }

        var body = new MemoryStream();
        var w = new BinaryWriter(body);
        // Enums and structs first (to collect names), names table is prepended afterwards.
        var payload = new MemoryStream();
        var pw = new BinaryWriter(payload);
        pw.Write((uint)t.Enums.Count);
        foreach (var e in t.Enums)
        {
            pw.Write(N(e.Name));
            var vals = e.Values.Take(255).ToList();
            pw.Write((byte)vals.Count);
            foreach (var v in vals) pw.Write(N(v));
        }
        pw.Write((uint)t.Structs.Count);
        foreach (var s in t.Structs)
        {
            pw.Write(N(s.Name));
            pw.Write(N(s.Super));
            pw.Write((ushort)s.Props.Sum(p => p.ArrayDim));
            pw.Write((ushort)s.Props.Count);
            int idx = 0;
            foreach (var p in s.Props)
            {
                pw.Write((ushort)idx);
                pw.Write((byte)p.ArrayDim);
                pw.Write(N(p.Name));
                WriteType(pw, p.Type, N);
                idx += p.ArrayDim;
            }
        }

        w.Write((uint)names.Count);
        foreach (var n in names)
        {
            var b = Encoding.UTF8.GetBytes(n);
            w.Write((byte)b.Length);
            w.Write(b);
        }
        payload.Position = 0;
        payload.CopyTo(body);
        var data = body.ToArray();

        using var f = new BinaryWriter(File.Create(path));
        f.Write((ushort)0x30C4); // magic
        f.Write((byte)0);        // EUsmapVersion.Initial
        f.Write((byte)0);        // no compression
        f.Write((uint)data.Length);
        f.Write((uint)data.Length);
        f.Write(data);
    }

    static void WriteType(BinaryWriter w, PropType t, Func<string?, int> N)
    {
        int ti = Array.IndexOf(TypeOrder, t.Type);
        w.Write((byte)(ti < 0 ? 0xFF : ti));
        switch (t.Type)
        {
            case "EnumProperty":
                WriteType(w, t.Inner ?? new PropType("ByteProperty"), N);
                w.Write(N(t.Enum ?? "None"));
                break;
            case "StructProperty":
                w.Write(N(t.Struct ?? "None"));
                break;
            case "SetProperty":
            case "ArrayProperty":
            case "OptionalProperty":
                WriteType(w, t.Inner ?? new PropType("Unknown"), N);
                break;
            case "MapProperty":
                WriteType(w, t.Inner ?? new PropType("Unknown"), N);
                WriteType(w, t.Value ?? new PropType("Unknown"), N);
                break;
        }
    }
}

public static class SdkJson
{
    public static void Write(string path, Types t, Engine e, Layout l)
    {
        var doc = new
        {
            engine = new { namePool = $"0x{e.NamePool - e.M.ModuleBase:X}", objectArray = $"0x{e.ObjectArray - e.M.ModuleBase:X}", layout = l },
            structs = t.Structs.ToDictionary(s => s.Path, s => new
            {
                s.Name, s.Super, s.IsClass, s.Size,
                props = s.Props.Select(p => new { p.Name, p.Offset, p.Size, p.ArrayDim, type = Describe(p.Type) }),
            }),
            enums = t.Enums.ToDictionary(x => x.Name, x => x.Values),
        };
        File.WriteAllText(path, JsonSerializer.Serialize(doc, new JsonSerializerOptions { IncludeFields = true }));
    }

    static string Describe(PropType t) => t.Type switch
    {
        "StructProperty" => $"struct {t.Struct}",
        "EnumProperty" => $"enum {t.Enum}",
        "ArrayProperty" or "SetProperty" or "OptionalProperty" => $"{t.Type.Replace("Property", "")}<{Describe(t.Inner!)}>",
        "MapProperty" => $"Map<{Describe(t.Inner!)}, {Describe(t.Value!)}>",
        _ => t.Type,
    };
}
