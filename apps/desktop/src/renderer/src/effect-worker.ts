import { effectImages, isShaderEffect } from '@gleech/project-model';
import {
  renderEffectsAsync,
  PaintedMaskRasterizer,
  PreviewStackCache,
  RenderCancelledError,
  builtinShaderInvocation,
  importedShaderInvocation,
  type RenderOptions,
} from '@gleech/effects';
import { previewSize, ShaderRenderer, IsfRenderer, type PixelImage } from '@gleech/renderer-core';
import type { EffectRequest, EffectReply } from './effect-protocol';

let source: PixelImage | null = null;
class MaskRasterizers extends Map<string, PaintedMaskRasterizer> {
  activeId: string | undefined;
  override get(id: string) {
    let rasterizer = super.get(id);
    if (!rasterizer) {
      if (this.size >= 4) this.delete([...this.keys()].find((key) => key !== this.activeId)!);
      rasterizer = new PaintedMaskRasterizer();
    }
    // Touch only masks actually rendered, so a long stack cannot evict the
    // active brush's incremental rasterizer every frame.
    this.delete(id);
    this.set(id, rasterizer);
    return rasterizer;
  }
}
const maskRasterizers = new MaskRasterizers();
const previewStackCache = new PreviewStackCache();
const cpuStackCache = new PreviewStackCache();
const layers = new Map<string, PixelImage>();
const drafts = new Map<number, { source: PixelImage; image: PixelImage }>();
function interactiveImage(image: PixelImage, maximum: number): PixelImage {
  if (Math.max(image.width, image.height) <= maximum) return image;
  const draft = drafts.get(maximum);
  if (draft?.source === image) return draft.image;
  const size = previewSize(image.width, image.height, maximum);
  const full = new OffscreenCanvas(image.width, image.height);
  const small = new OffscreenCanvas(size.width, size.height);
  const fullContext = full.getContext('2d')!;
  fullContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  const context = small.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(full, 0, 0, size.width, size.height);
  const pixels = context.getImageData(0, 0, size.width, size.height).data.buffer as ArrayBuffer;
  const result = { ...size, pixels };
  drafts.set(maximum, { source: image, image: result });
  if (drafts.size > 4) drafts.delete(drafts.keys().next().value!);
  // Release the temporary full-size surface; only the small source stays cached.
  full.width = full.height = 1;
  return result;
}
const jobs = new Map<number, { cancelled: boolean }>();
let codecSequence = 0;
const codecJobs = new Map<
  number,
  {
    jobId: number;
    resolve(pixels: ArrayBuffer): void;
    reject(error: Error): void;
  }
>();
let shaders: Promise<ShaderRenderer | null> | null = null;
let shaderFailure: string | null = null;
let isf: IsfRenderer | null | undefined;
async function shaderRenderer(): Promise<ShaderRenderer | null> {
  shaders ??= ShaderRenderer.create().catch((error: unknown) => {
    shaderFailure = error instanceof Error ? error.message : 'Shader GPU initialization failed.';
    return null;
  });
  const pending = shaders;
  const renderer = await pending;
  if (!renderer?.isLost) return renderer;
  if (shaders === pending) {
    shaders = ShaderRenderer.create().catch((error: unknown) => {
      shaderFailure = error instanceof Error ? error.message : 'Shader GPU recovery failed.';
      return null;
    });
  }
  return shaders;
}
const channel = new MessageChannel();
const yields: (() => void)[] = [];
channel.port1.onmessage = () => yields.shift()?.();
function yieldControl(): Promise<void> {
  return new Promise((resolve) => {
    yields.push(resolve);
    channel.port2.postMessage(null);
  });
}

self.onmessage = (event: MessageEvent<EffectRequest>) => {
  const request = event.data;
  if (request.kind === 'jpeg-result' || request.kind === 'jpeg-error') {
    const pending = codecJobs.get(request.codecId);
    if (pending?.jobId !== request.id) return;
    codecJobs.delete(request.codecId);
    if (request.kind === 'jpeg-result') pending.resolve(request.pixels);
    else pending.reject(new Error(request.error));
    return;
  }
  if (request.kind === 'cancel') {
    const token = jobs.get(request.id);
    if (token) token.cancelled = true;
    for (const [codecId, pending] of codecJobs)
      if (pending.jobId === request.id) {
        codecJobs.delete(codecId);
        pending.reject(new RenderCancelledError());
      }
    return;
  }
  if (request.image) {
    maskRasterizers.clear();
    previewStackCache.clear();
    cpuStackCache.clear();
    source = request.image;
    drafts.clear();
  }
  const original = source;
  const activeIds = new Set(request.effects.flatMap(effectImages).map((image) => image.source.id));
  for (const image of request.layerImages ?? []) {
    layers.set(image.id, image.image);
  }
  for (const id of layers.keys()) if (!activeIds.has(id)) layers.delete(id);
  const requestedLayers = new Map([...activeIds].map((id) => [id, layers.get(id)!] as const));
  const token = { cancelled: false };
  jobs.set(request.id, token);
  const reply = (message: EffectReply, transfer: Transferable[] = []) =>
    self.postMessage(message, { transfer });
  void (async () => {
    try {
      if (!original) throw new Error('No effect source image.');
      if ([...requestedLayers.values()].some((image) => !image))
        throw new Error('The Solid layer image is not available.');
      const image =
        request.purpose === 'preview' && request.previewMaxDimension
          ? interactiveImage(original, request.previewMaxDimension)
          : original;
      const options: RenderOptions & { yieldControl(): Promise<void> } = {
        recompressJpeg: (image, options) =>
          new Promise((resolve, reject) => {
            if (token.cancelled) {
              reject(new RenderCancelledError());
              return;
            }
            const codecId = ++codecSequence;
            codecJobs.set(codecId, { jobId: request.id, resolve, reject });
            const copy = { ...image, pixels: image.pixels.slice(0) };
            reply({ kind: 'jpeg-request', id: request.id, codecId, image: copy, options }, [
              copy.pixels,
            ]);
          }),
        masterSeed: request.masterSeed,
        reference: request.reference,
        subjectMask: request.subjectMask,
        paletteSource: original,
        layerImages: requestedLayers,
        ...(request.purpose === 'preview' && request.previewMaxDimension
          ? { fieldMaxDimension: request.previewMaxDimension }
          : {}),
        isCancelled: () => token.cancelled,
        yieldControl,
      };
      if (request.purpose === 'preview' && request.previewMaxDimension) {
        maskRasterizers.activeId = request.activeMaskId;
        options.previewStackCache = previewStackCache;
        for (const id of maskRasterizers.keys())
          if (
            !request.effects.some(
              (effect) => effect.instanceId === id && effect.paintedMask?.enabled,
            )
          )
            maskRasterizers.delete(id);
        options.paintedMaskRasterizers = maskRasterizers;
      }
      const activeShaders = request.effects.filter(
        (effect) =>
          isShaderEffect(effect) &&
          effect.enabled &&
          effect.params.amount > 0 &&
          effect.application.coverage > 0,
      );
      const hasShader = activeShaders.length > 0;
      const hasIsf = activeShaders.some(
        (effect) => effect.type === 'shader-import' && effect.shader.language === 'isf',
      );
      const hasWgsl = activeShaders.some(
        (effect) => effect.type !== 'shader-import' || effect.shader.language !== 'isf',
      );
      if (hasIsf && isf === undefined) isf = IsfRenderer.create();
      let gpu = hasWgsl && !shaderFailure ? await shaderRenderer() : null;
      if (token.cancelled) throw new RenderCancelledError();
      let result: PixelImage;
      let shaderBackend: PixelImage['shaderBackend'] =
        hasIsf && isf ? (gpu ? 'mixed-gpu' : 'webgl2') : gpu ? 'webgpu' : 'cpu';
      try {
        result = await renderEffectsAsync(image, request.effects, {
          ...options,
          ...(gpu || hasIsf
            ? {
                renderShader: async (input, effect, seed, reference, heightField, direction) => {
                  if (effect.type === 'shader-import' && effect.shader.language === 'isf') {
                    if (!isf) throw new Error('WebGL2 is unavailable for this ISF shader.');
                    const invocation = importedShaderInvocation(effect, seed, reference);
                    return isf.render(
                      input,
                      { ...invocation, program: 'isf' },
                      options.isCancelled!,
                      yieldControl,
                    );
                  }
                  if (!gpu) return null;
                  const invocation =
                    effect.type === 'shader-import'
                      ? {
                          ...importedShaderInvocation(effect, seed, reference),
                          program: 'imported' as const,
                        }
                      : builtinShaderInvocation(effect, seed, reference, heightField, direction);
                  try {
                    return await gpu!.render(input, invocation, options.isCancelled!);
                  } catch (error) {
                    if (token.cancelled || !gpu!.isLost) throw error;
                    // Recreate a lost device once. A compiler error stays local
                    // to its package and never triggers repeated GPU retries.
                    gpu = await shaderRenderer();
                    if (!gpu) throw error;
                    return gpu.render(input, invocation, options.isCancelled!);
                  }
                },
              }
            : {}),
        });
      } catch (error) {
        if (token.cancelled || error instanceof RenderCancelledError)
          throw new RenderCancelledError();
        if (
          !gpu ||
          request.effects.some(
            (effect) =>
              effect.type === 'shader-import' &&
              effect.enabled &&
              effect.params.amount > 0 &&
              effect.application.coverage > 0,
          )
        )
          throw error;
        // Retry the original stack, not a partially rendered image. These two
        // built-in programs have matching CPU implementations. Imported shaders
        // report their error and can be disabled to continue on CPU.
        shaderFailure = error instanceof Error ? error.message : 'Shader GPU rendering failed.';
        previewStackCache.clear();
        gpu.dispose();
        shaderBackend = 'cpu';
        result = await renderEffectsAsync(image, request.effects, {
          ...options,
          previewStackCache: options.previewStackCache ? cpuStackCache : undefined,
        });
      }
      if (token.cancelled) throw new RenderCancelledError();
      const pixels = result.pixels === image.pixels ? result.pixels.slice(0) : result.pixels;
      reply(
        {
          kind: 'success',
          id: request.id,
          image: {
            ...result,
            pixels,
            ...(hasShader
              ? {
                  shaderBackend,
                  ...(shaderBackend === 'cpu'
                    ? { shaderReason: shaderFailure ?? 'WebGPU is unavailable.' }
                    : {}),
                }
              : {}),
          },
        },
        [pixels],
      );
    } catch (error) {
      if (error instanceof RenderCancelledError) reply({ kind: 'cancelled', id: request.id });
      else
        reply({
          kind: 'error',
          id: request.id,
          error: error instanceof Error ? error.message : 'Effect rendering failed.',
        });
    } finally {
      jobs.delete(request.id);
    }
  })();
};
