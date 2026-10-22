// Read-only access to another process's memory.
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Dumper;

public sealed class Memory : IDisposable
{
    const uint PROCESS_VM_READ = 0x0010, PROCESS_QUERY_INFORMATION = 0x0400;
    const uint MEM_COMMIT = 0x1000;
    const uint PAGE_GUARD = 0x100, PAGE_NOACCESS = 0x01;

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern unsafe bool ReadProcessMemory(IntPtr h, ulong addr, byte* buf, nuint size, out nuint read);
    [DllImport("kernel32.dll", SetLastError = true)] static extern nuint VirtualQueryEx(IntPtr h, ulong addr, out MBI info, nuint len);

    [StructLayout(LayoutKind.Sequential)]
    public struct MBI
    {
        public ulong BaseAddress, AllocationBase;
        public uint AllocationProtect, _a1;
        public ulong RegionSize;
        public uint State, Protect, Type, _a2;
    }

    readonly IntPtr _h;
    public readonly ulong ModuleBase;
    public readonly ulong ModuleSize;
    public readonly int Pid;

    // Small page cache: UObject walking re-reads the same pages constantly.
    readonly Dictionary<ulong, byte[]?> _pages = new();
    const int PageSize = 0x1000;

    public Memory(Process p)
    {
        Pid = p.Id;
        _h = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, p.Id);
        if (_h == IntPtr.Zero) throw new InvalidOperationException($"OpenProcess failed (error {Marshal.GetLastWin32Error()})");
        var m = p.MainModule ?? throw new InvalidOperationException("No main module");
        ModuleBase = (ulong)m.BaseAddress;
        ModuleSize = (ulong)m.ModuleMemorySize;
    }

    public void Dispose() => CloseHandle(_h);
    public void ClearCache() => _pages.Clear();

    public unsafe bool ReadRaw(ulong addr, Span<byte> buf)
    {
        fixed (byte* p = buf)
            return ReadProcessMemory(_h, addr, p, (nuint)buf.Length, out var n) && n == (nuint)buf.Length;
    }

    byte[]? Page(ulong pageAddr)
    {
        if (_pages.TryGetValue(pageAddr, out var pg)) return pg;
        var b = new byte[PageSize];
        if (!ReadRaw(pageAddr, b)) b = null;
        if (_pages.Count > 200_000) _pages.Clear();
        _pages[pageAddr] = b;
        return b;
    }

    public bool Read(ulong addr, Span<byte> dst)
    {
        if (addr < 0x10000 || addr > 0x7FFF_FFFF_FFFF) return false;
        int done = 0;
        while (done < dst.Length)
        {
            ulong a = addr + (ulong)done;
            ulong pa = a & ~(ulong)(PageSize - 1);
            var pg = Page(pa);
            if (pg == null) return false;
            int off = (int)(a - pa);
            int n = Math.Min(PageSize - off, dst.Length - done);
            pg.AsSpan(off, n).CopyTo(dst[done..]);
            done += n;
        }
        return true;
    }

    public T Read<T>(ulong addr) where T : unmanaged
    {
        Span<byte> b = stackalloc byte[Marshal.SizeOf<T>()];
        return Read(addr, b) ? MemoryMarshal.Read<T>(b) : default;
    }
    public ulong Ptr(ulong addr) => Read<ulong>(addr);
    public int I32(ulong addr) => Read<int>(addr);
    public byte[] Bytes(ulong addr, int n) { var b = new byte[n]; return Read(addr, b) ? b : Array.Empty<byte>(); }

    public static bool LooksLikePtr(ulong p) => p > 0x10000 && p < 0x7FFF_FFFF_FFFF && (p & 7) == 0;
    public bool InModule(ulong p) => p >= ModuleBase && p < ModuleBase + ModuleSize;

    // Committed, readable regions (optionally only private read-write heap).
    public IEnumerable<MBI> Regions(ulong from = 0, ulong to = 0x7FFF_FFFF_FFFF, bool heapOnly = false)
    {
        ulong a = from;
        while (a < to && VirtualQueryEx(_h, a, out var mbi, (nuint)Marshal.SizeOf<MBI>()) != 0)
        {
            bool ok = mbi.State == MEM_COMMIT && (mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)) == 0 && mbi.Protect != 0;
            if (heapOnly) ok &= mbi.Type == 0x20000 && (mbi.Protect & 0x04) != 0; // MEM_PRIVATE, PAGE_READWRITE
            if (ok) yield return mbi;
            ulong next = mbi.BaseAddress + mbi.RegionSize;
            if (next <= a) break;
            a = next;
        }
    }

    // Reads [start, start+size) region by region; unreadable parts stay zero.
    public byte[] Snapshot(ulong start, ulong size)
    {
        var buf = new byte[size];
        foreach (var r in Regions(start, start + size))
        {
            ulong s = Math.Max(r.BaseAddress, start), e = Math.Min(r.BaseAddress + r.RegionSize, start + size);
            for (ulong a = s; a < e; a += 0x100000)
            {
                int n = (int)Math.Min(0x100000, e - a);
                ReadRaw(a, buf.AsSpan((int)(a - start), n));
            }
        }
        return buf;
    }
}
