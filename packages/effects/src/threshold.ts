import type { ThresholdEffect } from '@gleech/project-model';
import { createColorSampler } from './color-gradient';
import type { ReductionBlend, ReductionRandom } from './dither';

const clip = (v: number) => Math.max(0, Math.min(1, v));
export const thresholdTone = (
  value: number,
  p: Pick<ThresholdEffect['params'], 'inputBlack' | 'inputWhite' | 'gamma'>,
) => clip((value - p.inputBlack) / (p.inputWhite - p.inputBlack)) ** (1 / p.gamma);
const brightness = (pixels: Uint8Array, i: number) =>
  (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
// Local means use an alpha-weighted, area-sampled field capped at 512 per side.
// Separable running sums bound memory for large exports; fine source edges are
// evaluated independently at the actual output resolution.
export function* localThresholdField(
  input: Uint8Array,
  width: number,
  height: number,
  p: ThresholdEffect['params'],
  reference: { width: number; height: number },
): Generator<void, { width: number; height: number; means: Float64Array }> {
  const scale = Math.min(1, 512 / Math.max(width, height)),
    w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const values = new Float64Array(w * h),
    weights = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const top = Math.floor((y * height) / h),
      bottom = Math.floor(((y + 1) * height) / h);
    for (let x = 0; x < w; x++) {
      const left = Math.floor((x * width) / w),
        right = Math.floor(((x + 1) * width) / w);
      let value = 0,
        weight = 0,
        scanned = 0;
      for (let py = top; py < bottom; py++)
        for (let px = left; px < right; px++) {
          const i = (py * width + px) * 4,
            a = input[i + 3]! / 255;
          value += thresholdTone(brightness(input, i), p) * a;
          weight += a;
          if ((++scanned & 255) === 0) yield;
        }
      const i = y * w + x;
      values[i] = value / ((right - left) * (bottom - top));
      weights[i] = weight / ((right - left) * (bottom - top));
      if ((x & 127) === 127) yield;
    }
    yield;
  }
  const radius = (Math.min(reference.width, reference.height) * p.localRadius) / 100;
  const rx = Math.min(w - 1, Math.max(1, Math.round((radius * w) / reference.width))),
    ry = Math.min(h - 1, Math.max(1, Math.round((radius * h) / reference.height)));
  const horizontal = new Float64Array(w * h),
    horizontalWeights = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0,
      weight = 0;
    for (let x = 0; x <= rx; x++) {
      sum += values[y * w + x]!;
      weight += weights[y * w + x]!;
    }
    for (let x = 0; x < w; x++) {
      horizontal[y * w + x] = sum;
      horizontalWeights[y * w + x] = weight;
      if (x - rx >= 0) {
        sum -= values[y * w + x - rx]!;
        weight -= weights[y * w + x - rx]!;
      }
      if (x + rx + 1 < w) {
        sum += values[y * w + x + rx + 1]!;
        weight += weights[y * w + x + rx + 1]!;
      }
    }
    yield;
  }
  const means = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0,
      weight = 0;
    for (let y = 0; y <= ry; y++) {
      sum += horizontal[y * w + x]!;
      weight += horizontalWeights[y * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      means[y * w + x] = weight > 1e-12 ? sum / weight : 0.5;
      if (y - ry >= 0) {
        sum -= horizontal[(y - ry) * w + x]!;
        weight -= horizontalWeights[(y - ry) * w + x]!;
      }
      if (y + ry + 1 < h) {
        sum += horizontal[(y + ry + 1) * w + x]!;
        weight += horizontalWeights[(y + ry + 1) * w + x]!;
      }
    }
    yield;
  }
  return { width: w, height: h, means };
}
export function* thresholdPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: ThresholdEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  random: ReductionRandom,
): Generator<void> {
  output.set(input);
  const field =
    p.local === 'on' ? yield* localThresholdField(input, width, height, p, reference) : null;
  const ink = createColorSampler(p, 'inkColor', p.inkColor, reference),
    paper = createColorSampler(p, 'paperColor', p.paperColor, reference);
  const dirtSize = Math.max(1, (Math.min(reference.width, reference.height) * p.dirtSize) / 100),
    color = new Float64Array(4);
  function meanAt(x: number, y: number) {
    if (!field) return 0.5;
    const fx = Math.max(0, Math.min(field.width - 1, ((x + 0.5) * field.width) / width - 0.5)),
      fy = Math.max(0, Math.min(field.height - 1, ((y + 0.5) * field.height) / height - 0.5));
    const left = Math.floor(fx),
      top = Math.floor(fy),
      right = Math.min(field.width - 1, left + 1),
      bottom = Math.min(field.height - 1, top + 1),
      u = fx - left,
      v = fy - top;
    return (
      field.means[top * field.width + left]! * (1 - u) * (1 - v) +
      field.means[top * field.width + right]! * u * (1 - v) +
      field.means[bottom * field.width + left]! * (1 - u) * v +
      field.means[bottom * field.width + right]! * u * v
    );
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (input[i + 3] === 0) continue;
      const original = thresholdTone(brightness(input, i), p);
      let tone = field?.means?.length ? 0.5 + original - meanAt(x, y) : original;
      if (p.style === 'photocopy' && p.edgeEmphasis > 0) {
        let edge = 0,
          weight = 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nx = Math.max(0, Math.min(width - 1, x + dx!)),
            ny = Math.max(0, Math.min(height - 1, y + dy!)),
            j = (ny * width + nx) * 4,
            a = input[j + 3]! / 255;
          edge += Math.abs(original - thresholdTone(brightness(input, j), p)) * a;
          weight += a;
        }
        tone -= p.edgeEmphasis * (weight > 0 ? edge / weight : 0);
      }
      let level =
        p.style === 'bitmap'
          ? Math.round(clip(tone + 0.5 - p.threshold) * (p.levels - 1)) / (p.levels - 1)
          : tone >= p.threshold - 1e-12
            ? 1
            : 0;
      const rx = ((x + 0.5) * reference.width) / width,
        ry = ((y + 0.5) * reference.height) / height;
      if (p.style === 'photocopy' && p.dirt > 0) {
        const cx = Math.floor(rx / dirtSize),
          cy = Math.floor(ry / dirtSize);
        if (random(cx, cy, 0) < p.dirt) level = random(cx, cy, 1) < 0.5 ? 0 : 1;
      }
      if (p.invert === 'on') level = 1 - level;
      const dark = ink((x + 0.5) / width, (y + 0.5) / height),
        light = paper((x + 0.5) / width, (y + 0.5) / height);
      for (let c = 0; c < 3; c++) color[c] = dark[c]! + (light[c]! - dark[c]!) * level;
      color[3] = input[i + 3]!;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
