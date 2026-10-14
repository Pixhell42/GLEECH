import {
  SHAPE_TILE_DEFAULTS,
  type ShapesEffect,
  type ShapeTileParams,
} from '@gleech/project-model';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const normals = new Map<number, readonly (readonly [number, number])[]>();
export function polygonDistance(x: number, y: number, radius: number, sides: number): number {
  let edges = normals.get(sides);
  if (!edges) {
    edges = Array.from({ length: sides }, (_, i) => {
      const angle = ((2 * i + 1) * Math.PI) / sides - Math.PI / 2;
      return [Math.cos(angle), Math.sin(angle)] as const;
    });
    normals.set(sides, edges);
  }
  let distance = -Infinity;
  const apothem = radius * Math.cos(Math.PI / sides);
  for (const [nx, ny] of edges) distance = Math.max(distance, x * nx + y * ny - apothem);
  return distance;
}

export function shapeProgression(
  x: number,
  y: number,
  reference: { width: number; height: number },
  p: ShapeTileParams,
): number {
  const dx = x - (reference.width * p.progressionX) / 100;
  const dy = y - (reference.height * p.progressionY) / 100;
  const spanX = (reference.width * p.progressionRange) / 100;
  const spanY = (reference.height * p.progressionRange) / 100;
  const radius = (Math.min(reference.width, reference.height) * p.progressionRange) / 200;
  return clamp01(
    p.progressionField === 'left-right'
      ? 0.5 + dx / spanX
      : p.progressionField === 'right-left'
        ? 0.5 - dx / spanX
        : p.progressionField === 'top-bottom'
          ? 0.5 + dy / spanY
          : p.progressionField === 'bottom-top'
            ? 0.5 - dy / spanY
            : p.progressionField === 'radial'
              ? Math.hypot(dx, dy) / radius
              : Math.max(Math.abs(dx), Math.abs(dy)) / radius,
  );
}

interface Tile {
  x: number;
  y: number;
  cosine: number;
  sine: number;
  sides: number;
}
export interface TileSample {
  distance: number;
  centerX: number;
  centerY: number;
  dx: number;
  dy: number;
}

// Inverse layout lookup: enumerate only tiles whose bounds can reach this pixel.
// Coordinate-keyed randomness and a bounded cache keep sampling order immaterial.
export function createShapeTiles(
  effect: ShapesEffect,
  reference: { width: number; height: number },
  pixelWidth: number,
  random: (x: number, y: number, lane: number) => number,
) {
  const p = { ...SHAPE_TILE_DEFAULTS, ...effect.params };
  const shorter = Math.min(reference.width, reference.height);
  const spacing = (shorter * p.spacing) / 100;
  const radius = (spacing * p.size * p.scale) / 200;
  const edgeWidth = Math.min(spacing, Math.max(pixelWidth, (spacing * p.feather) / 100));
  const bound = radius * (['square', 'triangle'].includes(p.shape) ? Math.SQRT2 : 1) + edgeWidth;
  const originX = (reference.width * p.positionX) / 100;
  const originY = (reference.height * p.positionY) / 100;
  const angle = (p.layoutRotation * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const cache = new Map<string, Tile>();
  const factor = (
    style: ShapeTileParams['rotationStyle'],
    field: number,
    lane: number,
    i: number,
    j: number,
  ) =>
    style === 'uniform'
      ? 0
      : style === 'random'
        ? random(i, j, lane)
        : style === 'graduated'
          ? field * field * (3 - 2 * field)
          : field;
  function tile(i: number, j: number, localX: number, localY: number): Tile {
    const key = `${i},${j}`;
    const found = cache.get(key);
    if (found) return found;
    const x = originX + cosine * localX - sine * localY;
    const y = originY + sine * localX + cosine * localY;
    // Stabilize discrete side-count thresholds across JS engines and reference scales.
    const field = Math.round(shapeProgression(x, y, reference, p) * 1e9) / 1e9;
    const rotation =
      ((p.rotation + (p.endRotation - p.rotation) * factor(p.rotationStyle, field, 0, i, j)) *
        Math.PI) /
      180;
    const low = Math.min(p.startSides, p.endSides),
      high = Math.max(p.startSides, p.endSides);
    const sides =
      p.polygonStyle === 'random'
        ? low + Math.floor(random(i, j, 1) * (high - low + 1))
        : Math.round(
            p.startSides + (p.endSides - p.startSides) * factor(p.polygonStyle, field, 1, i, j),
          );
    const result = { x, y, cosine: Math.cos(rotation), sine: Math.sin(rotation), sides };
    if (cache.size >= 4096) cache.clear();
    cache.set(key, result);
    return result;
  }
  const result: TileSample = { distance: Infinity, centerX: 0, centerY: 0, dx: 0, dy: 0 };
  function consider(x: number, y: number, t: Tile) {
    const dx = x - t.x,
      dy = y - t.y;
    const localX = t.cosine * dx + t.sine * dy;
    const localY = -t.sine * dx + t.cosine * dy;
    const radial = Math.hypot(localX, localY);
    const distance =
      p.shape === 'polygon'
        ? polygonDistance(localX, localY, radius, t.sides)
        : p.shape === 'square'
          ? Math.max(Math.abs(localX), Math.abs(localY)) - radius
          : p.shape === 'triangle'
            ? Math.max(
                localY - radius,
                (-2 * localX - localY - radius) / Math.sqrt(5),
                (2 * localX - localY - radius) / Math.sqrt(5),
              )
            : p.shape === 'ring' && p.ringThickness < 1
              ? Math.max(radial - radius, radius * (1 - p.ringThickness) - radial)
              : radial - radius;
    // Shared polygon edges can tie between overlapping tiles. Quantize before
    // choosing a winner, so engine-sized float differences cannot swap sources.
    const stableDistance = (Math.round((distance / spacing) * 1e9) / 1e9) * spacing;
    if (stableDistance < result.distance) {
      result.distance = stableDistance;
      result.centerX = t.x;
      result.centerY = t.y;
      result.dx = dx;
      result.dy = dy;
    }
  }
  function sample(x: number, y: number): TileSample {
    result.distance = Infinity;
    const dx = x - originX,
      dy = y - originY;
    const u = cosine * dx + sine * dy,
      v = -sine * dx + cosine * dy;
    if (p.tilePattern !== 'radial') {
      for (let j = Math.ceil((v - bound) / spacing); j <= Math.floor((v + bound) / spacing); j++) {
        const offset = p.tilePattern === 'staggered' && Math.abs(j % 2) === 1 ? 0.5 : 0;
        for (
          let i = Math.ceil((u - bound) / spacing - offset);
          i <= Math.floor((u + bound) / spacing - offset);
          i++
        )
          consider(x, y, tile(i, j, (i + offset) * spacing, j * spacing));
      }
    } else {
      const radial = Math.hypot(u, v),
        theta = Math.atan2(v, u);
      const first = Math.max(0, Math.ceil((radial - bound) / spacing));
      const last = Math.floor((radial + bound) / spacing);
      for (let ring = first; ring <= last; ring++) {
        if (ring === 0) {
          consider(x, y, tile(0, 0, 0, 0));
          continue;
        }
        const r = ring * spacing,
          count = ring * p.radialRepeats;
        const step = (2 * Math.PI) / count;
        const extent = Math.ceil(Math.asin(Math.min(1, bound / r)) / step) + 1;
        const center = Math.round(theta / step);
        const all = bound >= r || 2 * extent + 1 >= count;
        const start = all ? 0 : center - extent;
        const end = all ? count - 1 : center + extent;
        for (let n = start; n <= end; n++) {
          const i = ((n % count) + count) % count;
          consider(x, y, tile(i, ring, Math.cos(i * step) * r, Math.sin(i * step) * r));
        }
      }
    }
    return result;
  }
  return { sample, radius, edgeWidth };
}
