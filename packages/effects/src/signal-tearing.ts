import { mixDirection, type DirectionSampler } from './direction-field';
import { directionFieldParams } from '@gleech/project-model';
import type { EdgeHandling, SignalTearingEffect } from '@gleech/project-model';
import type { ReductionBlend } from './dither';

type Random = (x: number, y: number, lane: number) => number;
type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
const tau = Math.PI * 2;

export function tearSampler(
  p: SignalTearingEffect['params'],
  shorter: number,
  random: Random,
): (q: number) => number {
  const band = Math.max(0.0001, (shorter * p.sliceSize) / 100);
  const span = band * (p.style === 'bursts' ? p.burstLength : 1);
  const amplitude = (shorter * p.displacement) / 100;
  const phase = random(0, 0, 5);
  const cache = new Map<number, number>();
  return (q) => {
    const group = Math.floor(q / span);
    let travel = cache.get(group);
    if (travel === undefined) {
      if (random(group, 0, 0) >= p.density) travel = 0;
      else {
        const t = (((group + 0.5) * span) / shorter) * p.frequency + phase;
        const wave = p.style === 'staircase' ? 2 * (t - Math.floor(t)) - 1 : Math.sin(tau * t);
        travel =
          amplitude * (wave * (1 - p.randomness) + (random(group, 0, 1) * 2 - 1) * p.randomness);
      }
      // Bound retained state even for extremely narrow, tall image canvases.
      if (cache.size < 4096) cache.set(group, travel);
    }
    if (p.sliceSoftness === 0 || travel === 0) return travel;
    const f = q / span - group;
    const t = Math.min(1, (Math.min(f, 1 - f) * 2) / p.sliceSoftness);
    return travel * t * t * (3 - 2 * t);
  };
}

export function* signalTearingPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: SignalTearingEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: ReductionBlend,
  random: Random,
  field?: (u: number, v: number) => number,
  directionField?: DirectionSampler,
): Generator<void> {
  if (p.displacement === 0 || p.density === 0) {
    output.set(input);
    return;
  }
  const shorter = Math.min(reference.width, reference.height);
  const fx = reference.width / width,
    fy = reference.height / height;
  const angle = (p.orientation * Math.PI) / 180;
  const nx = -Math.sin(angle),
    ny = Math.cos(angle);
  const base = (p.direction * Math.PI) / 180;
  const ax = (reference.width * p.positionX) / 100,
    ay = (reference.height * p.positionY) / 100;
  const travel = tearSampler(p, shorter, random);
  const vector = new Float64Array(2),
    influence = directionFieldParams(p).directionInfluence;
  const color = new Float64Array(4),
    accumulated = new Float64Array(4),
    hidden = new Float64Array(3);
  // Reduced previews estimate the pixel area with four samples instead of
  // changing the original-image slice grid. Full-size output samples its center.
  const offsets = fx > 1.5 || fy > 1.5 ? [0.25, 0.75] : [0.5];
  const count = offsets.length ** 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      accumulated.fill(0);
      hidden.fill(0);
      for (const oy of offsets)
        for (const ox of offsets) {
          const rx = (x + ox) * fx,
            ry = (y + oy) * fy;
          const distance = travel(nx * (rx - ax) + ny * (ry - ay));
          const direction =
            base +
            (field
              ? (field(rx / reference.width, ry / reference.height) - 0.5) * tau * p.fieldInfluence
              : 0);
          let vx = Math.cos(direction),
            vy = Math.sin(direction);
          if (directionField) {
            mixDirection(
              directionField,
              rx / reference.width,
              ry / reference.height,
              vx,
              vy,
              influence,
              vector,
            );
            vx = vector[0]!;
            vy = vector[1]!;
          }
          sample(
            input,
            width,
            height,
            x - (distance * vx) / fx,
            y - (distance * vy) / fy,
            color,
            p.edgeHandling,
          );
          for (let c = 0; c < 3; c++) {
            accumulated[c]! += color[c]! * color[3]!;
            hidden[c]! += color[c]!;
          }
          accumulated[3]! += color[3]!;
        }
      for (let c = 0; c < 3; c++)
        color[c] = accumulated[3]! > 0 ? accumulated[c]! / accumulated[3]! : hidden[c]! / count;
      color[3] = accumulated[3]! / count;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
