import { renderOnGpu, renderingSettings, gpuCapabilities } from './gpu';
import { renderEffectsAsync, RenderCancelledError, type RenderOptions } from '@gleech/effects';
import {
  effectsNeedSubject,
  layerImages,
  isShaderEffect,
  type EffectInstance,
  type SubjectMask,
} from '@gleech/project-model';
import { decodeImageBytes, fitInside, jpegPass, resizeImage, type RgbaImage } from './codec';

export { RenderCancelledError };

export interface HeadlessRenderRequest {
  source: RgbaImage;
  effects: readonly EffectInstance[];
  masterSeed: number;
  /** Lazily supplies the subject mask; only called when the stack needs it. */
  subject?: () => Promise<SubjectMask>;
  /** Render a reduced draft whose longest side is at most this many pixels. */
  previewMaxDimension?: number;
  /** Supply a cached draft source matching previewMaxDimension. */
  draftSource?: RgbaImage;
  isCancelled?: () => boolean;
}

export interface HeadlessRenderResult {
  image: RgbaImage;
  warnings: string[];
  milliseconds: number;
  backend: string;
}

const isActive = (effect: EffectInstance) =>
  effect.enabled && effect.params.amount > 0 && effect.application.coverage > 0;

const layerCache = new Map<string, { png: string; pending: Promise<RgbaImage> }>();
async function decodeLayers(
  effects: readonly EffectInstance[],
): Promise<ReadonlyMap<string, RgbaImage>> {
  const result = new Map<string, RgbaImage>();
  for (const layer of layerImages(effects)) {
    let pending =
      layerCache.get(layer.source.id)?.png === layer.png
        ? layerCache.get(layer.source.id)!.pending
        : undefined;
    if (!pending) {
      pending = decodeImageBytes(Buffer.from(layer.png.slice(22), 'base64')).then(({ image }) => {
        if (image.width !== layer.source.width || image.height !== layer.source.height)
          throw new Error('The embedded layer image dimensions do not match.');
        return image;
      });
      layerCache.set(layer.source.id, { png: layer.png, pending });
      if (layerCache.size > 16) layerCache.delete(layerCache.keys().next().value!);
    }
    result.set(layer.source.id, await pending);
  }
  return result;
}

/**
 * GPU-only layers (imported WGSL/ISF shaders) cannot run headlessly. They are
 * bypassed with a warning instead of failing the whole render; every built-in
 * effect, including the original shaders, has a matching CPU implementation.
 */
export function cpuRenderableStack(
  effects: readonly EffectInstance[],
  skipUnsupported = false,
): {
  effects: readonly EffectInstance[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const next = effects.map((effect) => {
    if (effect.type === 'shader-import' && isActive(effect)) {
      if (!skipUnsupported)
        throw new Error(
          'Imported shader “' +
            effect.shader.name +
            '” requires GPU rendering. Use --renderer auto/gpu, or --skip-unsupported-shaders to explicitly bypass it.',
        );
      warnings.push(
        `Skipped imported ${effect.shader.language.toUpperCase()} shader “${effect.shader.name}” — it needs the desktop app's GPU renderer.`,
      );
      return { ...effect, enabled: false } as EffectInstance;
    }
    return effect;
  });
  return { effects: next, warnings };
}

export async function draftFor(source: RgbaImage, maxDimension: number): Promise<RgbaImage> {
  const size = fitInside(source.width, source.height, maxDimension, maxDimension);
  return resizeImage(source, size.width, size.height);
}

export async function renderHeadless(
  request: HeadlessRenderRequest,
): Promise<HeadlessRenderResult> {
  const started = performance.now();
  const settings = renderingSettings();
  let effects = request.effects;
  const warnings: string[] = [];
  if (settings.renderer === 'cpu') {
    const stack = cpuRenderableStack(effects, settings.skipUnsupportedShaders);
    effects = stack.effects;
    warnings.push(...stack.warnings);
  }
  const recompressJpeg = jpegPass();
  if (!recompressJpeg && effects.some((e) => e.type === 'jpeg-recompression' && isActive(e)))
    throw new Error('JPEG Recompression needs Sharp’s native JPEG codec. Run pnpm install.');
  const subjectMask = effectsNeedSubject(effects, request.source.pixels)
    ? await (request.subject
        ? request.subject()
        : Promise.reject(new Error('This stack needs subject detection.')))
    : undefined;
  const decodedLayers = await decodeLayers(effects);
  if (
    settings.renderer !== 'cpu' &&
    (settings.renderer === 'gpu' || effects.some((e) => isShaderEffect(e) && isActive(e)))
  ) {
    try {
      if (request.isCancelled?.()) throw new RenderCancelledError();
      if (settings.renderer === 'gpu') {
        const caps = await gpuCapabilities();
        if (!caps.webgpu && !caps.webgl2) throw new Error('No GPU shader backend is available.');
      }
      const result = await renderOnGpu({
        source: request.source,
        effects,
        masterSeed: request.masterSeed,
        layers: decodedLayers,
        ...(subjectMask ? { subjectMask } : {}),
        ...(request.previewMaxDimension !== undefined
          ? { previewMaxDimension: request.previewMaxDimension }
          : {}),
        ...(request.isCancelled ? { isCancelled: request.isCancelled } : {}),
      });
      if (result.backend === 'cpu' && effects.some((e) => isShaderEffect(e) && isActive(e)))
        warnings.push('GPU shaders unavailable; built-in shaders rendered on CPU.');
      return { ...result, warnings, milliseconds: performance.now() - started };
    } catch (error) {
      if (error instanceof RenderCancelledError || request.isCancelled?.())
        throw new RenderCancelledError();
      if (settings.renderer === 'gpu') throw error;
      if (
        !settings.skipUnsupportedShaders &&
        effects.some((e) => e.type === 'shader-import' && isActive(e))
      )
        throw new Error(
          'GPU shader render failed: ' + (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      const fallback = cpuRenderableStack(effects, settings.skipUnsupportedShaders);
      effects = fallback.effects;
      warnings.push(
        ...fallback.warnings,
        'GPU render unavailable; using CPU. ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  const preview =
    request.previewMaxDimension !== undefined &&
    Math.max(request.source.width, request.source.height) > request.previewMaxDimension;
  const input = preview
    ? (request.draftSource ?? (await draftFor(request.source, request.previewMaxDimension!)))
    : request.source;
  if (request.isCancelled?.()) throw new RenderCancelledError();
  const options: RenderOptions & { yieldControl(): Promise<void> } = {
    masterSeed: request.masterSeed,
    reference: { width: request.source.width, height: request.source.height },
    paletteSource: request.source,
    layerImages: decodedLayers,
    ...(subjectMask ? { subjectMask } : {}),
    ...(recompressJpeg ? { recompressJpeg } : {}),
    ...(preview ? { fieldMaxDimension: request.previewMaxDimension } : {}),
    ...(request.isCancelled ? { isCancelled: request.isCancelled } : {}),
    yieldControl: () => new Promise((resolve) => setImmediate(resolve)),
  };
  const output = await renderEffectsAsync({ ...input, pixels: input.pixels }, effects, options);
  return {
    image: {
      width: output.width,
      height: output.height,
      pixels: output.pixels === input.pixels ? output.pixels.slice(0) : output.pixels,
    },
    warnings,
    backend: 'cpu',
    milliseconds: performance.now() - started,
  };
}
