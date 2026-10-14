import { CUTOUT_REFINEMENT_DEFAULTS, type CutoutEffect } from '@gleech/project-model';
const clamp = (value: number, size: number) => Math.max(0, Math.min(size - 1, value));

function* smoothMask(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
): Generator<void, Float32Array> {
  let source = input;
  for (let pass = 0; pass < 3; pass++)
    for (let axis = 0; axis < 2; axis++) {
      const destination = new Float32Array(input.length),
        length = axis === 0 ? width : height,
        lines = axis === 0 ? height : width;
      const r = Math.floor(radius / Math.sqrt(3)),
        f = radius / Math.sqrt(3) - r,
        divisor = 2 * r + 1 + 2 * f;
      const index = (line: number, t: number) =>
        axis === 0 ? line * width + clamp(t, width) : clamp(t, height) * width + line;
      for (let line = 0; line < lines; line++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += source[index(line, k)]!;
        for (let t = 0; t < length; t++) {
          destination[index(line, t)] =
            (sum + f * (source[index(line, t - r - 1)]! + source[index(line, t + r + 1)]!)) /
            divisor;
          sum += source[index(line, t + r + 1)]! - source[index(line, t - r)]!;
        }
        yield;
      }
      source = destination;
    }
  return source;
}
/** Exact squared Euclidean distance transform, bounded to the refinement grid. */
function* distanceTo(
  mask: Float32Array,
  width: number,
  height: number,
  foreground: boolean,
): Generator<void, Float32Array> {
  let source = Float32Array.from(mask, (value) => (value >= 0.5 === foreground ? 0 : 1e12));
  const maximum = Math.max(width, height),
    f = new Float64Array(maximum),
    v = new Int32Array(maximum),
    z = new Float64Array(maximum + 1);
  for (let axis = 0; axis < 2; axis++) {
    const destination = new Float32Array(source.length),
      length = axis === 0 ? width : height,
      lines = axis === 0 ? height : width;
    const index = (line: number, t: number) => (axis === 0 ? line * width + t : t * width + line);
    for (let line = 0; line < lines; line++) {
      for (let q = 0; q < length; q++) f[q] = source[index(line, q)]!;
      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (let q = 1; q < length; q++) {
        let s: number;
        do {
          const vk = v[k]!;
          s = (f[q]! + q * q - (f[vk]! + vk * vk)) / (2 * (q - vk));
          if (s <= z[k]!) k--;
          else break;
        } while (k >= 0);
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < length; q++) {
        while (z[k + 1]! < q) k++;
        const d = q - v[k]!;
        destination[index(line, q)] = d * d + f[v[k]!]!;
      }
      yield;
    }
    source = destination;
  }
  return source;
}

export function* refineCutoutMask(
  input: Float32Array,
  width: number,
  height: number,
  params: CutoutEffect['params'],
): Generator<void, Float32Array> {
  const p = { ...CUTOUT_REFINEMENT_DEFAULTS, ...params };
  let mask: Float32Array = input.slice();
  if (p.fillHoles === 'on' || p.removeSpecks > 0) {
    const visited = new Uint8Array(mask.length),
      queue = new Uint32Array(mask.length);
    let head = 0,
      tail = 0;
    const enqueue = (index: number, foreground: boolean) => {
      if (!visited[index] && mask[index]! >= 0.5 === foreground) {
        visited[index] = 1;
        queue[tail++] = index;
      }
    };
    function* flood(foreground: boolean): Generator<void> {
      while (head < tail) {
        const i = queue[head++]!,
          x = i % width,
          y = Math.floor(i / width);
        if (x > 0) enqueue(i - 1, foreground);
        if (x + 1 < width) enqueue(i + 1, foreground);
        if (y > 0) enqueue(i - width, foreground);
        if (y + 1 < height) enqueue(i + width, foreground);
        if ((head & 8191) === 0) yield;
      }
    }
    if (p.fillHoles === 'on') {
      for (let x = 0; x < width; x++) {
        enqueue(x, false);
        enqueue((height - 1) * width + x, false);
      }
      for (let y = 0; y < height; y++) {
        enqueue(y * width, false);
        enqueue(y * width + width - 1, false);
      }
      yield* flood(false);
      for (let i = 0; i < mask.length; i++) {
        if (!visited[i] && mask[i]! < 0.5) mask[i] = 1;
        if ((i & 8191) === 0) yield;
      }
    }
    if (p.removeSpecks > 0) {
      visited.fill(0);
      const maximum = (p.removeSpecks / 100) * mask.length;
      for (let i = 0; i < mask.length; i++) {
        if (!visited[i] && mask[i]! >= 0.5) {
          head = tail = 0;
          enqueue(i, true);
          yield* flood(true);
          if (tail <= maximum) for (let j = 0; j < tail; j++) mask[queue[j]!] = 0;
        }
        if ((i & 8191) === 0) yield;
      }
    }
  }
  const shorter = Math.min(width, height);
  if (p.cleanupSmoothing > 0)
    mask = yield* smoothMask(mask, width, height, (p.cleanupSmoothing / 100) * shorter);
  if (p.expand !== 0 || p.feather > 0) {
    const inside = yield* distanceTo(mask, width, height, false),
      outside = yield* distanceTo(mask, width, height, true);
    const delta = (p.expand / 100) * shorter,
      feather = (p.feather / 100) * shorter;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        // Outside the canvas is background, so contraction also works on a
        // completely filled mask and on objects touching its border.
        const signed =
          mask[i]! >= 0.5
            ? Math.min(Math.sqrt(inside[i]!), x + 1, width - x, y + 1, height - y) - 0.5
            : 0.5 - Math.sqrt(outside[i]!);
        const t =
          feather === 0
            ? Number(signed + delta >= 0)
            : Math.max(0, Math.min(1, (signed + delta) / feather + 0.5));
        mask[i] = feather === 0 ? t : t * t * (3 - 2 * t);
      }
      yield;
    }
  }
  return mask;
}
