import type { CrtEffect, EdgeHandling } from '@gleech/project-model';
import { glowHighlights } from './glow';
import { createColorSampler } from './color-gradient';
import type { ReductionBlend } from './dither';

type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
type Edge = (value: number, size: number, edges: EdgeHandling) => number;
const clip = (v: number) => Math.max(0, Math.min(1, v));
const mod = (v: number, period: number) => ((v % period) + period) % period;

// Exact rectangular band coverage for a pixel footprint, including negative
// coordinates and many periods. Fine stripes/fields converge to their mean.
export function crtBand(
  center: number,
  footprint: number,
  period: number,
  start: number,
  end: number,
): number {
  const integral = (v: number) =>
    Math.floor(v / period) * (end - start) +
    Math.max(0, Math.min(end - start, mod(v, period) - start));
  return clip((integral(center + footprint / 2) - integral(center - footprint / 2)) / footprint);
}

export function crtWarp(u: number, v: number, curvature: number): readonly [number, number] {
  const x = 2 * u - 1,
    y = 2 * v - 1;
  return [(x * (1 + curvature * y * y) + 1) / 2, (y * (1 + curvature * x * x) + 1) / 2];
}
export function crtIsNeutral(p: CrtEffect['params']): boolean {
  return (
    p.curvature === 0 &&
    (p.phosphor === 'off' || p.phosphorStrength === 0) &&
    (p.fieldBlend === 0 || (p.fieldOffsetX === 0 && p.fieldOffsetY === 0)) &&
    p.bloom === 0
  );
}

// Circle mask uses a bounded sixteen-point pixel-area estimate. If a reduced
// preview spans complete periods, use a row/column or area mean instead of
// phase-dependent samples that would sparkle while dragging.
export function phosphorCoverage(
  p: CrtEffect['params'],
  channel: number,
  x: number,
  y: number,
  fx: number,
  fy: number,
): number {
  if (p.phosphor === 'off') return 1;
  const pitch = p.phosphorPitch,
    duty = p.phosphorWidth;
  const stripe = crtBand(
    x,
    fx,
    pitch,
    ((channel + (1 - duty) / 2) * pitch) / 3,
    ((channel + (1 + duty) / 2) * pitch) / 3,
  );
  if (p.phosphor === 'grille') return stripe;
  if (p.phosphor === 'slot')
    return stripe * crtBand(y, fy, pitch, ((1 - duty) * pitch) / 2, ((1 + duty) * pitch) / 2);
  const rowHeight = pitch / 2,
    radius = (pitch * duty) / 6;
  const distanceX = (sx: number, odd: number) => {
    const value =
      mod(sx - (odd * pitch) / 2 - ((channel + 0.5) * pitch) / 3 + pitch / 2, pitch) - pitch / 2;
    return value;
  };
  if (fx >= pitch && fy >= pitch) return (Math.PI * duty * duty) / 18;
  let result = 0;
  if (fx >= pitch) {
    for (let n = 0; n < 8; n++) {
      const sy = y + ((n + 0.5) / 8 - 0.5) * fy;
      const dy = mod(sy, rowHeight) - rowHeight / 2;
      result += (2 * Math.sqrt(Math.max(0, radius * radius - dy * dy))) / pitch / 8;
    }
    return clip(result);
  }
  if (fy >= pitch) {
    for (let n = 0; n < 8; n++) {
      const sx = x + ((n + 0.5) / 8 - 0.5) * fx;
      for (let odd = 0; odd < 2; odd++) {
        const dx = distanceX(sx, odd);
        result += (2 * Math.sqrt(Math.max(0, radius * radius - dx * dx))) / pitch / 8;
      }
    }
    return clip(result);
  }
  for (let iy = 0; iy < 4; iy++) {
    const sy = y + ((iy + 0.5) / 4 - 0.5) * fy,
      row = Math.floor(sy / rowHeight),
      dy = sy - (row + 0.5) * rowHeight;
    for (let ix = 0; ix < 4; ix++) {
      const dx = distanceX(x + ((ix + 0.5) / 4 - 0.5) * fx, mod(row, 2));
      if (dx * dx + dy * dy <= radius * radius) result += 1 / 16;
    }
  }
  return result;
}

export function* crtPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: CrtEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: ReductionBlend,
  edge: Edge,
): Generator<void> {
  const display = new Uint8Array(input.length),
    color = new Float64Array(4),
    shifted = new Float64Array(4);
  const fx = reference.width / width,
    fy = reference.height / height;
  const patterned = p.phosphor !== 'off' && p.phosphorStrength > 0;
  const field = p.fieldBlend > 0 && (p.fieldOffsetX !== 0 || p.fieldOffsetY !== 0);
  for (let y = 0; y < height; y++) {
    const selected = field
      ? p.fieldBlend *
        crtBand(
          (y + 0.5) * fy,
          fy,
          p.fieldSize * 2,
          p.fieldOrder === 'odd' ? p.fieldSize : 0,
          p.fieldOrder === 'odd' ? p.fieldSize * 2 : p.fieldSize,
        )
      : 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [u, v] = crtWarp((x + 0.5) / width, (y + 0.5) / height, p.curvature);
      let coverage = 1;
      if (p.clipScreen === 'on' && p.curvature > 0) {
        coverage = 0;
        for (const oy of [0.25, 0.75])
          for (const ox of [0.25, 0.75]) {
            const [su, sv] = crtWarp((x + ox) / width, (y + oy) / height, p.curvature);
            if (su >= 0 && su <= 1 && sv >= 0 && sv <= 1) coverage += 0.25;
          }
      }
      if (coverage > 0) {
        const sx = u * width - 0.5,
          sy = v * height - 0.5;
        sample(input, width, height, sx, sy, color, p.edgeHandling);
        if (selected > 0) {
          sample(
            input,
            width,
            height,
            sx - p.fieldOffsetX / fx,
            sy - p.fieldOffsetY / fy,
            shifted,
            p.edgeHandling,
          );
          const a = color[3]! * (1 - selected),
            b = shifted[3]! * selected,
            total = a + b;
          for (let c = 0; c < 3; c++)
            color[c] =
              total > 0
                ? (color[c]! * a + shifted[c]! * b) / total
                : color[c]! * (1 - selected) + shifted[c]! * selected;
          color[3] = total;
        }
        color[3] = color[3]! * coverage;
        for (let c = 0; c < 3; c++) {
          const mask =
            patterned && color[3]! > 0
              ? phosphorCoverage(p, c, (x + 0.5) * fx, (y + 0.5) * fy, fx, fy)
              : 1;
          const gain =
            patterned && color[3]! > 0 ? 1 + p.phosphorStrength * (p.phosphorGain * mask - 1) : 1;
          display[i + c] = Math.round(Math.max(0, Math.min(255, color[c]! * gain)));
        }
        display[i + 3] = Math.round(color[3]!);
      }
      if ((x & 127) === 127) yield;
    }
    yield;
  }
  const bloom =
    p.bloom > 0
      ? yield* glowHighlights(
          display,
          width,
          height,
          {
            ...p,
            radius: p.bloomRadius,
            threshold: p.bloomThreshold,
            knee: 0.15,
            strength: p.bloom,
            colorMix: p.bloomColorMix,
          },
          reference,
          edge,
        )
      : undefined;
  const tint = createColorSampler(p, 'glowColor', p.glowColor, reference);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        at = (y * width + x) * 3;
      const ink =
        p.bloomColorMix > 0 && bloom ? tint((x + 0.5) / width, (y + 0.5) / height) : undefined;
      const light =
        bloom && ink ? 0.2126 * bloom[at]! + 0.7152 * bloom[at + 1]! + 0.0722 * bloom[at + 2]! : 0;
      for (let c = 0; c < 3; c++) {
        const halo =
          bloom && display[i + 3]! > 0
            ? bloom[at + c]! * (1 - p.bloomColorMix) +
              (ink ? ((light * ink[c]!) / 255) * p.bloomColorMix : 0)
            : 0;
        color[c] = Math.min(255, display[i + c]! + halo * p.bloom);
      }
      color[3] = display[i + 3]!;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
