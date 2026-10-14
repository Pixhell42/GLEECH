import { gradientStops, type IndexedPaletteEffect } from '@gleech/project-model';
import type { ReductionMapper, ReductionRandom } from './dither';

export type PaletteColor = readonly [number, number, number];
export function colorRamp(
  params: Readonly<Record<string, number | string>>,
  key: string,
  start: string,
  end: string,
): (value: number) => PaletteColor {
  const stops = gradientStops(params, key, start, end).map((s) => ({
    ...s,
    rgb: [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16)),
  }));
  return (value) => {
    const t = Math.max(0, Math.min(1, value));
    let i = 0;
    while (i < stops.length - 2 && t >= stops[i + 1]!.position) i++;
    const a = stops[i]!,
      b = stops[i + 1]!,
      u =
        b.position === a.position
          ? 1
          : Math.max(0, Math.min(1, (t - a.position) / (b.position - a.position)));
    return [
      a.rgb[0]! + (b.rgb[0]! - a.rgb[0]!) * u,
      a.rgb[1]! + (b.rgb[1]! - a.rgb[1]!) * u,
      a.rgb[2]! + (b.rgb[2]! - a.rgb[2]!) * u,
    ];
  };
}
const sourceCache = new WeakMap<ArrayBuffer, Map<number, readonly PaletteColor[]>>();
interface Bin {
  rgb: PaletteColor;
  weight: number;
}
// Alpha-weighted, deterministic stratified source sampling into a 5-bit RGB
// histogram, followed by weighted median cut. Scratch is bounded independently
// of original image size. Hidden transparent colors never enter the palette.
export function* sampledPalette(
  source: { width: number; height: number; pixels: ArrayBuffer },
  count: number,
): Generator<void, readonly PaletteColor[]> {
  const cached = sourceCache.get(source.pixels)?.get(count);
  if (cached) return cached;
  const pixels = new Uint8Array(source.pixels);
  const bins = new Float64Array(32768 * 4);
  const scale = Math.min(1, Math.sqrt(65536 / (source.width * source.height)));
  const width = Math.max(1, Math.floor(source.width * scale)),
    height = Math.max(1, Math.floor(source.height * scale));
  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(((x + 0.5) * source.width) / width)),
        i = (sy * source.width + sx) * 4,
        a = pixels[i + 3]!;
      if (a > 0) {
        const r = pixels[i]!,
          g = pixels[i + 1]!,
          b = pixels[i + 2]!,
          bin = ((r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3)) * 4;
        bins[bin] = bins[bin]! + a;
        bins[bin + 1] = bins[bin + 1]! + r * a;
        bins[bin + 2] = bins[bin + 2]! + g * a;
        bins[bin + 3] = bins[bin + 3]! + b * a;
      }
      if ((x & 255) === 255) yield;
    }
    yield;
  }
  const points: Bin[] = [];
  for (let i = 0; i < bins.length; i += 4) {
    const weight = bins[i]!;
    if (weight > 0)
      points.push({
        weight,
        rgb: [bins[i + 1]! / weight, bins[i + 2]! / weight, bins[i + 3]! / weight],
      });
    if ((i & 4095) === 4092) yield;
  }
  type Box = { points: Bin[]; axis: number; score: number; weight: number };
  const box = (points: Bin[]): Box => {
    const low = [255, 255, 255],
      high = [0, 0, 0];
    let weight = 0;
    for (const point of points) {
      weight += point.weight;
      for (let c = 0; c < 3; c++) {
        low[c] = Math.min(low[c]!, point.rgb[c]!);
        high[c] = Math.max(high[c]!, point.rgb[c]!);
      }
    }
    const spans = high.map((v, c) => v - low[c]!);
    const axis = spans.indexOf(Math.max(...spans));
    return {
      points,
      axis,
      weight,
      score: points.length > 1 ? Math.max(...spans) * Math.sqrt(weight) : 0,
    };
  };
  const boxes = points.length ? [box(points)] : [];
  while (boxes.length < count) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i]!.score > 0 && (best < 0 || boxes[i]!.score > boxes[best]!.score)) best = i;
    if (best < 0) break;
    const current = boxes[best]!;
    current.points.sort(
      (a, b) =>
        a.rgb[current.axis]! - b.rgb[current.axis]! ||
        a.rgb[0] - b.rgb[0] ||
        a.rgb[1] - b.rgb[1] ||
        a.rgb[2] - b.rgb[2],
    );
    let sum = 0,
      split = 1;
    for (let i = 0; i < current.points.length - 1; i++) {
      sum += current.points[i]!.weight;
      split = i + 1;
      if (sum >= current.weight / 2) break;
    }
    boxes.splice(best, 1, box(current.points.slice(0, split)), box(current.points.slice(split)));
    yield;
  }
  const result = boxes.map(
    ({ points, weight }) =>
      [0, 1, 2].map((c) =>
        Math.round(points.reduce((sum, p) => sum + p.rgb[c]! * p.weight, 0) / weight),
      ) as unknown as PaletteColor,
  );
  if (!result.length) result.push([0, 0, 0]);
  result.sort(
    (a, b) =>
      0.2126 * a[0] +
        0.7152 * a[1] +
        0.0722 * a[2] -
        (0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]) ||
      a[0] - b[0] ||
      a[1] - b[1] ||
      a[2] - b[2],
  );
  let cache = sourceCache.get(source.pixels);
  if (!cache) {
    cache = new Map();
    sourceCache.set(source.pixels, cache);
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(count, result);
  return result;
}
export function fixedPalette(p: IndexedPaletteEffect['params']): readonly PaletteColor[] {
  let colors: PaletteColor[] = [];
  if (p.palette === 'custom') {
    const ramp = colorRamp(p, 'paletteStart', p.paletteStart, p.paletteEnd);
    return Array.from(
      { length: p.colors },
      (_, i) => ramp(i / (p.colors - 1)).map(Math.round) as unknown as PaletteColor,
    );
  }
  if (p.palette === 'monochrome')
    colors = [
      [0, 0, 0],
      [255, 255, 255],
    ];
  else if (p.palette === 'gameboy')
    colors = [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ];
  else if (p.palette === 'cga')
    colors = Array.from({ length: 16 }, (_, i) => {
      const bright = i & 8 ? 85 : 0;
      return i === 6
        ? [170, 85, 0]
        : [(i & 4 ? 170 : 0) + bright, (i & 2 ? 170 : 0) + bright, (i & 1 ? 170 : 0) + bright];
    });
  else if (p.palette === 'ega')
    colors = Array.from({ length: 64 }, (_, i) => [
      (i & 4 ? 170 : 0) + (i & 32 ? 85 : 0),
      (i & 2 ? 170 : 0) + (i & 16 ? 85 : 0),
      (i & 1 ? 170 : 0) + (i & 8 ? 85 : 0),
    ]);
  else if (p.palette === 'rgb332')
    colors = Array.from({ length: 256 }, (_, i) => [
      Math.round(((i >> 5) * 255) / 7),
      Math.round((((i >> 2) & 7) * 255) / 7),
      (i & 3) * 85,
    ]);
  else if (p.palette === 'vga') {
    for (let r = 0; r < 6; r++)
      for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) colors.push([r * 51, g * 51, b * 51]);
    for (let i = 1; i <= 40; i++) {
      const v = Math.round((i * 255) / 41);
      colors.push([v, v, v]);
    }
  } else
    return Array.from({ length: p.colors }, (_, i) => {
      const v = Math.round((i * 255) / (p.colors - 1));
      return [v, v, v];
    });
  if (colors.length <= p.colors) return colors;
  return Array.from(
    { length: p.colors },
    (_, i) => colors[Math.round((i * (colors.length - 1)) / (p.colors - 1))]!,
  );
}

// Exact squared-RGB nearest search with deterministic lowest-index ties.
export function nearestPalette(
  colors: readonly PaletteColor[],
): (r: number, g: number, b: number) => number {
  interface Node {
    index: number;
    axis: number;
    left: Node | null;
    right: Node | null;
  }
  const build = (indices: number[]): Node | null => {
    if (!indices.length) return null;
    const spans = [0, 1, 2].map(
      (c) =>
        Math.max(...indices.map((i) => colors[i]![c]!)) -
        Math.min(...indices.map((i) => colors[i]![c]!)),
    );
    const axis = spans.indexOf(Math.max(...spans));
    indices.sort((a, b) => colors[a]![axis]! - colors[b]![axis]! || a - b);
    const middle = Math.floor(indices.length / 2);
    return {
      index: indices[middle]!,
      axis,
      left: build(indices.slice(0, middle)),
      right: build(indices.slice(middle + 1)),
    };
  };
  const root = build(colors.map((_, i) => i));
  return (r, g, b) => {
    const values = [r, g, b];
    let best = 0,
      distance = Infinity;
    function visit(node: Node | null) {
      if (!node) return;
      const color = colors[node.index]!,
        d = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
      if (d < distance || (d === distance && node.index < best)) {
        distance = d;
        best = node.index;
      }
      const delta = values[node.axis]! - color[node.axis]!;
      visit(delta < 0 ? node.left : node.right);
      if (delta * delta <= distance) visit(delta < 0 ? node.right : node.left);
    }
    visit(root);
    return best;
  };
}
export function* indexedMapper(
  source: { width: number; height: number; pixels: ArrayBuffer },
  p: IndexedPaletteEffect['params'],
  reference: { width: number; height: number },
  random: ReductionRandom,
  adjust: (
    r: number,
    g: number,
    b: number,
    hue: number,
    saturation: number,
    lightness: number,
    result: Float64Array,
  ) => void,
): Generator<void, ReductionMapper> {
  const palette =
    p.palette === 'source' ? yield* sampledPalette(source, p.colors) : fixedPalette(p);
  const nearest = nearestPalette(palette),
    count = palette.length;
  const order = Array.from({ length: count }, (_, i) => i),
    permutation = [...order];
  const selected = order
    .sort((a, b) => random(a, 0, 1) - random(b, 0, 1) || a - b)
    .slice(0, Math.round(p.colorSwap * count));
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(random(i, 0, 2) * (i + 1));
    const a = selected[i]!,
      b = selected[j]!;
    [permutation[a], permutation[b]] = [permutation[b]!, permutation[a]!];
  }
  const damaged = palette.map((color, i) => {
    const result = new Float64Array(4);
    adjust(
      ...color,
      (random(i, 0, 3) * 2 - 1) * 180 * p.hueDamage,
      (random(i, 0, 4) * 2 - 1) * p.saturationDamage,
      0,
      result,
    );
    return result;
  });
  const patch = Math.max(1, (Math.min(reference.width, reference.height) * p.driftSize) / 100);
  return (r, g, b, x, y, color, quantized) => {
    const index = nearest(r, g, b);
    const drift =
      p.drift > 0
        ? Math.round(
            (random(Math.floor(x / patch), Math.floor(y / patch), 5) * 2 - 1) * count * p.drift,
          )
        : 0;
    const shifted = (((permutation[index]! + drift) % count) + count) % count;
    for (let c = 0; c < 3; c++) {
      quantized[c] = palette[index]![c]!;
      color[c] = damaged[shifted]![c]!;
    }
  };
}
