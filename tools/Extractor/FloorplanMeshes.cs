// Visible floor: the up-facing surfaces of the static meshes placed in and around each dungeon. The navmesh
// also runs over invisible collision, such as a flat plane some dungeons were built over; Unseen() finds
// the navmesh that no mesh shows.
using System.Collections.Concurrent;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;

public static partial class Floorplan
{
    sealed record Mesh(FVector[] Verts, uint[] Indices, double Radius);

    static Dictionary<Region, Spans> LoadMeshFloors(DefaultFileProvider provider, List<Region> regions)
    {
        var meshes = new ConcurrentDictionary<string, Mesh?>();
        var placed = new ConcurrentBag<(Region r, Mesh m, FTransform t)>();
        var cells = provider.Files.Keys.Where(k => k.EndsWith(".umap") && k.Contains("/Maps/World/L_World")).ToList();
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
                    var mesh = meshes.GetOrAdd(meshIndex.ResolvedObject?.GetPathName() ?? meshIndex.ToString(), _ => LoadMesh(meshIndex));
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
        });
        Console.Error.WriteLine($"{placed.Count} mesh instances, {meshes.Count} meshes");
        var floors = new ConcurrentDictionary<Region, Spans>();
        Parallel.ForEach(placed.GroupBy(p => p.r).ToList(), new ParallelOptions { MaxDegreeOfParallelism = 4 },
            g => floors[g.Key] = Rasterize(g.Key, g.SelectMany(p => Surfaces(g.Key, p.m, p.t))));
        return floors.ToDictionary(kv => kv.Key, kv => kv.Value);
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
            return new Mesh(verts, idx, radius);
        }
        catch { return null; }
    }

    // A placed mesh's roughly horizontal triangles within the region's heights, facing either way: all that
    // matters is whether some visible surface lies at a height.
    static IEnumerable<NavTri> Surfaces(Region r, Mesh m, FTransform t)
    {
        for (int i = 0; i + 2 < m.Indices.Length; i += 3)
        {
            var a = t.TransformPosition(m.Verts[m.Indices[i]]);
            var b = t.TransformPosition(m.Verts[m.Indices[i + 1]]);
            var c = t.TransformPosition(m.Verts[m.Indices[i + 2]]);
            if (Math.Max(a.Z, Math.Max(b.Z, c.Z)) < r.minZ || Math.Min(a.Z, Math.Min(b.Z, c.Z)) > r.maxZ) continue;
            double ux = b.X - a.X, uy = b.Y - a.Y, uz = b.Z - a.Z, vx = c.X - a.X, vy = c.Y - a.Y, vz = c.Z - a.Z;
            double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 1e-6 || Math.Abs(nz) / len < 0.6) continue;
            yield return new NavTri(a, b, c);
        }
    }

    const double MinUnseen = 100e4; // cm²: a flat stretch of navmesh this large with no mesh under it is collision

    // Navmesh that no mesh shows and that is dead flat over a wide area: invisible collision (a plane under or
    // around the dungeon) rather than floor. Bumpy ground without meshes, like landscape terrain, is kept.
    static bool[] Unseen(Region r, Spans s, Spans shown)
    {
        int w = s.w, h = s.h;
        var owner = new int[s.z.Length];
        for (int i = 0; i < w * h; i++) for (int k = s.start[i]; k < s.start[i + 1]; k++) owner[k] = i;
        var hidden = new bool[s.z.Length];
        for (int k = 0; k < hidden.Length; k++)
        {
            int i = owner[k], x = i % w, y = i / w;
            bool seen = false;
            for (int dy = -2; dy <= 2 && !seen; dy++)
                for (int dx = -2; dx <= 2 && !seen; dx++)
                {
                    int qx = x + dx, qy = y + dy;
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
                    int j = qy * w + qx;
                    for (int m = shown.start[j]; m < shown.start[j + 1] && !seen; m++) seen = Math.Abs(shown.z[m] - s.z[k]) <= 60;
                }
            hidden[k] = !seen;
        }
        var drop = new bool[s.z.Length];
        var done = new bool[s.z.Length];
        var stack = new Stack<int>();
        var part = new List<int>();
        int min = (int)(MinUnseen / (r.res * r.res));
        for (int start = 0; start < hidden.Length; start++)
        {
            if (!hidden[start] || done[start]) continue;
            part.Clear(); done[start] = true; stack.Push(start);
            while (stack.Count > 0)
            {
                int k = stack.Pop(), i = owner[k], x = i % w, y = i / w;
                part.Add(k);
                void Visit(int j)
                {
                    for (int m = s.start[j]; m < s.start[j + 1]; m++)
                        if (hidden[m] && !done[m] && Math.Abs(s.z[m] - s.z[k]) <= 1) { done[m] = true; stack.Push(m); }
                }
                if (x > 0) Visit(i - 1);
                if (x < w - 1) Visit(i + 1);
                if (y > 0) Visit(i - w);
                if (y < h - 1) Visit(i + w);
            }
            if (part.Count >= min) foreach (var k in part) drop[k] = true;
        }
        int dropped = drop.Count(d => d);
        if (dropped > 0) Console.Error.WriteLine($"..  {r.id}: dropped {dropped * r.res * r.res / 1e4:0} m2 of flat navmesh that no mesh shows");
        return drop;
    }
}
