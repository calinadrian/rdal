// A creature model as a self-contained .glb for the app's 3D viewer: the first LOD in its bind pose,
// with each material's colour texture embedded (no skeleton or animation).
using System.Numerics;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Dto;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Textures;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Materials;
using SharpGLTF.Memory;
using SharpGLTF.Scenes;

using VERTEX = SharpGLTF.Geometry.VertexTypes.VertexPositionNormal;

public static class ModelExport
{
    public static byte[] Glb(USkeletalMesh mesh, int maxTexture)
    {
        if (!mesh.TryConvert(out SkeletalMeshDto? dto) || dto.LODs.Count == 0) throw new Exception("no mesh data");
        var lod = dto.LODs[0];
        var builder = new MeshBuilder<VERTEX, VertexTexture1, VertexEmpty>(mesh.Name);

        for (int i = 0; i < lod.Sections.Length; i++)
        {
            var section = lod.Sections[i];
            if (!section.IsValid) continue;
            var slot = dto.GetMaterial(section);
            var mat = new MaterialBuilder(slot?.SlotName ?? $"Slot{i}").WithDoubleSide(true).WithMetallicRoughnessShader();
            var png = slot?.Material is { } m && m.TryLoad<UMaterialInterface>(out var material) ? DiffusePng(material, maxTexture) : null;
            if (png != null) mat.WithBaseColor(new MemoryImage(png));
            else mat.WithBaseColor(new Vector4(0.7f, 0.65f, 0.6f, 1));
            mat.WithMetallicRoughness(0, 0.9f);

            var prim = builder.UsePrimitive(mat);
            for (int j = 0; j < section.NumFaces; j++)
            {
                var v = new IVertexBuilder[3];
                for (int k = 0; k < 3; k++)
                {
                    var vert = lod.Vertices[lod.Indices[section.FirstIndex + j * 3 + k]];
                    // Unreal is Z-up in centimetres; glTF is Y-up in metres (same swap as CUE4Parse's own glTF writer).
                    var p = new Vector3((float)vert.Position.X, (float)vert.Position.Z, (float)vert.Position.Y) * 0.01f;
                    var n = Vector3.Normalize(new Vector3(vert.Normal.X, vert.Normal.Z, vert.Normal.Y));
                    if (float.IsNaN(n.X)) n = Vector3.UnitY;
                    v[k] = new VertexBuilder<VERTEX, VertexTexture1, VertexEmpty>(new VERTEX(p, n), new VertexTexture1(new Vector2(vert.Uv.U, vert.Uv.V)));
                }
                prim.AddTriangle(v[0], v[1], v[2]);
            }
        }

        var scene = new SceneBuilder();
        scene.AddRigidMesh(builder, Matrix4x4.Identity);
        return scene.ToGltf2().WriteGLB().ToArray();
    }

    // The material's base colour texture as PNG (searching the usual parameter names), or null.
    static byte[]? DiffusePng(UMaterialInterface material, int maxSize)
    {
        var p = new CMaterialParams2();
        material.GetParams(p, EMaterialDepth.AllLayers);
        if (!p.TryGetTexture2d(out var tex, CMaterialParams2.Diffuse[0]) && !p.TryGetFirstTexture2d(out tex)) return null;
        if (tex is not UTexture2D t2) return null;
        var img = TextureDecoder.Decode(t2, maxSize);
        return img == null ? null : TextureEncoder.Encode(img, ETextureFormat.Png, false, out _);
    }
}
