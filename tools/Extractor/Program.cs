// Reads RuneScape: Dragonwilds game files (read-only) with CUE4Parse + our dumped mappings.
// Usage:
//   Extractor survey <outDir>                 list every asset path and class
//   Extractor json <outDir> <assetPath>...    export assets as JSON
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.MappingsProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
const string GameDir = @"C:\Program Files\WindowsApps\JagexLimited.Dominion_100.101.0.0_x64__srxstwq7wczqa\RSDragonwilds\Content\Paks";
var usmap = Path.Combine(root, "Dumper", "out", "Mappings.usmap");

var mode = args.ElementAtOrDefault(0) ?? "survey";
var outDir = Path.GetFullPath(args.ElementAtOrDefault(1) ?? Path.Combine(root, "Extractor", "out"));
Directory.CreateDirectory(outDir);

if (mode == "floorplan-test") { Floorplan.Test(); return; }
if (mode == "floorplan-style") { Floorplan.Restyle(args[2], outDir); return; }
// webp <dir> [--max=N] [--quality=Q]: PNG -> WebP in place (needs no game files).
if (mode == "webp") { Webp.Run(outDir, args.Skip(2)); return; }

var provider = new DefaultFileProvider(GameDir, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6), StringComparer.OrdinalIgnoreCase);
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
var mounted = provider.Mount();
Console.Error.WriteLine($"Mounted {mounted} containers, {provider.Files.Count} files; mappings: {provider.MappingsForGame?.Types.Count} types");

if (mode == "survey")
{
    var paths = provider.Files.Keys.Where(k => k.EndsWith(".uasset") || k.EndsWith(".umap")).OrderBy(k => k).ToList();
    File.WriteAllLines(Path.Combine(outDir, "files.txt"), paths);
    Console.Error.WriteLine($"Wrote {paths.Count} asset paths");
    return;
}

if (mode == "world")
{
    // Every placed blueprint actor in the world-partition cells: class, position, own properties.
    var levels = provider.Files.Keys.Where(k => k.EndsWith(".umap") && !k.Contains("FutureMajorVersion")
        && (k.Contains("/Maps/World/L_World") || k.Contains("/GameFeatures/") && k.Contains("/Maps/"))).ToList();
    var actors = new System.Collections.Concurrent.ConcurrentBag<object>();
    int done = 0, failed = 0;
    Parallel.ForEach(levels, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
    {
        try
        {
            foreach (var a in WorldScan.Actors(provider.LoadPackage(path), path)) actors.Add(a);
        }
        catch { Interlocked.Increment(ref failed); }
        if (Interlocked.Increment(ref done) % 100 == 0) Console.Error.WriteLine($"{done}/{levels.Count} levels");
    });
    var list = actors.ToList();
    File.WriteAllText(Path.Combine(outDir, "world_actors.json"), JsonConvert.SerializeObject(list));
    var hist = list.GroupBy(a => (string)((dynamic)a).cls).Select(g => $"{g.Count(),6} {g.Key}").OrderByDescending(s => s);
    File.WriteAllLines(Path.Combine(outDir, "world_classes.txt"), hist);
    Console.Error.WriteLine($"{list.Count} actors from {levels.Count} levels ({failed} failed)");
    return;
}

if (mode == "floorplan")
{
    // floorplan <outDir> <dungeon-regions.json> [cacheDir]  ->  <outDir>/<id>.png + floorplans.json, <cacheDir>/layouts
    Floorplan.Run(provider, outDir, args[2], args.ElementAtOrDefault(3) ?? outDir);
    return;
}

if (mode == "texture")
{
    // texture <outDir> [--max=N] <objectPath or package path>...  ->  <outDir>/<name>.png
    CUE4Parse_Conversion.Textures.TextureDecoder.UseAssetRipperTextureDecoder = true; // managed BC decoding, no native libs
    int maxSize = args.FirstOrDefault(a => a.StartsWith("--max="))?.Split('=')[1] is { } m ? int.Parse(m) : 8192;
    // "@file" arguments expand to one object path per line.
    var texPaths = args.Skip(2).Where(a => !a.StartsWith("--"))
        .SelectMany(a => a.StartsWith("@") ? File.ReadAllLines(a[1..]).Where(l => l.Trim().Length > 0) : new[] { a }).Distinct().ToList();
    Parallel.ForEach(texPaths, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
    {
        try
        {
            // Already exported (or already converted to WebP by the webp command).
            var existing = Path.Combine(outDir, path[(path.LastIndexOf('.') + 1)..]);
            if (File.Exists(existing + ".png") || File.Exists(existing + ".webp")) return;
            var tex = provider.LoadPackageObject<CUE4Parse.UE4.Assets.Exports.Texture.UTexture>(PluginPath(path.Replace(".uasset", "")));
            var img = CUE4Parse_Conversion.Textures.TextureDecoder.Decode(tex, maxSize)
                ?? throw new Exception("decode failed");
            var png = CUE4Parse_Conversion.Textures.TextureEncoder.Encode(img, CUE4Parse_Conversion.Options.ETextureFormat.Png, false, out _);
            File.WriteAllBytes(Path.Combine(outDir, tex.Name + ".png"), png);
            Console.Error.WriteLine($"OK  {tex.Name} {img.Width}x{img.Height}");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ERR {path}: {e.Message}");
        }
    });
    return;
}

if (mode == "model")
{
    // model <outDir> <skeletalMeshObjectPath>...  ->  <outDir>/<name>.glb (first LOD, colour textures embedded)
    CUE4Parse_Conversion.Textures.TextureDecoder.UseAssetRipperTextureDecoder = true;
    var meshPaths = args.Skip(2).Where(a => !a.StartsWith("--"))
        .SelectMany(a => a.StartsWith("@") ? File.ReadAllLines(a[1..]).Where(l => l.Trim().Length > 0) : new[] { a }).Distinct().ToList();
    Parallel.ForEach(meshPaths, new ParallelOptions { MaxDegreeOfParallelism = 4 }, path =>
    {
        try
        {
            var name = path[(path.LastIndexOf('.') + 1)..];
            var file = Path.Combine(outDir, name + ".glb");
            if (File.Exists(file)) return;
            var mesh = provider.LoadPackageObject<CUE4Parse.UE4.Assets.Exports.SkeletalMesh.USkeletalMesh>(PluginPath(path));
            File.WriteAllBytes(file, ModelExport.Glb(mesh, 512));
            Console.Error.WriteLine($"OK  {name}");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ERR {path}: {e.Message}");
        }
    });
    return;
}

if (mode == "bulk")
{
    // bulk <outDir> <name> <pathRegex> [exportTypeRegex]  ->  <outDir>/<name>.json  { packagePath: [exports] }
    var name = args[2];
    var pathRe = new System.Text.RegularExpressions.Regex(args[3], System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    var typeRe = args.Length > 4 ? new System.Text.RegularExpressions.Regex(args[4]) : null;
    var paths = provider.Files.Keys.Where(k => k.EndsWith(".uasset") && !k.Contains("FutureMajorVersion") && pathRe.IsMatch(k)).ToList();
    var result = new System.Collections.Concurrent.ConcurrentDictionary<string, object>();
    int failed = 0;
    Parallel.ForEach(paths, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
    {
        try
        {
            var exports = provider.LoadPackage(path).GetExports()
                .Where(e => typeRe is null || typeRe.IsMatch(e.ExportType) || typeRe.IsMatch(e.Name)).ToList();
            if (exports.Count > 0) result[path] = exports;
        }
        catch { Interlocked.Increment(ref failed); }
    });
    File.WriteAllText(Path.Combine(outDir, name + ".json"), JsonConvert.SerializeObject(result));
    Console.Error.WriteLine($"{name}: {result.Count}/{paths.Count} packages ({failed} failed)");
    return;
}

// Game-feature plugin mount points ("/DowdunReach/...") -> their file location.
static string PluginPath(string p)
{
    var m = System.Text.RegularExpressions.Regex.Match(p, @"^/(?!Game/|Engine/|Script/)([^/]+)/(.*)$");
    return m.Success ? $"RSDragonwilds/Plugins/GameFeatures/{m.Groups[1].Value}/Content/{m.Groups[2].Value}" : p;
}

if (mode == "json")
{
    foreach (var path in args.Skip(2))
    {
        try
        {
            var exports = provider.LoadPackage(path).GetExports();
            var file = Path.Combine(outDir, Path.GetFileNameWithoutExtension(path) + ".json");
            File.WriteAllText(file, JsonConvert.SerializeObject(exports, Formatting.Indented));
            Console.Error.WriteLine($"OK  {path}");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"ERR {path}: {e.GetType().Name}: {e.Message}");
        }
    }
}
