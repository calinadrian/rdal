// Cartographic rendering of the floor plans, kept separate from the extracted geometry: aged paper, rock
// hatched around the walls, inked walls, relief shading, a faint 5 m survey grid and tread lines where the
// floor climbs. Restyle redraws cached layouts, so visual revisions never require another game scan.
using System.IO.Compression;
using Newtonsoft.Json;
using SkiaSharp;

public static partial class Floorplan
{
    // A level cropped to its image: where you can walk, and the floor height there.
    sealed record Floor(bool[] Walk, float[] Height);

    static readonly SKColor Ink = new(52, 33, 16);
    static readonly SKColor FloorTone = new(239, 229, 202);
    static readonly SKColor ContextTone = new(207, 186, 143);

    // Cache exact masks/heights so visual revisions never require another game scan.
    static void SaveLayout(Region r, List<Sheet> levels, string outDir)
    {
        var dir = Path.Combine(outDir, "layouts");
        Directory.CreateDirectory(dir);
        using var file = File.Create(Path.Combine(dir, r.id + ".bin.gz"));
        using var zip = new GZipStream(file, CompressionLevel.Fastest);
        using var writer = new BinaryWriter(zip);
        writer.Write("DWAL-layout-3"); writer.Write(r.id);
        writer.Write(r.minX); writer.Write(r.minY); writer.Write(r.res); writer.Write(r.w); writer.Write(r.h);
        writer.Write(levels.Count);
        foreach (var sheet in levels)
        {
            writer.Write(sheet.Count());
            for (int i = 0; i < sheet.walk.Length; i++)
                if (sheet.walk[i]) { writer.Write(i); writer.Write(sheet.height[i]); }
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
            // Version 3 is drawn from the navmesh; older caches hold mesh-traced floors.
            if (reader.ReadString() != "DWAL-layout-3") throw new Exception("Unsupported layout cache: run the floorplan extraction again");
            var r = new Region { id = reader.ReadString(), minX = reader.ReadDouble(), minY = reader.ReadDouble(), res = reader.ReadDouble(), w = reader.ReadInt32(), h = reader.ReadInt32() };
            var levels = new List<Sheet>();
            int count = reader.ReadInt32();
            for (int l = 0; l < count; l++)
            {
                var s = new Sheet { walk = new bool[r.w * r.h], height = new float[r.w * r.h] };
                Array.Fill(s.height, float.PositiveInfinity);
                int pixels = reader.ReadInt32();
                for (int p = 0; p < pixels; p++) { int i = reader.ReadInt32(); s.walk[i] = true; s.height[i] = reader.ReadSingle(); }
                levels.Add(s);
            }
            frames.AddRange(SaveAll(r, levels, outDir));
        }
        if (frames.Count == 0) throw new Exception("No cached dungeon layouts found");
        File.WriteAllText(Path.Combine(outDir, "floorplans.json"), JsonConvert.SerializeObject(frames));
    }

    const float FadeLength = 28; // px over which floor cut off by the region's edge fades into the paper

    // One level (or, for the overview, every level) as a map. `active` floors are drawn lowest first, each
    // over the ones below it; `context` is the rest of the dungeon, subdued, so routes up and down stay visible.
    // `cut` marks floor that runs on past the mapped region: it gets no wall and fades out.
    static SKBitmap DrawPlan(int w, int h, double res, double originX, double originY, List<Floor> active, List<Floor> context, bool[]? cut)
    {
        var all = new bool[w * h];
        foreach (var f in active.Concat(context)) for (int i = 0; i < all.Length; i++) all[i] |= f.Walk[i];
        var fromCut = cut == null ? null : DistanceTo(cut, w, h);
        using var unwalled = fromCut == null ? null : Outline(Within(fromCut, 3), w, h, res);
        using var unhewn = fromCut == null ? null : Outline(Within(fromCut, FadeLength), w, h, res);
        var bmp = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var canvas = new SKCanvas(bmp);
        DrawPaper(canvas, w, h);
        using (var allPath = Outline(all, w, h, res)) DrawRock(canvas, all, allPath, unhewn, w, h, res);
        // Floors go on a layer of their own, so a cut edge can fade through to the paper beneath.
        canvas.SaveLayer(null);
        if (context.Count > 0)
        {
            var other = new bool[w * h];
            foreach (var f in context) for (int i = 0; i < other.Length; i++) other[i] |= f.Walk[i];
            using var otherPath = Outline(other, w, h, res);
            using var paint = new SKPaint { IsAntialias = true, Color = ContextTone };
            canvas.DrawPath(otherPath, paint);
            using var dash = SKPathEffect.CreateDash([5, 4], 0);
            paint.Style = SKPaintStyle.Stroke; paint.StrokeWidth = 1.4f; paint.Color = new SKColor(122, 92, 55, 220); paint.PathEffect = dash;
            canvas.DrawPath(otherPath, paint);
        }
        // The overview joins its levels without seams; a single level marks where it carries on elsewhere.
        foreach (var floor in active)
            DrawFloor(canvas, floor, active.Where(f => f != floor).Concat(context).ToList(), context.Count == 0, unwalled, w, h, res, originX, originY);
        if (fromCut != null)
        {
            using var fade = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul);
            var pixels = new SKColor[w * h];
            for (int i = 0; i < pixels.Length; i++)
            {
                if (fromCut[i] >= FadeLength) continue;
                float t = 1 - fromCut[i] / FadeLength;
                pixels[i] = new SKColor(0, 0, 0, (byte)(255 * t * t * (3 - 2 * t)));
            }
            fade.Pixels = pixels;
            using var erase = new SKPaint { BlendMode = SKBlendMode.DstOut };
            canvas.DrawBitmap(fade, 0, 0, erase);
        }
        canvas.Restore();
        DrawFrame(canvas, w, h, res);
        return bmp;
    }

    static bool[] Within(float[] d, float limit) { var m = new bool[d.Length]; for (int i = 0; i < d.Length; i++) m[i] = d[i] <= limit; return m; }

    static void DrawPaper(SKCanvas canvas, int w, int h)
    {
        using var paper = SKShader.CreateBitmap(PaperTexture.Value, SKShaderTileMode.Mirror, SKShaderTileMode.Mirror);
        using var paint = new SKPaint { IsAntialias = true, Shader = paper };
        canvas.DrawRect(0, 0, w, h, paint);
        paint.Shader = null;
        // Broad uneven toning, so the sheet neither repeats nor looks flat.
        using (var tone = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul))
        {
            var pixels = new SKColor[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float n = 0.65f * ValueNoise(x / 280f + 17, y / 280f + 5) + 0.35f * ValueNoise(x / 70f + 3, y / 70f + 11);
                    pixels[y * w + x] = new SKColor(96, 58, 22, (byte)Math.Clamp((n - 0.45f) * 120, 0, 42));
                }
            tone.Pixels = pixels;
            canvas.DrawBitmap(tone, 0, 0);
        }
        using var vignette = SKShader.CreateRadialGradient(new SKPoint(w * 0.5f, h * 0.45f), Math.Max(w, h) * 0.72f,
            [new SKColor(72, 43, 14, 0), new SKColor(72, 43, 14, 0), new SKColor(72, 43, 14, 120)], [0, 0.55f, 1], SKShaderTileMode.Clamp);
        paint.Shader = vignette;
        canvas.DrawRect(0, 0, w, h, paint);
    }

    // Solid rock around the rooms: shaded darker toward the wall and hatched in short clusters of strokes.
    // None is drawn in `spare`, where the floor was cut off rather than walled in.
    static void DrawRock(SKCanvas canvas, bool[] floor, SKPath floorPath, SKPath? spare, int w, int h, double res)
    {
        var d = DistanceTo(floor, w, h);
        float band = (float)Math.Clamp(180 / res, 8, 15), shadow = band * 1.6f;
        canvas.Save();
        if (spare != null) canvas.ClipPath(spare, SKClipOperation.Difference, true);
        using (var shade = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul))
        {
            var pixels = new SKColor[w * h];
            for (int i = 0; i < pixels.Length; i++)
            {
                if (floor[i] || d[i] > shadow) continue;
                float t = 1 - d[i] / shadow;
                pixels[i] = new SKColor(86, 56, 28, (byte)(100 * t * t));
            }
            shade.Pixels = pixels;
            canvas.DrawBitmap(shade, 0, 0);
        }
        canvas.Save();
        canvas.ClipPath(floorPath, SKClipOperation.Difference, true);
        var strokes = new[] { new SKPath(), new SKPath(), new SKPath() }; // near, middle and far from the wall
        const float cell = 6.5f, gap = 1.9f;
        for (int gy = 0; gy * cell < h; gy++)
            for (int gx = 0; gx * cell < w; gx++)
            {
                uint seed = Hash(gx, gy);
                float Next() { seed = unchecked(seed * 1664525 + 1013904223); return (seed >> 8) / 16777216f; }
                float cx = (gx + Next()) * cell, cy = (gy + Next()) * cell;
                if (cx >= w || cy >= h) continue;
                float dist = d[(int)cy * w + (int)cx];
                if (dist < 1 || dist > band) continue;
                float t = dist / band;
                if (Next() < t * t) continue; // the hatching thins out away from the wall
                float angle = Next() * MathF.PI, length = cell * (1.05f + 0.4f * Next());
                float dx = MathF.Cos(angle), dy = MathF.Sin(angle);
                int lines = Next() < 0.4f ? 4 : 3;
                var path = strokes[t < 0.4f ? 0 : t < 0.75f ? 1 : 2];
                for (int k = 0; k < lines; k++)
                {
                    float off = (k - (lines - 1) / 2f) * gap, half = length * (0.8f + 0.25f * Next()) / 2;
                    float px = cx - dy * off, py = cy + dx * off;
                    path.MoveTo(px - dx * half, py - dy * half);
                    path.LineTo(px + dx * half, py + dy * half);
                }
            }
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 0.95f, StrokeCap = SKStrokeCap.Round };
        byte[] alpha = [205, 150, 95];
        for (int k = 0; k < strokes.Length; k++)
        {
            paint.Color = Ink.WithAlpha(alpha[k]);
            canvas.DrawPath(strokes[k], paint);
            strokes[k].Dispose();
        }
        canvas.Restore();
        canvas.Restore();
    }

    static void DrawFloor(SKCanvas canvas, Floor floor, List<Floor> others, bool seamless, SKPath? cut, int w, int h, double res, double originX, double originY)
    {
        using var path = Outline(floor.Walk, w, h, res);
        using var gaps = OpenEdges(floor, others, w, h, res);
        using var paint = new SKPaint { IsAntialias = true };
        // Lift the floor off the page (and off any level below it), except where it runs on elsewhere.
        using (var blur = SKMaskFilter.CreateBlur(SKBlurStyle.Normal, 3))
        {
            paint.MaskFilter = blur; paint.Color = new SKColor(40, 22, 6, 125);
            canvas.Save();
            if (gaps != null) canvas.ClipPath(gaps, SKClipOperation.Difference, true);
            if (cut != null) canvas.ClipPath(cut, SKClipOperation.Difference, true);
            canvas.Translate(1.5f, 2.5f); canvas.DrawPath(path, paint);
            canvas.Restore();
            paint.MaskFilter = null;
        }
        paint.Color = FloorTone;
        canvas.DrawPath(path, paint);
        canvas.Save();
        canvas.ClipPath(path, SKClipOperation.Intersect, true);
        using (var paper = SKShader.CreateBitmap(PaperTexture.Value, SKShaderTileMode.Mirror, SKShaderTileMode.Mirror))
        {
            paint.Shader = paper; paint.Color = new SKColor(255, 255, 255, 48);
            canvas.DrawRect(0, 0, w, h, paint);
            paint.Shader = null;
        }
        // Neighbouring heights that jump rather than climb mark a ledge: the floor is drawn as terraces.
        var terrace = Terraces(floor, w, h, (float)(res * 1.2 + 60), out int terraces);
        var z = SmoothHeights(floor, terrace, w, h, 2);
        DrawRelief(canvas, terrace, z, w, h, res);
        DrawGrid(canvas, w, h, res, originX, originY);
        DrawTreads(canvas, terrace, z, w, h, res);
        DrawLedges(canvas, terrace, terraces, w, h, res);
        canvas.Restore();
        DrawWalls(canvas, path, gaps, cut, seamless);
    }

    // Connected parts of the floor whose neighbouring heights never differ by more than `jump`; -1 off the floor.
    static int[] Terraces(Floor f, int w, int h, float jump, out int count)
    {
        var id = new int[w * h];
        Array.Fill(id, -1);
        var stack = new Stack<int>();
        int next = 0;
        for (int start = 0; start < id.Length; start++)
        {
            if (!f.Walk[start] || id[start] >= 0 || !float.IsFinite(f.Height[start])) continue;
            id[start] = next; stack.Push(start);
            while (stack.Count > 0)
            {
                int i = stack.Pop(), x = i % w, y = i / w;
                void Visit(int j)
                {
                    if (f.Walk[j] && id[j] < 0 && float.IsFinite(f.Height[j]) && Math.Abs(f.Height[j] - f.Height[i]) <= jump)
                    { id[j] = next; stack.Push(j); }
                }
                if (x > 0) Visit(i - 1);
                if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w);
                if (y < h - 1) Visit(i + w);
            }
            next++;
        }
        count = next;
        return id;
    }

    // Floor heights averaged over a small neighbourhood of the same terrace (NaN off the floor), so the
    // relief and tread lines follow the slope rather than each navmesh triangle, and stop at ledges.
    static float[] SmoothHeights(Floor f, int[] terrace, int w, int h, int radius)
    {
        var a = new float[w * h];
        for (int i = 0; i < a.Length; i++) a[i] = terrace[i] >= 0 ? f.Height[i] : float.NaN;
        var b = new float[w * h];
        for (int pass = 0; pass < 2; pass++)
        {
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (terrace[i] < 0) { b[i] = float.NaN; continue; }
                    float sum = 0; int n = 0;
                    for (int k = -radius; k <= radius; k++)
                    {
                        int xx = pass == 0 ? x + k : x, yy = pass == 0 ? y : y + k;
                        if (xx < 0 || yy < 0 || xx >= w || yy >= h || terrace[yy * w + xx] != terrace[i]) continue;
                        sum += a[yy * w + xx]; n++;
                    }
                    b[i] = sum / n;
                }
            (a, b) = (b, a);
        }
        return a;
    }

    // Rise per unit of run along X and Y at pixel i, within its terrace (0 where the terrace ends).
    static (float gx, float gy) Gradient(float[] z, int[] terrace, int i, int w, int h, double res)
    {
        int x = i % w, y = i / w;
        float Slope(int back, int ahead, bool hasBack, bool hasAhead)
        {
            bool b = hasBack && terrace[back] == terrace[i], a = hasAhead && terrace[ahead] == terrace[i];
            if (a && b) return (float)((z[ahead] - z[back]) / (2 * res));
            if (a) return (float)((z[ahead] - z[i]) / res);
            if (b) return (float)((z[i] - z[back]) / res);
            return 0;
        }
        return (Slope(i - 1, i + 1, x > 0, x < w - 1), Slope(i - w, i + w, y > 0, y < h - 1));
    }

    // Hillshade lit from the upper left: slopes and steps read at a glance, flat rooms stay plain.
    static void DrawRelief(SKCanvas canvas, int[] terrace, float[] z, int w, int h, double res)
    {
        const float lx = -0.5f, ly = -0.5f, lz = 0.7071f;
        using var relief = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        var pixels = new SKColor[w * h];
        for (int i = 0; i < pixels.Length; i++)
        {
            if (terrace[i] < 0) continue;
            var (gx, gy) = Gradient(z, terrace, i, w, h, res);
            float len = MathF.Sqrt(gx * gx + gy * gy + 1);
            float shade = (-gx * lx - gy * ly + lz) / len - lz;
            pixels[i] = shade < 0
                ? new SKColor(80, 50, 22, (byte)Math.Min(120, -shade * 280))
                : new SKColor(255, 252, 238, (byte)Math.Min(90, shade * 220));
        }
        relief.Pixels = pixels;
        canvas.DrawBitmap(relief, 0, 0);
    }

    const double GridSpacing = 500; // cm: a 5 m survey grid, aligned to world coordinates

    static void DrawGrid(SKCanvas canvas, int w, int h, double res, double originX, double originY)
    {
        float step = (float)(GridSpacing / res);
        if (step < 8) return; // too dense to help
        using var grid = new SKPath();
        float x0 = (float)((Math.Ceiling(originX / GridSpacing) * GridSpacing - originX) / res);
        float y0 = (float)((Math.Ceiling(originY / GridSpacing) * GridSpacing - originY) / res);
        for (float x = x0; x < w; x += step) { grid.MoveTo(x, 0); grid.LineTo(x, h); }
        for (float y = y0; y < h; y += step) { grid.MoveTo(0, y); grid.LineTo(w, y); }
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1, Color = new SKColor(122, 96, 60, 42) };
        canvas.DrawPath(grid, paint);
    }

    // Where the floor climbs steeply (stairs, ramps, rock slopes), a line every `rise` of height, like the
    // treads of a staircase. The navmesh smooths stairs into ramps, so this is where they show.
    static void DrawTreads(SKCanvas canvas, int[] terrace, float[] z, int w, int h, double res)
    {
        const float Steep = 0.3f; // about 17 degrees
        var steep = new bool[w * h];
        for (int i = 0; i < steep.Length; i++)
        {
            if (terrace[i] < 0) continue;
            var (gx, gy) = Gradient(z, terrace, i, w, h, res);
            steep[i] = gx * gx + gy * gy > Steep * Steep;
        }
        FlipSmall(steep, w, h, true, (int)Math.Max(6, 12000 / (res * res))); // specks under a square metre or so
        float rise = (float)Math.Max(35, 2.1 * res); // about two steps, and never denser than ~3 px apart
        using var lines = new SKPath();
        var corner = new (float x, float y, float z)[4];
        var cut = new SKPoint[4];
        for (int y = 0; y < h - 1; y++)
            for (int x = 0; x < w - 1; x++)
            {
                int i = y * w + x;
                if (!steep[i] || !steep[i + 1] || !steep[i + w] || !steep[i + w + 1]) continue;
                int own = terrace[i];
                if (terrace[i + 1] != own || terrace[i + w] != own || terrace[i + w + 1] != own) continue;
                corner[0] = (x + 0.5f, y + 0.5f, z[i]); corner[1] = (x + 1.5f, y + 0.5f, z[i + 1]);
                corner[2] = (x + 1.5f, y + 1.5f, z[i + w + 1]); corner[3] = (x + 0.5f, y + 1.5f, z[i + w]);
                float lo = Math.Min(Math.Min(corner[0].z, corner[1].z), Math.Min(corner[2].z, corner[3].z));
                float hi = Math.Max(Math.Max(corner[0].z, corner[1].z), Math.Max(corner[2].z, corner[3].z));
                for (float level = MathF.Ceiling(lo / rise) * rise; level < hi; level += rise)
                {
                    int n = 0;
                    for (int e = 0; e < 4; e++)
                    {
                        var (ax, ay, az) = corner[e]; var (bx, by, bz) = corner[(e + 1) % 4];
                        if ((az < level) == (bz < level)) continue;
                        float t = (level - az) / (bz - az);
                        cut[n++] = new SKPoint(ax + (bx - ax) * t, ay + (by - ay) * t);
                    }
                    for (int k = 0; k + 1 < n; k += 2) { lines.MoveTo(cut[k]); lines.LineTo(cut[k + 1]); }
                }
            }
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1.1f, StrokeCap = SKStrokeCap.Round, Color = Ink.WithAlpha(170) };
        canvas.DrawPath(lines, paint);
    }

    // A fine ink line where one terrace of the floor ends above another: a ledge, a dais, a drop.
    static void DrawLedges(SKCanvas canvas, int[] terrace, int count, int w, int h, double res)
    {
        var edge = new bool[w * h];
        var touched = new bool[count];
        var area = new int[count];
        var (x0, y0, x1, y1) = (new int[count], new int[count], new int[count], new int[count]);
        Array.Fill(x0, w); Array.Fill(y0, h); Array.Fill(x1, -1); Array.Fill(y1, -1);
        bool any = false;
        for (int i = 0; i < terrace.Length; i++)
        {
            int t = terrace[i];
            if (t < 0) continue;
            int x = i % w, y = i / w;
            area[t]++; x0[t] = Math.Min(x0[t], x); y0[t] = Math.Min(y0[t], y); x1[t] = Math.Max(x1[t], x); y1[t] = Math.Max(y1[t], y);
            foreach (var j in new[] { x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1 })
                if (j >= 0 && terrace[j] >= 0 && terrace[j] != t) { edge[i] = edge[j] = touched[t] = touched[terrace[j]] = any = true; }
        }
        if (!any) return;
        var d = DistanceTo(edge, w, h);
        var near = new bool[w * h];
        for (int i = 0; i < near.Length; i++) near[i] = d[i] <= 2.5f;
        using var zone = Outline(near, w, h, res);
        using var lines = new SKPath();
        for (int t = 0; t < count; t++)
        {
            if (!touched[t] || area[t] < 6) continue;
            int bx = Math.Max(0, x0[t] - 2), by = Math.Max(0, y0[t] - 2), bw = Math.Min(w, x1[t] + 3) - bx, bh = Math.Min(h, y1[t] + 3) - by;
            var mask = new bool[bw * bh];
            for (int y = 0; y < bh; y++) for (int x = 0; x < bw; x++) mask[y * bw + x] = terrace[(y + by) * w + x + bx] == t;
            using var outline = Outline(mask, bw, bh, res);
            outline.Offset(bx, by);
            lines.AddPath(outline);
        }
        canvas.Save();
        canvas.ClipPath(zone, SKClipOperation.Intersect, true);
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeJoin = SKStrokeJoin.Round, StrokeWidth = 1.5f, Color = Ink.WithAlpha(215) };
        canvas.DrawPath(lines, paint);
        canvas.Restore();
    }

    // The part of the floor's edge where it carries on at the same height on another level, such as the top
    // or foot of a staircase, widened a little to clip with; null where there is none.
    static SKPath? OpenEdges(Floor f, List<Floor> others, int w, int h, double res)
    {
        float tolerance = (float)(res * 1.5 + 60);
        var open = new bool[w * h];
        bool any = false;
        for (int i = 0; i < open.Length; i++)
        {
            if (!f.Walk[i]) continue;
            int x = i % w, y = i / w;
            foreach (var j in new[] { x > 0 ? i - 1 : i, x < w - 1 ? i + 1 : i, y > 0 ? i - w : i, y < h - 1 ? i + w : i })
                if (!f.Walk[j] && others.Any(o => o.Walk[j] && Math.Abs(o.Height[j] - f.Height[i]) <= tolerance)) { open[i] = any = true; break; }
        }
        if (!any) return null;
        var d = DistanceTo(open, w, h);
        var near = new bool[w * h];
        for (int i = 0; i < near.Length; i++) near[i] = d[i] <= 3;
        return Outline(near, w, h, res);
    }

    // Inked wall line around the floor, left open where it runs on into another level (`gaps`): dotted on a
    // single level's map, so routes up and down read as connected, and not drawn at all when seamless.
    // Where the region cut the floor off (`cut`) there is no wall either.
    static void DrawWalls(SKCanvas canvas, SKPath path, SKPath? gaps, SKPath? cut, bool seamless)
    {
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeJoin = SKStrokeJoin.Round, StrokeCap = SKStrokeCap.Round,
            StrokeWidth = 2.6f, Color = Ink };
        canvas.Save();
        if (cut != null) canvas.ClipPath(cut, SKClipOperation.Difference, true);
        if (gaps != null) canvas.ClipPath(gaps, SKClipOperation.Difference, true);
        canvas.DrawPath(path, paint);
        canvas.Restore();
        if (gaps == null || seamless) return;
        canvas.Save();
        canvas.ClipPath(gaps, SKClipOperation.Intersect, true);
        using var dots = SKPathEffect.CreateDash([1.5f, 3], 0);
        paint.StrokeWidth = 1.3f; paint.Color = Ink.WithAlpha(120); paint.PathEffect = dots;
        canvas.DrawPath(path, paint);
        canvas.Restore();
    }

    // A ruled border and a scale bar, like a surveyed sheet.
    static void DrawFrame(SKCanvas canvas, int w, int h, double res)
    {
        using var paint = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, Color = Ink.WithAlpha(190), StrokeWidth = 2.2f };
        canvas.DrawRect(12, 12, w - 24, h - 24, paint);
        paint.StrokeWidth = 0.9f;
        canvas.DrawRect(17, 17, w - 34, h - 34, paint);
        // The roundest length that fits, in four alternating blocks.
        int metres = new[] { 5, 10, 20, 25, 50, 100, 200 }.LastOrDefault(m => m * 100 / res <= Math.Min(220, w * 0.3));
        if (metres == 0) return;
        float length = (float)(metres * 100 / res), x0 = 36, y0 = h - 42, bar = 5;
        paint.Style = SKPaintStyle.Fill;
        for (int k = 0; k < 4; k++)
        {
            paint.Color = k % 2 == 0 ? Ink : FloorTone;
            canvas.DrawRect(x0 + k * length / 4, y0, length / 4, bar, paint);
        }
        paint.Style = SKPaintStyle.Stroke; paint.StrokeWidth = 1; paint.Color = Ink;
        canvas.DrawRect(x0, y0, length, bar, paint);
        using var typeface = SKTypeface.FromFamilyName("Georgia", SKFontStyle.Italic);
        paint.Style = SKPaintStyle.Fill; paint.Typeface = typeface; paint.TextSize = 13; paint.TextAlign = SKTextAlign.Center;
        canvas.DrawText("0", x0, y0 - 5, paint);
        canvas.DrawText($"{metres} m", x0 + length, y0 - 5, paint);
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

    static uint Hash(int x, int y)
    {
        uint n = unchecked((uint)(x * 374761393 + y * 668265263));
        n = unchecked((n ^ (n >> 13)) * 1274126177);
        return n ^ (n >> 16);
    }

    // Smooth value noise in [0, 1].
    static float ValueNoise(float x, float y)
    {
        int xi = (int)Math.Floor(x), yi = (int)Math.Floor(y);
        float fx = x - xi, fy = y - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        float H(int a, int b) => Hash(a, b) / (float)uint.MaxValue;
        float a = H(xi, yi), b = H(xi + 1, yi), c = H(xi, yi + 1), d = H(xi + 1, yi + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }

    // Paper grain: broad mottling plus fine fibres.
    static float Noise(int x, int y) => 0.5f * ValueNoise(x / 96f, y / 96f) + 0.3f * ValueNoise(x / 32f, y / 32f) + 0.2f * ValueNoise(x / 8f, y / 8f);

    static readonly Lazy<SKBitmap> PaperTexture = new(() =>
    {
        const int size = 512;
        var bitmap = new SKBitmap(size, size, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        var pixels = new SKColor[size * size];
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
        {
            float fine = (Hash(x, y) & 255) / 255f;
            float value = (Noise(x, y) - 0.5f) * 22 + (fine - 0.5f) * 12;
            pixels[y * size + x] = new SKColor((byte)(185 + value), (byte)(150 + value), (byte)(94 + value));
        }
        bitmap.Pixels = pixels;
        return bitmap;
    });
}
