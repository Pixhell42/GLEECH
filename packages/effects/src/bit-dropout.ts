import {
  BIT_DAMAGE_DEFAULTS,
  type BitDamageEffect,
  type FreezeDropoutEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import type { ReductionBlend, ReductionRandom } from './dither';
import { createColorSampler } from './color-gradient';

type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edge: EdgeHandling,
) => void;
export function* bitDamagePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: BitDamageEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  random: ReductionRandom,
): Generator<void> {
  const q = { ...BIT_DAMAGE_DEFAULTS, ...p };
  const mask =
    q.bitSelection === 'custom'
      ? q.bitMask
      : ((1 << (Math.abs(p.highBit - p.lowBit) + 1)) - 1) << Math.min(p.lowBit, p.highBit);
  if (mask === 0 || (q.probability === 0 && p.visualize === 'off')) {
    output.set(input);
    return;
  }
  const planes = Array.from({ length: 8 }, (_, bit) => bit).filter((bit) => mask & (1 << bit));
  const count = planes.length,
    range = (1 << count) - 1;
  const pack = (value: number) =>
    planes.reduce((bits, plane, rank) => bits | (((value >>> plane) & 1) << rank), 0);
  const unpack = (value: number) =>
    planes.reduce((bits, plane, rank) => bits | (((value >>> rank) & 1) << plane), 0);
  const target = ['red', 'green', 'blue', 'alpha'].indexOf(p.target);
  const color = new Float64Array(4);
  const permutations = new Map<string, readonly number[]>();
  let permutationRow = NaN;
  const orderFor = (gx: number, gy: number, channel: number, length: number, bytes = false) => {
    const key = `${bytes}:${gx}:${channel}`;
    let order = permutations.get(key);
    if (!order) {
      const values = Array.from({ length }, (_, j) => j);
      for (let j = length - 1; j > 0; j--) {
        const k = Math.floor(
          random(gx, gy, (bytes ? 70 + channel * 64 : 10 + channel * 8) + j) * (j + 1),
        );
        [values[j], values[k]] = [values[k]!, values[j]!];
      }
      order = values;
      permutations.set(key, order);
    }
    return order;
  };
  const luma = (i: number) =>
    Math.round(input[i]! * 0.2126 + input[i + 1]! * 0.7152 + input[i + 2]! * 0.0722);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = ((x + 0.5) * reference.width) / width;
      const gx = Math.floor(px / p.cellSize),
        gy = Math.floor(((y + 0.5) * reference.height) / height / p.cellSize);
      if (gy !== permutationRow) {
        permutations.clear();
        permutationRow = gy;
      }
      const clustered = q.clustering > 0 && random(gx, gy, 50) < q.clustering;
      const active =
        p.density === 1 ||
        (p.density > 0 &&
          (clustered
            ? random(Math.floor(gx / q.burstLength), Math.floor(gy / 3), 0)
            : random(gx, gy, 0)) < p.density);
      if (!active) output.set(input.subarray(i, i + 4), i);
      else {
        for (let c = 0; c < 4; c++) color[c] = input[i + c]!;
        for (let c = 0; c < (p.target === 'luma' ? 1 : 4); c++) {
          const affects =
            p.target === 'rgba' || p.target === 'luma' || (target < 0 ? c < 3 : c === target);
          if (!affects || (input[i + 3] === 0 && c !== 3)) continue;
          const value = p.target === 'luma' ? luma(i) : input[i + c]!;
          const selected = pack(value);
          let result = selected;
          let byte: number;
          if (p.visualize === 'on') byte = (selected / range) * 255;
          else {
            switch (p.operation) {
              case 'flip':
                result = selected ^ range;
                break;
              case 'clear':
                result = 0;
                break;
              case 'set':
                result = range;
                break;
              case 'shift':
                result = p.shift >= 0 ? (selected << p.shift) & range : selected >>> -p.shift;
                break;
              case 'rotate': {
                const n = ((p.shift % count) + count) % count;
                result = ((selected << n) | (selected >>> (count - n))) & range;
                break;
              }
              case 'scramble': {
                const order = orderFor(gx, gy, c, count);
                result = 0;
                for (let j = 0; j < count; j++) result |= ((selected >>> order[j]!) & 1) << j;
                break;
              }
              case 'swap': {
                byte = value;
                if (
                  mask & (1 << q.swapBitA) &&
                  mask & (1 << q.swapBitB) &&
                  ((value >>> q.swapBitA) & 1) !== ((value >>> q.swapBitB) & 1)
                )
                  byte ^= (1 << q.swapBitA) | (1 << q.swapBitB);
                result = pack(byte);
                break;
              }
              case 'xor':
                result = selected ^ pack(q.operand);
                break;
              case 'and':
                result = selected & pack(q.operand);
                break;
              case 'or':
                result = selected | pack(q.operand);
                break;
              case 'inject':
                result = Math.floor(random(gx, gy, 200 + c) * (range + 1));
                break;
              case 'crossfeed': {
                const source = ['red', 'green', 'blue', 'alpha'].indexOf(q.sourceChannel);
                result = pack(source < 0 ? luma(i) : input[i + source]!);
                break;
              }
              case 'byte-scramble': {
                const run = Math.max(2, q.burstLength),
                  group = Math.floor(gx / run);
                const cells = Math.min(run, Math.ceil(reference.width / p.cellSize) - group * run);
                const order = orderFor(group, gy, c, cells, true);
                const sx = Math.max(
                  0,
                  Math.min(
                    width - 1,
                    Math.floor(
                      (((group * run + order[gx % run]!) * p.cellSize + (px % p.cellSize)) *
                        width) /
                        reference.width,
                    ),
                  ),
                );
                const source = (y * width + sx) * 4;
                result = pack(p.target === 'luma' ? luma(source) : input[source + c]!);
                break;
              }
              case 'isolate':
                break;
            }
            byte =
              p.operation === 'isolate' ? value & mask : (value & (~mask & 255)) | unpack(result);
            if (q.probability < 1) {
              for (const plane of planes)
                if (random(gx, gy, 300 + c * 8 + plane) >= q.probability)
                  byte = (byte & ~(1 << plane)) | (value & (1 << plane));
            }
          }
          if (p.target === 'luma') {
            for (let channel = 0; channel < 3; channel++)
              color[channel] =
                p.visualize === 'on'
                  ? byte
                  : Math.max(0, Math.min(255, input[i + channel]! + byte - value));
          } else color[c] = byte;
        }
        if (target === 3 && p.visualize === 'on') {
          color[0] = color[1] = color[2] = color[3]!;
          color[3] = input[i + 3]!;
          if (input[i + 3] === 0) for (let c = 0; c < 3; c++) color[c] = input[i + c]!;
        } else if ((target === 3 || p.target === 'rgba') && input[i + 3] === 0 && color[3]! > 0)
          color[0] = color[1] = color[2] = 0;
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}

export function* freezeDropoutPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: FreezeDropoutEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  sample: Sample,
  random: ReductionRandom,
): Generator<void> {
  if (p.density === 0) {
    output.set(input);
    return;
  }
  const fx = reference.width / width,
    fy = reference.height / height;
  const patch = (Math.min(reference.width, reference.height) * p.patchSize) / 100;
  const travel = (Math.min(reference.width, reference.height) * p.travel) / 100;
  const angle = (p.direction * Math.PI) / 180,
    dx = travel * Math.cos(angle),
    dy = travel * Math.sin(angle);
  const ink = createColorSampler(p, 'dropoutColor', p.dropoutColor, reference);
  const color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gx = Math.floor(((x + 0.5) * fx - (reference.width * p.positionX) / 100) / patch);
      const gy = Math.floor(((y + 0.5) * fy - (reference.height * p.positionY) / 100) / patch);
      // Correlated and independent decisions share the same uniform threshold;
      // endpoints preserve exact density semantics, including zero and one.
      const clustered = random(gx, gy, 1) < p.clustering;
      const active =
        p.density === 1 ||
        (clustered ? random(Math.floor(gx / 3), Math.floor(gy / 3), 0) : random(gx, gy, 0)) <
          p.density;
      if (p.style === 'freeze') {
        const age = active ? Math.max(0, p.steps - p.holdAge) : p.steps;
        sample(
          input,
          width,
          height,
          x - (dx * age) / fx,
          y - (dy * age) / fy,
          color,
          p.edgeHandling,
        );
      } else if (!active) {
        output.set(input.subarray(i, i + 4), i);
        if ((x & 127) === 127 || x === width - 1) yield;
        continue;
      } else if (p.style === 'duplicate') {
        const sx = (dx + travel * p.scatter * (random(gx, gy, 2) * 2 - 1)) * p.steps;
        const sy = (dy + travel * p.scatter * (random(gx, gy, 3) * 2 - 1)) * p.steps;
        sample(input, width, height, x - sx / fx, y - sy / fy, color, p.edgeHandling);
      } else if (p.style === 'blank') {
        const rgb = ink((x + 0.5) / width, (y + 0.5) / height);
        for (let c = 0; c < 3; c++) color[c] = input[i + 3] === 0 ? input[i + c]! : rgb[c]!;
        color[3] = p.clearAlpha === 'on' ? 0 : input[i + 3]!;
      } else {
        for (let c = 0; c < 3; c++)
          color[c] =
            input[i + 3] === 0
              ? input[i + c]!
              : random(Math.floor((x + 0.5) * fx), Math.floor((y + 0.5) * fy), 20 + c) * 255;
        color[3] = input[i + 3]!;
      }
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
