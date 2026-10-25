// Locates and reads Unreal Engine 5 globals: the FName pool (GNames) and GUObjectArray.
using System.Buffers.Binary;
using System.Text;

namespace Dumper;

public sealed class Engine
{
    public readonly Memory M;
    public ulong NamePool, ObjectArray;
    ulong[] _blocks = Array.Empty<ulong>();
    readonly Dictionary<uint, string> _names = new();

    // FUObjectArray / FUObjectItem layout (verified at runtime)
    ulong _chunks;
    public int NumObjects;
    int _itemSize = 24;
    const int ChunkSize = 64 * 1024;

    // UObject layout (UE5 shipping)
    public const int OClass = 0x10, OName = 0x18, OOuter = 0x20, OIndex = 0x0C, OFlags = 0x08;

    public Engine(Memory m) => M = m;

    /* ---------- GNames ---------- */

    public void FindNamePool(byte[] module, Action<string> log)
    {
        if (FindNamePoolInModule(module, log)) return;
        // Block 0 of the pool starts with the entries "None", "ByteProperty". Copies of those entries can sit in
        // other heap buffers too, so each match is tried in turn: the pool is the one the module points at.
        var needle = Encoding.ASCII.GetBytes("ByteProperty");
        int tried = 0;
        foreach (var r in M.Regions(heapOnly: true))
        {
            if (r.RegionSize > 0x40000000) continue;
            var buf = new byte[r.RegionSize];
            if (!M.ReadRaw(r.BaseAddress, buf)) continue;
            int i = 0;
            while ((i = IndexOf(buf, needle, i)) >= 0)
            {
                if (i >= 8 && Encoding.ASCII.GetString(buf, i - 6, 4) == "None"
                    && (BinaryPrimitives.ReadUInt16LittleEndian(buf.AsSpan(i - 8)) >> 6) == 4
                    && (BinaryPrimitives.ReadUInt16LittleEndian(buf.AsSpan(i - 2)) >> 6) == 12)
                {
                    ulong block0 = r.BaseAddress + (ulong)(i - 8);
                    tried++;
                    log($"Name block 0 candidate at 0x{block0:X}");
                    if (UseNamePool(module, block0, log)) return;
                }
                i++;
            }
        }
        throw new Exception(tried == 0 ? "FName pool block 0 not found" : "Pointer to FName pool not found in module");
    }

    // The quick way, from the module's side: a block count, then that many block pointers, the first of which
    // starts with "None", "ByteProperty". Avoids reading the whole heap (the game holds copies of those entries).
    bool FindNamePoolInModule(byte[] module, Action<string> log)
    {
        var first = new byte[22];
        for (int o = 0; o + 0x18 <= module.Length; o += 8)
        {
            uint cur = BinaryPrimitives.ReadUInt32LittleEndian(module.AsSpan(o + 8));
            if (cur == 0 || cur > 8192 || o + 0x10 + (cur + 1) * 8 > module.Length) continue;
            bool blocks = true;
            for (int b = 0; b <= cur && blocks; b++)
            {
                ulong p = BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o + 0x10 + b * 8));
                blocks = Memory.LooksLikePtr(p) && !M.InModule(p);
            }
            if (!blocks || !M.ReadRaw(BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o + 0x10)), first)) continue;
            if ((BinaryPrimitives.ReadUInt16LittleEndian(first) >> 6) != 4 || Encoding.ASCII.GetString(first, 2, 4) != "None"
                || (BinaryPrimitives.ReadUInt16LittleEndian(first.AsSpan(6)) >> 6) != 12 || Encoding.ASCII.GetString(first, 8, 12) != "ByteProperty") continue;
            return UseNamePool(module, BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o + 0x10)), log);
        }
        return false;
    }

    // FNamePool: FRWLock (8), CurrentBlock (4), CurrentByteCursor (4), Blocks[]
    bool UseNamePool(byte[] module, ulong block0, Action<string> log)
    {
        for (int o = 0x10; o + 8 <= module.Length; o += 8)
        {
            if (BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o)) != block0) continue;
            ulong pool = M.ModuleBase + (ulong)o - 0x10;
            uint cur = M.Read<uint>(pool + 8);
            if (cur == 0 || cur > 8192) continue;
            NamePool = pool;
            _blocks = new ulong[cur + 1];
            for (int b = 0; b <= cur; b++) _blocks[b] = M.Ptr(pool + 0x10 + (ulong)b * 8);
            log($"GNames at module+0x{o - 0x10:X} ({cur + 1} blocks)");
            return true;
        }
        return false;
    }

    // The pool grows while the game runs (loading a save adds the names of its quest flags), so a block past the
    // ones known is looked up again. A name that could not be read is not remembered: it is tried again next time.
    public string Name(uint index)
    {
        if (_names.TryGetValue(index, out var s)) return s;
        uint block = index >> 16, offset = (index & 0xFFFF) * 2;
        if (block >= _blocks.Length) RefreshNameBlocks();
        if (block >= _blocks.Length || _blocks[block] == 0) return "";
        ulong e = _blocks[block] + offset;
        ushort hdr = M.Read<ushort>(e);
        int len = hdr >> 6;
        bool wide = (hdr & 1) != 0;
        if (len <= 0 || len >= 1024) return "";
        var b = M.Bytes(e + 2, wide ? len * 2 : len);
        if (b.Length == 0) return "";
        s = wide ? Encoding.Unicode.GetString(b) : Encoding.Latin1.GetString(b);
        _names[index] = s;
        return s;
    }

    void RefreshNameBlocks()
    {
        uint cur = M.Read<uint>(NamePool + 8);
        if (cur == 0 || cur > 8192 || cur + 1 <= _blocks.Length) return;
        var blocks = new ulong[cur + 1];
        for (int b = 0; b <= cur; b++) blocks[b] = M.Ptr(NamePool + 0x10 + (ulong)b * 8);
        _blocks = blocks;
    }

    // FName = { ComparisonIndex, Number }
    public string FName(ulong addr)
    {
        uint idx = M.Read<uint>(addr), num = M.Read<uint>(addr + 4);
        var n = Name(idx);
        return num == 0 ? n : $"{n}_{num - 1}";
    }

    /* ---------- GUObjectArray ---------- */

    // FChunkedFixedUObjectArray: Objects**, PreAllocated*, MaxElements, NumElements, MaxChunks, NumChunks.
    // The exact chunk counts are checked first; a build or PC that sizes the array differently is still found by its
    // objects (each knows its own index), and when nothing fits the nearest candidates are logged.
    public void FindObjectArray(byte[] module, Action<string> log)
    {
        if (FindObjectArray(module, log, strict: true) || FindObjectArray(module, log, strict: false)) return;
        int shown = 0;
        for (int o = 0; o + 32 <= module.Length && shown < 5; o += 8)
        {
            var s = module.AsSpan(o);
            int max = BinaryPrimitives.ReadInt32LittleEndian(s[16..]), num = BinaryPrimitives.ReadInt32LittleEndian(s[20..]);
            int maxChunks = BinaryPrimitives.ReadInt32LittleEndian(s[24..]), numChunks = BinaryPrimitives.ReadInt32LittleEndian(s[28..]);
            ulong objects = BinaryPrimitives.ReadUInt64LittleEndian(s);
            if (max < 0x10000 || max > (1 << 28) || num < 1000 || num > max || maxChunks < 1 || maxChunks > 8192
                || numChunks < 1 || numChunks > maxChunks || !Memory.LooksLikePtr(objects)) continue;
            ulong chunk0 = M.Ptr(objects), first = chunk0 == 0 ? 0 : M.Ptr(chunk0);
            if (first == 0) continue;
            log($"  candidate module+0x{o - 0x10:X}: max {max} num {num} chunks {maxChunks}/{numChunks}, chunk 0 at 0x{chunk0:X}, "
                + $"object 0 at 0x{first:X} index {(first == 0 ? -1 : M.I32(first + OIndex))} name '{(first == 0 ? "" : Name(M.Read<uint>(first + OName)))}'");
            shown++;
        }
        throw new Exception("GUObjectArray not found");
    }

    bool FindObjectArray(byte[] module, Action<string> log, bool strict)
    {
        for (int o = 0; o + 32 <= module.Length; o += 4)
        {
            var s = module.AsSpan(o);
            int max = BinaryPrimitives.ReadInt32LittleEndian(s[16..]);
            int num = BinaryPrimitives.ReadInt32LittleEndian(s[20..]);
            if (max < 0x10000 || max > (strict ? 1 << 26 : 1 << 28) || num < 10000 || num > max) continue;
            int maxChunks = BinaryPrimitives.ReadInt32LittleEndian(s[24..]);
            int numChunks = BinaryPrimitives.ReadInt32LittleEndian(s[28..]);
            int needed = (num + ChunkSize - 1) / ChunkSize;
            if (strict ? maxChunks != (max + ChunkSize - 1) / ChunkSize || numChunks != needed
                : numChunks < needed || maxChunks < numChunks || maxChunks > 8192) continue;
            ulong objects = BinaryPrimitives.ReadUInt64LittleEndian(s);
            if (!Memory.LooksLikePtr(objects)) continue;

            foreach (int size in new[] { 24, 16, 32 })
            {
                _chunks = objects; _itemSize = size; NumObjects = num;
                if (Validate())
                {
                    ObjectArray = M.ModuleBase + (ulong)o - 0x10;
                    log($"GUObjectArray at module+0x{o - 0x10:X}: {num} objects, item size {size}{(strict ? "" : $", chunks {maxChunks}/{numChunks}")}");
                    return true;
                }
            }
        }
        _chunks = 0; NumObjects = 0;
        return false;
    }

    bool Validate()
    {
        int ok = 0;
        for (int i = 1; i < 50; i++)
        {
            ulong obj = Object(i);
            if (obj != 0 && M.I32(obj + OIndex) == i) ok++;
        }
        return ok > 40 && Name(M.Read<uint>(Object(0) + OName)).Length > 0;
    }

    public ulong Object(int i)
    {
        if (i < 0 || i >= NumObjects) return 0;
        ulong chunk = M.Ptr(_chunks + (ulong)(i / ChunkSize) * 8);
        return chunk == 0 ? 0 : M.Ptr(chunk + (ulong)(i % ChunkSize * _itemSize));
    }

    public void Refresh() => NumObjects = M.I32(ObjectArray + 0x10 + 20);

    public ulong ClassOf(ulong obj) => M.Ptr(obj + OClass);
    public string ObjName(ulong obj) => FName(obj + OName);
    public ulong Outer(ulong obj) => M.Ptr(obj + OOuter);

    public string PathName(ulong obj)
    {
        var parts = new List<string>();
        for (ulong o = obj; o != 0 && parts.Count < 16; o = Outer(o)) parts.Add(ObjName(o));
        parts.Reverse();
        return parts.Count switch { 0 => "", 1 => parts[0], _ => parts[0] + "." + string.Join(":", parts.Skip(1)) };
    }

    public IEnumerable<(int Index, ulong Obj)> Objects()
    {
        for (int i = 0; i < NumObjects; i++)
        {
            ulong o = Object(i);
            if (o != 0) yield return (i, o);
        }
    }

    public ulong FindObject(string path)
    {
        string name = path[(path.LastIndexOfAny(new[] { '.', ':' }) + 1)..];
        foreach (var (_, o) in Objects())
            if (ObjName(o) == name && PathName(o) == path) return o;
        return 0;
    }

    static int IndexOf(byte[] hay, byte[] needle, int start) => hay.AsSpan(start).IndexOf(needle) is var i and >= 0 ? i + start : -1;
}
