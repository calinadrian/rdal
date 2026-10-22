// Finds placed blueprint actors and their world positions in a level package.
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;

public static class WorldScan
{
    // Scenery and engine helpers that never matter on a map.
    static readonly string[] Skip = { "Foliage", "Ambience", "Audio", "PP_", "PostProcess", "Path_C", "WorldBoundary", "PCG_", "Light", "Decal", "Fog", "Sky", "Water", "Volume", "Spline" };

    public static IEnumerable<object> Actors(IPackage pkg, string levelPath)
    {
        var exports = pkg.GetExports().ToList();
        foreach (var exp in exports)
        {
            var cls = exp.ExportType;
            if (!cls.EndsWith("_C") || Skip.Any(cls.Contains)) continue;
            if (exp.Outer is not null && exp.Outer.Class?.Name.Text != "Level") continue; // components, not actors

            var loc = Location(exp, exports);
            if (loc is null) continue;
            yield return new
            {
                cls,
                name = exp.Name,
                x = Math.Round(loc.Value.X), y = Math.Round(loc.Value.Y), z = Math.Round(loc.Value.Z),
                level = Path.GetFileNameWithoutExtension(levelPath),
                props = exp.Properties.Where(p => p.Tag is not null && !p.Name.Text.EndsWith("Component"))
                    .ToDictionary(p => p.Name.Text, p => Short(p.Tag!.ToString() ?? "")),
            };
        }
    }

    static string Short(string s) => s.Length > 300 ? s[..300] : s;

    static FVector? Location(UObject actor, List<UObject> exports)
    {
        UObject? root = null;
        if (actor.TryGetValue(out FPackageIndex rootIdx, "RootComponent") && !rootIdx.IsNull)
            root = rootIdx.Load<UObject>();
        // Inherited root components are exported as children of the actor.
        root ??= exports.FirstOrDefault(e => e.Outer?.Name.Text == actor.Name && e.Properties.Any(p => p.Name.Text == "RelativeLocation"));
        if (root is null || !root.TryGetValue(out FVector rel, "RelativeLocation")) return null;
        return rel;
    }
}
