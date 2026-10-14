import type { EdgeHandling, GlowEffect } from '@gleech/project-model';

type EdgeIndex = (value: number, size: number, mode: EdgeHandling) => number;

// Sliding windows make each separable pass linear in image size, independent of
// halo radius. Three box passes approximate a soft Gaussian highlight spread.
function* boxPass(
  input: Float32Array,
  output: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  mode: EdgeHandling,
  edge: EdgeIndex,
): Generator<void> {
  const length = horizontal ? width : height,
    lines = horizontal ? height : width;
  const stride = horizontal ? 3 : width * 3;
  const sum = new Float64Array(3),
    divisor = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width * 3 : line * 3;
    sum.fill(0);
    for (let k = -radius; k <= radius; k++) {
      const index = start + edge(k, length, mode) * stride;
      for (let c = 0; c < 3; c++) sum[c] = sum[c]! + input[index + c]!;
      if ((k & 127) === 127) yield;
    }
    for (let position = 0; position < length; position++) {
      const index = start + position * stride;
      for (let c = 0; c < 3; c++) output[index + c] = Math.max(0, sum[c]! / divisor);
      const leaving = start + edge(position - radius, length, mode) * stride;
      const entering = start + edge(position + radius + 1, length, mode) * stride;
      for (let c = 0; c < 3; c++) sum[c] = sum[c]! - input[leaving + c]! + input[entering + c]!;
      if ((position & 127) === 127) yield;
    }
    yield;
  }
}

export function* glowHighlights(
  pixels: Uint8Array,
  width: number,
  height: number,
  params: GlowEffect['params'],
  reference: { width: number; height: number },
  edge: EdgeIndex,
): Generator<void, Float32Array> {
  const field = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const luma =
        (0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!) / 255;
      const soft = Math.max(0, Math.min(2 * params.knee, luma - params.threshold + params.knee));
      const weight =
        Math.max(luma - params.threshold, params.knee > 0 ? (soft * soft) / (4 * params.knee) : 0) /
        Math.max(luma, 1e-12);
      const alpha = pixels[index + 3]! / 255;
      for (let c = 0; c < 3; c++)
        field[(y * width + x) * 3 + c] = pixels[index + c]! * alpha * weight;
      if ((x & 127) === 127) yield;
    }
    yield;
  }
  if (params.radius === 0) return field;
  const radius = (Math.min(reference.width, reference.height) * params.radius) / 100;
  const radiusX = Math.round((radius * width) / reference.width);
  const radiusY = Math.round((radius * height) / reference.height);
  if (radiusX === 0 && radiusY === 0) return field;
  const scratch = new Float32Array(field.length);
  for (let pass = 0; pass < 3; pass++) {
    yield* boxPass(field, scratch, width, height, radiusX, true, params.edgeHandling, edge);
    yield* boxPass(scratch, field, width, height, radiusY, false, params.edgeHandling, edge);
  }
  return field;
}
