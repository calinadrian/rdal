// Navigation-first rendering, kept separate from the extracted floor geometry.
using System.IO.Compression;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SkiaSharp;

public static partial class Floorplan
{
    // Cache exact masks/heights so visual revisions never require another game scan.
    static void SaveLayout(Region r, List<Sheet> levels, string outDir)
    {
        var dir = Path.Combine(outDir, "layouts");
        Directory.CreateDirectory(dir);
        using var file = File.Create(Path.Combine(dir, r.id + ".bin.gz"));
        using var zip = new GZipStream(file, CompressionLevel.Fastest);
        using var writer = new BinaryWriter(zip);
        writer.Write("DWAL-layout-2"); writer.Write(r.id);
        writer.Write(r.minX); writer.Write(r.minY); writer.Write(r.res); writer.Write(r.w); writer.Write(r.h);
        writer.Write(levels.Count);
        foreach (var sheet in levels)
        {
            writer.Write(sheet.Count());
            for (int i = 0; i < sheet.walk.Length; i++)
                if (sheet.walk[i]) { writer.Write(i); writer.Write(sheet.height[i]); writer.Write(sheet.stairs?[i] == true); }
        }
    }

    public static void Restyle(string inputDir, string outDir)
    {
        Directory.CreateDirectory(outDir);
        var frames = new List<object>();
        foreach (var name in Directory.GetFiles(Path.Combine(inputDir, "layouts"), "*.bin.gz").Order())
        {
            using var file = File.OpenRead(name);
            using var zip = new GZipStream(file, CompressionMode.Decompress);
            using var reader = new BinaryReader(zip);
            // Version 2 adds a stair flag per pixel; version 1 caches predate stairs.
            var format = reader.ReadString();
            if (format is not ("DWAL-layout-1" or "DWAL-layout-2")) throw new Exception("Unsupported layout cache");
            bool hasStairs = format == "DWAL-layout-2";
            var r = new Region { id = reader.ReadString(), minX = reader.ReadDouble(), minY = reader.ReadDouble(), res = reader.ReadDouble(), w = reader.ReadInt32(), h = reader.ReadInt32() };
            var levels = new List<Sheet>();
            int count = reader.ReadInt32();
            for (int l = 0; l < count; l++)
            {
                var s = new Sheet { walk = new bool[r.w * r.h], height = new float[r.w * r.h], stairs = hasStairs ? new bool[r.w * r.h] : null };
                Array.Fill(s.height, float.PositiveInfinity);
                int pixels = reader.ReadInt32();
                for (int p = 0; p < pixels; p++)
                {
                    int i = reader.ReadInt32(); s.walk[i] = true; s.height[i] = reader.ReadSingle();
                    if (hasStairs) s.stairs![i] = reader.ReadBoolean();
                }
                levels.Add(s);
            }
            for (int l = 0; l < count; l++) frames.Add(Save(r, levels, l, outDir, count > 1 ? $"{r.id}-{l + 1}" : r.id));
            if (count > 1) Save(r, levels, -1, outDir, r.id + "-all");
        }
        if (frames.Count == 0) throw new Exception("No cached dungeon layouts found");
        File.WriteAllText(Path.Combine(outDir, "floorplans.json"), JsonConvert.SerializeObject(frames));
    }

    // Cosmetic cleanup cannot invent shortcuts or sever a corridor. If rounding splits a
    // retained component, that component uses its exact source silhouette instead.
    static bool[] DisplayMask(bool[] original, int w, int h, int minArea)
    {
        var result = new bool[original.Length];
        var rounded = Smooth(original, w, h, 1);
        // A one-pixel tread or bridge can be essential even when an alternative route exists.
        for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++)
        {
            int i = y * w + x;
            if (!original[i]) continue;
            int neighbours = (original[i - 1] ? 1 : 0) + (original[i + 1] ? 1 : 0)
                + (original[i - w] ? 1 : 0) + (original[i + w] ? 1 : 0);
            if (neighbours <= 2) rounded[i] = true;
        }
        var seen = new bool[original.Length];
        var tested = new bool[original.Length];
        var stack = new Stack<int>();
        var component = new List<int>();
        for (int start = 0; start < original.Length; start++)
        {
            if (!original[start] || seen[start]) continue;
            component.Clear(); stack.Push(start); seen[start] = true;
            while (stack.Count > 0)
            {
                int i = stack.Pop(), x = i % w, y = i / w; component.Add(i);
                void Visit(int j) { if (original[j] && !seen[j]) { seen[j] = true; stack.Push(j); } }
                if (x > 0) Visit(i - 1); if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w); if (y < h - 1) Visit(i + w);
            }
            if (component.Count < minArea) continue;
            int first = component.Find(i => rounded[i]), remaining = component.Count(i => rounded[i]);
            int reached = 0;
            if (remaining > 0)
            {
                stack.Push(first); tested[first] = true;
                while (stack.Count > 0)
                {
                    int i = stack.Pop(), x = i % w, y = i / w; reached++;
                    void Visit(int j) { if (original[j] && rounded[j] && !tested[j]) { tested[j] = true; stack.Push(j); } }
                    if (x > 0) Visit(i - 1); if (x < w - 1) Visit(i + 1);
                    if (y > 0) Visit(i - w); if (y < h - 1) Visit(i + w);
                }
            }
            bool safe = remaining > 0 && reached == remaining;
            foreach (var i in component) result[i] = !safe || rounded[i];
        }
        return result;
    }

    // Trace the actual floor perimeter, including holes, rather than shading every pixel edge.
    // Clockwise turns keep diagonally touching islands separate at ambiguous corners.
    static SKPath Outline(bool[] mask, int w, int h, double res = 20)
    {
        int stride = w + 1;
        var edges = new Dictionary<int, List<int>>();
        void Edge(int a, int b) { if (!edges.TryGetValue(a, out var next)) edges[a] = next = []; next.Add(b); }
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
        {
            int i = y * w + x, v = y * stride + x;
            if (!mask[i]) continue;
            if (y == 0 || !mask[i - w]) Edge(v, v + 1);
            if (x == w - 1 || !mask[i + 1]) Edge(v + 1, v + stride + 1);
            if (y == h - 1 || !mask[i + w]) Edge(v + stride + 1, v + stride);
            if (x == 0 || !mask[i - 1]) Edge(v + stride, v);
        }
        var path = new SKPath { FillType = SKPathFillType.EvenOdd };
        var clearance = DistanceTo(Not(mask), w, h);
        static int Direction(int a, int b, int stride) => b == a + 1 ? 0 : b == a + stride ? 1 : b == a - 1 ? 2 : 3;
        foreach (int start in edges.Keys)
        {
            var available = edges[start];
            while (available.Count > 0)
            {
                int current = start, direction = Direction(start, available[0], stride), lastDirection = -1;
                var contour = new List<SKPoint> { new(start % stride, start / stride) };
                do
                {
                    var next = edges[current];
                    int chosen = 0, rank = 10;
                    for (int k = 0; k < next.Count; k++)
                    {
                        int turn = (Direction(current, next[k], stride) - direction + 4) % 4;
                        int priority = turn == 1 ? 0 : turn == 0 ? 1 : turn == 3 ? 2 : 3;
                        if (priority < rank) { rank = priority; chosen = k; }
                    }
                    int end = next[chosen]; next.RemoveAt(chosen);
                    direction = Direction(current, end, stride);
                    if (direction != lastDirection && current != start) contour.Add(new SKPoint(current % stride, current / stride));
                    lastDirection = direction; current = end;
                } while (current != start);
                AddContour(path, contour, clearance, w, h, res);
            }
        }
        return path;
    }

    // Broad floor cores define rooms. Reconstruct paths between those cores through the
    // source floor, keeping thin corridors while discarding one-ended mesh slivers.
    static bool[] CartographicMask(bool[] source, int w, int h, double res, List<SKPoint>? anchors = null)
    {
        float radius = (float)Math.Clamp(70 / res, 1.5, 4);
        var deep = Where(DistanceTo(Not(source), w, h), d => d > radius);
        var distance = DistanceTo(deep, w, h);
        var result = new bool[source.Length];
        for (int i = 0; i < result.Length; i++) result[i] = source[i] && distance[i] <= radius;
        // Preserve a useful dead end even when it is narrower than a room core. Snap only
        // onto existing floor; a marker can never create a bridge over missing geometry.
        foreach (var pin in anchors ?? [])
        {
            int px = (int)pin.X, py = (int)pin.Y, reach = Math.Max(2, (int)Math.Ceiling(120 / res));
            int best = -1; double gap = double.MaxValue;
            for (int dy = -reach; dy <= reach; dy++) for (int dx = -reach; dx <= reach; dx++)
            {
                int x = px + dx, y = py + dy;
                if (x < 0 || y < 0 || x >= w || y >= h || !source[y * w + x]) continue;
                double d = dx * dx + dy * dy;
                if (d < gap) { best = y * w + x; gap = d; }
            }
            if (best >= 0 && distance[best] > radius + 100 / res) result[best] = true;
        }
        var owner = new int[source.Length]; Array.Fill(owner, -1);
        var previous = new int[source.Length]; Array.Fill(previous, -1);
        var origin = new int[source.Length];
        var queue = new Queue<int>();
        var frontier = new List<int>();
        int group = 0;
        for (int start = 0; start < result.Length; start++)
        {
            if (!result[start] || owner[start] >= 0) continue;
            owner[start] = group; queue.Enqueue(start);
            while (queue.Count > 0)
            {
                int i = queue.Dequeue(), x = i % w, y = i / w; bool boundary = false;
                void Visit(int j)
                {
                    if (result[j] && owner[j] < 0) { owner[j] = group; queue.Enqueue(j); }
                    else if (source[j] && !result[j]) boundary = true;
                }
                if (x > 0) Visit(i - 1); if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w); if (y < h - 1) Visit(i + w);
                if (boundary) { frontier.Add(i); origin[i] = i; }
            }
            group++;
        }
        foreach (int i in frontier) queue.Enqueue(i);
        var routes = new bool[source.Length];
        void Trace(int i)
        {
            while (previous[i] >= 0 && !routes[i]) { routes[i] = true; i = previous[i]; }
        }
        while (queue.Count > 0)
        {
            int i = queue.Dequeue(), x = i % w, y = i / w;
            void Visit(int j)
            {
                if (!source[j]) return;
                if (owner[j] < 0)
                {
                    owner[j] = owner[i]; previous[j] = i; origin[j] = origin[i]; queue.Enqueue(j);
                }
                else if (!result[j] && origin[j] != origin[i])
                {
                    int a = origin[i], b = origin[j];
                    double spread = Math.Abs(a % w - b % w) + Math.Abs(a / w - b / w);
                    // Distinct rooms, or a long bypass returning to the same room: retain both
                    // paths, rather than reducing the floor to a minimum spanning tree.
                    if (owner[i] != owner[j] || spread > radius * 4)
                    { Trace(i); Trace(j); }
                }
            }
            if (x > 0) Visit(i - 1); if (x < w - 1) Visit(i + 1);
            if (y > 0) Visit(i - w); if (y < h - 1) Visit(i + w);
        }
        var nearRoute = DistanceTo(routes, w, h);
        float width = (float)Math.Clamp(45 / res, 1, 3);
        for (int i = 0; i < result.Length; i++) result[i] |= source[i] && nearRoute[i] <= width;
        return result;
    }

    static readonly Lazy<Dictionary<string, List<(double x, double y)>>> MapAnchors = new(() =>
    {
        var pins = new Dictionary<string, List<(double, double)>>();
        string database = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "data", "db.json"));
        if (!File.Exists(database)) return pins;
        var markers = JObject.Parse(File.ReadAllText(database))["map"]?["markers"];
        if (markers == null) return pins;
        var useful = new HashSet<string> { "chest", "travel", "quest", "npc", "monster", "shrine", "lore", "agility" };
        foreach (var m in markers)
        {
            string? id = (string?)m["d"], category = (string?)m["c"];
            if (id == null || category == null || !useful.Contains(category)) continue;
            if (!pins.TryGetValue(id, out var list)) pins[id] = list = [];
            list.Add(((double)m["x"]!, (double)m["y"]!));
        }
        return pins;
    });

    static List<SKPoint> Pins(string id, double minX, double minY, double res) =>
        MapAnchors.Value.TryGetValue(id, out var pins)
            ? pins.Select(p => new SKPoint((float)((p.x - minX) / res), (float)((p.y - minY) / res))).ToList() : [];

    static void AddContour(SKPath path, List<SKPoint> points, float[] clearance, int w, int h, double res)
    {
        static SKPoint Times(SKPoint p, float k) => new(p.X * k, p.Y * k);
        if (points.Count < 3) return;
        float tolerance = (float)Math.Clamp(65 / res, 1.3, 3.5);
        var limits = new float[points.Count];
        int reach = Math.Max(2, (int)Math.Ceiling(110 / res));
        for (int i = 0; i < points.Count; i++)
        {
            int x = (int)points[i].X, y = (int)points[i].Y;
            float thick = 0;
            for (int dy = -reach; dy <= reach; dy += 2) for (int dx = -reach; dx <= reach; dx += 2)
                if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h)
                    thick = Math.Max(thick, clearance[(y + dy) * w + x + dx]);
            // Keep tight stair treads/bridges precise; broad rooms can lose mesh-sized nicks.
            limits[i] = thick < 2.5f ? 0.4f : tolerance;
        }
        // Split a closed contour into two open arcs before simplifying it.
        int split = 1; float farthest = 0;
        for (int i = 1; i < points.Count; i++)
        {
            float d = (points[i] - points[0]).LengthSquared;
            if (d > farthest) { farthest = d; split = i; }
        }
        var keep = new bool[points.Count]; keep[0] = keep[split] = true;
        var stack = new Stack<(int a, int b)>();
        stack.Push((0, split)); stack.Push((split, points.Count));
        while (stack.Count > 0)
        {
            var (a, b) = stack.Pop();
            var p = points[a % points.Count]; var q = points[b % points.Count];
            var edge = q - p; float length = edge.LengthSquared;
            int best = -1; float worst = 1;
            for (int i = a + 1; i < b; i++)
            {
                var v = points[i % points.Count] - p;
                float t = length > 0 ? Math.Clamp((v.X * edge.X + v.Y * edge.Y) / length, 0, 1) : 0;
                float gap = (v - Times(edge, t)).Length / limits[i % points.Count];
                if (gap > worst) { worst = gap; best = i; }
            }
            if (best < 0) continue;
            keep[best % points.Count] = true;
            stack.Push((a, best)); stack.Push((best, b));
        }
        var selected = new List<(SKPoint p, float limit)>();
        for (int i = 0; i < points.Count; i++) if (keep[i]) selected.Add((points[i], limits[i]));
        if (selected.Count < 3) return;
        // Short quadratic corners remove pixel staircases without turning rectangular rooms into blobs.
        for (int i = 0; i < selected.Count; i++)
        {
            var (p, limit) = selected[i];
            var prev = selected[(i + selected.Count - 1) % selected.Count].p;
            var next = selected[(i + 1) % selected.Count].p;
            float a = (prev - p).Length, b = (next - p).Length;
            float round = Math.Min(Math.Min(a, b) * 0.18f, limit * 0.7f);
            var before = a > 0 ? p + Times(prev - p, round / a) : p;
            var after = b > 0 ? p + Times(next - p, round / b) : p;
            if (i == 0) path.MoveTo(before); else path.LineTo(before);
            path.QuadTo(p, after);
        }
        path.Close();
    }

    static readonly Lazy<SKBitmap> PaperTexture = new(() =>
    {
        const int size = 512;
        var bitmap = new SKBitmap(size, size, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        var pixels = new SKColor[size * size];
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
        {
            uint seed = unchecked((uint)(x * 374761393 + y * 668265263));
            seed = unchecked((seed ^ (seed >> 13)) * 1274126177);
            float fine = (seed & 255) / 255f;
            float broad = Noise(x, y);
            float value = (broad - 0.5f) * 22 + (fine - 0.5f) * 12;
            pixels[y * size + x] = new SKColor((byte)(185 + value), (byte)(150 + value), (byte)(94 + value));
        }
        bitmap.Pixels = pixels;
        return bitmap;
    });

    const float TreadRise = 60; // one tread line per this much climb (about every second step)

    static SKBitmap DrawPlan(bool[] walk, bool[] context, int w, int h, double res, List<SKPoint>? pins = null, float[]? treads = null)
    {
        // Eight square metres: remove detached debris, never a narrow route attached to a room.
        int minArea = Math.Max(24, (int)Math.Round(80000 / (res * res)));
        var other = CartographicMask(DisplayMask(context, w, h, minArea), w, h, res, pins);
        var active = new bool[walk.Length];
        for (int i = 0; i < active.Length; i++) active[i] = walk[i] && other[i];
        using var activePath = Outline(active, w, h, res);
        using var otherPath = Outline(other, w, h, res);
        var bmp = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var canvas = new SKCanvas(bmp);
        using var paper = SKShader.CreateBitmap(PaperTexture.Value, SKShaderTileMode.Mirror, SKShaderTileMode.Mirror);
        using var paint = new SKPaint { IsAntialias = true, Shader = paper };
        canvas.DrawRect(0, 0, w, h, paint);
        paint.Shader = null;
        using var vignette = SKShader.CreateRadialGradient(new SKPoint(w * 0.5f, h * 0.45f), Math.Max(w, h) * 0.7f,
            [new SKColor(72, 43, 14, 0), new SKColor(72, 43, 14, 0), new SKColor(72, 43, 14, 115)], [0, 0.55f, 1], SKShaderTileMode.Clamp);
        paint.Shader = vignette; canvas.DrawRect(0, 0, w, h, paint); paint.Shader = null;
        paint.Color = new SKColor(143, 115, 68, 130);
        canvas.DrawPath(otherPath, paint);
        // Offset depth, then a broad wall rim and a fine, continuous inner ink line.
        paint.Style = SKPaintStyle.Stroke; paint.StrokeJoin = SKStrokeJoin.Round; paint.StrokeWidth = 10;
        using var blur = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 3);
        paint.MaskFilter = blur; paint.Color = new SKColor(48, 29, 10, 125);
        canvas.Save(); canvas.Translate(1.5f, 3); canvas.DrawPath(activePath, paint); canvas.Restore();
        paint.MaskFilter = null; paint.StrokeWidth = 7; paint.Color = new SKColor(133, 103, 58);
        canvas.DrawPath(activePath, paint);
        paint.StrokeWidth = 3.8f; paint.Color = new SKColor(160, 131, 79);
        canvas.DrawPath(activePath, paint);
        paint.Style = SKPaintStyle.Fill; paint.Color = new SKColor(208, 199, 163);
        canvas.DrawPath(activePath, paint);
        // Restrained paper grain inside the stone fill; no random props or decorative geometry.
        canvas.Save(); canvas.ClipPath(activePath);
        paint.Shader = paper; paint.Color = new SKColor(255, 255, 255, 42);
        canvas.DrawRect(0, 0, w, h, paint); paint.Shader = null;
        // Stairs: thin tread lines where the steps climb past each TreadRise, like contour lines.
        if (treads != null)
        {
            using var steps = new SKPath();
            int Band(int i) => (int)Math.Floor(treads[i] / TreadRise);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int i = y * w + x;
                if (float.IsPositiveInfinity(treads[i])) continue;
                if (x < w - 1 && !float.IsPositiveInfinity(treads[i + 1]) && Band(i) != Band(i + 1)) { steps.MoveTo(x + 1, y); steps.LineTo(x + 1, y + 1); }
                if (y < h - 1 && !float.IsPositiveInfinity(treads[i + w]) && Band(i) != Band(i + w)) { steps.MoveTo(x, y + 1); steps.LineTo(x + 1, y + 1); }
            }
            paint.Style = SKPaintStyle.Stroke; paint.StrokeWidth = 1.3f; paint.StrokeCap = SKStrokeCap.Square;
            paint.Color = new SKColor(118, 94, 58, 210);
            canvas.DrawPath(steps, paint);
            paint.Style = SKPaintStyle.Fill;
        }
        canvas.Restore();
        paint.Style = SKPaintStyle.Stroke; paint.StrokeWidth = 1.5f; paint.Color = new SKColor(101, 80, 50);
        canvas.DrawPath(activePath, paint);
        return bmp;
    }
}
