import type { FeedbackBloomEffect, EdgeHandling } from '@gleech/project-model';

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

// Every render begins with explicit input pixels, never with the displayed preview.
// Two reusable buffers bound memory independently of the number of feedback passes.
export function* feedbackPixels(
  input: Uint8Array,
  width: number,
  height: number,
  p: FeedbackBloomEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: Blend,
  random: (x: number, y: number, lane: number) => number,
): Generator<void, Uint8Array> {
  if (
    p.persistence === 0 ||
    (p.displacement === 0 && p.scale === 1 && p.rotation === 0 && p.decay === 0)
  )
    return input;
  let previous = input;
  let next: Uint8Array = new Uint8Array(input.length);
  let spare: Uint8Array = new Uint8Array(input.length);
  const color = new Float64Array(4);
  const shorter = Math.min(reference.width, reference.height);
  const period = (shorter * p.coherence) / 100;
  const travel = (shorter * p.displacement) / 100;
  const angle = (p.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const direction = (p.direction * Math.PI) / 180;
  const directionX = Math.cos(direction),
    directionY = Math.sin(direction);
  const stepX = reference.width / width,
    stepY = reference.height / height;
  const cx = (reference.width * p.centerX) / 100,
    cy = (reference.height * p.centerY) / 100;
  const phase = random(0, 0, 19) * Math.PI * 2;
  for (let pass = 0; pass < p.iterations; pass++) {
    for (let y = 0; y < height; y++) {
      const ry = (y + 0.5) * stepY;
      const cellY = Math.floor(ry / period);
      let lastCell = -1,
        refreshed = false;
      for (let x = 0; x < width; x++) {
        const rx = (x + 0.5) * stepX;
        const i = (y * width + x) * 4;
        if (p.refresh > 0) {
          const cellX = Math.floor(rx / period);
          if (cellX !== lastCell) {
            lastCell = cellX;
            refreshed = random(cellX, cellY, pass + 101) < p.refresh;
          }
        }
        if (refreshed) {
          for (let c = 0; c < 4; c++) next[i + c] = input[i + c]!;
          if ((x & 127) === 127) yield;
          continue;
        }
        const dx = rx - cx,
          dy = ry - cy;
        const flow = 0.65 + 0.35 * Math.sin(((rx + ry * 0.3) / period) * Math.PI * 2 + phase);
        const radial = p.style === 'melt' ? 0 : Math.hypot(dx, dy);
        const vx = p.style === 'melt' ? directionX : radial > 0 ? dx / radial : 0;
        const vy = p.style === 'melt' ? directionY : radial > 0 ? dy / radial : 0;
        const sx = cx + (cosine * dx + sine * dy) / p.scale - vx * travel * flow;
        const sy = cy + (-sine * dx + cosine * dy) / p.scale - vy * travel * flow;
        sample(previous, width, height, sx / stepX - 0.5, sy / stepY - 0.5, color, p.edgeHandling);
        color[3] = color[3]! * (1 - p.decay);
        blend(next, input, i, color, p.persistence);
        if ((x & 127) === 127) yield;
      }
      yield;
    }
    previous = next;
    next = spare;
    spare = previous;
  }
  return previous;
}
