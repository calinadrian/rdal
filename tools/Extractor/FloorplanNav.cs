// Walkable floor from the game's own navigation mesh: the Recast/Detour tiles baked into the world
// partition cells. It is exactly where creatures (and so players) can walk, and it already runs through
// doorways, over bridges and up stairs, so rooms join the way they do in the game.
using System.Collections.Concurrent;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.NavigationSystem.Detour;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.NavigationSystem.NavMesh;
using CUE4Parse.UE4.Objects.UObject;

public static partial class Floorplan
{
    // One walkable triangle of the navmesh, in world space (cm).
    readonly record struct NavTri(FVector A, FVector B, FVector C);

    // A jump, drop or ladder the navmesh links across (AI uses it, so it joins floors).
    readonly record struct NavLink(FVector From, FVector To, double Radius, bool BothWays);

    // Detour stores Recast's Y-up coordinates: x = -X, y = Z, z = -Y.
    static FVector FromRecast(FVector v) => new(-v.X, -v.Z, v.Y);

    // The game bakes a navmesh per agent size; "Default" is the player-sized one ("Gigantic" is for bosses).
    const string NavAgent = "-Default";

    // Every ground polygon of the player-sized navmesh tiles that `wanted` accepts, as its detail
    // triangles: they carry the real floor height, unlike the coarse polygon itself.
    static (List<NavTri> tris, List<NavLink> links) LoadNavmesh(DefaultFileProvider provider, Func<FVector, FVector, bool> wanted)
    {
        var cells = provider.Files.Keys.Where(k => k.EndsWith(".umap") && k.Contains("/Maps/World/L_World")).ToList();
        var tris = new ConcurrentBag<NavTri>();
        var links = new ConcurrentBag<NavLink>();
        Parallel.ForEach(cells, new ParallelOptions { MaxDegreeOfParallelism = 8 }, path =>
        {
            try
            {
                foreach (var exp in provider.LoadPackage(path).GetExports())
                {
                    if (exp is not URecastNavMeshDataChunk chunk || !exp.GetOrDefault<FName>("NavigationDataName").Text.EndsWith(NavAgent)) continue;
                    foreach (var data in chunk.Tiles)
                    {
                        if (!data.IsValid) continue;
                        var tile = data.Tile!;
                        FVector a = FromRecast(tile.Header.BMin), b = FromRecast(tile.Header.BMax);
                        if (!wanted(new FVector(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Min(a.Z, b.Z)),
                                    new FVector(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y), Math.Max(a.Z, b.Z)))) continue;
                        for (int p = 0; p < tile.Polys.Length && p < tile.DetailMeshes.Length; p++)
                        {
                            var poly = tile.Polys[p];
                            if (poly.AreaAndType >> 6 != 0) continue; // off-mesh link polygons are not floor
                            var detail = tile.DetailMeshes[p];
                            FVector Vertex(int k) => FromRecast(k < poly.VertCount
                                ? tile.Vertices[poly.Verts[k]]
                                : tile.DetailVertices[detail.VertBase + k - poly.VertCount]);
                            for (int t = 0; t < detail.TriCount; t++)
                            {
                                var tri = tile.DetailTris[detail.TriBase + t];
                                tris.Add(new NavTri(Vertex(tri[0]), Vertex(tri[1]), Vertex(tri[2])));
                            }
                        }
                        foreach (var link in tile.OffMeshConnections)
                            links.Add(new NavLink(FromRecast(link.Positiona), FromRecast(link.Positionb), link.Radius,
                                link.Flags.HasFlag(EDetourOffMesh.ConnectionBidir)));
                    }
                }
            }
            catch (Exception e) { Console.Error.WriteLine($"ERR {path}: {e.Message}"); }
        });
        return (tris.ToList(), links.ToList());
    }
}
