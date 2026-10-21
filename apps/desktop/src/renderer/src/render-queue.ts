// Background render jobs. Each job renders frames with its own effect worker,
// so the editor stays interactive, and streams them to the encoder in main.
import {
  effectsNeedSubject,
  evaluateEffectsAt,
  frameSeed,
  timeFrame,
  type ModulationContext,
  type ProjectState,
  type SubjectMask,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import type { PixelImage } from '@gleech/renderer-core';
import { EffectProcessor } from './EffectProcessor';
import { unwrap } from '../../shared/image-api';
import type { RenderJobSpec, RenderResult, RenderTab } from '../../shared/render';
import { isUniform } from './render-plan';

export interface RenderRequest {
  readonly kind: RenderTab;
  /** Output file or folder name for the queue list. */
  readonly label: string;
  /** Snapshot taken when the job was queued; later edits don't change it. */
  readonly project: ProjectState;
  readonly spec: Omit<
    RenderJobSpec,
    'frameCount' | 'fps' | 'sourceWidth' | 'sourceHeight' | 'frameTimes' | 'withOriginal'
  >;
  /** Timeline seconds of every frame to send, in order. */
  readonly times: readonly number[];
  /** Rate of the frames sent (uniform renders). */
  readonly inputFps: number;
  /** Size effects render at (source size, or larger for native upscaling). */
  readonly renderSize: { readonly width: number; readonly height: number };
  /** Registered media id when the source is a video clip. */
  readonly videoMediaId?: string;
  /** Effects-only overlays also send each unedited frame. */
  readonly overlay: boolean;
}

export type RenderStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'failed' | 'canceled';
export interface RenderJob {
  readonly id: string;
  readonly kind: RenderTab;
  readonly label: string;
  readonly outputPath: string;
  readonly status: RenderStatus;
  readonly done: number;
  readonly total: number;
  readonly startedAt: number | null;
  readonly result?: RenderResult;
  readonly error?: string;
}

function resizePixels(image: PixelImage, width: number, height: number): PixelImage {
  if (image.width === width && image.height === height) return image;
  const from = new OffscreenCanvas(image.width, image.height);
  from
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  const to = new OffscreenCanvas(width, height);
  const context = to.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(from, 0, 0, width, height);
  return {
    width,
    height,
    pixels: context.getImageData(0, 0, width, height).data.buffer as ArrayBuffer,
  };
}

class RenderQueue {
  private jobs: readonly RenderJob[] = [];
  private requests = new Map<string, RenderRequest>();
  private listeners = new Set<() => void>();
  private cancelled = new Set<string>();
  private active: { id: string; processor: EffectProcessor; encoder: string | null } | null = null;
  private running = false;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly snapshot = () => this.jobs;

  enqueue(request: RenderRequest): string {
    const id = crypto.randomUUID();
    this.requests.set(id, request);
    this.update([
      ...this.jobs,
      {
        id,
        kind: request.kind,
        label: request.label,
        outputPath: request.spec.outputPath,
        status: 'queued',
        done: 0,
        total: request.times.length,
        startedAt: null,
      },
    ]);
    void this.pump();
    return id;
  }

  cancel(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['queued', 'rendering', 'encoding'].includes(job.status)) return;
    this.cancelled.add(id);
    if (job.status === 'queued') this.patch(id, { status: 'canceled' });
    if (this.active?.id === id) {
      this.active.processor.cancelAll();
      // Finishing passes (GIF palettes, size limits) run in the encoder itself.
      if (this.active.encoder) void window.gleech.cancelRender(this.active.encoder).catch(() => {});
    }
  }

  dismiss(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['queued', 'rendering', 'encoding'].includes(job.status)) return;
    this.requests.delete(id);
    this.update(this.jobs.filter((entry) => entry.id !== id));
  }

  busy(): boolean {
    return this.jobs.some((job) => ['queued', 'rendering', 'encoding'].includes(job.status));
  }

  private update(jobs: readonly RenderJob[]) {
    this.jobs = jobs;
    for (const listener of this.listeners) listener();
  }
  private patch(id: string, change: Partial<RenderJob>) {
    this.update(this.jobs.map((job) => (job.id === id ? { ...job, ...change } : job)));
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.jobs.find((job) => job.status === 'queued');
        if (!next) break;
        await this.run(next.id);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string) {
    const request = this.requests.get(id);
    if (!request) return;
    const { project, times } = request;
    const timeline = project.timeline;
    const source = project.source;
    const processor = new EffectProcessor();
    this.active = { id, processor, encoder: null };
    this.patch(id, { status: 'rendering', startedAt: performance.now() });
    let encoder: string | null = null;
    let reader: string | null = null;
    const check = () => {
      if (this.cancelled.has(id)) throw new RenderCancelledError();
    };
    try {
      if (!timeline || !source) throw new Error('Open Timeline mode before rendering.');
      const modulation: ModulationContext = {
        bpm: timeline.bpm ?? (timeline.audio?.analysis?.bpm || 120),
        seed: project.masterSeed,
        audio: timeline.audio?.analysis,
      };
      const { width, height } = request.renderSize;
      let still: PixelImage | null = null;
      if (!request.videoMediaId)
        still = resizePixels(unwrap(await window.gleech.originalPixels(source.id)), width, height);
      check();
      encoder = unwrap(
        await window.gleech.beginRender({
          ...request.spec,
          frameCount: times.length,
          fps: request.inputFps,
          sourceWidth: width,
          sourceHeight: height,
          frameTimes: times,
          withOriginal: request.overlay,
        }),
      );
      if (this.active?.id === id) this.active.encoder = encoder;
      if (request.videoMediaId && times.length > 1 && isUniform(times, request.inputFps))
        reader = unwrap(
          await window.gleech.openVideoReader(request.videoMediaId, {
            start: times[0]!,
            fps: request.inputFps,
            count: times.length,
            width,
            height,
          }),
        );
      let subject: SubjectMask | undefined;
      let lastClipFrame: PixelImage | null = null;
      for (let index = 0; index < times.length; index++) {
        check();
        const t = times[index]!;
        let raw: PixelImage;
        if (still) raw = still;
        else if (reader) {
          // Past the clip's end the last frame holds, like the preview.
          const frame = unwrap(await window.gleech.readVideoFrame(reader));
          if (frame) lastClipFrame = resizePixels(frame, width, height);
          if (!lastClipFrame)
            lastClipFrame = resizePixels(
              unwrap(
                await window.gleech.videoFrameAt(request.videoMediaId!, t, Math.max(width, height)),
              ),
              width,
              height,
            );
          raw = lastClipFrame;
        } else
          raw = resizePixels(
            unwrap(
              await window.gleech.videoFrameAt(request.videoMediaId!, t, Math.max(width, height)),
            ),
            width,
            height,
          );
        const effects = evaluateEffectsAt(project.effects, t, modulation);
        const seed = frameSeed(project.masterSeed, timeline.seed, timeFrame(t, timeline.fps));
        const active = effects.some((effect) => effect.enabled && effect.params.amount > 0);
        if (active && !subject && effectsNeedSubject(effects, raw.pixels))
          subject = unwrap(await window.gleech.subjectMask(source.id));
        check();
        const rendered = active
          ? await processor.render(raw, effects, {
              masterSeed: seed,
              reference: raw,
              purpose: 'export',
              ...(subject ? { subjectMask: subject } : {}),
            })
          : raw;
        check();
        unwrap(
          await window.gleech.renderFrame(
            encoder,
            { width: rendered.width, height: rendered.height, pixels: rendered.pixels },
            request.overlay
              ? { width: raw.width, height: raw.height, pixels: raw.pixels }
              : undefined,
          ),
        );
        this.patch(id, { done: index + 1 });
      }
      check();
      this.patch(id, { status: 'encoding' });
      const result = unwrap(await window.gleech.finishRender(encoder));
      encoder = null;
      if (this.active) this.active.encoder = null;
      this.patch(id, { status: 'done', result });
    } catch (error) {
      if (encoder) await window.gleech.cancelRender(encoder).catch(() => {});
      if (error instanceof RenderCancelledError || this.cancelled.has(id))
        this.patch(id, { status: 'canceled' });
      else
        this.patch(id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'The render failed.',
        });
    } finally {
      if (reader) await window.gleech.closeVideoReader(reader).catch(() => {});
      processor.dispose();
      this.active = null;
      this.cancelled.delete(id);
    }
  }
}

export const renderQueue = new RenderQueue();
