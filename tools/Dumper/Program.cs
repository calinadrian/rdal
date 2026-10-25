// Dragonwilds mappings dumper: reads the running game (read-only) and writes a .usmap
// plus a JSON description of every class/struct layout.
// Usage: Dumper [outDir] [--probe]
using System.Diagnostics;
using Dumper;

var outDir = args.FirstOrDefault(a => !a.StartsWith("--")) ?? Path.Combine(AppContext.BaseDirectory, "out");
Directory.CreateDirectory(outDir);
var sw = Stopwatch.StartNew();
void Log(string s) => Console.Error.WriteLine($"[{sw.Elapsed.TotalSeconds,6:F1}s] {s}");

var proc = Process.GetProcessesByName("RSDragonwilds-WinGDK-Shipping").Concat(Process.GetProcessesByName("RSDragonwilds-Win64-Shipping")).FirstOrDefault()
    ?? throw new Exception("RuneScape: Dragonwilds is not running.");
using var mem = new Memory(proc);
Log($"Attached to {proc.ProcessName} (pid {proc.Id}), module 0x{mem.ModuleBase:X} size 0x{mem.ModuleSize:X}");

var module = mem.Snapshot(mem.ModuleBase, mem.ModuleSize);
Log("Module snapshot read");
var eng = new Engine(mem);
eng.FindNamePool(module, Log);
eng.FindObjectArray(module, Log);
if (args.Contains("--track"))
{
    // Position stream for the overlay: logs go to stderr, JSON lines to stdout.
    Action<string> err = s => Console.Error.WriteLine(s);
    // Runs beside the game for hours: the game always comes first for the CPU.
    try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
    mem.MaxPages = 50_000; // runs beside the game, often on a modest PC: a smaller cache, a slightly slower start
    var tracker = new Tracker(eng, Layout.Discover(eng, err), err);
    tracker.Init(module);
    module = null;
    // Finding the game's types read hundreds of megabytes once: hand them back before tracking for hours.
    mem.ClearCache();
    GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
    int samples = args.Contains("--once") ? 1 : int.MaxValue;
    var outLock = new object();
    void Emit(object o) { lock (outLock) Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(o)); }
    if (samples > 1) KeyWatch.Start(proc.Id, key => { if (key == "M") tracker.MapKeyPressed(); Emit(new { key }); });
    for (int i = 0; i < samples && !proc.HasExited; i++)
    {
        try { Emit(tracker.Sample()); }
        catch (Exception e) { Emit(new { ok = false, error = e.Message }); }
        if (samples > 1) Thread.Sleep(150);
    }
    return;
}
module = null;

int ai = Array.IndexOf(args, "--find");
if (ai >= 0) { new Probe(eng, Layout.Discover(eng, Log)).Find(args[ai + 1], true); return; }
ai = Array.IndexOf(args, "--watch");
if (ai >= 0) { new Probe(eng, Layout.Discover(eng, Log)).Watch(args[ai + 1], int.Parse(args[ai + 2])); return; }
ai = Array.IndexOf(args, "--rawwatch");
if (ai >= 0) { new Probe(eng, Layout.Discover(eng, Log)).RawWatch(args[ai + 1], int.Parse(args[ai + 2])); return; }

if (args.Contains("--probe"))
{
    for (int i = 0; i < 12; i++)
    {
        var o = eng.Object(i);
        Log($"#{i} {eng.PathName(o)}  class={eng.ObjName(eng.ClassOf(o))}");
    }
    return;
}

var layout = Layout.Discover(eng, Log);
var types = new TypeDumper(eng, layout, Log).Dump();
UsmapWriter.Write(Path.Combine(outDir, "Mappings.usmap"), types);
SdkJson.Write(Path.Combine(outDir, "sdk.json"), types, eng, layout);
Log($"Wrote {types.Structs.Count} structs, {types.Enums.Count} enums to {outDir}");
