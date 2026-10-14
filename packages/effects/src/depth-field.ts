import {
  createEffect,
  type HeightFieldParams,
  type NoiseGrainEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import { createNoiseField } from './noise';
import { polygonDistance } from './shape-tiles';

export interface HeightField {
  width: number;
  height: number;
  values: Float32Array;
}
type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edge: EdgeHandling,
) => void;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
// A fixed canvas grid makes manufactured fields reusable across preview sizes and
// treatments, and bounds smoothing work independently of full-resolution exports.
export function* createHeightField(
  source: { width: number; height: number; pixels: ArrayBuffer },
  reference: { width: number; height: number },
  p: HeightFieldParams,
  sample: Sample,
  random: (x: number, y: number, lane: number) => number,
  imported?: { width: number; height: number; pixels: ArrayBuffer },
  maximum?: number,
): Generator<void, HeightField> {
  if (
    p.fieldSource === 'image' &&
    (!imported || imported.pixels.byteLength !== imported.width * imported.height * 4)
  )
    throw new Error('Invalid depth map pixels.');
  // Imported fields retain detail up to the 2048px starter-map resolution.
  if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 1))
    throw new RangeError('Invalid draft field dimension.');
  const fullLimit =
    p.fieldSource === 'image' ? Math.min(2048, Math.max(imported!.width, imported!.height)) : 256;
  const limit =
    maximum === undefined ? fullLimit : Math.max(1, Math.min(fullLimit, Math.floor(maximum)));
  const ratio = Math.min(1, limit / Math.max(reference.width, reference.height));
  const width = Math.max(1, Math.round(reference.width * ratio)),
    height = Math.max(1, Math.round(reference.height * ratio));
  let values = new Float32Array(width * height);
  const shorter = Math.min(reference.width, reference.height),
    span = (shorter * p.fieldScale) / 100;
  const angle = (p.fieldRotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const noise = createNoiseField(
    {
      ...(createEffect('noise-grain', 'field') as NoiseGrainEffect).params,
      style: ['perlin', 'simplex', 'value', 'voronoi'].includes(p.fieldSource)
        ? (p.fieldSource as NoiseGrainEffect['params']['style'])
        : 'perlin',
      detail: p.fieldDetail,
      roughness: p.fieldRoughness,
    },
    random,
  );
  const map = p.fieldSource === 'image' ? imported! : source;
  const pixels = new Uint8Array(map.pixels),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const dx = (u - p.fieldX / 100) * reference.width,
        dy = (v - p.fieldY / 100) * reference.height;
      const rx = (cosine * dx + sine * dy) / span,
        ry = (-sine * dx + cosine * dy) / span;
      let value: number;
      if (p.fieldSource === 'image') {
        const scale = p.fieldScale / 100;
        const mu = 0.5 + (cosine * dx + sine * dy) / reference.width / scale;
        const mv = 0.5 + (-sine * dx + cosine * dy) / reference.height / scale;
        sample(
          pixels,
          map.width,
          map.height,
          mu * map.width - 0.5,
          mv * map.height - 0.5,
          color,
          'extend',
        );
        value =
          (((0.2126 * color[0]! + 0.7152 * color[1]! + 0.0722 * color[2]!) / 255) * color[3]!) /
          255;
      } else if (p.fieldSource === 'brightness') {
        sample(
          pixels,
          source.width,
          source.height,
          u * source.width - 0.5,
          v * source.height - 0.5,
          color,
          'extend',
        );
        value =
          (((0.2126 * color[0]! + 0.7152 * color[1]! + 0.0722 * color[2]!) / 255) * color[3]!) /
          255;
      } else if (p.fieldSource === 'linear') value = clamp(0.5 + rx);
      else if (p.fieldSource === 'radial') value = clamp(1 - Math.hypot(rx, ry) * 2);
      else if (p.fieldSource === 'shapes') {
        const sx = rx - Math.floor(rx + 0.5),
          sy = ry - Math.floor(ry + 0.5);
        value =
          p.fieldShape === 'circle'
            ? clamp(1 - Math.hypot(sx, sy) * 2)
            : p.fieldShape === 'square'
              ? clamp(1 - Math.max(Math.abs(sx), Math.abs(sy)) * 2)
              : clamp(-polygonDistance(sx, sy, 0.5, 3) * 4);
      } else value = noise(rx + 17, ry + 29);
      values[y * width + x] = value;
      if ((x & 127) === 127) yield;
    }
    yield;
  }
  if (p.fieldSmoothing > 0) {
    const radiusX = Math.round((((shorter * p.fieldSmoothing) / 100) * width) / reference.width);
    const radiusY = Math.round((((shorter * p.fieldSmoothing) / 100) * height) / reference.height);
    let scratch = new Float32Array(values.length);
    for (let pass = 0; pass < 3; pass++)
      for (const horizontal of [true, false]) {
        const length = horizontal ? width : height,
          lines = horizontal ? height : width,
          radius = horizontal ? radiusX : radiusY;
        if (radius === 0) continue;
        const stride = horizontal ? 1 : width,
          divisor = radius * 2 + 1;
        for (let line = 0; line < lines; line++) {
          const start = horizontal ? line * width : line;
          let sum = 0;
          for (let k = -radius; k <= radius; k++)
            sum += values[start + Math.max(0, Math.min(length - 1, k)) * stride]!;
          for (let pos = 0; pos < length; pos++) {
            scratch[start + pos * stride] = clamp(sum / divisor);
            sum -= values[start + Math.max(0, pos - radius) * stride]!;
            sum += values[start + Math.min(length - 1, pos + radius + 1) * stride]!;
            if ((pos & 127) === 127) yield;
          }
          yield;
        }
        const swap = values;
        values = scratch;
        scratch = swap;
      }
  }
  let min = 1,
    max = 0;
  if (p.fieldNormalize === 'on')
    for (let i = 0; i < values.length; i++) {
      min = Math.min(min, values[i]!);
      max = Math.max(max, values[i]!);
      if ((i & 511) === 511) yield;
    }
  for (let i = 0; i < values.length; i++) {
    let value = values[i]!;
    if (p.fieldNormalize === 'on' && max > min + 1e-9) value = (value - min) / (max - min);
    value = clamp((value - 0.5) * p.fieldContrast + 0.5);
    if (p.fieldInvert === 'on') value = 1 - value;
    const range = p.fieldNear - p.fieldFar;
    value = range === 0 ? (value >= p.fieldNear ? 1 : 0) : clamp((value - p.fieldFar) / range);
    values[i] = value * (1 - p.fieldFalloff) + value * value * (3 - 2 * value) * p.fieldFalloff;
    if ((i & 511) === 511) yield;
  }
  return { width, height, values };
}
export function sampleHeight(field: HeightField, u: number, v: number): number {
  const x = Math.max(0, Math.min(field.width - 1, u * field.width - 0.5)),
    y = Math.max(0, Math.min(field.height - 1, v * field.height - 0.5));
  const left = Math.floor(x),
    top = Math.floor(y),
    right = Math.min(field.width - 1, left + 1),
    bottom = Math.min(field.height - 1, top + 1);
  const fx = x - left,
    fy = y - top;
  return (
    (field.values[top * field.width + left]! * (1 - fx) +
      field.values[top * field.width + right]! * fx) *
      (1 - fy) +
    (field.values[bottom * field.width + left]! * (1 - fx) +
      field.values[bottom * field.width + right]! * fx) *
      fy
  );
}
