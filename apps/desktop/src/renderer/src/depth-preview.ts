export type DepthPreviewMode = 'grayscale' | 'false-color' | 'overlay' | 'hidden';
type Image = { width: number; height: number; pixels: ArrayBuffer };
/** Presentation only: these colors never enter a filter's height values. */
export function depthPreviewPixels(
  field: Image,
  source: Image,
  mode: Exclude<DepthPreviewMode, 'hidden'>,
): Uint8ClampedArray<ArrayBuffer> {
  const input = new Uint8Array(field.pixels),
    original = new Uint8Array(source.pixels),
    output = new Uint8ClampedArray(input.length);
  const stops = [
    [40, 50, 190],
    [0, 210, 230],
    [255, 220, 0],
    [240, 40, 40],
  ];
  for (let y = 0; y < field.height; y++)
    for (let x = 0; x < field.width; x++) {
      const i = (y * field.width + x) * 4,
        h = input[i]! / 255;
      if (mode === 'grayscale') output.set([input[i]!, input[i]!, input[i]!, 255], i);
      else {
        const position = h * 3,
          lo = Math.min(2, Math.floor(position)),
          mix = position - lo;
        const sx = Math.min(source.width - 1, Math.floor(((x + 0.5) * source.width) / field.width)),
          sy = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / field.height));
        const index = (sy * source.width + sx) * 4,
          alpha = original[index + 3]! / 255;
        for (let c = 0; c < 3; c++) {
          const color = stops[lo]![c]! * (1 - mix) + stops[lo + 1]![c]! * mix;
          output[i + c] =
            mode === 'overlay'
              ? (color + original[index + c]! * alpha + 80 * (1 - alpha)) / 2
              : color;
        }
        output[i + 3] = 255;
      }
    }
  return output;
}
