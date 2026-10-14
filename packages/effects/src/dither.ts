import type { DitherAlgorithm } from '@gleech/project-model';
import { BLUE_NOISE_RANKS, BLUE_NOISE_SIZE } from './blue-noise';

export type ReductionBlend = (
  output: Uint8Array,
  input: Uint8Array,
  index: number,
  color: ArrayLike<number>,
  amount: number,
) => void;
export type ReductionRandom = (x: number, y: number, lane: number) => number;
export type ReductionMapper = (
  r: number,
  g: number,
  b: number,
  x: number,
  y: number,
  color: Float64Array,
  quantized: Float64Array,
) => void;
export interface DitherSettings {
  algorithm: DitherAlgorithm;
  strength: number;
  cellSize: number;
  noiseScale: number;
  amount: number;
  scan?: 'serpentine' | 'forward';
  mono?: boolean;
  skippedCells?: number;
  errorDisplacement?: number;
  randomDirection?: number;
  blockInterruptions?: number;
  blockSize?: number;
  channelDivergence?: number;
}
// Standard forward error weights; serpentine mirrors their horizontal offsets.
export const DIFFUSION_KERNELS: Readonly<
  Record<string, readonly (readonly [number, number, number])[]>
> = {
  'floyd-steinberg': [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  sierra: [
    [1, 0, 5 / 32],
    [2, 0, 3 / 32],
    [-2, 1, 2 / 32],
    [-1, 1, 4 / 32],
    [0, 1, 5 / 32],
    [1, 1, 4 / 32],
    [2, 1, 2 / 32],
    [-1, 2, 2 / 32],
    [0, 2, 3 / 32],
    [1, 2, 2 / 32],
  ],
  jarvis: [
    [1, 0, 7 / 48],
    [2, 0, 5 / 48],
    [-2, 1, 3 / 48],
    [-1, 1, 5 / 48],
    [0, 1, 7 / 48],
    [1, 1, 5 / 48],
    [2, 1, 3 / 48],
    [-2, 2, 1 / 48],
    [-1, 2, 3 / 48],
    [0, 2, 5 / 48],
    [1, 2, 3 / 48],
    [2, 2, 1 / 48],
  ],
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const clip = (v: number) => Math.max(0, Math.min(255, v));

// Only three cell rows and error rows are retained. Cells average visible RGB;
// output alpha and hidden RGB stay at their original pixel positions.
export function* ditherPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  reference: { width: number; height: number },
  p: DitherSettings,
  mapper: ReductionMapper,
  blend: ReductionBlend,
  random: ReductionRandom,
): Generator<void> {
  output.set(input);
  const columns = Math.min(width, Math.ceil(reference.width / p.cellSize));
  const rows = Math.min(height, Math.ceil(reference.height / p.cellSize));
  const cells = Array.from({ length: 3 }, () => new Float64Array(columns * 4));
  const errors = Array.from({ length: 3 }, () => new Float64Array(columns * 3));
  const startX = (x: number) => Math.floor((x * width) / columns);
  const startY = (y: number) => Math.floor((y * height) / rows);
  function* loadRow(y: number, row: Float64Array) {
    row.fill(0);
    if (y >= rows) return;
    if (columns === width && rows === height) {
      for (let x = 0; x < columns; x++) {
        const i = (y * width + x) * 4,
          j = x * 4;
        if (input[i + 3]! > 0) {
          if (p.mono)
            row[j] =
              row[j + 1] =
              row[j + 2] =
                0.2126 * input[i]! + 0.7152 * input[i + 1]! + 0.0722 * input[i + 2]!;
          else {
            row[j] = input[i]!;
            row[j + 1] = input[i + 1]!;
            row[j + 2] = input[i + 2]!;
          }
          row[j + 3] = input[i + 3]! / 255;
        }
        if ((x & 127) === 127) yield;
      }
      return;
    }
    for (let x = 0; x < columns; x++) {
      const left = startX(x),
        right = startX(x + 1),
        top = startY(y),
        bottom = startY(y + 1);
      let alpha = 0,
        r = 0,
        g = 0,
        b = 0,
        scanned = 0;
      for (let py = top; py < bottom; py++)
        for (let px = left; px < right; px++) {
          const i = (py * width + px) * 4,
            a = input[i + 3]!;
          alpha += a;
          r += input[i]! * a;
          g += input[i + 1]! * a;
          b += input[i + 2]! * a;
          if ((++scanned & 255) === 0) yield;
        }
      const index = x * 4;
      if (alpha > 0) {
        row[index] = r / alpha;
        row[index + 1] = g / alpha;
        row[index + 2] = b / alpha;
        if (p.mono) {
          const value = 0.2126 * row[index]! + 0.7152 * row[index + 1]! + 0.0722 * row[index + 2]!;
          row[index] = row[index + 1] = row[index + 2] = value;
        }
        row[index + 3] = alpha / ((right - left) * (bottom - top) * 255);
      }
      if ((x & 127) === 127) yield;
    }
  }
  for (let row = 0; row < 3; row++) yield* loadRow(row, cells[row]!);
  const corrupted = p.algorithm === 'corrupted';
  const kernel = DIFFUSION_KERNELS[corrupted ? 'floyd-steinberg' : p.algorithm];
  const blueX = Math.floor(random(0, 0, 90) * BLUE_NOISE_SIZE),
    blueY = Math.floor(random(0, 0, 91) * BLUE_NOISE_SIZE);
  const color = new Float64Array(4),
    quantized = new Float64Array(3),
    value = new Float64Array(3);
  const blockSize = p.blockSize ?? 16;
  for (let y = 0; y < rows; y++) {
    let direction = p.scan === 'forward' || y % 2 === 0 ? 1 : -1;
    if (corrupted && random(0, y, 20) < (p.randomDirection ?? 0)) direction *= -1;
    for (let step = 0; step < columns; step++) {
      const x = direction === 1 ? step : columns - 1 - step,
        ci = x * 4,
        ei = x * 3;
      const visible = cells[0]![ci + 3]!;
      if (visible === 0) {
        errors[0]!.fill(0, ei, ei + 3);
        continue;
      }
      const refX = ((x + 0.5) * reference.width) / columns,
        refY = ((y + 0.5) * reference.height) / rows;
      const nx = Math.floor(refX / p.cellSize),
        ny = Math.floor(refY / p.cellSize);
      const blockX = Math.floor(refX / blockSize),
        blockY = Math.floor(refY / blockSize);
      const interrupted = corrupted && random(blockX, blockY, 22) < (p.blockInterruptions ?? 0);
      const skipped = corrupted && random(nx, ny, 21) < (p.skippedCells ?? 0);
      if (skipped) {
        errors[0]!.fill(0, ei, ei + 3);
        continue;
      }
      let noise = 0;
      if (p.algorithm === 'ordered') noise = (BAYER[(ny % 4) * 4 + (nx % 4)]! + 0.5) / 16 - 0.5;
      else if (p.algorithm === 'blue-noise')
        noise =
          (BLUE_NOISE_RANKS[((ny + blueY) % 64) * 64 + ((nx + blueX) % 64)]! + 0.5) / 4096 - 0.5;
      else if (p.algorithm === 'random') noise = random(nx, ny, 0) - 0.5;
      for (let c = 0; c < 3; c++) {
        const divergence =
          corrupted && !p.mono
            ? (random(nx, ny, 30 + c) - 0.5) *
              (p.channelDivergence ?? 0) *
              p.noiseScale *
              p.strength
            : 0;
        value[c] = clip(
          cells[0]![ci + c]! +
            (interrupted ? 0 : errors[0]![ei + c]!) +
            noise * p.noiseScale * p.strength +
            divergence,
        );
      }
      mapper(value[0]!, value[1]!, value[2]!, refX, refY, color, quantized);
      const left = startX(x),
        right = startX(x + 1),
        top = startY(y),
        bottom = startY(y + 1);
      for (let py = top; py < bottom; py++)
        for (let px = left; px < right; px++) {
          const i = (py * width + px) * 4;
          if (input[i + 3] === 0) continue;
          color[3] = input[i + 3]!;
          blend(output, input, i, color, p.amount);
          if ((((py - top) * (right - left) + px - left) & 255) === 255) yield;
        }
      if (kernel && p.strength > 0 && !interrupted) {
        for (let c = 0; c < (p.mono ? 1 : 3); c++) {
          const error = (value[c]! - quantized[c]!) * p.strength * visible;
          // Mono paths share offsets; RGB divergence can give each channel its own path.
          const lane = !p.mono && (p.channelDivergence ?? 0) > 0 ? c : 0;
          const diverges =
            corrupted && !p.mono && random(nx, ny, 40 + lane) < (p.channelDivergence ?? 0);
          const displacement = corrupted
            ? Math.round(
                ((random(nx, ny, 50 + lane) * 2 - 1) * (p.errorDisplacement ?? 0)) / p.cellSize,
              )
            : 0;
          for (const [dx, dy, weight] of kernel) {
            if (y + dy >= rows) continue;
            const flip = corrupted && random(nx, ny, 60 + lane) < (p.randomDirection ?? 0) ? -1 : 1;
            const tx =
              x +
              (dy === 0 ? direction : direction * flip * (diverges ? -1 : 1)) * dx +
              displacement;
            if (
              tx < 0 ||
              tx >= columns ||
              (dy === 0 && (tx - x) * direction <= 0) ||
              cells[dy]![tx * 4 + 3] === 0
            )
              continue;
            if (dy > 1 && cells[1]![Math.round(x + (tx - x) / dy) * 4 + 3] === 0) continue;
            // Do not bridge an invisible gap within the same scan row.
            if (dy === 0) {
              let gap = false;
              for (let between = x + direction; between !== tx; between += direction)
                if (cells[0]![between * 4 + 3] === 0) {
                  gap = true;
                  break;
                }
              if (gap) continue;
            }
            if (corrupted && (p.blockInterruptions ?? 0) > 0) {
              const targetBlockX = Math.floor(((tx + 0.5) * reference.width) / columns / blockSize),
                targetBlockY = Math.floor(((y + dy + 0.5) * reference.height) / rows / blockSize);
              if (random(targetBlockX, targetBlockY, 22) < p.blockInterruptions!) continue;
            }
            errors[dy]![tx * 3 + c] = errors[dy]![tx * 3 + c]! + error * weight;
            if (p.mono) errors[dy]![tx * 3 + 1] = errors[dy]![tx * 3 + 2] = errors[dy]![tx * 3]!;
          }
        }
      }
      if ((step & 127) === 127) yield;
    }
    const reusedCell = cells.shift()!,
      reusedError = errors.shift()!;
    cells.push(reusedCell);
    errors.push(reusedError);
    reusedError.fill(0);
    yield* loadRow(y + 3, reusedCell);
    yield;
  }
}
