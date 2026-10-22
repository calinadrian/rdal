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
        // Block 0 of the pool starts with the entries "None", "ByteProperty".
        var needle = Encoding.ASCII.GetBytes("ByteProperty");
        ulong block0 = 0;
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
                    block0 = r.BaseAddress + (ulong)(i - 8);
                    break;
                }
                i++;
            }
            if (block0 != 0) break;
        }
        if (block0 == 0) throw new Exception("FName pool block 0 not found");
        log($"Name block 0 at 0x{block0:X}");

        // FNamePool: FRWLock (8), CurrentBlock (4), CurrentByteCursor (4), Blocks[]
        for (int o = 0; o + 8 <= module.Length; o += 8)
        {
            if (BinaryPrimitives.ReadUInt64LittleEndian(module.AsSpan(o)) != block0) continue;
            ulong pool = M.ModuleBase + (ulong)o - 0x10;
            uint cur = M.Read<uint>(pool + 8);
            if (cur == 0 || cur > 8192) continue;
            NamePool = pool;
            _blocks = new ulong[cur + 1];
            for (int b = 0; b <= cur; b++) _blocks[b] = M.Ptr(pool + 0x10 + (ulong)b * 8);
            log($"GNames at module+0x{o - 0x10:X} ({cur + 1} blocks)");
            return;
        }
        throw new Exception("Pointer to FName pool not found in module");
    }

    public string Name(uint index)
    {
        if (_names.TryGetValue(index, out var s)) return s;
        uint block = index >> 16, offset = (index & 0xFFFF) * 2;
        s = "";
        if (block < _blocks.Length)
        {
            ulong e = _blocks[block] + offset;
            ushort hdr = M.Read<ushort>(e);
            int len = hdr >> 6;
            bool wide = (hdr & 1) != 0;
            if (len > 0 && len < 1024)
            {
                var b = M.Bytes(e + 2, wide ? len * 2 : len);
                s = wide ? Encoding.Unicode.GetString(b) : Encoding.Latin1.GetString(b);
            }
        }
        _names[index] = s;
        return s;
    }

    // FName = { ComparisonIndex, Number }
    public string FName(ulong addr)
    {
        uint idx = M.Read<uint>(addr), num = M.Read<uint>(addr + 4);
        var n = Name(idx);
        return num == 0 ? n : $"{n}_{num - 1}";
    }

    /* ---------- GUObjectArray ---------- */

    public void FindObjectArray(byte[] module, Action<string> log)
    {
        // FChunkedFixedUObjectArray: Objects**, PreAllocated*, MaxElements, NumElements, MaxChunks, NumChunks
        for (int o = 0; o + 32 <= module.Length; o += 4)
        {
            var s = module.AsSpan(o);
            int max = BinaryPrimitives.ReadInt32LittleEndian(s[16..]);
            int num = BinaryPrimitives.ReadInt32LittleEndian(s[20..]);
            if (max < 0x10000 || max > (1 << 26) || num < 10000 || num > max) continue;
            int maxChunks = BinaryPrimitives.ReadInt32LittleEndian(s[24..]);
            int numChunks = BinaryPrimitives.ReadInt32LittleEndian(s[28..]);
            if (maxChunks != (max + ChunkSize - 1) / ChunkSize || numChunks != (num + ChunkSize - 1) / ChunkSize) continue;
            ulong objects = BinaryPrimitives.ReadUInt64LittleEndian(s);
            if (!Memory.LooksLikePtr(objects)) continue;

            foreach (int size in new[] { 24, 16, 32 })
            {
                _chunks = objects; _itemSize = size; NumObjects = num;
                if (Validate())
                {
                    ObjectArray = M.ModuleBase + (ulong)o - 0x10;
                    log($"GUObjectArray at module+0x{o - 0x10:X}: {num} objects, item size {size}");
                    return;
                }
            }
        }
        throw new Exception("GUObjectArray not found");
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
