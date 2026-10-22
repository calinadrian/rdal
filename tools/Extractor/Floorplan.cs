// Top-down floor plans of the dungeons, drawn from the game's navigation mesh (FloorplanNav.cs): the floor
// creatures and players actually walk on, already joined through doorways and up stairs. The navmesh also
// covers roofs, wall tops and rock ledges that nothing can reach, so only floor connected to the region's
// gameplay actors (spawns, chests, exits...) is kept, and none over invisible collision (FloorplanMeshes.cs).
// Stacked storeys become separate levels. Each region
// from raw/dungeon-regions.json becomes <id>.png (or <id>-<n>.png per level plus <id>-all.png) and a frame
// in floorplans.json that maps world X/Y to image pixels.
using System.Collections.Concurrent;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Objects.Core.Math;
using Newtonsoft.Json;
using SkiaSharp;

public static partial class Floorplan
{
    const int MaxSide = 2048;      // pixels on the longest side
    const double MinRes = 20;      // world units (cm) per pixel at best
    const double AgentRadius = 34; // the navmesh stops this far short of walls (the Default agent's radius)
    const float MergeZ = 40;       // navmesh surfaces closer than this over one pixel are the same floor
    const int Margin = 80;         // paper around the plan

    sealed class Region
    {
#pragma warning disable CS0649 // filled from JSON
        public string id = "";
        public double minX, maxX, minY, maxY, minZ, maxZ;
        public double[][] points = [];
#pragma warning restore CS0649
        public double res;
        public int w, h;
        public bool Contains(double x, double y, double z, double pad) =>
            x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad && z >= minZ - pad && z <= maxZ + pad;
    }

    // The images go to outDir; cacheDir/layouts keeps the floor data for Restyle (it does not ship).
    public static void Run(DefaultFileProvider provider, string outDir, string regionsFile, string cacheDir)
    {
        var regions = JsonConvert.DeserializeObject<List<Region>>(File.ReadAllText(regionsFile))!;
        foreach (var r in regions)
        {
            r.res = Math.Max(MinRes, Math.Max(r.maxX - r.minX, r.maxY - r.minY) / MaxSide);
            r.w = (int)Math.Ceiling((r.maxX - r.minX) / r.res);
            r.h = (int)Math.Ceiling((r.maxY - r.minY) / r.res);
        }
        var (tris, links) = LoadNavmesh(provider, (lo, hi) => regions.Any(r =>
            hi.X >= r.minX && lo.X <= r.maxX && hi.Y >= r.minY && lo.Y <= r.maxY && hi.Z >= r.minZ && lo.Z <= r.maxZ));
        Console.Error.WriteLine($"{tris.Count} navmesh triangles, {links.Count} links");
        var shown = LoadMeshFloors(provider, regions);
        Directory.CreateDirectory(outDir);
        var frames = new ConcurrentBag<object>();
        Parallel.ForEach(regions, new ParallelOptions { MaxDegreeOfParallelism = 4 }, r =>
        {
            // Every triangle overlapping the region; drawing clips them to it, so its edges stay straight.
            var mine = tris.Where(t => Math.Max(t.A.X, Math.Max(t.B.X, t.C.X)) >= r.minX && Math.Min(t.A.X, Math.Min(t.B.X, t.C.X)) <= r.maxX
                && Math.Max(t.A.Y, Math.Max(t.B.Y, t.C.Y)) >= r.minY && Math.Min(t.A.Y, Math.Min(t.B.Y, t.C.Y)) <= r.maxY
                && r.Contains(r.minX, r.minY, (t.A.Z + t.B.Z + t.C.Z) / 3, 0)).ToList();
            var spans = Rasterize(r, mine);
            var keep = Reachable(r, spans, links.Where(l => r.Contains(l.From.X, l.From.Y, l.From.Z, 500) || r.Contains(l.To.X, l.To.Y, l.To.Z, 500)).ToList(),
                shown.TryGetValue(r, out var visible) ? Unseen(r, spans, visible) : null);
            var levels = Storeys(r, spans, keep);
            if (levels.Count == 0) { Console.Error.WriteLine($"--  {r.id}: no reachable navmesh"); return; }
            foreach (var level in levels) Tidy(r, level);
            SaveLayout(r, levels, cacheDir);
            foreach (var frame in SaveAll(r, levels, outDir)) frames.Add(frame);
        });
        var sorted = frames.OrderBy(f => (string)((dynamic)f).image).ToList();
        File.WriteAllText(Path.Combine(outDir, "floorplans.json"), JsonConvert.SerializeObject(sorted));
    }

    // Every navmesh surface over each pixel, lowest first: pixel i has heights z[start[i]] .. z[start[i + 1] - 1].
    sealed class Spans
    {
        public int w, h;
        public int[] start = [];
        public float[] z = [];
    }

    static Spans Rasterize(Region r, IEnumerable<NavTri> tris)
    {
        var lists = new List<float>?[r.w * r.h];
        foreach (var t in tris)
            Cover(r, t, (i, z) =>
            {
                var list = lists[i] ??= new List<float>(1);
                for (int k = 0; k < list.Count; k++)
                    if (Math.Abs(list[k] - z) < MergeZ) { if (z < list[k]) list[k] = z; return; }
                list.Add(z);
            });
        var s = new Spans { w = r.w, h = r.h, start = new int[r.w * r.h + 1] };
        for (int i = 0; i < lists.Length; i++) s.start[i + 1] = s.start[i] + (lists[i]?.Count ?? 0);
        s.z = new float[s.start[^1]];
        for (int i = 0; i < lists.Length; i++)
            if (lists[i] is { } list) { list.Sort(); list.CopyTo(s.z, s.start[i]); }
        return s;
    }

    // Conservative fill of a triangle's top-down projection: every pixel it touches, with the height at the
    // nearest point of the triangle. A corridor or stair run can be under a pixel wide on the navmesh
    // (it stops an agent's radius short of each wall), so sampling only pixel centres would break it apart.
    static void Cover(Region r, NavTri t, Action<int, float> plot)
    {
        double ax = (t.A.X - r.minX) / r.res, ay = (t.A.Y - r.minY) / r.res;
        double bx = (t.B.X - r.minX) / r.res, by = (t.B.Y - r.minY) / r.res;
        double cx = (t.C.X - r.minX) / r.res, cy = (t.C.Y - r.minY) / r.res;
        double area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.Abs(area) < 1e-9) return;
        double sign = Math.Sign(area), size = Math.Abs(area);
        // How far each edge function can change across half a pixel.
        double slackA = 0.5 * (Math.Abs(cx - bx) + Math.Abs(cy - by)), slackB = 0.5 * (Math.Abs(ax - cx) + Math.Abs(ay - cy)),
            slackC = 0.5 * (Math.Abs(bx - ax) + Math.Abs(by - ay));
        int x0 = Math.Max(0, (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx)) - 0.5)), x1 = Math.Min(r.w - 1, (int)Math.Floor(Math.Max(ax, Math.Max(bx, cx)) + 0.5));
        int y0 = Math.Max(0, (int)Math.Floor(Math.Min(ay, Math.Min(by, cy)) - 0.5)), y1 = Math.Min(r.h - 1, (int)Math.Floor(Math.Max(ay, Math.Max(by, cy)) + 0.5));
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
            {
                double px = x + 0.5, py = y + 0.5;
                double wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * sign;
                double wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * sign;
                double wc = size - wa - wb;
                if (wa < -slackA || wb < -slackB || wc < -slackC) continue;
                wa = Math.Max(0, wa); wb = Math.Max(0, wb); wc = Math.Max(0, wc);
                plot(y * r.w + x, (float)((wa * t.A.Z + wb * t.B.Z + wc * t.C.Z) / (wa + wb + wc)));
            }
    }

    const double MaxRoam = 4000;    // cm on foot: floor this far from every actor may lie outside the dungeon,
    const double RoamNear = 800;    // with all the floor beyond this distance that leads to it,
    const double MaxContact = 1200; // if it meets the floor near the actors along no more than this

    // Floor that something stands on (spawns, chests, exits...) and everything joined to it: across
    // neighbouring pixels at a climbable height difference, and along the navmesh's jump and ladder links.
    // `banned` surfaces are never floor.
    static bool[] Reachable(Region r, Spans s, List<NavLink> links, bool[]? banned = null)
    {
        int w = s.w, h = s.h;
        var owner = new int[s.z.Length];
        for (int i = 0; i < w * h; i++) for (int k = s.start[i]; k < s.start[i + 1]; k++) owner[k] = i;
        // Surfaces within `radius` of a point whose height lies between `below` under it and `above` over it.
        List<int> Near(double x, double y, double z, double radius, double below, double above)
        {
            var found = new List<int>();
            int px = (int)((x - r.minX) / r.res), py = (int)((y - r.minY) / r.res), reach = (int)Math.Ceiling(radius / r.res);
            for (int dy = -reach; dy <= reach; dy++)
                for (int dx = -reach; dx <= reach; dx++)
                {
                    int qx = px + dx, qy = py + dy;
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h || dx * dx + dy * dy > reach * reach) continue;
                    int i = qy * w + qx;
                    for (int k = s.start[i]; k < s.start[i + 1]; k++) if (s.z[k] >= z - below && s.z[k] <= z + above) found.Add(k);
                }
            return found;
        }
        // Walking distance in pixels from the nearest actor; -1 is out of reach.
        var dist = new int[s.z.Length];
        Array.Fill(dist, -1);
        var queue = new Queue<int>();
        void Reach(int k, int d) { if (dist[k] < 0 && banned?[k] != true) { dist[k] = d; queue.Enqueue(k); } }
        foreach (var p in r.points)
        {
            // Actors stand on the floor or hover a little over it; a ceiling's top is well above them. A few
            // (boss spawns, effects) float higher and take the floor further below instead.
            var under = Near(p[0], p[1], p[2], 200, 400, 150);
            if (under.Count == 0) under = Near(p[0], p[1], p[2], 600, 1500, 150);
            foreach (var k in under) Reach(k, 0);
        }
        var jumps = new Dictionary<int, List<int>>();
        void Join(List<int> from, List<int> to) { foreach (var k in from) { if (!jumps.TryGetValue(k, out var list)) jumps[k] = list = []; list.AddRange(to); } }
        foreach (var l in links)
        {
            var from = Near(l.From.X, l.From.Y, l.From.Z, Math.Max(l.Radius, r.res), 150, 150);
            var to = Near(l.To.X, l.To.Y, l.To.Z, Math.Max(l.Radius, r.res), 150, 150);
            Join(from, to);
            if (l.BothWays) Join(to, from);
        }
        // Steep enough for the steepest walkable ramp from one pixel to the next, far short of a storey.
        float climb = (float)(r.res * 1.2 + 60);
        while (queue.Count > 0)
        {
            int k = queue.Dequeue(), i = owner[k], x = i % w, y = i / w, d = dist[k] + 1;
            void Visit(int j) { for (int m = s.start[j]; m < s.start[j + 1]; m++) if (Math.Abs(s.z[m] - s.z[k]) <= climb) Reach(m, d); }
            if (x > 0) Visit(i - 1);
            if (x < w - 1) Visit(i + 1);
            if (y > 0) Visit(i - w);
            if (y < h - 1) Visit(i + w);
            if (jumps.TryGetValue(k, out var targets)) foreach (var m in targets) Reach(m, d);
        }
        // Some dungeons leak: through a gap in the rock their navmesh runs out onto the outside of the shell
        // or a backdrop plane, far from anything. Such an area hangs off the dungeon by a narrow neck, whereas
        // an arena larger than its actors' spread meets them along a broad front. Drop the former.
        int far = (int)(MaxRoam / r.res), near = (int)(RoamNear / r.res);
        var keep = new bool[s.z.Length];
        for (int k = 0; k < keep.Length; k++) keep[k] = dist[k] >= 0;
        var area = new int[s.z.Length];
        Array.Fill(area, -1);
        var stack = new Stack<int>();
        var members = new List<int>();
        int dropped = 0;
        for (int seed = 0; seed < keep.Length; seed++)
        {
            if (dist[seed] <= far || area[seed] >= 0) continue;
            members.Clear(); area[seed] = seed; stack.Push(seed);
            int contact = 0;
            while (stack.Count > 0)
            {
                int k = stack.Pop(), i = owner[k], x = i % w, y = i / w;
                members.Add(k);
                bool touches = false;
                void Spread(int j)
                {
                    for (int m = s.start[j]; m < s.start[j + 1]; m++)
                    {
                        if (Math.Abs(s.z[m] - s.z[k]) > climb || dist[m] < 0) continue;
                        if (dist[m] <= near) touches = true;
                        else if (area[m] < 0) { area[m] = seed; stack.Push(m); }
                    }
                }
                if (x > 0) Spread(i - 1);
                if (x < w - 1) Spread(i + 1);
                if (y > 0) Spread(i - w);
                if (y < h - 1) Spread(i + w);
                if (touches) contact++;
            }
            if (contact * r.res > MaxContact) continue;
            foreach (var k in members) keep[k] = false;
            dropped += members.Count;
        }
        if (dropped > 0) Console.Error.WriteLine($"..  {r.id}: dropped {dropped * r.res * r.res / 1e4:0} m2 of floor beyond a narrow neck, out of reach of every actor");
        return keep;
    }

    const double LevelBin = 50;      // height resolution when finding storeys
    const double StoreyHeight = 350; // floors closer than this belong to one storey (stairs, slopes, steps)

    // The kept floor as storeys: height bands around the peaks of floor area, put back together unless they
    // really lie on top of each other, so a level is everything you can see without a floor in the way.
    static List<Sheet> Storeys(Region r, Spans s, bool[] keep)
    {
        float zMin = float.PositiveInfinity, zMax = float.NegativeInfinity;
        for (int k = 0; k < keep.Length; k++) if (keep[k]) { zMin = Math.Min(zMin, s.z[k]); zMax = Math.Max(zMax, s.z[k]); }
        if (zMin > zMax) return [];
        var hist = new double[(int)Math.Ceiling((zMax - zMin) / LevelBin) + 1];
        for (int k = 0; k < keep.Length; k++) if (keep[k]) hist[(int)((s.z[k] - zMin) / LevelBin)]++;
        var levels = new List<Sheet>();
        foreach (var (lo, hi) in Levels(hist, zMin, zMax))
        {
            var sheet = new Sheet { walk = new bool[r.w * r.h], height = new float[r.w * r.h] };
            Array.Fill(sheet.height, float.PositiveInfinity);
            for (int i = 0; i < r.w * r.h; i++)
                for (int k = s.start[i]; k < s.start[i + 1]; k++)
                    if (keep[k] && s.z[k] >= lo && s.z[k] < hi) { sheet.walk[i] = true; sheet.height[i] = s.z[k]; break; }
            if (sheet.Count() > 0) levels.Add(sheet);
        }
        // Height bands slice a sloping dungeon into pieces; join every piece that does not overlap a level.
        var joined = new List<Sheet>();
        foreach (var sheet in levels)
        {
            var home = joined.FirstOrDefault(l => l.Overlap(sheet) < 0.15);
            if (home != null) home.Add(sheet); else joined.Add(sheet);
        }
        return joined.OrderBy(l => l.MeanHeight()).ToList();
    }

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

    // The navmesh keeps an agent's radius away from every wall: grow it back out to the real floor edge, and
    // fill the pinholes small props (crates, rubble, braziers) punch in it. Pillars and larger holes stay.
    static void Tidy(Region r, Sheet sheet)
    {
        int w = r.w, h = r.h;
        float grow = (float)((AgentRadius - r.res / 2) / r.res); // the conservative fill already reaches half a pixel out
        if (grow >= 0.5f)
        {
            var d = DistanceTo(sheet.walk, w, h);
            for (int i = 0; i < d.Length; i++) if (d[i] <= grow) sheet.walk[i] = true;
        }
        FlipSmall(sheet.walk, w, h, false, (int)Math.Max(4, 6000 / (r.res * r.res)));
        // New floor borrows the height next to it.
        for (int pass = 0; pass < 8; pass++)
        {
            bool open = false;
            for (int i = 0; i < sheet.walk.Length; i++)
            {
                if (!sheet.walk[i] || !float.IsPositiveInfinity(sheet.height[i])) continue;
                int x = i % w, y = i / w;
                foreach (var j in new[] { x > 0 ? i - 1 : i, x < w - 1 ? i + 1 : i, y > 0 ? i - w : i, y < h - 1 ? i + w : i })
                    if (!float.IsPositiveInfinity(sheet.height[j])) { sheet.height[i] = sheet.height[j]; break; }
                open |= float.IsPositiveInfinity(sheet.height[i]);
            }
            if (!open) break;
        }
        // At a ledge the navmesh stops short both above and below the drop. Close a gap that narrow between
        // floors at different heights (or a one-pixel seam anywhere), so the drop reads as one edge rather
        // than a double wall. Walls between rooms on one floor leave a wider gap, and stay.
        int gap = Math.Max(1, (int)Math.Round(45 / r.res));
        float climb = (float)(r.res * 1.2 + 60);
        var bridges = new List<(int i, float z)>();
        foreach (var (dx, dy) in new[] { (1, 0), (0, 1) })
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int a = y * w + x;
                    if (!sheet.walk[a]) continue;
                    int s = 1;
                    while (s <= gap + 1 && x + dx * s < w && y + dy * s < h && !sheet.walk[(y + dy * s) * w + x + dx * s]) s++;
                    if (s < 2 || s > gap + 1 || x + dx * s >= w || y + dy * s >= h) continue;
                    int b = (y + dy * s) * w + x + dx * s;
                    if (s > 2 && Math.Abs(sheet.height[a] - sheet.height[b]) <= climb) continue;
                    float top = Math.Max(sheet.height[a], sheet.height[b]);
                    for (int t = 1; t < s; t++) bridges.Add(((y + dy * t) * w + x + dx * t, top));
                }
        foreach (var (i, z) in bridges)
            if (!sheet.walk[i] || z > sheet.height[i]) { sheet.walk[i] = true; sheet.height[i] = z; }
    }

    // One level of a dungeon on the region's pixel grid: where you can walk, and the floor height there.
    sealed class Sheet
    {
        public bool[] walk = [];
        public float[] height = [];
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
        }
        public double MeanHeight()
        {
            double s = 0; int n = 0;
            for (int i = 0; i < walk.Length; i++) if (walk[i] && float.IsFinite(height[i])) { s += height[i]; n++; }
            return n == 0 ? 0 : s / n;
        }
    }

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

    public static void Test()
    {
        static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
        // A rectangle of navmesh; with z0 != z1 a ramp climbing along X.
        static NavTri[] Quad(double x0, double y0, double x1, double y1, double z0, double z1) =>
            [new(new FVector(x0, y0, z0), new FVector(x1, y0, z1), new FVector(x1, y1, z1)), new(new FVector(x0, y0, z0), new FVector(x1, y1, z1), new FVector(x0, y1, z0))];
        var r = new Region { id = "T", maxX = 1600, maxY = 640, minZ = -1000, maxZ = 2000, res = 20, w = 80, h = 32 };

        var thin = Rasterize(r, [.. Quad(100, 312, 1500, 318, 0, 0)]);
        Check(Enumerable.Range(6, 68).All(x => thin.start[15 * r.w + x + 1] > thin.start[15 * r.w + x]), "A corridor narrower than a pixel must cover every pixel along it");

        // Floor with an actor on it, a ramp up to a gallery beside it, a roof over everything, a ledge reached
        // by a one-way drop from the gallery, and a platform whose only link leads away from it.
        var tris = new List<NavTri>();
        tris.AddRange(Quad(0, 0, 400, 640, 0, 0));
        tris.AddRange(Quad(400, 200, 800, 440, 0, 300));
        tris.AddRange(Quad(800, 0, 1200, 640, 300, 300));
        tris.AddRange(Quad(0, 0, 1200, 640, 900, 900));
        tris.AddRange(Quad(1300, 0, 1600, 300, -200, -200));
        tris.AddRange(Quad(1300, 400, 1600, 640, 0, 0));
        r.points = [[200, 300, 40]];
        var spans = Rasterize(r, tris);
        var keep = Reachable(r, spans, [new NavLink(new FVector(1150, 150, 300), new FVector(1400, 150, -200), 50, false),
            new NavLink(new FVector(1400, 500, 0), new FVector(300, 500, 0), 50, false)]);
        bool Kept(double x, double y, double z)
        {
            int i = (int)(y / r.res) * r.w + (int)(x / r.res);
            for (int k = spans.start[i]; k < spans.start[i + 1]; k++) if (Math.Abs(spans.z[k] - z) < 60) return keep[k];
            return false;
        }
        Check(Kept(200, 300, 0) && Kept(600, 320, 150) && Kept(1000, 300, 300), "Floor, ramp and gallery must stay connected");
        Check(!Kept(200, 300, 900), "A roof over occupied floor must not be kept");
        Check(Kept(1450, 150, -200), "A ledge reached by a navmesh drop must be kept");
        Check(!Kept(1450, 500, 0), "A link leading away from a platform must not make it reachable");
        var levels = Storeys(r, spans, keep);
        Check(levels.Count == 1, $"A ramp between side-by-side floors must stay one level, not {levels.Count}");

        // A backdrop plane running off from a room is dropped back to near the actors; a long hall is not.
        var plain = new Region { id = "P", maxX = 10000, maxY = 1000, minZ = -1000, maxZ = 1000, res = 100, w = 100, h = 10, points = [[100, 500, 20]] };
        var plane = Rasterize(plain, [.. Quad(0, 0, 10000, 1000, 0, 0)]);
        var planeKeep = Reachable(plain, plane, []);
        Check(planeKeep[plane.start[5 * 100 + 5]] && !planeKeep[plane.start[5 * 100 + 20]] && !planeKeep[plane.start[5 * 100 + 90]],
            "Floor far beyond every actor, and its approach, must be dropped");
        var hallway = Rasterize(plain, [.. Quad(0, 0, 3500, 1000, 0, 0)]);
        var hallwayKeep = Reachable(plain, hallway, []);
        Check(hallwayKeep[hallway.start[5 * 100 + 34]], "A long hall within reach of an actor must be kept whole");
        var arena = new Region { id = "A", maxX = 10000, maxY = 3000, minZ = -1000, maxZ = 1000, res = 100, w = 100, h = 30, points = [[100, 1500, 20]] };
        var floor = Rasterize(arena, [.. Quad(0, 0, 10000, 3000, 0, 0)]);
        Check(Reachable(arena, floor, [])[floor.start[15 * 100 + 90]], "An arena wider than its actors' spread must be kept whole");

        // Navmesh over invisible collision: a wide, dead-flat stretch that no mesh shows. Bumpy ground stays.
        var u = new Region { id = "U", maxX = 2000, maxY = 1000, minZ = -1000, maxZ = 1000, res = 20, w = 100, h = 50 };
        var collision = Rasterize(u, [.. Quad(0, 0, 2000, 1000, 0, 0)]);
        var hidden = Unseen(u, collision, Rasterize(u, [.. Quad(0, 0, 800, 1000, 2, 2)]));
        Check(!hidden[collision.start[25 * 100 + 20]] && hidden[collision.start[25 * 100 + 80]], "A wide flat stretch of navmesh no mesh shows must count as collision");
        var terrain = Rasterize(u, [.. Quad(0, 0, 2000, 1000, 0, 400)]);
        Check(!Unseen(u, terrain, Rasterize(u, [])).Any(v => v), "Bumpy ground without meshes must stay floor");

        // A mezzanine over half a hall, with a ramp down from its edge: two levels, lowest first.
        var hall = new Region { id = "H", maxX = 800, maxY = 640, minZ = -1000, maxZ = 2000, res = 20, w = 40, h = 32, points = [[600, 100, 20]] };
        var stacked = new List<NavTri>();
        stacked.AddRange(Quad(0, 0, 800, 640, 0, 0));
        stacked.AddRange(Quad(0, 0, 400, 640, 600, 600));
        stacked.AddRange(Quad(400, 440, 800, 640, 600, 0));
        var hallSpans = Rasterize(hall, stacked);
        var storeys = Storeys(hall, hallSpans, Reachable(hall, hallSpans, []));
        Check(storeys.Count == 2 && storeys[0].MeanHeight() < storeys[1].MeanHeight(), $"A mezzanine over a hall must be its own, upper level ({storeys.Count})");

        // Tidy grows the navmesh back to the walls and fills prop pinholes, but keeps a pillar.
        var sheet = new Sheet { walk = new bool[40 * 32], height = new float[40 * 32] };
        Array.Fill(sheet.height, float.PositiveInfinity);
        for (int y = 4; y < 28; y++) for (int x = 4; x < 36; x++) if (!(x == 10 && y == 10) && !(x >= 20 && x < 28 && y >= 12 && y < 20))
            { sheet.walk[y * 40 + x] = true; sheet.height[y * 40 + x] = 0; }
        Tidy(hall, sheet);
        Check(sheet.walk[3 * 40 + 20] && float.IsFinite(sheet.height[3 * 40 + 20]), "Floor must grow back by the agent radius, with a height");
        Check(sheet.walk[10 * 40 + 10], "A prop pinhole must be filled");
        Check(!sheet.walk[16 * 40 + 24], "A pillar must stay a hole");
        Sheet Sides(int gapPx, float right)
        {
            var two = new Sheet { walk = new bool[40 * 32], height = new float[40 * 32] };
            Array.Fill(two.height, float.PositiveInfinity);
            for (int y = 4; y < 28; y++) for (int x = 4; x < 36; x++) if (x < 16 || x >= 16 + gapPx)
                { two.walk[y * 40 + x] = true; two.height[y * 40 + x] = x < 16 ? 0 : right; }
            Tidy(hall, two);
            return two;
        }
        var ledge = Sides(3, 200);
        Check(Enumerable.Range(4, 32).All(x => ledge.walk[15 * 40 + x]), "The navmesh gap at a ledge must close into one edge");
        Check(!Sides(4, 0).walk[15 * 40 + 17], "A wall between rooms on one floor must not be bridged");

        var rooms = new Floor(new bool[96 * 64], new float[96 * 64]);
        for (int y = 12; y < 42; y++) for (int x = 8; x < 32; x++) rooms.Walk[y * 96 + x] = true;
        for (int y = 12; y < 42; y++) for (int x = 62; x < 86; x++) rooms.Walk[y * 96 + x] = true;
        for (int x = 31; x <= 62; x++) rooms.Walk[27 * 96 + x] = true;
        using var drawn = DrawPlan(96, 64, 20, 0, 0, [rooms], [], null);
        var fill = drawn.GetPixel(20, 22);
        Check(fill.Red > 200 && fill.Green > 190 && fill.Blue > 150, "Floor must be drawn in the light floor tone");
        var rock = drawn.GetPixel(48, 4);
        Check(rock.Red + rock.Green + rock.Blue < fill.Red + fill.Green + fill.Blue - 60, "Rock must be darker than the floor");
        using var corridor = Outline(rooms.Walk, 96, 64, 20);
        Check(corridor.Contains(46.5f, 27.5f), "The outline must keep a one-pixel corridor between rooms");
        Console.WriteLine("Floorplan tests passed: sub-pixel corridors, reachability, roofs, navmesh links, storeys, tidying, drawing");
    }

    const int HeightCell = 10; // pixels per cell of the coarse height grid the app uses to tell levels apart

    // Writes every level, and with several levels an overview of all of them, on parchment. All images of a
    // dungeon share one frame (the bounds of every level plus paper), so switching levels keeps your place.
    static List<object> SaveAll(Region r, List<Sheet> levels, string outDir)
    {
        int minPx = r.w, minPy = r.h, maxPx = 0, maxPy = 0;
        foreach (var s in levels)
            for (int i = 0; i < s.walk.Length; i++)
                if (s.walk[i]) { int x = i % r.w, y = i / r.w; minPx = Math.Min(minPx, x); maxPx = Math.Max(maxPx, x); minPy = Math.Min(minPy, y); maxPy = Math.Max(maxPy, y); }
        minPx -= Margin; minPy -= Margin; maxPx += Margin; maxPy += Margin;
        int w = maxPx - minPx + 1, h = maxPy - minPy + 1;
        double originX = r.minX + minPx * r.res, originY = r.minY + minPy * r.res;
        var floors = levels.Select(s =>
        {
            var f = new Floor(new bool[w * h], new float[w * h]);
            Array.Fill(f.Height, float.PositiveInfinity);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int gx = x + minPx, gy = y + minPy;
                    if (gx < 0 || gy < 0 || gx >= r.w || gy >= r.h || !s.walk[gy * r.w + gx]) continue;
                    f.Walk[y * w + x] = true; f.Height[y * w + x] = s.height[gy * r.w + gx];
                }
            return f;
        }).ToList();
        // Floor running off the edge of the region was cut there, not walled: the map fades out instead.
        var cut = new bool[w * h];
        bool anyCut = false;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int gx = x + minPx, gy = y + minPy;
                if (gx < 0 || gy < 0 || gx >= r.w || gy >= r.h || (gx > 0 && gy > 0 && gx < r.w - 1 && gy < r.h - 1)) continue;
                if (floors.Any(f => f.Walk[y * w + x])) cut[y * w + x] = anyCut = true;
            }
        void Write(List<Floor> active, List<Floor> context, string name)
        {
            using var plan = DrawPlan(w, h, r.res, originX, originY, active, context, anyCut ? cut : null);
            using var img = SKImage.FromBitmap(plan);
            using var png = img.Encode(SKEncodedImageFormat.Png, 100);
            File.WriteAllBytes(Path.Combine(outDir, name + ".png"), png.ToArray());
        }
        var frames = new List<object>();
        for (int l = 0; l < floors.Count; l++)
        {
            string name = floors.Count > 1 ? $"{r.id}-{l + 1}" : r.id;
            Write([floors[l]], floors.Where((_, k) => k != l).ToList(), name);
            var f = floors[l];
            // Coarse floor heights (cm, null = no floor) so the app can tell which level the player and markers are on.
            int gw = (w + HeightCell - 1) / HeightCell, gh = (h + HeightCell - 1) / HeightCell;
            var grid = new int?[gw * gh];
            float zLo = float.PositiveInfinity, zHi = float.NegativeInfinity;
            for (int cy = 0; cy < gh; cy++)
                for (int cx = 0; cx < gw; cx++)
                {
                    double sum = 0; int n = 0;
                    for (int y = cy * HeightCell; y < Math.Min(h, (cy + 1) * HeightCell); y++)
                        for (int x = cx * HeightCell; x < Math.Min(w, (cx + 1) * HeightCell); x++)
                        {
                            float z = f.Height[y * w + x];
                            if (!f.Walk[y * w + x] || float.IsPositiveInfinity(z)) continue;
                            sum += z; n++; zLo = Math.Min(zLo, z); zHi = Math.Max(zHi, z);
                        }
                    if (n > 0) grid[cy * gw + cx] = (int)Math.Round(sum / n);
                }
            Console.Error.WriteLine($"OK  {name} {w}x{h} @ {r.res:0.#} cm/px, floor {zLo:0}..{zHi:0}");
            frames.Add(new { r.id, level = l, image = name + ".png", minX = originX, minY = originY, res = r.res, w, h,
                overview = floors.Count > 1 ? r.id + "-all.png" : null,
                zLo, zHi, heights = new { cell = HeightCell, w = gw, h = gh, z = grid } });
        }
        if (floors.Count > 1) Write(floors, [], r.id + "-all");
        return frames;
    }
}
