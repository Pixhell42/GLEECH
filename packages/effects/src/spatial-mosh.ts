import { mixDirection, type DirectionSampler } from './direction-field';
import { directionFieldParams } from '@gleech/project-model';
import type {
  VectorCorruptionEffect,
  ReferenceMoshEffect,
  MotionTransferEffect,
  EdgeHandling,
} from '@gleech/project-model';
import type { ReductionBlend } from './dither';
type Image = { width: number; height: number; pixels: ArrayBuffer };
export type SpatialSample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  result: Float64Array,
  mode: EdgeHandling,
) => void;
export type SpatialRandom = (x: number, y: number, lane: number) => number;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const limit = (v: number, size: number) => Math.max(0, Math.min(size - 1, v));
const bounded = (v: number) => Math.max(-1, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export function* vectorCorruptionPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: VectorCorruptionEffect['params'],
  reference: { width: number; height: number },
  sample: SpatialSample,
  random: SpatialRandom,
  blend: ReductionBlend,
  directionField?: DirectionSampler,
): Generator<void> {
  if (p.strength === 0 || p.density === 0) {
    output.set(input);
    return;
  }
  const short = Math.min(reference.width, reference.height);
  const size = (short * p.cellSize) / 100;
  const travel = (short * p.strength) / 100;
  const direction = (p.direction * Math.PI) / 180;
  const color = new Float64Array(4),
    vector = new Float64Array(2);
  const influence = directionFieldParams(p).directionInfluence;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cx = Math.floor(((x + 0.5) * reference.width) / width / size),
        cy = Math.floor(((y + 0.5) * reference.height) / height / size);
      const i = (y * width + x) * 4;
      if (random(cx, cy, 0) >= p.density) output.set(input.subarray(i, i + 4), i);
      else {
        const groupX = Math.floor(cx / 4),
          groupY = Math.floor(cy / 4);
        const coarse = (random(groupX, groupY, 1) * 2 - 1) * Math.PI;
        const fine = (random(cx, cy, 2) * 2 - 1) * Math.PI;
        let angle = direction + coarse * p.coherence + fine * (1 - p.coherence);
        if (p.operation === 'reverse') angle = direction + Math.PI;
        else if (p.operation === 'rotate') angle = direction + Math.PI / 2;
        else if (p.operation === 'quantize')
          angle =
            Math.round(angle / ((2 * Math.PI) / p.quantization)) * ((2 * Math.PI) / p.quantization);
        const distance = travel * (0.25 + random(cx, cy, 3) * 0.75);
        let vx = Math.cos(angle),
          vy = Math.sin(angle);
        if (directionField) {
          directionField((x + 0.5) / width, (y + 0.5) / height, vector);
          let a = vector[0]!,
            b = vector[1]!;
          if (p.operation === 'reverse') {
            a = -a;
            b = -b;
          } else if (p.operation === 'rotate') {
            a = -vector[1]!;
            b = vector[0]!;
          } else if (p.operation === 'quantize') {
            const q =
                Math.round(Math.atan2(b, a) / ((2 * Math.PI) / p.quantization)) *
                ((2 * Math.PI) / p.quantization),
              m = Math.hypot(a, b);
            a = Math.cos(q) * m;
            b = Math.sin(q) * m;
          } else {
            const turn = coarse * p.coherence + fine * (1 - p.coherence),
              c = Math.cos(turn),
              s = Math.sin(turn);
            a = vector[0]! * c - vector[1]! * s;
            b = vector[0]! * s + vector[1]! * c;
          }
          vx = vx * (1 - influence) + a * influence;
          vy = vy * (1 - influence) + b * influence;
        }
        sample(
          input,
          width,
          height,
          x - (vx * distance * width) / reference.width,
          y - (vy * distance * height) / reference.height,
          color,
          p.edgeHandling,
        );
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* referenceMoshPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: ReferenceMoshEffect['params'],
  reference: { width: number; height: number },
  other: Image,
  sample: SpatialSample,
  transparent: OmitLast<SpatialSample>,
  random: SpatialRandom,
  blend: ReductionBlend,
): Generator<void> {
  if (p.progression === 0 || p.replacementDensity === 0) {
    output.set(input);
    return;
  }
  const source = new Uint8Array(other.pixels),
    color = new Float64Array(4);
  const size = (Math.min(reference.width, reference.height) * p.patchSize) / 100;
  const ratioX = width / other.width,
    ratioY = height / other.height;
  const scale = p.placement === 'fill' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
  const shownW = p.placement === 'stretch' ? width : other.width * scale,
    shownH = p.placement === 'stretch' ? height : other.height * scale;
  const angle = (p.direction * Math.PI) / 180;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cx = Math.floor(((x + 0.5) * reference.width) / width / size),
        cy = Math.floor(((y + 0.5) * reference.height) / height / size);
      // A separate random lane preserves the old progression pattern at 100%
      // density and keeps nested selections stable as density increases.
      if (random(cx, cy, 7) >= (p.replacementDensity ?? 1)) {
        output.set(input.subarray(i, i + 4), i);
        if ((x & 127) === 127 || x === width - 1) yield;
        continue;
      }
      // Stable per-cell activation makes scrubbing monotonic and keeps both endpoints exact.
      const threshold = Math.pow(random(cx, cy, 0), 1 / (1 + p.persistence * 3));
      const mix =
        p.progression === 1
          ? 1
          : p.style === 'dissolve'
            ? smooth((p.progression - threshold + 0.1) / 0.2)
            : p.progression > threshold
              ? 1
              : 0;
      if (mix === 0) output.set(input.subarray(i, i + 4), i);
      else {
        const travel =
          p.style === 'drag'
            ? ((Math.min(reference.width, reference.height) * p.travel) / 100) *
              (1 - p.progression) *
              (0.25 + random(cx, cy, 2) * 0.75)
            : 0;
        const u =
          ((x +
            0.5 -
            width / 2 -
            ((p.referenceX ?? 0) * width) / 100 -
            (Math.cos(angle) * travel * width) / reference.width) /
            shownW +
            0.5) *
            other.width -
          0.5;
        const v =
          ((y +
            0.5 -
            height / 2 -
            ((p.referenceY ?? 0) * height) / 100 -
            (Math.sin(angle) * travel * height) / reference.height) /
            shownH +
            0.5) *
            other.height -
          0.5;
        if (p.placement === 'fit') transparent(source, other.width, other.height, u, v, color);
        else sample(source, other.width, other.height, u, v, color, p.edgeHandling);
        blend(output, input, i, color, p.amount * mix);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
type OmitLast<T> = T extends (...args: [...infer A, EdgeHandling]) => void
  ? (...args: A) => void
  : never;
export function* motionTransferPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: MotionTransferEffect['params'],
  reference: { width: number; height: number },
  map: Image,
  sample: SpatialSample,
  blend: ReductionBlend,
  directionField?: DirectionSampler,
): Generator<void> {
  if (p.strength === 0) {
    output.set(input);
    return;
  }
  const data = new Uint8Array(map.pixels),
    mapColor = new Float64Array(4),
    color = new Float64Array(4),
    vector = new Float64Array(2);
  const influence = directionFieldParams(p).directionInfluence;
  const angle = (p.mapRotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    scale = p.mapScale / 100;
  const travel = (Math.min(reference.width, reference.height) * p.strength) / 100;
  const direction = (p.direction * Math.PI) / 180;
  const slopeStepX = Math.max(1, map.width / 128),
    slopeStepY = Math.max(1, map.height / 128);
  // Decode vectors BEFORE filtering. Fully transparent map texels contribute zero,
  // not hidden RGB. RG byte 128 is exactly neutral on either side of the asymmetric range.
  const signed = (byte: number) => (byte >= 128 ? (byte - 128) / 127 : (byte - 128) / 128);
  // A neutral padded map outside its explicit bounds, with bilinear interpolation.
  const field = (x: number, y: number, lane: number) => {
    const bx = Math.floor(x),
      by = Math.floor(y),
      fx = x - bx,
      fy = y - by;
    let v = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const sx = bx + dx,
          sy = by + dy;
        if (sx >= 0 && sx < map.width && sy >= 0 && sy < map.height) {
          const i = (sy * map.width + sx) * 4,
            a = data[i + 3]! / 255;
          const decoded =
            lane === 2
              ? 1
              : p.encoding === 'rg'
                ? signed(data[i + lane]!)
                : p.encoding === 'gradient'
                  ? (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
                  : signed(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
          v += decoded * a * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        }
      }
    return v;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = ((x + 0.5) / width - p.mapX / 100) * reference.width,
        dy = ((y + 0.5) / height - p.mapY / 100) * reference.height;
      const mx = ((dx * cos + dy * sin) / reference.width / scale + 0.5) * map.width - 0.5;
      const my = ((-dx * sin + dy * cos) / reference.height / scale + 0.5) * map.height - 0.5;
      let vx = p.encoding === 'gradient' ? 0 : field(mx, my, 0),
        vy = p.encoding === 'rg' ? field(mx, my, 1) : 0;
      if (p.encoding === 'luma') {
        vy = vx * Math.sin(direction);
        vx *= Math.cos(direction);
      } else if (p.encoding === 'gradient') {
        const coverage = field(mx, my, 2);
        if (coverage > 0) {
          // A fixed normalized stencil suppresses byte quantization at large map
          // resolutions. Clamp derivative probes to the map, so a constant height
          // does not turn into a false slope at its outside border.
          const px = limit(mx, map.width),
            py = limit(my, map.height);
          const ax = limit(mx - slopeStepX, map.width),
            bx = limit(mx + slopeStepX, map.width);
          const ay = limit(my - slopeStepY, map.height),
            by = limit(my + slopeStepY, map.height);
          const differenceX = field(bx, py, 0) - field(ax, py, 0),
            differenceY = field(px, by, 0) - field(px, ay, 0);
          vx =
            bx === ax || Math.abs(differenceX) < 1e-12
              ? 0
              : bounded(((differenceX / (bx - ax)) * map.width) / scale) * coverage;
          vy =
            by === ay || Math.abs(differenceY) < 1e-12
              ? 0
              : bounded(((differenceY / (by - ay)) * map.height) / scale) * coverage;
        }
      }
      const rx = vx * cos - vy * sin,
        ry = vx * sin + vy * cos;
      mapColor[0] = rx * (p.invertX === 'on' ? -1 : 1);
      mapColor[1] = ry * (p.invertY === 'on' ? -1 : 1);
      if (directionField) {
        mixDirection(
          directionField,
          (x + 0.5) / width,
          (y + 0.5) / height,
          mapColor[0]!,
          mapColor[1]!,
          influence,
          vector,
        );
        mapColor[0] = vector[0]!;
        mapColor[1] = vector[1]!;
      }
      sample(
        input,
        width,
        height,
        x - (mapColor[0]! * travel * width) / reference.width,
        y - (mapColor[1]! * travel * height) / reference.height,
        color,
        p.edgeHandling,
      );
      blend(output, input, (y * width + x) * 4, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
