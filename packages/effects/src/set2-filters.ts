import {
  directionFieldParams,
  type GranularEchoEffect,
  type PigmentDragEffect,
  type PixelStretchEffect,
  type LedMatrixEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import { mixDirection, type DirectionSampler } from './direction-field';
import { createColorSampler } from './color-gradient';
type Sampler = (
  input: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function* granularEchoPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: GranularEchoEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
  field?: DirectionSampler,
): Generator<void> {
  const p = effect.params,
    short = Math.min(reference.width, reference.height),
    cell = p.particleSize / 100,
    reach = p.trailLength / 100;
  const angle = (p.direction * Math.PI) / 180,
    phase = (p.phase % 1) * Math.PI * 2,
    vector = new Float64Array(2),
    color = new Float64Array(4),
    chosen = createColorSampler(p, 'particleColor', p.particleColor, reference);
  const influence = directionFieldParams(p).directionInfluence;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height,
        i = (y * width + x) * 4;
      let dx = Math.cos(angle),
        dy = Math.sin(angle);
      if (field) {
        mixDirection(field, u, v, dx, dy, influence, vector);
        dx = vector[0]!;
        dy = vector[1]!;
      }
      const sum = [0, 0, 0];
      let energy = 0;
      for (let j = 0; j < p.trailLayers; j++) {
        const travel = (reach * (j + 0.25)) / p.trailLayers;
        const sx = u - (dx * travel * short) / reference.width,
          sy = v - (dy * travel * short) / reference.height;
        const cx = Math.floor((sx * reference.width) / short / cell),
          cy = Math.floor((sy * reference.height) / short / cell);
        const r = random(cx, cy, seed, j),
          mask = 0.5 + 0.5 * Math.sin(phase + r * 9);
        if (r < p.breakup * mask) continue;
        const px =
          ((cx + 0.5 + (random(cx, cy, seed, j + 19) - 0.5) * 0.4) * cell * short) /
          reference.width;
        const py =
          ((cy + 0.5 + (random(cx, cy, seed, j + 31) - 0.5) * 0.4) * cell * short) /
          reference.height;
        sample(input, width, height, px * width - 0.5, py * height - 0.5, color, p.edgeHandling);
        const luma = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
        const distance =
          Math.hypot(
            ((sx - px) * reference.width) / short,
            ((sy - py) * reference.height) / short,
          ) / cell;
        const weight =
          (clamp((0.65 - distance) * 3) * (1 - (j / p.trailLayers) * 0.7) * color[3]!) / 255;
        if (luma < p.threshold) continue;
        const ink = p.colorSource === 'chosen' ? chosen(u, v) : color;
        for (let k = 0; k < 3; k++)
          sum[k] = sum[k]! + (p.monochrome === 'on' ? luma * 255 : ink[k]!) * weight;
        energy += weight;
      }
      const opacity = clamp(energy * 0.85);
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(
          input[i + k]! * (1 - opacity * 0.7) +
            (energy > 0 ? sum[k]! / energy : 0) * opacity * 0.85,
        );
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
export function* pigmentDragPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: PigmentDragEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
  field?: DirectionSampler,
): Generator<void> {
  const p = effect.params,
    short = Math.min(reference.width, reference.height),
    size = p.brushSize / 100,
    reach = p.dragLength / 100,
    phase = (p.phase % 1) * Math.PI * 2,
    angle = (p.direction * Math.PI) / 180;
  const vector = new Float64Array(2),
    color = new Float64Array(4),
    pigment = createColorSampler(p, 'pigmentColor', p.pigmentColor, reference),
    influence = directionFieldParams(p).directionInfluence;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      let dx = Math.cos(angle),
        dy = Math.sin(angle);
      if (field) {
        mixDirection(field, u, v, dx, dy, influence, vector);
        dx = vector[0]!;
        dy = vector[1]!;
      }
      const px = (u * reference.width) / short,
        py = (v * reference.height) / short;
      const textureX = Math.hypot(dx, dy) > 0.000001 ? dx : Math.cos(angle),
        textureY = Math.hypot(dx, dy) > 0.000001 ? dy : Math.sin(angle);
      const lane = Math.floor((-px * textureY + py * textureX) / size),
        block = Math.floor(
          (px * textureX + py * textureY) / Math.max(size, reach * Math.hypot(dx, dy)),
        );
      const r = random(lane, block, seed),
        scrape = random(lane, Math.floor(((px * textureX + py * textureY) / size) * 3), seed, 9);
      const travel = reach * (0.2 + r * 0.8) * (0.7 + Math.sin(phase + r * 8) * 0.3);
      const weight = scrape < p.scraping * 0.6 ? 0 : 1 - p.retention;
      const run =
        p.drips * size * 3 * random(Math.floor(px / size), Math.floor(py / (size * 5)), seed, 7);
      sample(
        input,
        width,
        height,
        (u - (dx * travel * short) / reference.width) * width - 0.5,
        (v - ((dy * travel + run) * short) / reference.height) * height - 0.5,
        color,
        p.edgeHandling,
      );
      const ink = pigment(u, v),
        grain = (random(x, y, seed, 33) - 0.5) * p.grain * 60;
      for (let k = 0; k < 3; k++) {
        const dragged = color[k]! * (1 - p.colorMix) + ink[k]! * p.colorMix + grain;
        output[i + k] = Math.round(
          Math.max(0, Math.min(255, input[i + k]! * (1 - weight) + dragged * weight)),
        );
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
function random(x: number, y: number, seed: number, lane = 0) {
  let h =
    Math.imul(x | 0, 0x8da6b343) ^
    Math.imul(y | 0, 0xd8163841) ^
    seed ^
    Math.imul(lane, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function* pixelStretchPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: PixelStretchEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    short = Math.min(reference.width, reference.height),
    ax = reference.width / short,
    ay = reference.height / short;
  const strip = p.stripWidth / 100,
    reach = p.length / 100,
    phase = (p.phase % 1) * Math.PI * 2;
  const ox = (p.originX / 100) * ax,
    oy = (p.originY / 100) * ay,
    color = new Float64Array(4),
    adjacent = new Float64Array(4);
  if (reach === 0 || p.density === 0) {
    output.set(input);
    return;
  }
  const feather = (distance: number, limit: number) =>
    p.softness === 0
      ? distance <= limit
        ? 1
        : 0
      : clamp((limit - distance) / Math.max(limit * p.softness, 1e-8));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        px = ((x + 0.5) / width) * ax,
        py = ((y + 0.5) / height) * ay;
      let sx = px,
        sy = py,
        weight = 0;
      if (p.style === 'radial') {
        const dx = px - ox,
          dy = py - oy,
          r = Math.hypot(dx, dy),
          angle = Math.atan2(dy, dx);
        const sectors = Math.max(4, Math.round((Math.PI * 2) / strip)),
          sector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * sectors);
        if (random(sector, 0, seed) < p.density && r > 0) {
          const anchor =
            0.1 +
            random(sector, 0, seed, 1) * 0.24 +
            Math.sin(phase + random(sector, 0, seed, 2) * Math.PI * 2) * 0.035;
          if (r >= anchor) {
            weight = feather(r - anchor, reach);
            sx = ox + (dx / r) * anchor;
            sy = oy + (dy / r) * anchor;
          }
        }
      } else {
        const vertical = p.axis === 'vertical',
          along = vertical ? py : px,
          cross = vertical ? px : py,
          lane = Math.floor(cross / strip);
        const drift = Math.sin(phase + random(lane, 0, seed, 2) * Math.PI * 2) * reach * 0.18;
        const step = reach + strip * 2,
          block = p.style === 'patches' ? Math.floor((along - drift) / step) : 0;
        if (random(lane, block, seed) < p.density) {
          const anchor =
            p.style === 'patches'
              ? (block + 0.15 + random(lane, block, seed, 1) * 0.65) * step + drift
              : (vertical ? oy : ox) + drift;
          const limit = reach * (0.6 + random(lane, block, seed, 3) * 0.4);
          weight = feather(Math.abs(along - anchor), limit);
          if (vertical) sy = anchor;
          else sx = anchor;
        }
      }
      if (weight > 0) {
        sample(
          input,
          width,
          height,
          (sx / ax) * width - 0.5,
          (sy / ay) * height - 0.5,
          color,
          p.edgeHandling,
        );
        const brightness = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
        if (brightness < p.threshold) weight = 0;
      }
      if (weight > 0 && (p.edgeBias ?? 0) > 0) {
        sample(
          input,
          width,
          height,
          (sx / ax) * width + 0.5,
          (sy / ay) * height - 0.5,
          adjacent,
          p.edgeHandling,
        );
        let edge = 0;
        for (let k = 0; k < 3; k++) edge += Math.abs(adjacent[k]! - color[k]!) / 765;
        sample(
          input,
          width,
          height,
          (sx / ax) * width - 0.5,
          (sy / ay) * height + 0.5,
          adjacent,
          p.edgeHandling,
        );
        for (let k = 0; k < 3; k++) edge += Math.abs(adjacent[k]! - color[k]!) / 765;
        weight *= 1 - (p.edgeBias ?? 0) + (p.edgeBias ?? 0) * clamp(edge * 12);
      }
      if ((p.protectedRadius ?? 0) > 0) {
        const radius = (p.protectedRadius ?? 0) / 100;
        weight *= clamp((Math.hypot(px - ox, py - oy) - radius) / Math.max(0.001, radius * 0.1));
      }
      for (let c = 0; c < 4; c++)
        output[i + c] = Math.round(
          input[i + c]! * (1 - weight) + (weight > 0 ? color[c]! : 0) * weight,
        );
    }
    yield;
  }
}

export function* ledMatrixPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: LedMatrixEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
): Generator<void> {
  const p = effect.params,
    short = Math.min(reference.width, reference.height),
    ax = reference.width / short,
    ay = reference.height / short;
  const aa = Math.max(ax / width, ay / height),
    spacing = Math.max(p.cellSize / 100, aa),
    phase = (p.phase % 1) * Math.PI * 2;
  const angle = (p.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const shiftX = (random(0, 0, seed, 7) - 0.5) * 0.4 * spacing + Math.sin(phase) * spacing * 0.18;
  const shiftY =
    (random(0, 0, seed, 8) - 0.5) * 0.4 * spacing + (Math.cos(phase) - 1) * spacing * 0.18;
  const color = new Float64Array(4),
    cache = new Map<string, readonly number[]>();
  const params = p as unknown as Readonly<Record<string, number | string>>;
  const chosen = createColorSampler(params, 'ledColor', p.ledColor, reference),
    background = createColorSampler(params, 'backgroundColor', p.backgroundColor, reference);
  const emitter = (cx: number, cy: number) => {
    const key = `${cx},${cy}`,
      existing = cache.get(key);
    if (existing) return existing;
    const qx = (cx + 0.5) * spacing - shiftX,
      qy = (cy + 0.5) * spacing - shiftY;
    const ux = (c * qx + s * qy) / ax + 0.5,
      uy = (-s * qx + c * qy) / ay + 0.5;
    sample(input, width, height, ux * width - 0.5, uy * height - 0.5, color, 'extend');
    const luma = (color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255;
    let gain =
      random(cx, cy, seed) < p.deadCells
        ? 0
        : (p.brightness *
            (0.85 + 0.15 * Math.cos(phase + random(cx, cy, seed, 3) * Math.PI * 2)) *
            color[3]!) /
          255;
    const pattern =
      p.brightnessSource === 'pattern'
        ? 0.5 +
          0.5 *
            Math.sin(
              ux * (p.patternFrequency ?? 5) * Math.PI * 2 + phase + random(0, 0, seed, 11) * 6,
            ) *
            Math.cos(uy * (p.patternFrequency ?? 5) * Math.PI * 2 - phase)
        : luma;
    if (p.brightnessSource === 'pattern' && p.coloring === 'source')
      gain *= pattern / Math.max(0.05, luma);
    const ink = p.coloring === 'chosen' ? chosen(ux, uy) : color;
    const result = [
      ink[0]! * gain * (p.coloring === 'chosen' ? pattern : 1),
      ink[1]! * gain * (p.coloring === 'chosen' ? pattern : 1),
      ink[2]! * gain * (p.coloring === 'chosen' ? pattern : 1),
    ];
    if (cache.size >= 65536) cache.clear();
    cache.set(key, result);
    return result;
  };
  const radius = (1 - p.gap) * 0.5,
    footprint = aa / spacing,
    neighbors = p.glow > 0 ? 1 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        ux = (x + 0.5) / width,
        uy = (y + 0.5) / height;
      const px = (ux - 0.5) * ax,
        py = (uy - 0.5) * ay,
        qx = (c * px - s * py + shiftX) / spacing,
        qy = (s * px + c * py + shiftY) / spacing;
      const bx = Math.floor(qx),
        by = Math.floor(qy),
        base = background(ux, uy),
        light = [base[0]!, base[1]!, base[2]!];
      if (radius > 0)
        for (let yy = -neighbors; yy <= neighbors; yy++)
          for (let xx = -neighbors; xx <= neighbors; xx++) {
            const cx = bx + xx,
              cy = by + yy,
              dx = qx - cx - 0.5,
              dy = qy - cy - 0.5,
              d = p.shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
            const distance = p.shape === 'ring' ? Math.abs(d - radius * 0.78) : d;
            const extent = p.shape === 'ring' ? radius * 0.18 : radius;
            const body = clamp((extent - distance) / Math.max(footprint, 1e-8) + 0.5);
            const halo = p.glow * Math.exp(-(Math.max(0, d - radius * 0.7) ** 2) * 5) * 0.5;
            const ink = emitter(cx, cy);
            for (let k = 0; k < 3; k++) light[k] = light[k]! + ink[k]! * (body + halo);
          }
      for (let k = 0; k < 3; k++) output[i + k] = Math.round(Math.max(0, Math.min(255, light[k]!)));
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
