import type { EdgeHandling } from '@gleech/project-model';

export type FieldEdge = (value: number, size: number, mode: EdgeHandling) => number;
// Three fractional box passes approximate a Gaussian. Sliding sums keep work
// linear in image size, with continuous radius changes and premultiplied fields.
export function* softField(
  input: Float32Array,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
  mode: EdgeHandling,
  edge: FieldEdge,
): Generator<void, Float32Array> {
  if (radiusX === 0 && radiusY === 0) return input;
  let source = input;
  const a = new Float32Array(input.length),
    b = new Float32Array(input.length);
  for (let pass = 0; pass < 3; pass++)
    for (let axis = 0; axis < 2; axis++) {
      const radius = (axis === 0 ? radiusX : radiusY) / Math.sqrt(3);
      if (radius === 0) continue;
      const destination = source === a ? b : a;
      const r = Math.floor(radius),
        f = radius - r,
        divisor = 2 * r + 1 + 2 * f;
      const length = axis === 0 ? width : height,
        lines = axis === 0 ? height : width;
      const stride = axis === 0 ? 4 : width * 4;
      const sums = new Float64Array(4);
      for (let line = 0; line < lines; line++) {
        const start = axis === 0 ? line * width * 4 : line * 4;
        sums.fill(0);
        for (let k = -r; k <= r; k++) {
          const i = start + edge(k, length, mode) * stride;
          for (let c = 0; c < 4; c++) sums[c] = sums[c]! + source[i + c]!;
          if ((k & 127) === 127) yield;
        }
        for (let t = 0; t < length; t++) {
          const i = start + t * stride;
          const left = start + edge(t - r - 1, length, mode) * stride;
          const right = start + edge(t + r + 1, length, mode) * stride;
          const leaving = start + edge(t - r, length, mode) * stride;
          for (let c = 0; c < 4; c++) {
            destination[i + c] =
              (sums[c]! + f * (source[left + c]! + source[right + c]!)) / divisor;
            sums[c] = sums[c]! - source[leaving + c]! + source[right + c]!;
          }
          if ((t & 127) === 127) yield;
        }
        yield;
      }
      source = destination;
    }
  return source;
}
