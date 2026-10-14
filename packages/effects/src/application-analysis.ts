import { APPLICATION_DEFAULTS, type EffectApplication } from '@gleech/project-model';
import { sampleHeight, type HeightField } from './depth-field';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
export interface ApplicationAnalysis {
  luminance: HeightField;
  alpha: HeightField;
  edges: HeightField;
  detail: HeightField;
}
/** Stage-input analysis shared by all Application consumers within one render. */
export function* analyzeApplication(
  source: { width: number; height: number; pixels: ArrayBuffer },
  reference: { width: number; height: number },
  scale: number,
): Generator<void, ApplicationAnalysis> {
  const ratio = Math.min(1, 256 / Math.max(reference.width, reference.height));
  const width = Math.max(1, Math.round(reference.width * ratio)),
    height = Math.max(1, Math.round(reference.height * ratio));
  const luminance = new Float32Array(width * height),
    alpha = new Float32Array(width * height);
  const pixels = new Uint8Array(source.pixels);
  // Premultiplied bilinear luminance ignores hidden RGB at transparent edges.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, ((x + 0.5) * source.width) / width - 0.5));
      const sy = Math.max(
        0,
        Math.min(source.height - 1, ((y + 0.5) * source.height) / height - 0.5),
      );
      const bx = Math.floor(sx),
        by = Math.floor(sy),
        fx = sx - bx,
        fy = sy - by;
      let a = 0,
        l = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i =
            (Math.min(source.height - 1, by + dy) * source.width +
              Math.min(source.width - 1, bx + dx)) *
            4;
          const weight = ((dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * pixels[i + 3]!) / 255;
          a += weight;
          l +=
            ((pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255) *
            weight;
        }
      alpha[y * width + x] = a;
      luminance[y * width + x] = l;
    }
    yield;
  }
  const stride = width + 1,
    sums = new Float64Array(stride * (height + 1)),
    squares = new Float64Array(sums.length);
  for (let y = 0; y < height; y++) {
    let sum = 0,
      square = 0;
    for (let x = 0; x < width; x++) {
      const value = luminance[y * width + x]!;
      sum += value;
      square += value * value;
      const i = (y + 1) * stride + x + 1;
      sums[i] = sums[i - stride]! + sum;
      squares[i] = squares[i - stride]! + square;
    }
    yield;
  }
  const edges = new Float32Array(luminance.length),
    detail = new Float32Array(luminance.length);
  const rx = Math.max(
    1,
    Math.round(
      ((scale / 100) * Math.min(reference.width, reference.height) * width) / reference.width,
    ),
  );
  const ry = Math.max(
    1,
    Math.round(
      ((scale / 100) * Math.min(reference.width, reference.height) * height) / reference.height,
    ),
  );
  const at = (x: number, y: number) =>
    luminance[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        (at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1)) /
        4;
      const gy =
        (at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1)) /
        4;
      edges[y * width + x] = clamp(Math.hypot(gx, gy) * 2);
      const left = Math.max(0, x - rx),
        right = Math.min(width, x + rx + 1),
        top = Math.max(0, y - ry),
        bottom = Math.min(height, y + ry + 1);
      const count = (right - left) * (bottom - top);
      const rect = (values: Float64Array) =>
        values[bottom * stride + right]! -
        values[top * stride + right]! -
        values[bottom * stride + left]! +
        values[top * stride + left]!;
      const mean = rect(sums) / count;
      detail[y * width + x] = clamp(
        Math.sqrt(Math.max(0, rect(squares) / count - mean * mean)) * 4,
      );
    }
    yield;
  }
  const field = (values: Float32Array): HeightField => ({ width, height, values });
  return {
    luminance: field(luminance),
    alpha: field(alpha),
    edges: field(edges),
    detail: field(detail),
  };
}

export function signalApplicationSampler(
  application: EffectApplication,
  analysis?: ApplicationAnalysis,
  depth?: HeightField,
): (u: number, v: number) => number {
  const p = { ...APPLICATION_DEFAULTS, ...application },
    region = p.region;
  const above = (value: number, boundary: number) =>
    p.softness === 0
      ? Number(value >= boundary)
      : smooth((value - boundary) / (p.softness * 0.5) + 0.5);
  if (region.endsWith('-bands'))
    return (u, v) => {
      if (p.coverage === 1) return 1;
      const position = (region === 'horizontal-bands' ? v : u) * p.bandFrequency + p.bandOffset;
      return above(p.coverage / 2, Math.abs(position - Math.floor(position) - 0.5));
    };
  const field = region.startsWith('depth-')
    ? depth
    : region === 'alpha'
      ? analysis?.alpha
      : ['content-edges', 'flat-areas'].includes(region)
        ? analysis?.edges
        : ['high-detail', 'low-detail'].includes(region)
          ? analysis?.detail
          : analysis?.luminance;
  if (!field) throw new Error('Application analysis is not available.');
  const lo = Math.min(p.rangeStart, p.rangeEnd),
    hi = Math.max(p.rangeStart, p.rangeEnd);
  return (u, v) => {
    const value = sampleHeight(field, u, v);
    const window = (lo === 0 ? 1 : above(value, lo)) * (hi === 1 ? 1 : above(hi, value));
    const t = hi === lo ? 0.5 : (value - lo) / (hi - lo);
    let weight: number;
    if (['shadows', 'depth-far', 'flat-areas', 'low-detail'].includes(region))
      weight = above(p.coverage, t);
    else if (['midtones', 'depth-mid', 'depth-band'].includes(region))
      weight = above(p.coverage, Math.abs(t - 0.5) * 2);
    else if (region === 'alpha') weight = value * above(t, 1 - p.coverage);
    else weight = above(t, 1 - p.coverage);
    return clamp(window * weight);
  };
}
