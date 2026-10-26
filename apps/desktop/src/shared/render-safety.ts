import type { EffectInstance, ImageFinishParams } from '@gleech/project-model';
import { isShaderEffect } from '@gleech/project-model';
import type { TimelineRenderRequest } from './timeline-runner';

export type ExportMemoryMode = 'auto' | 'standard' | 'one-frame' | 'tiled';
export interface RenderSafetySettings {
  readonly checkMemory: boolean;
  readonly mode: ExportMemoryMode;
  /** Zero disables segmented movie encoding. */
  readonly segmentSeconds: number;
  readonly keepParts: boolean;
  readonly resume: boolean;
  readonly tileSize: 256 | 512 | 1024;
  readonly processing: 'source' | 'output';
}
export const DEFAULT_RENDER_SAFETY: RenderSafetySettings = {
  checkMemory: true,
  mode: 'auto',
  segmentSeconds: 0,
  keepParts: false,
  resume: false,
  tileSize: 512,
  processing: 'source',
};
export function renderSafety(value?: Partial<RenderSafetySettings>): RenderSafetySettings {
  return { ...DEFAULT_RENDER_SAFETY, ...value };
}

export interface RenderMemoryBudget {
  readonly totalRAMBytes: number;
  readonly availableRAMBytes: number;
  /** Null when the platform cannot reliably report currently available VRAM. */
  readonly availableGPUBytes: number | null;
}
export interface RenderMemoryAssessment {
  readonly mode: Exclude<ExportMemoryMode, 'auto'>;
  readonly estimatedPeakBytes: number;
  readonly oneFramePeakBytes: number;
  readonly estimatedGPUBytes: number;
  readonly availableRAMBytes: number | null;
  readonly usableRAMBytes: number | null;
  readonly availableGPUBytes: number | null;
  readonly status: 'fits-estimate' | 'insufficient' | 'unknown';
  readonly tiledUnavailable: string | null;
  readonly notes: readonly string[];
}
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
export const memorySize = (bytes: number) =>
  bytes >= GiB ? `${(bytes / GiB).toFixed(1)} GiB` : `${Math.ceil(bytes / MiB)} MiB`;

/** Only pointwise color operations with uniform application are tile independent. */
export function tiledRenderUnavailable(effects: readonly EffectInstance[]): string | null {
  const safe = new Set(['hue-saturation', 'levels-curves', 'gradient-map', 'photo-adjustments']);
  for (const effect of effects) {
    if (
      !effect.enabled ||
      effect.application.coverage <= 0 ||
      (effect.params.amount <= 0 && !effect.animation)
    )
      continue;
    const finish = effect.params as Partial<ImageFinishParams>;
    if (
      !safe.has(effect.type) ||
      effect.application.region !== 'all' ||
      effect.application.coverage !== 1 ||
      effect.paintedMask?.enabled ||
      effect.directionImage ||
      effect.application.depthImage ||
      (finish.colorMode === 'gradient' && (finish.tintStrength ?? 0) > 0)
    )
      return `Tiled processing cannot preserve ${effect.type} with its current settings. Use one-frame mode or reduce resolution.`;
  }
  return null;
}

/** Conservative working-set estimate, not a promise about driver/codec allocations. */
export function assessRenderMemory(
  request: TimelineRenderRequest,
  budget: RenderMemoryBudget | null,
  supplied?: RenderSafetySettings,
): RenderMemoryAssessment {
  const safety = renderSafety(supplied ?? request.spec.safety);
  const effects = request.project.effects.filter(
    (e) => e.enabled && (e.params.amount > 0 || !!e.animation),
  );
  const input = request.renderSize.width * request.renderSize.height * 4;
  const output =
    request.kind === 'video' && request.spec.video
      ? request.spec.video.frame.width * request.spec.video.frame.height * 4
      : input;
  const pixels = Math.max(input, output);
  const original = request.project.timeline?.video ?? request.project.source;
  const decoded = original ? original.width * original.height * 4 : input;
  const shader = effects.some(isShaderEffect);
  const tiledUnavailable = tiledRenderUnavailable(effects);
  const usable = budget
    ? Math.max(
        0,
        budget.availableRAMBytes -
          Math.max(512 * MiB, Math.min(2 * GiB, budget.totalRAMBytes * 0.1)),
      )
    : null;
  const peak = (mode: Exclude<ExportMemoryMode, 'auto'>) => {
    const working = mode === 'tiled' ? Math.min(input, safety.tileSize ** 2 * 4) : input;
    const effectsBytes = effects.length ? working * (6 + Math.min(effects.length, 8) * 2) : working;
    // Includes IPC copies, fitted frame, decoder surfaces and encoder reference frames.
    const copies = mode === 'standard' ? 8 : 4;
    const encode = output * (mode === 'standard' ? 12 : 3);
    let bytes = 256 * MiB + Math.max(decoded, input) * 2 + pixels * copies + effectsBytes + encode;
    if (request.overlay) bytes += input * 3;
    if (
      request.kind === 'gif' &&
      request.spec.gif?.format === 'gif' &&
      request.spec.gif.palette === 'whole'
    )
      bytes += output * request.times.length;
    return Math.ceil(bytes * 1.25);
  };
  const oneFramePeakBytes = peak('one-frame');
  const mode =
    safety.mode === 'auto'
      ? usable !== null && peak('standard') > usable
        ? 'one-frame'
        : 'standard'
      : safety.mode;
  const estimatedPeakBytes = peak(mode);
  const estimatedGPUBytes = shader && mode !== 'tiled' ? input * 16 : 0;
  const status =
    (usable !== null && estimatedPeakBytes > usable) ||
    (budget?.availableGPUBytes !== null &&
      budget?.availableGPUBytes !== undefined &&
      estimatedGPUBytes > budget.availableGPUBytes)
      ? 'insufficient'
      : usable === null
        ? 'unknown'
        : 'fits-estimate';
  return {
    mode,
    estimatedPeakBytes,
    oneFramePeakBytes,
    estimatedGPUBytes,
    availableRAMBytes: budget?.availableRAMBytes ?? null,
    usableRAMBytes: usable,
    availableGPUBytes: budget?.availableGPUBytes ?? null,
    status,
    tiledUnavailable,
    notes: [
      'Estimates include working buffers and memory reserved for the app and OS.',
      ...(shader && budget?.availableGPUBytes == null
        ? [
            'Available GPU memory is unknown; RAM estimates do not guarantee a GPU allocation will fit.',
          ]
        : []),
      ...(safety.segmentSeconds > 0
        ? ['Parts limit encoder lifetime; each full frame and its effects must still fit.']
        : []),
    ],
  };
}
export class RenderMemoryError extends Error {
  constructor(readonly assessment: RenderMemoryAssessment) {
    super(
      `This export may need ${memorySize(assessment.estimatedPeakBytes)} of RAM; ` +
        `${memorySize(assessment.usableRAMBytes ?? 0)} is available after headroom. ` +
        'Choose one-frame mode, compatible tiled processing, or a smaller output. Splitting into parts does not shrink a single frame.',
    );
    this.name = 'RenderMemoryError';
  }
}

/** Tile coordinates never reach effects that depend on neighboring/global pixels. */
export async function renderTiledFrame<
  T extends { width: number; height: number; pixels: ArrayBuffer },
>(
  image: T,
  tileSize: number,
  render: (tile: T) => Promise<T>,
  cancelled: () => boolean,
): Promise<T> {
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0)
    throw new Error('Choose a positive tile size.');
  const source = new Uint8Array(image.pixels);
  const result = new Uint8Array(source.length);
  for (let top = 0; top < image.height; top += tileSize) {
    for (let left = 0; left < image.width; left += tileSize) {
      if (cancelled()) throw new Error('Render cancelled.');
      const width = Math.min(tileSize, image.width - left);
      const height = Math.min(tileSize, image.height - top);
      const data = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row++)
        data.set(
          source.subarray(
            ((top + row) * image.width + left) * 4,
            ((top + row) * image.width + left + width) * 4,
          ),
          row * width * 4,
        );
      const tile = await render({ ...image, width, height, pixels: data.buffer });
      if (tile.width !== width || tile.height !== height || tile.pixels.byteLength !== data.length)
        throw new Error('A tiled effect changed its image dimensions.');
      const pixels = new Uint8Array(tile.pixels);
      for (let row = 0; row < height; row++)
        result.set(
          pixels.subarray(row * width * 4, (row + 1) * width * 4),
          ((top + row) * image.width + left) * 4,
        );
    }
  }
  return { ...image, pixels: result.buffer };
}
