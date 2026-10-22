// Top-down floor plans of the dungeons, drawn from the static meshes placed in the world cells.
// Pass 1 keeps the lowest up-facing surface per pixel inside the region's floor band (where its gameplay
// actors stand), so ceilings and rock tops never cover the rooms. Pass 2 marks anything that blocks
// walking height above that floor as wall. Each region from raw/dungeon-regions.json becomes <id>.png
// plus a frame in floorplans.json that maps world X/Y to image pixels.
using System.Collections.Concurrent;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using Newtonsoft.Json;
using SkiaSharp;

public static partial class Floorplan
{
    const int MaxSide = 2048;    // pixels on the longest side
    const double MinRes = 20;    // world units (cm) per pixel at best
    const double MaxEdge = 5000;  // backdrop planes under the dungeons are a few huge triangles; architecture is not
    const int MinIsland = 400;    // floor islands smaller than this many pixels are stray ledges and props
    const float WalkLo = 40, WalkHi = 200; // the slice above the floor that counts as "in the way"
    const double MinWallHeight = 150;      // shorter meshes are props (crates, rubble, torches) you walk around, not walls

    sealed class Region
    {
#pragma warning disable CS0649 // filled from JSON
        public string id = "";
        public double minX, maxX, minY, maxY, minZ, maxZ, floorMinZ, floorMaxZ;
        public double[][] points = [];
#pragma warning restore CS0649
        public double bandLo, bandHi; // the floor level being drawn
        public double[]? hist;        // floor area per height bin, while finding the levels
        public double res;
        public int w, h;
        public float[] floor = [];
        public byte[] wall = [];
        public float[] stairs = [];   // tread heights of stair meshes, whatever band they fall in
        public bool Contains(double x, double y, double z, double pad) =>
            x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad && z >= minZ - pad && z <= maxZ + pad;
    }

    sealed record Mesh(FVector[] Verts, uint[] Indices, double Radius, FVector Min, FVector Max, bool Stairs = false);

    // Stairs, steps and ramps by mesh name (not the walls and rails built alongside them).
    static readonly System.Text.RegularExpressions.Regex StairName =
        new(@"Stair|Steps?(_|\b)|Stepdown|Stepset|Ramp", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    static readonly System.Text.RegularExpressions.Regex NotStairName =
        new(@"Wall|Rail|Banister|Arch|Frame", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    public static void Run(DefaultFileProvider provider, string outDir, string regionsFile)
    {
        var regions = JsonConvert.DeserializeObject<List<Region>>(File.ReadAllText(regionsFile))!;
        foreach (var r in regions)
        {
            r.res = Math.Max(MinRes, Math.Max(r.maxX - r.minX, r.maxY - r.minY) / MaxSide);
            r.w = (int)Math.Ceiling((r.maxX - r.minX) / r.res);
            r.h = (int)Math.Ceiling((r.maxY - r.minY) / r.res);
            r.floor = new float[r.w * r.h];
            Array.Fill(r.floor, float.PositiveInfinity);
            r.wall = new byte[r.w * r.h];
            r.stairs = new float[r.w * r.h];
            Array.Fill(r.stairs, float.PositiveInfinity);
        }

        // Every placed mesh instance near a dungeon, collected once and drawn in two passes.
        var meshes = new ConcurrentDictionary<string, Mesh?>();
        var placed = new ConcurrentBag<(Region r, Mesh m, FTransform t)>();
        var cells = provider.Files.Keys.Where(k => k.EndsWith(".umap") && k.Contains("/Maps/World/L_World")).ToList();
        int done = 0;
        Parallel.ForEach(cells, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
        {
            try
            {
                foreach (var exp in provider.LoadPackage(path).GetExports())
                {
                    // Foliage is scattered clutter (pebbles, plants), not architecture.
                    if (exp is not UStaticMeshComponent smc || exp.ExportType.StartsWith("Foliage")) continue;
                    FTransform world;
                    try { world = smc.GetAbsoluteTransform(); } catch { continue; }
                    var instances = exp is UInstancedStaticMeshComponent ism
                        ? ism.PerInstanceSMData?.Select(i => i.TransformData * world).ToArray() ?? []
                        : [world];
                    // Cheap reject before loading the mesh: is any instance near a dungeon?
                    if (!instances.Any(t => regions.Any(r => r.Contains(t.Translation.X, t.Translation.Y, t.Translation.Z, 20000)))) continue;
                    var meshIndex = smc.GetStaticMesh();
                    if (meshIndex.IsNull) continue;
                    var mesh = meshes.GetOrAdd(meshIndex.ResolvedObject?.GetPathName() ?? meshIndex.ToString(), key =>
                    {
                        var loaded = LoadMesh(meshIndex);
                        var name = key[(key.LastIndexOfAny(['/', '.']) + 1)..];
                        return loaded is null ? null : loaded with { Stairs = StairName.IsMatch(name) && !NotStairName.IsMatch(name) };
                    });
                    if (mesh is null) continue;
                    foreach (var t in instances)
                    {
                        double reach = mesh.Radius * t.GetMaximumAxisScale();
                        foreach (var r in regions)
                            if (r.Contains(t.Translation.X, t.Translation.Y, t.Translation.Z, reach)) placed.Add((r, mesh, t));
                    }
                }
            }
            catch (Exception e) { Console.Error.WriteLine($"ERR {path}: {e.Message}"); }
            if (Interlocked.Increment(ref done) % 200 == 0) Console.Error.WriteLine($"{done}/{cells.Count} cells");
        });
        Console.Error.WriteLine($"{placed.Count} mesh instances, {meshes.Count} meshes");

        // Dungeons stack rooms on top of each other: find the storeys from how much floor lies at each
        // height, then draw each storey as its own plan.
        var frames = new ConcurrentBag<object>();
        Parallel.ForEach(placed.GroupBy(p => p.r).ToList(), g =>
        {
            var r = g.Key;
            r.hist = new double[(int)Math.Ceiling((r.floorMaxZ - r.floorMinZ) / LevelBin) + 1];
            foreach (var p in g) Draw(r, p.m, p.t, walls: false);
            var bands = Levels(r.hist, r.floorMinZ, r.floorMaxZ);
            r.hist = null;
            // Height bands slice a sloping dungeon into pieces; put them back together unless they really
            // lie on top of each other, so a level is everything you can see without a floor in the way.
            var levels = new List<Sheet>();
            foreach (var (lo, hi) in bands)
            {
                r.bandLo = lo; r.bandHi = hi;
                Array.Fill(r.floor, float.PositiveInfinity);
                Array.Clear(r.wall);
                foreach (var p in g) Draw(r, p.m, p.t, walls: false);
                foreach (var p in g) Draw(r, p.m, p.t, walls: true);
                if (Build(r) is not { } sheet) continue;
                levels.Add(sheet);
            }
            // Validate connected floors only after joining height bands. A staircase often has no
            // gameplay actor on its intermediate band; filtering that band first deletes the route.
            // Reachability crosses level boundaries too. An unoccupied flight of stairs can
            // join two occupied floors even when it has to be drawn on another sheet.
            KeepSupportedLevels(r, levels);
            // Roofs must be removed before measuring overlap, otherwise their footprint makes
            // a continuous sloping floor look like several stacked storeys.
            var joined = new List<Sheet>();
            foreach (var sheet in levels.Where(l => l.Count() > 0))
            {
                var home = joined.FirstOrDefault(l => l.Overlap(sheet) < 0.15);
                if (home != null) home.Add(sheet); else joined.Add(sheet);
            }
            levels = joined.OrderBy(l => l.MeanHeight()).ToList();
            AttachStairs(r, levels);
            SaveLayout(r, levels, outDir);
            if (levels.Count > 1) Save(r, levels, -1, outDir, r.id + "-all");
            for (int i = 0; i < levels.Count; i++)
                frames.Add(Save(r, levels, i, outDir, levels.Count > 1 ? $"{r.id}-{i + 1}" : r.id));
        });
        var sorted = frames.OrderBy(f => (string)((dynamic)f).image).ToList();
        File.WriteAllText(Path.Combine(outDir, "floorplans.json"), JsonConvert.SerializeObject(sorted));
    }

    const double LevelBin = 50;      // height resolution when finding storeys
    const double StoreyHeight = 350; // floors closer than this belong to one storey (stairs, slopes, steps)

    // Height bands, one per storey: peaks of floor area at least a storey apart, cut at the emptiest height
    // between them.
    static List<(double lo, double hi)> Levels(double[] hist, double zMin, double zMax)
    {
        int n = hist.Length, reach = (int)(StoreyHeight / LevelBin);
        var smooth = new double[n];
        for (int i = 0; i < n; i++) { double s = 0; for (int k = -2; k <= 2; k++) if (i + k >= 0 && i + k < n) s += hist[i + k]; smooth[i] = s; }
        double max = smooth.Max();
        var peaks = new List<int>();
        for (int i = 0; i < n; i++)
        {
            if (smooth[i] < max * 0.12) continue;
            bool top = true;
            for (int k = -reach; k <= reach && top; k++) if (k != 0 && i + k >= 0 && i + k < n && smooth[i + k] > smooth[i]) top = false;
            if (top && (peaks.Count == 0 || i - peaks[^1] >= reach)) peaks.Add(i);
        }
        var bands = new List<(double, double)>();
        double lo = zMin;
        for (int p = 0; p + 1 < peaks.Count; p++)
        {
            int cut = peaks[p];
            for (int i = peaks[p]; i <= peaks[p + 1]; i++) if (smooth[i] < smooth[cut]) cut = i;
            double z = zMin + cut * LevelBin;
            bands.Add((lo, z)); lo = z;
        }
        bands.Add((lo, zMax + 1));
        return bands;
    }

    static Mesh? LoadMesh(FPackageIndex index)
    {
        try
        {
            if (!index.TryLoad<UStaticMesh>(out var sm) || sm.RenderData?.LODs is not { Length: > 0 } lods) return null;
            // Reduced LODs collapse large floors into a few slanted triangles, so use the full mesh.
            var lod = lods.FirstOrDefault(l => !l.SkipLod);
            if (lod?.PositionVertexBuffer?.Verts is not { } verts || lod.IndexBuffer?.Buffer is not { } idx) return null;
            double radius = verts.Length == 0 ? 0 : verts.Max(v => Math.Sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z));
            var min = new FVector(verts.Min(v => v.X), verts.Min(v => v.Y), verts.Min(v => v.Z));
            var max = new FVector(verts.Max(v => v.X), verts.Max(v => v.Y), verts.Max(v => v.Z));
            return new Mesh(verts, idx, radius, min, max);
        }
        catch { return null; }
    }

    // Height of a placed mesh in the world (its bounding box corners, transformed).
    static double WorldHeight(Mesh m, FTransform t)
    {
        double lo = double.MaxValue, hi = double.MinValue;
        for (int c = 0; c < 8; c++)
        {
            var p = t.TransformPosition(new FVector((c & 1) != 0 ? m.Max.X : m.Min.X, (c & 2) != 0 ? m.Max.Y : m.Min.Y, (c & 4) != 0 ? m.Max.Z : m.Min.Z));
            lo = Math.Min(lo, p.Z); hi = Math.Max(hi, p.Z);
        }
        return hi - lo;
    }

    static void Draw(Region r, Mesh m, FTransform t, bool walls)
    {
        // A staircase's own sides and risers are not walls: the stairs are the way through.
        if (walls && (m.Stairs || WorldHeight(m, t) < MinWallHeight)) return;
        var flip = t.GetDeterminant() < 0; // mirrored instances reverse the winding
        for (int i = 0; i + 2 < m.Indices.Length; i += 3)
        {
            var a = t.TransformPosition(m.Verts[m.Indices[i]]);
            var b = t.TransformPosition(m.Verts[m.Indices[i + 1]]);
            var c = t.TransformPosition(m.Verts[m.Indices[i + 2]]);
            double lo = Math.Min(a.Z, Math.Min(b.Z, c.Z)), hi = Math.Max(a.Z, Math.Max(b.Z, c.Z));
            if (hi < r.minZ || lo > r.maxZ) continue;
            if (Math.Max(Math.Abs(a.X - b.X), Math.Abs(a.Y - b.Y)) > MaxEdge || Math.Max(Math.Abs(b.X - c.X), Math.Abs(b.Y - c.Y)) > MaxEdge
                || Math.Max(Math.Abs(c.X - a.X), Math.Abs(c.Y - a.Y)) > MaxEdge) continue;
            if (!walls)
            {
                // Unreal winds front faces clockwise, so an upward face has a negative right-handed cross product.
                double ux = b.X - a.X, uy = b.Y - a.Y, vx = c.X - a.X, vy = c.Y - a.Y, uz = b.Z - a.Z, vz = c.Z - a.Z;
                double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                if (len < 1e-6) continue;
                nz = -nz / len;
                if (flip) nz = -nz;
                if (nz <= 0.7 || hi < r.floorMinZ || lo > r.floorMaxZ) continue;
                if (r.hist != null)
                {
                    int bin = (int)(((a.Z + b.Z + c.Z) / 3 - r.floorMinZ) / LevelBin);
                    if (bin >= 0 && bin < r.hist.Length) r.hist[bin] += len / 2 * nz / 1e4; // square metres from above
                    // Height bands cut flights of stairs in two; keep the whole flight to attach afterwards.
                    if (m.Stairs) Raster(r, a, b, c, floor: true, stairs: true);
                }
                else if (hi >= r.bandLo && lo < r.bandHi) Raster(r, a, b, c, floor: true);
            }
            // Stair risers and railing bars are only a hand's height each; walls are not.
            else if (hi - lo >= 60) Raster(r, a, b, c, floor: false);
        }
    }

    // The part of a (near-vertical) triangle that lies in the walking slice above the floor under it,
    // traced from above. A lintel over a doorway is above the slice, so the doorway stays open.
    static void TraceSlice(Region r, FVector a, FVector b, FVector c)
    {
        float f = float.PositiveInfinity;
        foreach (var p in new[] { a, b, c, (a + b + c) / 3 })
        {
            int x = (int)((p.X - r.minX) / r.res), y = (int)((p.Y - r.minY) / r.res);
            if (x >= 0 && y >= 0 && x < r.w && y < r.h) f = Math.Min(f, r.floor[y * r.w + x]);
        }
        if (float.IsPositiveInfinity(f)) return;
        var poly = Clip(Clip([a, b, c], f + WalkLo, above: true), f + WalkHi, above: false);
        for (int i = 0; i < poly.Count; i++)
        {
            var p = poly[i]; var q = poly[(i + 1) % poly.Count];
            Line(r, (p.X - r.minX) / r.res, (p.Y - r.minY) / r.res, (q.X - r.minX) / r.res, (q.Y - r.minY) / r.res, f + WalkLo + 1, f + WalkHi - 1);
        }
    }

    // Sutherland-Hodgman against one horizontal plane: keep the side above (or below) height z.
    static List<FVector> Clip(List<FVector> poly, double z, bool above)
    {
        var res = new List<FVector>();
        for (int i = 0; i < poly.Count; i++)
        {
            var p = poly[i]; var q = poly[(i + 1) % poly.Count];
            bool pin = above ? p.Z >= z : p.Z <= z, qin = above ? q.Z >= z : q.Z <= z;
            if (pin) res.Add(p);
            if (pin != qin) { var t = (float)((z - p.Z) / (q.Z - p.Z)); res.Add(p + (q - p) * t); }
        }
        return res;
    }

    // Scanline fill of the triangle's top-down projection, with the triangle's height interpolated per pixel.
    // Floors keep the lowest surface. Walls mark pixels where the triangle passes through the walking slice
    // above that pixel's floor; near-vertical triangles are edge-on from above, so their edges are traced too.
    static void Raster(Region r, FVector a, FVector b, FVector c, bool floor, bool stairs = false)
    {
        double ax = (a.X - r.minX) / r.res, ay = (a.Y - r.minY) / r.res;
        double bx = (b.X - r.minX) / r.res, by = (b.Y - r.minY) / r.res;
        double cx = (c.X - r.minX) / r.res, cy = (c.Y - r.minY) / r.res;
        int x0 = Math.Max(0, (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx)))), x1 = Math.Min(r.w - 1, (int)Math.Ceiling(Math.Max(ax, Math.Max(bx, cx))));
        int y0 = Math.Max(0, (int)Math.Floor(Math.Min(ay, Math.Min(by, cy)))), y1 = Math.Min(r.h - 1, (int)Math.Ceiling(Math.Max(ay, Math.Max(by, cy))));
        if (x0 > x1 || y0 > y1) return;
        double area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (!floor && Math.Abs(area) < 1.5) { TraceSlice(r, a, b, c); return; }
        if (Math.Abs(area) < 1e-9) return;
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
            {
                double px = x + 0.5, py = y + 0.5;
                double w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
                double w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
                double w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                float z = (float)(w0 * a.Z + w1 * b.Z + w2 * c.Z);
                int i = y * r.w + x;
                if (stairs) { if (z < r.stairs[i]) r.stairs[i] = z; }
                else if (floor) { if (z >= r.bandLo && z < r.bandHi && z < r.floor[i]) r.floor[i] = z; }
                else if (Blocks(r, i, z, z)) r.wall[i] = 1;
            }
    }

    static bool Blocks(Region r, int i, float lo, float hi)
    {
        float f = r.floor[i];
        return !float.IsPositiveInfinity(f) && lo < f + WalkHi && hi > f + WalkLo;
    }

    static void Line(Region r, double x0, double y0, double x1, double y1, float lo, float hi)
    {
        int n = (int)Math.Ceiling(Math.Max(Math.Abs(x1 - x0), Math.Abs(y1 - y0))) + 1;
        for (int s = 0; s <= n; s++)
        {
            int x = (int)(x0 + (x1 - x0) * s / n), y = (int)(y0 + (y1 - y0) * s / n);
            if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
            int i = y * r.w + x;
            if (Blocks(r, i, lo, hi)) r.wall[i] = 1;
        }
    }

    static void DropIslands(Region r)
    {
        var seen = new bool[r.w * r.h];
        var stack = new Stack<int>();
        var island = new List<int>();
        for (int start = 0; start < seen.Length; start++)
        {
            if (seen[start] || float.IsPositiveInfinity(r.floor[start])) continue;
            island.Clear(); stack.Push(start); seen[start] = true;
            while (stack.Count > 0)
            {
                int i = stack.Pop(); island.Add(i);
                int x = i % r.w, y = i / r.w;
                void Visit(int j) { if (!seen[j] && !float.IsPositiveInfinity(r.floor[j])) { seen[j] = true; stack.Push(j); } }
                if (x > 0) Visit(i - 1);
                if (x < r.w - 1) Visit(i + 1);
                if (y > 0) Visit(i - r.w);
                if (y < r.h - 1) Visit(i + r.w);
            }
            if (island.Count < MinIsland) foreach (var i in island) { r.floor[i] = float.PositiveInfinity; r.wall[i] = 0; }
        }
    }


    // Map style, after the classic parchment dungeon maps: walkable floor as a pale inked shape on
    // aged paper; everything else (walls, rock, void) stays paper. Sizes are in pixels.
    const int Margin = 80;      // paper around the plan

    // Chamfer distance in pixels from every pixel to the nearest pixel where `target` is true.
    static float[] DistanceTo(bool[] target, int w, int h)
    {
        const float A = 1, D = 1.4142f;
        var d = new float[w * h];
        for (int i = 0; i < d.Length; i++) d[i] = target[i] ? 0 : 1e9f;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = y * w + x; float v = d[i];
                if (x > 0) v = Math.Min(v, d[i - 1] + A);
                if (y > 0)
                {
                    v = Math.Min(v, d[i - w] + A);
                    if (x > 0) v = Math.Min(v, d[i - w - 1] + D);
                    if (x < w - 1) v = Math.Min(v, d[i - w + 1] + D);
                }
                d[i] = v;
            }
        for (int y = h - 1; y >= 0; y--)
            for (int x = w - 1; x >= 0; x--)
            {
                int i = y * w + x; float v = d[i];
                if (x < w - 1) v = Math.Min(v, d[i + 1] + A);
                if (y < h - 1)
                {
                    v = Math.Min(v, d[i + w] + A);
                    if (x < w - 1) v = Math.Min(v, d[i + w + 1] + D);
                    if (x > 0) v = Math.Min(v, d[i + w - 1] + D);
                }
                d[i] = v;
            }
        return d;
    }

    static bool[] Where(float[] d, Func<float, bool> f) { var m = new bool[d.Length]; for (int i = 0; i < d.Length; i++) m[i] = f(d[i]); return m; }
    static bool[] Not(bool[] a) { var m = new bool[a.Length]; for (int i = 0; i < a.Length; i++) m[i] = !a[i]; return m; }

    // Enclosed regions of `value` smaller than `max` pixels flip to the other value.
    static void FlipSmall(bool[] m, int w, int h, bool value, int max)
    {
        var seen = new bool[m.Length];
        var stack = new Stack<int>();
        var part = new List<int>();
        for (int start = 0; start < m.Length; start++)
        {
            if (seen[start] || m[start] != value) continue;
            part.Clear(); stack.Push(start); seen[start] = true;
            bool edge = false;
            while (stack.Count > 0)
            {
                int i = stack.Pop(); part.Add(i);
                int x = i % w, y = i / w;
                if (x == 0 || y == 0 || x == w - 1 || y == h - 1) edge = true;
                void Visit(int j) { if (!seen[j] && m[j] == value) { seen[j] = true; stack.Push(j); } }
                if (x > 0) Visit(i - 1);
                if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w);
                if (y < h - 1) Visit(i + w);
            }
            if (part.Count < max && !edge) foreach (var i in part) m[i] = !value;
        }
    }

    // Rounds off pixel staircases: box blur of the mask, cut at one half.
    static bool[] Smooth(bool[] m, int w, int h, int radius)
    {
        var a = new float[m.Length]; var b = new float[m.Length];
        for (int i = 0; i < m.Length; i++) a[i] = m[i] ? 1 : 0;
        for (int pass = 0; pass < 2; pass++)
        {
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float sum = 0; int n = 0;
                    for (int k = -radius; k <= radius; k++)
                    {
                        int xx = pass == 0 ? x + k : x, yy = pass == 0 ? y : y + k;
                        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                        sum += a[yy * w + xx]; n++;
                    }
                    b[y * w + x] = sum / n;
                }
            (a, b) = (b, a);
        }
        return Where(a, v => v >= 0.5f);
    }

    // Smooth value noise in [0, 1] for the paper grain.
    static float Noise(int x, int y)
    {
        static float Hash(int x, int y) { uint n = unchecked((uint)(x * 374761393 + y * 668265263)); n = unchecked((n ^ (n >> 13)) * 1274126177); return (n ^ (n >> 16)) / (float)uint.MaxValue; }
        static float Layer(float x, float y)
        {
            int xi = (int)Math.Floor(x), yi = (int)Math.Floor(y);
            float fx = x - xi, fy = y - yi;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            float a = Hash(xi, yi), b = Hash(xi + 1, yi), c = Hash(xi, yi + 1), d = Hash(xi + 1, yi + 1);
            return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
        }
        return 0.5f * Layer(x / 96f, y / 96f) + 0.3f * Layer(x / 32f, y / 32f) + 0.2f * Layer(x / 8f, y / 8f);
    }

    static (byte r, byte g, byte b) Mix((byte r, byte g, byte b) a, (byte r, byte g, byte b) b, double t)
    {
        t = Math.Clamp(t, 0, 1);
        return ((byte)(a.r + (b.r - a.r) * t), (byte)(a.g + (b.g - a.g) * t), (byte)(a.b + (b.b - a.b) * t));
    }
    static (byte r, byte g, byte b) Scale((byte r, byte g, byte b) a, double k) =>
        ((byte)Math.Clamp(a.r * k, 0, 255), (byte)Math.Clamp(a.g * k, 0, 255), (byte)Math.Clamp(a.b * k, 0, 255));

    // One level of a dungeon on the region's pixel grid: where you can walk, and the floor height there.
    sealed class Sheet
    {
        public bool[] walk = [];
        public float[] height = [];
        public bool[]? stairs;   // pixels that are stair treads (drawn with tread lines)
        public int Count() => walk.Count(v => v);
        public double Overlap(Sheet o)
        {
            int both = 0, a = 0, b = 0;
            for (int i = 0; i < walk.Length; i++) { if (walk[i]) a++; if (o.walk[i]) b++; if (walk[i] && o.walk[i]) both++; }
            return Math.Min(a, b) == 0 ? 0 : both / (double)Math.Min(a, b);
        }
        public void Add(Sheet o)
        {
            for (int i = 0; i < walk.Length; i++) if (o.walk[i] && !walk[i]) { walk[i] = true; height[i] = o.height[i]; }
            if (o.stairs != null)
            {
                stairs ??= new bool[walk.Length];
                for (int i = 0; i < walk.Length; i++) stairs[i] |= o.stairs[i];
            }
        }
        public double MeanHeight()
        {
            double s = 0; int n = 0;
            for (int i = 0; i < walk.Length; i++) if (walk[i]) { s += height[i]; n++; }
            return n == 0 ? 0 : s / n;
        }
    }

    // The walkable shape of the band just drawn into r.floor / r.wall, tidied into clean rooms, or null if
    // nothing stands on it.
    static Sheet? Build(Region r)
    {
        int w = r.w, h = r.h;
        var walk = new bool[w * h];
        var wall = new bool[w * h];
        var height = (float[])r.floor.Clone();
        for (int i = 0; i < walk.Length; i++) { walk[i] = !float.IsPositiveInfinity(r.floor[i]) && r.wall[i] == 0; wall[i] = r.wall[i] != 0; }
        // Bridge pixel cracks, shave off slivers, fill specks of clutter and drop scraps of floor.
        walk = Where(DistanceTo(Not(Where(DistanceTo(walk, w, h), d => d <= 1.5f)), w, h), d => d > 1.5f); // close
        // Do not open/erode the mask: real stair treads and narrow corridors are only a few
        // pixels wide. Removing small islands here also removes the ends of sloping bands.
        FlipSmall(walk, w, h, false, 16);
        // The tidying above bridges thin walls between rooms: put them back so rooms stay separate.
        var nearWall = DistanceTo(wall, w, h);
        for (int i = 0; i < walk.Length; i++) if (nearWall[i] <= 1) walk[i] = false;
        // Smoothing can grow the floor past where heights were drawn: borrow the nearest height there.
        for (int pass = 0; pass < 8; pass++)
            for (int i = 0; i < walk.Length; i++)
            {
                if (!walk[i] || !float.IsPositiveInfinity(height[i])) continue;
                int x = i % w, y = i / w;
                foreach (var j in new[] { x > 0 ? i - 1 : i, x < w - 1 ? i + 1 : i, y > 0 ? i - w : i, y < h - 1 ? i + w : i })
                    if (!float.IsPositiveInfinity(height[j])) { height[i] = height[j]; break; }
            }
        return walk.Any(v => v) ? new Sheet { walk = walk, height = height } : null;
    }

    static void KeepSupported(Region r, Sheet sheet)
        => KeepSupportedLevels(r, [sheet]);

    static void KeepSupportedLevels(Region r, List<Sheet> sheets)
    {
        int w = r.w, h = r.h;
        int size = w * h;
        // Keep only floor that something stands on (spawns, chests, ore...): the tops of ceilings and rocks
        // that fall in this band have nothing on them.
        var kept = sheets.Select(s => new bool[size]).ToArray();
        var stack = new Stack<int>();
        for (int level = 0; level < sheets.Count; level++)
        foreach (var p in r.points)
        {
            int px = (int)((p[0] - r.minX) / r.res), py = (int)((p[1] - r.minY) / r.res);
            for (int dy = -10; dy <= 10; dy++)
                for (int dx = -10; dx <= 10; dx++)
                {
                    int x = px + dx, y = py + dy;
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    int i = y * w + x;
                    var s = sheets[level];
                    if (s.walk[i] && !kept[level][i] && p[2] >= s.height[i] - 300 && p[2] <= s.height[i] + 400)
                    { kept[level][i] = true; stack.Push(level * size + i); }
                }
        }
        while (stack.Count > 0)
        {
            int entry = stack.Pop(), level = entry / size, i = entry % size, x = i % w, y = i / w;
            void Visit(int l, int j)
            {
                // Floors touching in X/Y are not necessarily connected: a ceiling can sit over
                // a corridor. Cross a sheet boundary only where floor heights actually meet.
                if (sheets[l].walk[j] && !kept[l][j]
                    && Math.Abs(sheets[l].height[j] - sheets[level].height[i]) <= Math.Max(120, r.res * 2))
                { kept[l][j] = true; stack.Push(l * size + j); }
            }
            for (int l = 0; l < sheets.Count; l++)
            {
                Visit(l, i);
                if (x > 0) Visit(l, i - 1);
                if (x < w - 1) Visit(l, i + 1);
                if (y > 0) Visit(l, i - w);
                if (y < h - 1) Visit(l, i + w);
            }
        }
        for (int l = 0; l < sheets.Count; l++)
        {
            for (int i = 0; i < size; i++) if (!kept[l][i]) sheets[l].height[i] = float.PositiveInfinity;
            sheets[l].walk = kept[l];
        }
    }

    // Each flight of stairs joins the levels it actually meets: at either end its treads sit at that level's
    // floor height, so it is drawn on the lower and the upper map alike. Flights that meet no floor are
    // decoration or out of reach and stay off the map.
    static void AttachStairs(Region r, List<Sheet> levels)
    {
        int w = r.w, h = r.h;
        var seen = new bool[w * h];
        var stack = new Stack<int>();
        var flight = new List<int>();
        for (int start = 0; start < seen.Length; start++)
        {
            if (seen[start] || float.IsPositiveInfinity(r.stairs[start])) continue;
            flight.Clear(); stack.Push(start); seen[start] = true;
            while (stack.Count > 0)
            {
                int i = stack.Pop(), x = i % w, y = i / w; flight.Add(i);
                void Visit(int j)
                {
                    // Treads of one flight differ by a riser at most; a jump means another flight above or below.
                    if (!seen[j] && !float.IsPositiveInfinity(r.stairs[j]) && Math.Abs(r.stairs[j] - r.stairs[i]) <= 80)
                    { seen[j] = true; stack.Push(j); }
                }
                if (x > 0) Visit(i - 1); if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w); if (y < h - 1) Visit(i + w);
            }
            if (flight.Count < 6) continue;
            foreach (var level in levels)
            {
                int contacts = 0;
                foreach (int i in flight)
                {
                    int x = i % w, y = i / w;
                    for (int d = 0; d <= 3 && contacts < 3; d++)
                        foreach (var (dx, dy) in new[] { (d, 0), (-d, 0), (0, d), (0, -d) })
                        {
                            int qx = x + dx, qy = y + dy;
                            if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
                            int q = qy * w + qx;
                            if (level.walk[q] && Math.Abs(level.height[q] - r.stairs[i]) <= 120) { contacts++; break; }
                        }
                    if (contacts >= 3) break;
                }
                if (contacts < 3) continue;
                level.stairs ??= new bool[w * h];
                foreach (int i in flight)
                {
                    level.stairs[i] = true;
                    if (!level.walk[i]) { level.walk[i] = true; level.height[i] = r.stairs[i]; }
                }
            }
        }
    }

    const int HeightCell = 10; // pixels per cell of the coarse height grid the app uses to tell levels apart

    public static void Test()
    {
        static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
        var r = new Region { minX = 0, minY = 0, res = 1, w = 64, h = 32,
            floor = new float[64 * 32], wall = new byte[64 * 32], bandLo = 100, bandHi = 200 };
        Array.Fill(r.floor, float.PositiveInfinity);
        Raster(r, new FVector(0, 0, 0), new FVector(60, 0, 300), new FVector(0, 30, 0), true);
        Check(float.IsPositiveInfinity(r.floor[2 * r.w + 10]), "Ramp must exclude pixels below the band");
        Check(float.IsFinite(r.floor[2 * r.w + 25]), "Ramp must retain pixels inside the band");
        Check(float.IsPositiveInfinity(r.floor[2 * r.w + 42]), "Ramp must exclude pixels above the band");
        Array.Fill(r.floor, float.PositiveInfinity);
        for (int y = 14; y <= 16; y++) for (int x = 8; x < 56; x++) r.floor[y * r.w + x] = 150;
        var stairs = Build(r);
        Check(stairs != null && stairs.walk[15 * r.w + 30], "Unoccupied narrow stairs must survive band construction");
        var landing = new Sheet { walk = new bool[r.w * r.h], height = new float[r.w * r.h] };
        Array.Fill(landing.height, float.PositiveInfinity);
        for (int y = 10; y <= 20; y++) for (int x = 2; x <= 10; x++)
        { landing.walk[y * r.w + x] = true; landing.height[y * r.w + x] = 150; }
        landing.Add(stairs!);
        r.points = [[4, 15, 150]];
        KeepSupported(r, landing);
        Check(landing.walk[15 * r.w + 50], "Actor-supported landing must keep the connected flight of stairs");
        var upper = new Sheet { walk = (bool[])landing.walk.Clone(), height = (float[])landing.height.Clone() };
        for (int i = 0; i < upper.height.Length; i++) if (upper.walk[i]) upper.height[i] += 800;
        KeepSupportedLevels(r, [landing, upper]);
        Check(upper.Count() == 0, "An unsupported ceiling above an occupied floor must not become a connected route");
        var clean = DisplayMask(landing.walk, r.w, r.h, 50);
        Check(clean[15 * r.w + 30], "Cosmetic cleanup must retain narrow connected stairs");
        var debris = (bool[])landing.walk.Clone(); debris[2 * r.w + 60] = true;
        clean = DisplayMask(debris, r.w, r.h, 50);
        Check(!clean[2 * r.w + 60], "Cosmetic cleanup must remove isolated debris");
        for (int i = 0; i < clean.Length; i++) Check(!clean[i] || debris[i], "Cosmetic cleanup must never invent walkable floor");
        using var drawn = DrawPlan(landing.walk, landing.walk, r.w, r.h, 20);
        var fill = drawn.GetPixel(6, 15);
        Check(fill.Red > 180 && fill.Green > 170 && fill.Blue > 120, "Floor contour must fill the actual room interior");
        using var narrowPath = Outline(landing.walk, r.w, r.h, 20);
        Check(narrowPath.Contains(30.5f, 15.5f), "Contour simplification must preserve the narrow stair route");
        var jagged = new bool[64 * 64];
        for (int y = 8; y < 56; y++) for (int x = 8; x < 56; x++) jagged[y * 64 + x] = y != 8 || x % 2 == 0;
        using var smoothPath = Outline(jagged, 64, 64, 20);
        Check(smoothPath.PointCount < 40, "Mesh-sized sawteeth must simplify to a smooth room perimeter");
        Check(smoothPath.Contains(32, 32) && !smoothPath.Contains(2, 2), "Smoothing must retain the room footprint");
        var connectedRooms = new bool[96 * 64];
        for (int y = 12; y < 42; y++) for (int x = 8; x < 32; x++) connectedRooms[y * 96 + x] = true;
        for (int y = 12; y < 42; y++) for (int x = 62; x < 86; x++) connectedRooms[y * 96 + x] = true;
        for (int x = 31; x <= 62; x++) connectedRooms[27 * 96 + x] = true;
        for (int y = 3; y < 13; y++) connectedRooms[y * 96 + 15] = true;
        var cartography = CartographicMask(connectedRooms, 96, 64, 20);
        Check(cartography[27 * 96 + 46], "A one-pixel corridor between rooms must survive sliver removal");
        Check(!cartography[4 * 96 + 15], "A thin one-ended mesh spur must not remain on the map");
        for (int i = 0; i < cartography.Length; i++) Check(!cartography[i] || connectedRooms[i], "Cartography must never add a shortcut outside the source floor");
        var anchored = CartographicMask(connectedRooms, 96, 64, 20, [new SKPoint(15, 4)]);
        Check(anchored[4 * 96 + 15] && anchored[9 * 96 + 15], "A useful marker at the end of a narrow passage must keep the whole passage");
        for (int x = 31; x <= 62; x++) connectedRooms[35 * 96 + x] = true;
        var alternatives = CartographicMask(connectedRooms, 96, 64, 20);
        Check(alternatives[27 * 96 + 46] && alternatives[35 * 96 + 46], "Both parallel narrow routes between rooms must remain visible");
        // A flight from a lower hall up to a gallery belongs on both levels' maps.
        var hall = new Region { minX = 0, minY = 0, res = 20, w = 64, h = 32, stairs = new float[64 * 32] };
        Array.Fill(hall.stairs, float.PositiveInfinity);
        Sheet Floor(int x0, int x1, float z)
        {
            var s = new Sheet { walk = new bool[64 * 32], height = new float[64 * 32] };
            Array.Fill(s.height, float.PositiveInfinity);
            for (int y = 8; y < 24; y++) for (int x = x0; x < x1; x++) { s.walk[y * 64 + x] = true; s.height[y * 64 + x] = z; }
            return s;
        }
        var lower = Floor(0, 20, 0); var gallery = Floor(44, 64, 300);
        for (int y = 12; y < 20; y++) for (int x = 20; x < 44; x++) hall.stairs[y * 64 + x] = (x - 20) * 300f / 23;
        var loose = new Sheet { walk = new bool[64 * 32], height = new float[64 * 32] };
        AttachStairs(hall, [lower, gallery, loose]);
        Check(lower.walk[15 * 64 + 30] && lower.stairs![15 * 64 + 30], "Stairs must appear on the level at their foot");
        Check(gallery.walk[15 * 64 + 30] && gallery.stairs![15 * 64 + 30], "Stairs must appear on the level at their head");
        Check(Math.Abs(gallery.height[15 * 64 + 40] - hall.stairs[15 * 64 + 40]) < 1, "Added treads must keep their own height");
        Check(loose.Count() == 0, "Stairs must not appear on a level they do not reach");
        Console.WriteLine("Floorplan geometry tests passed: ramp slicing, narrow stairs, cross-band reachability, ceiling rejection, stairs on both levels");
    }

    // Writes one level on parchment. All levels of a dungeon share a frame (the bounds of every level plus
    // paper), so switching levels keeps your place.
    static object Save(Region r, List<Sheet> levels, int level, string outDir, string name)
    {
        int minPx = r.w, minPy = r.h, maxPx = 0, maxPy = 0;
        foreach (var s in levels)
            for (int i = 0; i < s.walk.Length; i++)
                if (s.walk[i]) { int x = i % r.w, y = i / r.w; minPx = Math.Min(minPx, x); maxPx = Math.Max(maxPx, x); minPy = Math.Min(minPy, y); maxPy = Math.Max(maxPy, y); }
        minPx -= Margin; minPy -= Margin; maxPx += Margin; maxPy += Margin;
        int w = maxPx - minPx + 1, h = maxPy - minPy + 1;
        var sheet = level >= 0 ? levels[level] : new Sheet { walk = new bool[r.w * r.h], height = new float[r.w * r.h] };
        if (level < 0)
        {
            Array.Fill(sheet.height, float.PositiveInfinity);
            foreach (var s in levels) sheet.Add(s);
        }
        var walk = new bool[w * h];
        var context = new bool[w * h]; // other storeys keep the dungeon's route visible across stairs
        var height = new float[w * h];
        var treads = new float[w * h]; // stair heights, for the tread lines
        Array.Fill(height, float.PositiveInfinity);
        Array.Fill(treads, float.PositiveInfinity);
        float zLo = float.PositiveInfinity, zHi = float.NegativeInfinity;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int gx = x + minPx, gy = y + minPy;
                if (gx < 0 || gy < 0 || gx >= r.w || gy >= r.h) continue;
                int i = gy * r.w + gx;
                context[y * w + x] = levels.Any(s => s.walk[i]);
                if (!sheet.walk[i]) continue;
                walk[y * w + x] = true; height[y * w + x] = sheet.height[i];
                if (sheet.stairs?[i] == true) treads[y * w + x] = sheet.height[i];
                if (!float.IsPositiveInfinity(sheet.height[i])) { zLo = Math.Min(zLo, sheet.height[i]); zHi = Math.Max(zHi, sheet.height[i]); }
            }
        // Styling works on a display mask only; gameplay heights and the original geometry stay intact.
        using var bmp = DrawPlan(walk, context, w, h, r.res, Pins(r.id, r.minX + minPx * r.res, r.minY + minPy * r.res, r.res), treads);
        using var img = SKImage.FromBitmap(bmp);
        using var png = img.Encode(SKEncodedImageFormat.Png, 100);
        File.WriteAllBytes(Path.Combine(outDir, name + ".png"), png.ToArray());

        // Coarse floor heights (cm, null = no floor) so the app can tell which level the player and markers are on.
        int gw = (w + HeightCell - 1) / HeightCell, gh = (h + HeightCell - 1) / HeightCell;
        var grid = new int?[gw * gh];
        for (int cy = 0; cy < gh; cy++)
            for (int cx = 0; cx < gw; cx++)
            {
                double s = 0; int n = 0;
                for (int y = cy * HeightCell; y < Math.Min(h, (cy + 1) * HeightCell); y++)
                    for (int x = cx * HeightCell; x < Math.Min(w, (cx + 1) * HeightCell); x++)
                        if (walk[y * w + x] && !float.IsPositiveInfinity(height[y * w + x])) { s += height[y * w + x]; n++; }
                if (n > 0) grid[cy * gw + cx] = (int)Math.Round(s / n);
            }
        Console.Error.WriteLine($"OK  {name} {w}x{h} @ {r.res:0.#} cm/px, floor {zLo:0}..{zHi:0}");
        return new { r.id, level, image = name + ".png", minX = r.minX + minPx * r.res, minY = r.minY + minPy * r.res, res = r.res, w, h,
            overview = levels.Count > 1 ? r.id + "-all.png" : null,
            zLo, zHi, heights = new { cell = HeightCell, w = gw, h = gh, z = grid } };
    }
}
