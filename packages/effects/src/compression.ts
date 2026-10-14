import type { CompressionBreakupEffect, EdgeHandling } from '@gleech/project-model';

type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
type Blend = (
  output: Uint8Array,
  input: Uint8Array,
  index: number,
  color: ArrayLike<number>,
  amount: number,
) => void;
type Random = (x: number, y: number, lane: number) => number;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const stable = (v: number) => Math.round(v * 1e8) / 1e8;
// Orthonormal 8 × 8 transform, reused for every block and channel.
const basis = Float64Array.from({ length: 64 }, (_, i) => {
  const k = Math.floor(i / 8),
    x = i % 8;
  return (k === 0 ? Math.sqrt(1 / 8) : 0.5) * Math.cos(((2 * x + 1) * k * Math.PI) / 16);
});

function transform(
  data: Float64Array,
  offset: number,
  scratch: Float64Array,
  coefficients: Float64Array,
  strength: number,
  channel: number,
  damage: string,
  severity: number,
  random: Random,
  cx: number,
  cy: number,
) {
  for (let y = 0; y < 8; y++)
    for (let k = 0; k < 8; k++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += data[offset + y * 8 + x]! * basis[k * 8 + x]!;
      scratch[y * 8 + k] = sum;
    }
  for (let ky = 0; ky < 8; ky++)
    for (let kx = 0; kx < 8; kx++) {
      let value = 0;
      for (let y = 0; y < 8; y++) value += scratch[y * 8 + kx]! * basis[ky * 8 + y]!;
      const i = ky * 8 + kx;
      const step = strength * strength * (3 + 2 * (kx + ky) ** 2) * (channel === 0 ? 1 : 1.5);
      if (step >= 1e-6) value = Math.round(stable(value / step)) * step;
      if (
        damage === 'coefficient-loss' &&
        i > 0 &&
        random(cx, cy, 200 + channel * 64 + i) < severity
      )
        value = 0;
      if (damage === 'dropout' && i === 0) {
        const target = channel === 0 ? random(cx, cy, 30) * 255 : 0;
        value = value * (1 - severity) + target * 8 * severity;
      }
      coefficients[i] = value;
    }
  for (let y = 0; y < 8; y++)
    for (let kx = 0; kx < 8; kx++) {
      let sum = 0;
      for (let ky = 0; ky < 8; ky++) sum += coefficients[ky * 8 + kx]! * basis[ky * 8 + y]!;
      scratch[y * 8 + kx] = sum;
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let kx = 0; kx < 8; kx++) sum += scratch[y * 8 + kx]! * basis[kx * 8 + x]!;
      data[offset + y * 8 + x] = sum;
    }
}

function gridAt(data: Float64Array, offset: number, x: number, y: number) {
  x = clamp(x, 0, 7);
  y = clamp(y, 0, 7);
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const a = offset + iy * 8 + ix,
    b = offset + iy * 8 + Math.min(7, ix + 1);
  const c = offset + Math.min(7, iy + 1) * 8 + ix,
    d = offset + Math.min(7, iy + 1) * 8 + Math.min(7, ix + 1);
  return (
    (data[a]! * (1 - fx) + data[b]! * fx) * (1 - fy) + (data[c]! * (1 - fx) + data[d]! * fx) * fy
  );
}

export function compressionIsNeutral(p: CompressionBreakupEffect['params']) {
  return (
    p.compression === 0 &&
    p.colorResolution === 'full' &&
    p.colorBleed === 0 &&
    p.ringing === 0 &&
    p.seams === 0 &&
    (p.damageDensity === 0 || p.damageStrength === 0)
  );
}

// Sample a fixed original-canvas grid and reconstruct one block at a time.
// Scratch is constant-sized; each visible block is processed once, even in drafts.
// This is an artistic transform simulation, not a JPEG bitstream round trip.
export function* compressionPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: CompressionBreakupEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: Blend,
  random: Random,
): Generator<void> {
  if (compressionIsNeutral(p)) {
    output.set(input);
    return;
  }
  const block = Math.max(8, (Math.min(reference.width, reference.height) * p.blockSize) / 100);
  const stepX = reference.width / width,
    stepY = reference.height / height;
  const group = { full: 1, half: 2, quarter: 4, block: 8 }[p.colorResolution];
  const data = new Float64Array(192),
    scratch = new Float64Array(64),
    coefficients = new Float64Array(64);
  const alpha = new Float64Array(64),
    color = new Float64Array(4),
    mean = new Float64Array(3);
  for (let y0 = 0; y0 < height;) {
    const cy = Math.floor(((y0 + 0.5) * stepY) / block);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(((cy + 1) * block) / stepY - 0.5)));
    for (let x0 = 0; x0 < width;) {
      const cx = Math.floor(((x0 + 0.5) * stepX) / block);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(((cx + 1) * block) / stepX - 0.5)));
      mean.fill(0);
      let weight = 0;
      for (let gy = 0; gy < 8; gy++)
        for (let gx = 0; gx < 8; gx++) {
          const i = gy * 8 + gx;
          sample(
            input,
            width,
            height,
            ((cx + (gx + 0.5) / 8) * block) / stepX - 0.5,
            ((cy + (gy + 0.5) / 8) * block) / stepY - 0.5,
            color,
            p.edgeHandling,
          );
          const a = color[3]! / 255;
          const luminance = 0.299 * color[0]! + 0.587 * color[1]! + 0.114 * color[2]!;
          data[i] = luminance;
          data[64 + i] = (color[2]! - luminance) / 1.772;
          data[128 + i] = (color[0]! - luminance) / 1.402;
          alpha[i] = a;
          weight += a;
          for (let ch = 0; ch < 3; ch++) mean[ch] = mean[ch]! + data[ch * 64 + i]! * a;
        }
      if (weight > 0) {
        for (let ch = 0; ch < 3; ch++) mean[ch] = mean[ch]! / weight;
        // Transparent colors must not enter the transform. Fill missing samples
        // from visible block colors; keep original alpha and hidden pixels below.
        for (let i = 0; i < 64; i++)
          if (alpha[i] === 0) for (let ch = 0; ch < 3; ch++) data[ch * 64 + i] = mean[ch]!;
        if (group !== 1 || p.colorBleed !== 0)
          for (let gy = 0; gy < 8; gy += group)
            for (let gx = 0; gx < 8; gx += group) {
              sample(
                input,
                width,
                height,
                ((cx + (gx + group / 2) / 8 + p.colorBleed) * block) / stepX - 0.5,
                ((cy + (gy + group / 2) / 8) * block) / stepY - 0.5,
                color,
                p.edgeHandling,
              );
              const luminance = 0.299 * color[0]! + 0.587 * color[1]! + 0.114 * color[2]!;
              const cb = color[3]! > 0 ? (color[2]! - luminance) / 1.772 : mean[1]!;
              const cr = color[3]! > 0 ? (color[0]! - luminance) / 1.402 : mean[2]!;
              for (let dy = 0; dy < group; dy++)
                for (let dx = 0; dx < group; dx++) {
                  const i = (gy + dy) * 8 + gx + dx;
                  data[64 + i] = cb;
                  data[128 + i] = cr;
                }
            }
        yield;
        const damaged = p.damageStrength > 0 && random(cx, cy, 0) < p.damageDensity;
        const damage = damaged
          ? p.damageMode === 'mixed'
            ? ['color-shift', 'dropout', 'coefficient-loss'][Math.floor(random(cx, cy, 1) * 3)]!
            : p.damageMode
          : '';
        for (let ch = 0; ch < 3; ch++) {
          transform(
            data,
            ch * 64,
            scratch,
            coefficients,
            p.compression,
            ch,
            damage,
            p.damageStrength,
            random,
            cx,
            cy,
          );
          yield;
        }
        const cbShift =
          damage === 'color-shift' ? (random(cx, cy, 2) * 2 - 1) * 127 * p.damageStrength : 0;
        const crShift =
          damage === 'color-shift' ? (random(cx, cy, 3) * 2 - 1) * 127 * p.damageStrength : 0;
        const detailMix = Math.max(
          p.compression,
          damage === 'dropout' || damage === 'coefficient-loss' ? p.damageStrength : 0,
        );
        const chromaMix = group !== 1 || p.colorBleed !== 0 ? 1 : detailMix;
        for (let y = y0; y < y1; y++) {
          const v = stable(((y + 0.5) * stepY) / block - cy),
            sy = v * 8 - 0.5;
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            if (input[i + 3] === 0) {
              output.set(input.subarray(i, i + 4), i);
              continue;
            }
            const u = stable(((x + 0.5) * stepX) / block - cx),
              sx = u * 8 - 0.5;
            const originalY = 0.299 * input[i]! + 0.587 * input[i + 1]! + 0.114 * input[i + 2]!;
            const decodedY = gridAt(data, 0, sx, sy);
            let luminance = originalY + (decodedY - originalY) * detailMix;
            if (p.ringing > 0)
              luminance +=
                p.ringing *
                1.5 *
                (decodedY -
                  (gridAt(data, 0, sx - 1, sy) +
                    gridAt(data, 0, sx + 1, sy) +
                    gridAt(data, 0, sx, sy - 1) +
                    gridAt(data, 0, sx, sy + 1)) /
                    4);
            const seam = p.seams * Math.max(0, 1 - Math.min(u, 1 - u, v, 1 - v) * 8) * 0.7;
            luminance *= 1 - seam;
            const originalCb = (input[i + 2]! - originalY) / 1.772,
              originalCr = (input[i]! - originalY) / 1.402;
            const cb = originalCb + (gridAt(data, 64, sx, sy) - originalCb) * chromaMix + cbShift,
              cr = originalCr + (gridAt(data, 128, sx, sy) - originalCr) * chromaMix + crShift;
            color[0] = clamp(stable(luminance + 1.402 * cr), 0, 255);
            color[1] = clamp(stable(luminance - 0.344136 * cb - 0.714136 * cr), 0, 255);
            color[2] = clamp(stable(luminance + 1.772 * cb), 0, 255);
            color[3] = input[i + 3]!;
            blend(output, input, i, color, p.amount);
            if ((x & 127) === 127) yield;
          }
          yield;
        }
      } else {
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            output.set(input.subarray(i, i + 4), i);
            if ((x & 127) === 127) yield;
          }
          yield;
        }
      }
      x0 = x1;
    }
    y0 = y1;
  }
}
