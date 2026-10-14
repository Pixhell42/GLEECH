import type { NoiseGrainEffect } from '@gleech/project-model';

// Version-one counter fields have no mutable random state: changing preview
// dimensions or cancelling work cannot advance the pattern.
type Random = (x: number, y: number, lane: number) => number;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const gradients = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
] as const;
type CellCache = Map<number, { x: number; y: number; points: Float64Array }>;
function dot(random: Random, x: number, y: number, dx: number, dy: number, lane: number) {
  const g = gradients[Math.floor(random(x, y, lane) * 8)]!;
  return g[0] * dx + g[1] * dy;
}
export function noiseValue(
  style: NoiseGrainEffect['params']['style'],
  x: number,
  y: number,
  random: Random,
  lane = 0,
  cellular = 'distance',
  cells?: CellCache,
): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  if (['white', 'speckle', 'film', 'salt-pepper', 'scan'].includes(style))
    return random(ix, iy, lane);
  if (style === 'gaussian') {
    const a = Math.max(1e-9, random(ix, iy, lane)),
      b = random(ix, iy, lane + 91);
    return clamp(0.5 + (Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b)) / 6);
  }
  if (style === 'value')
    return mix(
      mix(random(ix, iy, lane), random(ix + 1, iy, lane), fade(fx)),
      mix(random(ix, iy + 1, lane), random(ix + 1, iy + 1, lane), fade(fx)),
      fade(fy),
    );
  if (style === 'perlin')
    return clamp(
      0.5 +
        mix(
          mix(
            dot(random, ix, iy, fx, fy, lane),
            dot(random, ix + 1, iy, fx - 1, fy, lane),
            fade(fx),
          ),
          mix(
            dot(random, ix, iy + 1, fx, fy - 1, lane),
            dot(random, ix + 1, iy + 1, fx - 1, fy - 1, lane),
            fade(fx),
          ),
          fade(fy),
        ) *
          0.7,
    );
  if (style === 'simplex') {
    const skew = ((x + y) * (Math.sqrt(3) - 1)) / 2;
    const i = Math.floor(x + skew),
      j = Math.floor(y + skew);
    const unskew = ((i + j) * (3 - Math.sqrt(3))) / 6;
    const x0 = x - i + unskew,
      y0 = y - j + unskew;
    const i1 = x0 > y0 ? 1 : 0,
      j1 = 1 - i1,
      g = (3 - Math.sqrt(3)) / 6;
    const contribution = (sx: number, sy: number, dx: number, dy: number) => {
      const t = 0.5 - dx * dx - dy * dy;
      return t > 0 ? t * t * t * t * dot(random, sx, sy, dx, dy, lane) : 0;
    };
    return clamp(
      0.5 +
        35 *
          (contribution(i, j, x0, y0) +
            contribution(i + i1, j + j1, x0 - i1 + g, y0 - j1 + g) +
            contribution(i + 1, j + 1, x0 - 1 + 2 * g, y0 - 1 + 2 * g)),
    );
  }
  let first = Infinity,
    second = Infinity,
    cell = 0.5;
  let neighborhood = cells?.get(lane);
  if (cells && (neighborhood?.x !== ix || neighborhood.y !== iy)) {
    const points = new Float64Array(25 * 3);
    let i = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const cx = ix + dx,
          cy = iy + dy;
        points[i++] = cx + random(cx, cy, lane + 31);
        points[i++] = cy + random(cx, cy, lane + 57);
        points[i++] = random(cx, cy, lane + 71);
      }
    neighborhood = { x: ix, y: iy, points };
    cells.set(lane, neighborhood);
  }
  let at = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const cx = ix + dx,
        cy = iy + dy;
      const deltaX = (neighborhood ? neighborhood.points[at]! : cx + random(cx, cy, lane + 31)) - x,
        deltaY = (neighborhood ? neighborhood.points[at + 1]! : cy + random(cx, cy, lane + 57)) - y;
      // A component alone bounds the distance. Distant features cannot become
      // either nearest cell; skip their hypot while preserving exact distances
      // and the original tie-breaking order for all candidates that can win.
      if (Math.abs(deltaX) >= second || Math.abs(deltaY) >= second) {
        at += 3;
        continue;
      }
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < first) {
        second = first;
        first = distance;
        cell = neighborhood ? neighborhood.points[at + 2]! : random(cx, cy, lane + 71);
      } else if (distance < second) second = distance;
      at += 3;
    }
  return cellular === 'cells'
    ? cell
    : cellular === 'borders'
      ? 1 - clamp((second - first) * 4)
      : clamp(first / Math.SQRT2);
}
export function createNoiseField(params: NoiseGrainEffect['params'], random: Random) {
  const procedural = ['perlin', 'simplex', 'value', 'voronoi'].includes(params.style);
  // Adjacent samples share the same cellular neighborhood. Keep one per lane/
  // octave, rather than hashing fifty feature coordinates for every pixel.
  const cells: CellCache | undefined = params.style === 'voronoi' ? new Map() : undefined;
  const grains = new Map<number, { x: number; y: number; value: number }>();
  return (x: number, y: number, lane = 0) => {
    if (params.style === 'salt-pepper')
      return random(Math.floor(x), Math.floor(y), lane) < (params.balance ?? 0.5) ? 1 : 0;
    if (params.style === 'scan') {
      const ix = Math.floor(x),
        iy = Math.floor(y);
      const horizontal = random(0, iy, lane + 701);
      const vertical = random(ix, 0, lane + 709);
      const line =
        params.scanDirection === 'vertical'
          ? vertical
          : params.scanDirection === 'both'
            ? (horizontal + vertical) / 2
            : horizontal;
      return mix(
        line,
        random(
          ix * 17 + Math.floor((x - ix) * 17),
          iy * 17 + Math.floor((y - iy) * 17),
          lane + 719,
        ),
        params.scanIrregularity ?? 0.15,
      );
    }
    if (!procedural) {
      const ix = Math.floor(x),
        iy = Math.floor(y),
        cached = grains.get(lane);
      if (cached?.x === ix && cached.y === iy) return cached.value;
      const value = noiseValue(params.style, x, y, random, lane);
      grains.set(lane, { x: ix, y: iy, value });
      return value;
    }
    let total = 0,
      weight = 1,
      weights = 0,
      frequency = 1;
    for (let octave = 0; octave < params.detail; octave++) {
      const v = noiseValue(
        params.style,
        x * frequency,
        y * frequency,
        random,
        lane + octave * 101,
        params.cellular,
        cells,
      );
      total +=
        (params.variant === 'turbulence'
          ? Math.abs(v * 2 - 1)
          : params.variant === 'ridged'
            ? 1 - Math.abs(v * 2 - 1)
            : v) * weight;
      weights += weight;
      weight *= params.roughness;
      frequency *= 2;
    }
    return clamp(total / weights);
  };
}
