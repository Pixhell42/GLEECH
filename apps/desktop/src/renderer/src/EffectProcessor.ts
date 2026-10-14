import { effectImages, withoutImageData, type EffectInstance } from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import type { PixelImage } from '@gleech/renderer-core';
import type { EffectContext, EffectReply, EffectRequest } from './effect-protocol';
import { unwrap } from '../../shared/image-api';

export class EffectProcessor {
  private worker = new Worker(new URL('./effect-worker.ts', import.meta.url), { type: 'module' });
  private source: PixelImage | null = null;
  private sequence = 0;
  private requests = new Map<
    number,
    { resolve(image: PixelImage): void; reject(error: Error): void }
  >();
  private stopped = false;
  private previewId: number | null = null;
  private layers = new Map<string, string>();
  private decodedLayers = new Map<string, { png: string; image: Promise<PixelImage> }>();
  private cancelled = new Set<number>();
  private codecQueue: Promise<void> = Promise.resolve();
  cancelledPreviews = 0;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<EffectReply>) => {
      const reply = event.data;
      if (reply.kind === 'jpeg-request') {
        // Serialize codec work; superseded previews are discarded before IPC so
        // slider gestures cannot queue unbounded native JPEG generations.
        this.codecQueue = this.codecQueue.then(async () => {
          if (this.stopped) return;
          try {
            if (!this.requests.has(reply.id) || this.cancelled.has(reply.id))
              throw new RenderCancelledError();
            const pixels = unwrap(await window.gleech.recompressJpeg(reply.image, reply.options));
            if (!this.stopped)
              this.worker.postMessage(
                {
                  kind: 'jpeg-result',
                  id: reply.id,
                  codecId: reply.codecId,
                  pixels,
                } satisfies EffectRequest,
                [pixels],
              );
          } catch (error) {
            if (!this.stopped)
              this.worker.postMessage({
                kind: 'jpeg-error',
                id: reply.id,
                codecId: reply.codecId,
                error: error instanceof Error ? error.message : 'JPEG recompression failed.',
              } satisfies EffectRequest);
          }
        });
        return;
      }
      const request = this.requests.get(reply.id);
      this.requests.delete(reply.id);
      this.cancelled.delete(reply.id);
      if (this.previewId === reply.id) this.previewId = null;
      if (reply.kind === 'error') request?.reject(new Error(reply.error));
      else if (reply.kind === 'cancelled') {
        this.cancelledPreviews++;
        request?.reject(new RenderCancelledError());
      } else request?.resolve(reply.image);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.dispose();
    };
  }

  cancelPreview(): void {
    if (this.previewId !== null && this.requests.has(this.previewId)) {
      this.cancelled.add(this.previewId);
      this.worker.postMessage({ kind: 'cancel', id: this.previewId } satisfies EffectRequest);
      this.previewId = null;
    }
  }

  cancelAll(): void {
    for (const [id, request] of this.requests) {
      this.cancelled.add(id);
      this.worker.postMessage({ kind: 'cancel', id } satisfies EffectRequest);
      request.reject(new RenderCancelledError());
    }
    this.requests.clear();
    this.previewId = null;
    this.source = null;
    this.layers.clear();
  }

  render(
    image: PixelImage,
    effects: readonly EffectInstance[],
    context: EffectContext,
  ): Promise<PixelImage> {
    if (this.stopped)
      return Promise.reject(new Error('The effect worker stopped. Reopen the app.'));
    if (context.purpose === 'preview') this.cancelPreview();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.requests.set(id, { resolve, reject });
      if (context.purpose === 'preview') this.previewId = id;
      void (async () => {
        try {
          const images = effects.flatMap(effectImages);
          const layers = new Map(images.map((image) => [image.source.id, image.png]));
          const decoded = await Promise.all(
            [...new Map(images.map((image) => [image.source.id, image])).values()].map(
              async (image) => {
                let cached = this.decodedLayers.get(image.source.id);
                if (cached?.png !== image.png) {
                  cached = {
                    png: image.png,
                    image: window.gleech.decodeLayerImage(image).then(unwrap),
                  };
                  this.decodedLayers.set(image.source.id, cached);
                }
                return { id: image.source.id, image: await cached.image };
              },
            ),
          );
          if (this.stopped) throw new Error('The effect worker closed.');
          if (!this.requests.has(id) || this.cancelled.has(id)) throw new RenderCancelledError();
          if (context.purpose === 'preview' && this.previewId !== id)
            throw new RenderCancelledError();
          const request: EffectRequest = {
            kind: 'render',
            id,
            // Pixels are cached in the worker. Slider edits never resend large PNG strings.
            effects: effects.map(withoutImageData),
            layerImages: decoded.filter(
              (image) => this.layers.get(image.id) !== layers.get(image.id),
            ),
            ...context,
            ...(image !== this.source ? { image } : {}),
          };
          this.worker.postMessage(request);
          this.source = image;
          this.layers = layers;
          for (const key of this.decodedLayers.keys())
            if (!layers.has(key)) this.decodedLayers.delete(key);
        } catch (error) {
          this.requests.delete(id);
          this.cancelled.delete(id);
          if (this.previewId === id) this.previewId = null;
          reject(error);
        }
      })();
    });
  }

  dispose(): void {
    this.stopped = true;
    this.worker.terminate();
    this.source = null;
    this.layers.clear();
    this.decodedLayers.clear();
    for (const request of this.requests.values())
      request.reject(new Error('The effect worker closed.'));
    this.requests.clear();
    this.cancelled.clear();
  }
}
