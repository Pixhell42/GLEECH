import type { ChromaMoshEffect, EdgeHandling } from '@gleech/project-model';

type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edge: EdgeHandling,
) => void;
type Blend = (
  output: Uint8Array,
  input: Uint8Array,
  index: number,
  color: ArrayLike<number>,
  amount: number,
) => void;

// Retain the original luminance even when the requested color falls outside RGB.
// Scaling chroma toward neutral avoids the brightness shifts caused by clipping.
export function chromaAtLuma(y: number, cb: number, cr: number, color: Float64Array): void {
  const r = 1.402 * cr,
    b = 1.772 * cb,
    g = -(0.299 * r + 0.114 * b) / 0.587;
  let scale = 1;
  for (const delta of [r, g, b])
    if (delta > 0) scale = Math.min(scale, (255 - y) / delta);
    else if (delta < 0) scale = Math.min(scale, -y / delta);
  color[0] = y + r * scale;
  color[1] = y + g * scale;
  color[2] = y + b * scale;
}

export function* chromaMoshPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: ChromaMoshEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: Blend,
  random: (x: number, y: number, lane: number) => number,
): Generator<void> {
  output.set(input);
  if (p.chromaMix === 0 || (p.style !== 'smear' && p.density === 0)) return;
  const shorter = Math.min(reference.width, reference.height);
  const cell = Math.max(1, (shorter * p.colorResolution) / 100);
  const travel = (shorter * p.displacement) / 100;
  const angle = (p.direction * Math.PI) / 180,
    dx = Math.cos(angle),
    dy = Math.sin(angle);
  const sampled = new Float64Array(4),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (input[i + 3] === 0) continue;
      const rx = ((x + 0.5) * reference.width) / width;
      const ry = ((y + 0.5) * reference.height) / height;
      const cx = Math.floor(rx / cell),
        cy = Math.floor(ry / cell);
      if (p.style !== 'smear' && random(cx, cy, 0) >= p.density) continue;
      const distance = travel * (p.style === 'smear' ? 1 : 0.35 + random(cx, cy, 1) * 1.3);
      const count = p.style === 'trails' ? p.samples : 1;
      let cb = 0,
        cr = 0,
        weight = 0;
      for (let k = 0; k < count; k++) {
        const fraction = count === 1 ? 1 : k / (count - 1);
        const sx = rx - distance * dx * fraction,
          sy = ry - distance * dy * fraction;
        // Original-coordinate color cells keep the recipe's proportions at every resolution.
        const gx = (Math.floor(sx / cell) + 0.5) * cell;
        const gy = (Math.floor(sy / cell) + 0.5) * cell;
        sample(
          input,
          width,
          height,
          (gx * width) / reference.width - 0.5,
          (gy * height) / reference.height - 0.5,
          sampled,
          p.edgeHandling,
        );
        const w = ((count === 1 ? 1 : p.persistence ** k) * sampled[3]!) / 255;
        const luma = 0.299 * sampled[0]! + 0.587 * sampled[1]! + 0.114 * sampled[2]!;
        cb += ((sampled[2]! - luma) / 1.772) * w;
        cr += ((sampled[0]! - luma) / 1.402) * w;
        weight += w;
      }
      if (weight > 0) {
        const luma = 0.299 * input[i]! + 0.587 * input[i + 1]! + 0.114 * input[i + 2]!;
        const originalCb = (input[i + 2]! - luma) / 1.772;
        const originalCr = (input[i]! - luma) / 1.402;
        chromaAtLuma(
          luma,
          originalCb + (cb / weight - originalCb) * p.chromaMix,
          originalCr + (cr / weight - originalCr) * p.chromaMix,
          color,
        );
        color[3] = input[i + 3]!;
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
