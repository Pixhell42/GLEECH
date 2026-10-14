import type { PixelSortEffect } from '@gleech/project-model';
import { directionFieldParams } from '@gleech/project-model';
import { mixDirection, type DirectionSampler } from './direction-field';

type Blend = (
  output: Uint8Array,
  input: Uint8Array,
  index: number,
  color: ArrayLike<number>,
  amount: number,
) => void;

export function pixelSortKey(
  r: number,
  g: number,
  b: number,
  criterion: PixelSortEffect['params']['criterion'],
): number {
  if (criterion === 'brightness') return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  if (criterion === 'saturation') return max === 0 ? 0 : delta / max;
  if (delta === 0) return 0;
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (((hue / 6) % 1) + 1) % 1;
}

// A monotone digital-line offset assigns every pixel to exactly one line. Clip
// each line with binary searches so thin, wide images never scan empty squares.
function firstOffset(length: number, slope: number, target: number): number {
  let lo = 0,
    hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1,
      offset = Math.floor(mid * slope + 0.5);
    if (slope >= 0 ? offset < target : offset > target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function* pixelSortPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: PixelSortEffect['params'],
  reference: { width: number; height: number },
  blend: Blend,
  random: (x: number, y: number, lane: number) => number,
  directionField?: DirectionSampler,
): Generator<void> {
  if (directionField) {
    yield* fieldSortPixels(
      input,
      output,
      width,
      height,
      p,
      reference,
      blend,
      random,
      directionField,
    );
    return;
  }
  output.set(input);
  if (p.length === 0 || p.density === 0) return;
  const angle = (p.direction * Math.PI) / 180;
  // Snap trigonometric roundoff at cardinal angles before constructing lines.
  const dx = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
  const dy = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
  const vx = (dx * width) / reference.width,
    vy = (dy * height) / reference.height;
  const horizontal = Math.abs(vx) >= Math.abs(vy);
  const major = horizontal ? width : height,
    minor = horizontal ? height : width;
  const slope = horizontal ? vy / vx : vx / vy;
  const offsetEnd = Math.floor((major - 1) * slope + 0.5);
  const firstLine = -Math.max(0, offsetEnd),
    lastLine = minor - 1 - Math.min(0, offsetEnd);
  const physicalStep = horizontal
    ? Math.hypot(reference.width / width, (slope * reference.height) / height)
    : Math.hypot((slope * reference.width) / width, reference.height / height);
  const span = Math.abs(dx) * reference.width + Math.abs(dy) * reference.height;
  const limit = Math.min(major, Math.max(1, Math.round((span * p.length) / 100 / physicalStep)));
  if (limit < 2) return;
  const indices = new Int32Array(limit),
    keys = new Float64Array(limit),
    order = new Int32Array(limit);
  const color = new Float64Array(4);
  const sign = (p.order === 'descending' ? -1 : 1) * ((horizontal ? dx : dy) < 0 ? -1 : 1);
  const spacing = Math.max(1, Math.min(reference.width, reference.height) / 128);
  const low = Math.min(p.thresholdStart, p.thresholdEnd),
    high = Math.max(p.thresholdStart, p.thresholdEnd);
  const wraps = p.criterion === 'hue' && p.thresholdStart > p.thresholdEnd;
  let count = 0,
    anchorX = 0,
    anchorY = 0;
  function flush() {
    if (count > 1 && random(anchorX, anchorY, 0) < p.density) {
      const permutation = order.subarray(0, count);
      permutation.sort((a, b) => (keys[a]! - keys[b]!) * sign || a - b);
      for (let k = 0; k < count; k++) {
        const target = indices[k]!,
          source = indices[permutation[k]!]!;
        color[0] = input[source]!;
        color[1] = input[source + 1]!;
        color[2] = input[source + 2]!;
        color[3] = input[target + 3]!;
        blend(output, input, target, color, p.amount);
      }
    }
    count = 0;
  }
  for (let line = firstLine; line <= lastLine; line++) {
    const start = firstOffset(major, slope, slope >= 0 ? -line : minor - 1 - line);
    const end = firstOffset(major, slope, slope >= 0 ? minor - line : -line - 1);
    let previousProbe = -1;
    for (let pos = start; pos < end; pos++) {
      const cross = line + Math.floor(pos * slope + 0.5);
      const x = horizontal ? pos : cross,
        y = horizontal ? cross : pos;
      const i = (y * width + x) * 4;
      const key = pixelSortKey(input[i]!, input[i + 1]!, input[i + 2]!, p.criterion);
      const eligible =
        input[i + 3]! > 0 &&
        (wraps ? key >= p.thresholdStart || key <= p.thresholdEnd : key >= low && key <= high);
      const cx = Math.floor(((x + 0.5) * reference.width) / width / spacing);
      const cy = Math.floor(((y + 0.5) * reference.height) / height / spacing);
      const probe = horizontal ? cx : cy;
      if (
        count > 0 &&
        (count === limit ||
          !eligible ||
          (probe !== previousProbe && p.breakup > 0 && random(cx, cy, 1) < p.breakup))
      ) {
        flush();
        yield;
      }
      if (eligible) {
        if (count === 0) {
          anchorX = cx;
          anchorY = cy;
        }
        indices[count] = i;
        keys[count] = wraps ? (key - p.thresholdStart + 1) % 1 : key;
        order[count] = count;
        count++;
      }
      previousProbe = probe;
      if ((pos & 127) === 127) yield;
    }
    flush();
    yield;
  }
}

// Partition the image into bounded, non-overlapping digital streamlines. Read all
// colors from the immutable input, keeping sorting a permutation within each run.
function* fieldSortPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: PixelSortEffect['params'],
  reference: { width: number; height: number },
  blend: Blend,
  random: (x: number, y: number, lane: number) => number,
  field: DirectionSampler,
): Generator<void> {
  output.set(input);
  if (p.length === 0 || p.density === 0) return;
  const limit = Math.min(
    width * height,
    Math.max(1, Math.round((Math.max(width, height) * p.length) / 100)),
  );
  if (limit < 2) return;
  const visited = new Uint8Array(width * height),
    vector = new Float64Array(2),
    color = new Float64Array(4);
  const angle = (p.direction * Math.PI) / 180,
    nx = Math.cos(angle),
    ny = Math.sin(angle),
    influence = directionFieldParams(p).directionInfluence;
  const low = Math.min(p.thresholdStart, p.thresholdEnd),
    high = Math.max(p.thresholdStart, p.thresholdEnd),
    wraps = p.criterion === 'hue' && p.thresholdStart > p.thresholdEnd;
  const spacing = Math.max(1, Math.min(reference.width, reference.height) / 128);
  const run: number[] = [],
    keys: number[] = [];
  function flush() {
    if (run.length > 1) {
      const anchor = run[0]!,
        ax = Math.floor((((anchor % width) + 0.5) * reference.width) / width / spacing),
        ay = Math.floor(((Math.floor(anchor / width) + 0.5) * reference.height) / height / spacing);
      if (random(ax, ay, 0) < p.density) {
        const order = run
          .map((_, i) => i)
          .sort((a, b) => (keys[a]! - keys[b]!) * (p.order === 'descending' ? -1 : 1) || a - b);
        for (let i = 0; i < run.length; i++) {
          const target = run[i]! * 4,
            source = run[order[i]!]! * 4;
          color[0] = input[source]!;
          color[1] = input[source + 1]!;
          color[2] = input[source + 2]!;
          color[3] = input[target + 3]!;
          blend(output, input, target, color, p.amount);
        }
      }
    }
    run.length = keys.length = 0;
  }
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const backward: number[] = [],
      forward: number[] = [];
    for (const sign of [-1, 1]) {
      const path = sign === -1 ? backward : forward;
      let x = (seed % width) + 0.5,
        y = Math.floor(seed / width) + 0.5,
        last = seed;
      while (backward.length + forward.length + 1 < limit) {
        let next = last;
        for (let attempt = 0; attempt < 4 && next === last; attempt++) {
          mixDirection(field, x / width, y / height, nx, ny, influence, vector);
          const dx = (vector[0]! * width) / reference.width,
            dy = (vector[1]! * height) / reference.height,
            m = Math.hypot(dx, dy);
          if (m < 1e-8) break;
          x += ((sign * dx) / m) * 0.8;
          y += ((sign * dy) / m) * 0.8;
          if (x < 0 || y < 0 || x >= width || y >= height) break;
          next = Math.floor(y) * width + Math.floor(x);
        }
        if (x < 0 || y < 0 || x >= width || y >= height || next === last || visited[next]) break;
        visited[next] = 1;
        path.push(next);
        last = next;
        if ((path.length & 127) === 127) yield;
      }
    }
    const path = [...backward.reverse(), seed, ...forward];
    let previous = -1;
    for (const pixel of path) {
      const i = pixel * 4,
        key = pixelSortKey(input[i]!, input[i + 1]!, input[i + 2]!, p.criterion);
      const eligible =
        input[i + 3]! > 0 &&
        (wraps ? key >= p.thresholdStart || key <= p.thresholdEnd : key >= low && key <= high);
      const cx = Math.floor((((pixel % width) + 0.5) * reference.width) / width / spacing),
        cy = Math.floor(((Math.floor(pixel / width) + 0.5) * reference.height) / height / spacing),
        probe = cy * Math.ceil(reference.width / spacing) + cx;
      if (!eligible || (probe !== previous && p.breakup > 0 && random(cx, cy, 1) < p.breakup))
        flush();
      if (eligible) {
        run.push(pixel);
        keys.push(wraps ? (key - p.thresholdStart + 1) % 1 : key);
      }
      previous = probe;
    }
    flush();
    yield;
  }
}
