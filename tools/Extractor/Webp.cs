// webp <dir> [--max=N] [--quality=Q]: converts every PNG in <dir> to WebP, scaled down so its longest side
// is at most N pixels (never up), then deletes the PNG. Keeps the shipped journal art and floor plans small.
using SkiaSharp;

static class Webp
{
    public static void Run(string dir, IEnumerable<string> options)
    {
        int Option(string name, int fallback) =>
            options.FirstOrDefault(a => a.StartsWith($"--{name}="))?.Split('=')[1] is { } v ? int.Parse(v) : fallback;
        int max = Option("max", int.MaxValue), quality = Option("quality", 90);
        int done = 0, failed = 0;
        Parallel.ForEach(Directory.GetFiles(dir, "*.png"), new ParallelOptions { MaxDegreeOfParallelism = 8 }, file =>
        {
            try
            {
                using var source = SKBitmap.Decode(file) ?? throw new Exception("decode failed");
                double k = Math.Min(1.0, (double)max / Math.Max(source.Width, source.Height));
                using var scaled = k < 1
                    ? source.Resize(new SKImageInfo(Math.Max(1, (int)Math.Round(source.Width * k)), Math.Max(1, (int)Math.Round(source.Height * k)),
                        source.ColorType, source.AlphaType), SKFilterQuality.High) ?? throw new Exception("resize failed")
                    : null;
                using var image = SKImage.FromBitmap(scaled ?? source);
                using var webp = image.Encode(SKEncodedImageFormat.Webp, quality) ?? throw new Exception("encode failed");
                File.WriteAllBytes(Path.ChangeExtension(file, ".webp"), webp.ToArray());
                File.Delete(file);
                Interlocked.Increment(ref done);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine($"ERR {Path.GetFileName(file)}: {e.Message}");
                Interlocked.Increment(ref failed);
            }
        });
        Console.Error.WriteLine($"WebP: {done} converted, {failed} failed");
        if (failed > 0) Environment.ExitCode = 1;
    }
}
