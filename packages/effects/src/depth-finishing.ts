import { refineCutoutMask } from './cutout-refinement';
import type {
  DepthParallaxEffect,
  DepthHazeEffect,
  DepthColorMapEffect,
  CutoutEffect,
  LensDistortionEffect,
  SubjectMask,
} from '@gleech/project-model';
import { sampleHeight, type HeightField } from './depth-field';
import { createColorSampler } from './color-gradient';
import type { ReductionBlend } from './dither';
import type { SpatialSample, SpatialRandom } from './spatial-mosh';
type TransparentSample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
) => void;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export function* depthParallaxPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: DepthParallaxEffect['params'],
  field: HeightField,
  reference: { width: number; height: number },
  sample: SpatialSample,
  transparent: TransparentSample,
  random: SpatialRandom,
  blend: ReductionBlend,
): Generator<void> {
  if (
    (p.style === 'push-pull' && p.strength === 0) ||
    (p.style !== 'push-pull' && p.cameraX === 0 && p.cameraY === 0)
  ) {
    output.set(input);
    return;
  }
  const short = Math.min(reference.width, reference.height),
    dx = ((p.cameraX / 100) * short * width) / reference.width,
    dy = ((p.cameraY / 100) * short * height) / reference.height;
  const cx = (p.centerX / 100) * width - 0.5,
    cy = (p.centerY / 100) * height - 0.5,
    color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sx = x,
        sy = y;
      if (p.style === 'tearing') {
        const band = Math.min(
          p.bands - 1,
          Math.floor(sampleHeight(field, (x + 0.5) / width, (y + 0.5) / height) * p.bands),
        );
        const d = (band + 0.5) / p.bands - p.focusDepth + (random(band, 0, 0) * 2 - 1) * p.scatter;
        sx = x - dx * d;
        sy = y - dy * d;
      } else {
        // Bounded damped inverse of a 2.5D forward transform. It cannot reconstruct
        // occluded geometry, but avoids flat destination-only depth displacement.
        for (let iteration = 0; iteration < 6; iteration++) {
          const d = sampleHeight(field, (sx + 0.5) / width, (sy + 0.5) / height) - p.focusDepth;
          const scale = Math.max(
            0.15,
            1 + p.strength * d * (d >= 0 ? (p.nearStrength ?? 1) : (p.farStrength ?? 1)),
          );
          const tx = p.style === 'push-pull' ? cx + (x - cx) / scale : x - dx * d;
          const ty = p.style === 'push-pull' ? cy + (y - cy) / scale : y - dy * d;
          sx = sx * 0.25 + tx * 0.75;
          sy = sy * 0.25 + ty * 0.75;
        }
      }
      if (p.edges === 'transparent') transparent(input, width, height, sx, sy, color);
      else sample(input, width, height, sx, sy, color, p.edges);
      blend(output, input, (y * width + x) * 4, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* depthColorPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: DepthHazeEffect | DepthColorMapEffect,
  field: HeightField,
  reference: { width: number; height: number },
  blend: ReductionBlend,
): Generator<void> {
  const p = effect.params,
    color = new Float64Array(4);
  const sampler =
    effect.type === 'depth-haze'
      ? createColorSampler(p, 'fogColor', '#b5dce5', reference)
      : createColorSampler(
          { depthColorMode: 'gradient', depthColorEnd: '#ffd078', ...p },
          'depthColor',
          '#241050',
          reference,
          true,
        );
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        v = (y + 0.5) / height,
        h = sampleHeight(field, u, v);
      let mix = 1;
      if (effect.type === 'depth-haze') {
        const q = effect.params,
          lo = Math.min(q.start, q.end),
          hi = Math.max(q.start, q.end),
          distance = 1 - h;
        mix =
          q.density *
          (hi === lo ? (distance >= hi ? 1 : 0) : smooth((distance - lo) / (hi - lo))) ** q.falloff;
        const rgb = sampler(u, v);
        for (let c = 0; c < 3; c++) color[c] = input[i + c]! * (1 - mix) + rgb[c]! * mix;
      } else {
        const q = effect.params,
          rgb = sampler(u, v, q.reverse === 'on' ? 1 - h : h);
        const light = (0.2126 * input[i]! + 0.7152 * input[i + 1]! + 0.0722 * input[i + 2]!) / 255;
        for (let c = 0; c < 3; c++) color[c] = rgb[c]! * (1 - q.shading + q.shading * light);
      }
      color[3] = input[i + 3]!;
      if (input[i + 3] === 0 || (effect.type === 'depth-haze' && mix === 0))
        output.set(input.subarray(i, i + 4), i);
      else blend(output, input, i, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* cutoutPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: CutoutEffect['params'],
  field: HeightField | undefined,
  subject: SubjectMask | undefined,
  blend: ReductionBlend,
): Generator<void> {
  if (
    p.mode !== 'depth' &&
    (!subject || subject.values.byteLength !== subject.width * subject.height)
  )
    throw new Error('Subject detection is not available for Cutout.');
  const values = subject ? new Uint8Array(subject.values) : undefined,
    color = new Float64Array(4);
  const lo = Math.min(p.near, p.far),
    hi = Math.max(p.near, p.far);
  const above = (v: number, boundary: number) =>
    p.softness === 0 ? (v >= boundary ? 1 : 0) : smooth((v - boundary) / p.softness + 0.5);
  const confidence = (u: number, v: number) => {
    if (!subject || !values) return 0;
    const x = Math.max(0, Math.min(subject.width - 1, u * subject.width - 0.5)),
      y = Math.max(0, Math.min(subject.height - 1, v * subject.height - 0.5));
    const bx = Math.floor(x),
      by = Math.floor(y),
      fx = x - bx,
      fy = y - by;
    let result = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        result +=
          (values[
            Math.min(subject.height - 1, by + dy) * subject.width +
              Math.min(subject.width - 1, bx + dx)
          ]! /
            255) *
          (dx ? fx : 1 - fx) *
          (dy ? fy : 1 - fy);
    return result;
  };
  const keepAt = (u: number, v: number) => {
    const h = field ? sampleHeight(field, u, v) : 0;
    // Limits at black/white include endpoints, even with feathering enabled.
    const depth = (lo === 0 ? 1 : above(h, lo)) * (hi === 1 ? 1 : above(hi, h));
    const detected = p.mode === 'depth' ? 1 : above(confidence(u, v), p.subjectThreshold);
    let keep =
      p.mode === 'subject'
        ? detected
        : p.mode === 'depth'
          ? depth
          : p.combine === 'union'
            ? Math.max(depth, detected)
            : Math.min(depth, detected);
    if (p.keep === 'outside') keep = 1 - keep;
    return keep;
  };
  let refined: HeightField | undefined;
  if (
    p.fillHoles === 'on' ||
    (p.removeSpecks ?? 0) > 0 ||
    (p.cleanupSmoothing ?? 0) > 0 ||
    (p.expand ?? 0) !== 0 ||
    (p.feather ?? 0) > 0
  ) {
    const ratio = Math.min(1, 2048 / Math.max(width, height));
    const rw = Math.max(1, Math.round(width * ratio)),
      rh = Math.max(1, Math.round(height * ratio));
    const mask = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) mask[y * rw + x] = keepAt((x + 0.5) / rw, (y + 0.5) / rh);
      yield;
    }
    refined = { width: rw, height: rh, values: yield* refineCutoutMask(mask, rw, rh, p) };
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const keep = refined ? sampleHeight(refined, u, v) : keepAt(u, v);
      for (let c = 0; c < 3; c++) color[c] = input[i + c]!;
      color[3] = input[i + 3]! * keep;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* lensDistortionPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: LensDistortionEffect['params'],
  reference: { width: number; height: number },
  sample: SpatialSample,
  transparent: TransparentSample,
  blend: ReductionBlend,
): Generator<void> {
  if (p.distortion === 0 && p.secondary === 0 && p.zoom === 100) {
    output.set(input);
    return;
  }
  const radius = Math.min(reference.width, reference.height) / 2,
    cx = p.centerX / 100,
    cy = p.centerY / 100,
    zoom = p.zoom / 100,
    color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = (((x + 0.5) / width - cx) * reference.width) / radius / zoom,
        dy = (((y + 0.5) / height - cy) * reference.height) / radius / zoom;
      const r2 = dx * dx + dy * dy;
      // Clamp an extreme polynomial before it crosses through the optical center.
      const factor = Math.max(0.05, 1 + p.distortion * r2 + p.secondary * r2 * r2);
      const sx = (cx + (dx * factor * radius) / reference.width) * width - 0.5,
        sy = (cy + (dy * factor * radius) / reference.height) * height - 0.5;
      if (p.edges === 'transparent') transparent(input, width, height, sx, sy, color);
      else sample(input, width, height, sx, sy, color, p.edges);
      blend(output, input, (y * width + x) * 4, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
