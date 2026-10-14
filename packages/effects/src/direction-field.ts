import { directionFieldParams } from '@gleech/project-model';
import type { SpatialSample } from './spatial-mosh';
import type { ReductionBlend } from './dither';

export type DirectionSampler = (u: number, v: number, into: Float64Array) => void;
type Image = { width: number; height: number; pixels: ArrayBuffer };
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const signed = (v: number) => (v - 128) / (v >= 128 ? 127 : 128);
/** Decode before interpolation; hidden RGB and space outside the map are neutral. */
export function vectorMapSampler(map: Image): DirectionSampler {
  const pixels = new Uint8Array(map.pixels);
  return (u, v, into) => {
    const x = u * map.width - 0.5,
      y = v * map.height - 0.5;
    const bx = Math.floor(x),
      by = Math.floor(y),
      fx = x - bx,
      fy = y - by;
    into[0] = into[1] = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const sx = bx + dx,
          sy = by + dy;
        if (sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) continue;
        const i = (sy * map.width + sx) * 4,
          weight = ((dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * pixels[i + 3]!) / 255;
        into[0]! += signed(pixels[i]!) * weight;
        into[1]! += signed(pixels[i + 1]!) * weight;
      }
  };
}
function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy;
  const a = tx * tx * (3 - 2 * tx),
    b = ty * ty * (3 - 2 * ty);
  const top = hash(ix, iy, seed) * (1 - a) + hash(ix + 1, iy, seed) * a;
  const bottom = hash(ix, iy + 1, seed) * (1 - a) + hash(ix + 1, iy + 1, seed) * a;
  return top * (1 - b) + bottom * b;
}
export function createDirectionSampler(
  params: object,
  reference: { width: number; height: number },
  source: Image,
  map?: Image,
): DirectionSampler {
  const p = directionFieldParams(params),
    angle = (p.directionRotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    scale = p.directionScale / 100;
  const shorter = Math.min(reference.width, reference.height),
    data = new Uint8Array(source.pixels);
  const imported = map ? vectorMapSampler(map) : undefined;
  const height = (u: number, v: number) => {
    const x = Math.max(0, Math.min(source.width - 1, u * source.width - 0.5));
    const y = Math.max(0, Math.min(source.height - 1, v * source.height - 0.5));
    const bx = Math.floor(x),
      by = Math.floor(y),
      fx = x - bx,
      fy = y - by;
    let value = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const i =
          (Math.min(source.height - 1, by + dy) * source.width +
            Math.min(source.width - 1, bx + dx)) *
          4;
        value +=
          ((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255) *
          (data[i + 3]! / 255) *
          (dx ? fx : 1 - fx) *
          (dy ? fy : 1 - fy);
      }
    return value;
  };
  return (u, v, into) => {
    const dx = (u - p.directionX / 100) * reference.width,
      dy = (v - p.directionY / 100) * reference.height;
    const x = (dx * c + dy * s) / shorter / scale,
      y = (-dx * s + dy * c) / shorter / scale;
    const r = Math.hypot(x, y),
      div = Math.max(0.000001, r);
    let vx = 0,
      vy = 0;
    if (p.directionSource === 'linear') vx = 1;
    else if (['radial', 'toward', 'perspective'].includes(p.directionSource)) {
      const magnitude =
        p.directionSource === 'perspective' ? Math.min(1, r * 2) : Math.min(1, r * 4);
      const sign = p.directionSource === 'toward' ? -1 : 1;
      vx = (x / div) * magnitude * sign;
      vy = (y / div) * magnitude * sign;
    } else if (p.directionSource === 'circular' || p.directionSource === 'spiral') {
      const twist = p.directionSource === 'spiral' ? p.directionTwist : 0,
        normal = Math.hypot(1, twist),
        magnitude = Math.min(1, r * 4);
      vx = ((-y + x * twist) / div / normal) * magnitude;
      vy = ((x + y * twist) / div / normal) * magnitude;
    } else if (p.directionSource === 'flow') {
      const a = noise(x * 3 + 17, y * 3 + 29, p.directionSeed) * Math.PI * 4;
      const magnitude = 0.35 + noise(x * 2 + 13, y * 2 + 7, p.directionSeed + 991) * 0.65;
      vx = Math.cos(a) * magnitude;
      vy = Math.sin(a) * magnitude;
    } else if (p.directionSource === 'image' && imported) {
      imported(
        (dx * c + dy * s) / reference.width / scale + 0.5,
        (-dx * s + dy * c) / reference.height / scale + 0.5,
        into,
      );
      vx = into[0]!;
      vy = into[1]!;
    } else if (p.directionSource === 'depth-gradient') {
      const mu = (dx * c + dy * s) / reference.width / scale + 0.5,
        mv = (-dx * s + dy * c) / reference.height / scale + 0.5,
        step = 1 / 128;
      vx = clamp(
        (((height(mu + step, mv) - height(mu - step, mv)) / (2 * step)) * shorter) /
          reference.width /
          scale,
      );
      vy = clamp(
        (((height(mu, mv + step) - height(mu, mv - step)) / (2 * step)) * shorter) /
          reference.height /
          scale,
      );
    }
    const reverse = p.directionInvert === 'on' ? -1 : 1;
    into[0] = (vx * c - vy * s) * reverse;
    into[1] = (vx * s + vy * c) * reverse;
  };
}
export function mixDirection(
  field: DirectionSampler,
  u: number,
  v: number,
  x: number,
  y: number,
  influence: number,
  into: Float64Array,
) {
  field(u, v, into);
  into[0] = x * (1 - influence) + into[0]! * influence;
  into[1] = y * (1 - influence) + into[1]! * influence;
}

export function* directionWarpPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  reference: { width: number; height: number },
  field: DirectionSampler,
  travel: number,
  influence: number,
  sample: SpatialSample,
  blend: ReductionBlend,
  amount: number,
) {
  const vector = new Float64Array(2),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field((x + 0.5) / width, (y + 0.5) / height, vector);
      sample(
        input,
        width,
        height,
        x - (vector[0]! * travel * influence * width) / reference.width,
        y - (vector[1]! * travel * influence * height) / reference.height,
        color,
        'extend',
      );
      blend(output, input, (y * width + x) * 4, color, amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
