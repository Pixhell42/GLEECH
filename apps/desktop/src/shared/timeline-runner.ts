// Host-independent timeline rendering. Desktop, CLI and TUI supply pixels,
// effect processing and an encoder; this module owns frame order and cleanup.
import {
  effectsNeedSubject,
  evaluateEffectsAt,
  frameSeed,
  timeFrame,
  type EffectInstance,
  type ModulationContext,
  type ProjectState,
  type SubjectMask,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import type { RenderFrame, RenderJobSpec, RenderResult, RenderTab } from './render';
import { isUniform } from './render-plan';

export interface TimelineRenderRequest {
  readonly kind: RenderTab;
  readonly label: string;
  /** Immutable project snapshot, taken when the job is queued. */
  readonly project: ProjectState;
  readonly spec: Omit<
    RenderJobSpec,
    'frameCount' | 'fps' | 'sourceWidth' | 'sourceHeight' | 'frameTimes' | 'withOriginal'
  >;
  /** Timeline seconds in delivery order, including jumps for concat loops. */
  readonly times: readonly number[];
  readonly inputFps: number;
  readonly renderSize: { readonly width: number; readonly height: number };
  /** Send each unedited frame alongside the result for effects-only exports. */
  readonly overlay: boolean;
}

export interface TimelineFrameReader {
  /** Null means end of clip; errors must reject, rather than masquerading as EOF. */
  read(): Promise<RenderFrame | null>;
  close(): Promise<void>;
}

export interface TimelineReaderOptions {
  readonly start: number;
  readonly fps: number;
  readonly count: number;
  readonly width: number;
  readonly height: number;
}

export type TimelineFrameSource =
  | { readonly kind: 'still'; read(): Promise<RenderFrame> }
  | {
      readonly kind: 'video';
      /** Random access must clamp times beyond the clip to its final frame. */
      frameAt(t: number, maxDimension: number): Promise<RenderFrame>;
      /** Optional streaming optimization for uniformly spaced frame times. */
      openReader?(options: TimelineReaderOptions): Promise<TimelineFrameReader>;
    };

export interface TimelineEncoder {
  frame(image: RenderFrame, original?: RenderFrame): Promise<void>;
  finish(): Promise<RenderResult>;
  /** Must interrupt an in-flight frame/finish and release partial output. */
  cancel(): Promise<void>;
}

export interface TimelineEffectContext {
  readonly masterSeed: number;
  readonly subjectMask?: SubjectMask;
  readonly isCancelled: () => boolean;
}

export interface TimelineRenderAdapters {
  readonly source: TimelineFrameSource;
  resize(image: RenderFrame, width: number, height: number): RenderFrame | Promise<RenderFrame>;
  /** Keep input pixels intact: stills and held clip frames are reused. */
  render(
    image: RenderFrame,
    effects: readonly EffectInstance[],
    context: TimelineEffectContext,
  ): Promise<RenderFrame>;
  /** Uses the project's source/poster mask, matching desktop clip rendering. */
  subject(): Promise<SubjectMask>;
  begin(spec: RenderJobSpec): Promise<TimelineEncoder>;
  /** Interrupt host worker processing; polling hosts can use context.isCancelled. */
  cancelEffects?(): void;
}

export interface TimelineRenderProgress {
  readonly phase: 'rendering' | 'encoding';
  readonly done: number;
  readonly total: number;
}

export interface TimelineRunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TimelineRenderProgress) => void;
}

/**
 * Streams one frame at a time with backpressure. Owns the reader/encoder it
 * opens, but leaves reusable effect engines and GPU helpers with the caller.
 */
export async function runTimelineRender(
  request: TimelineRenderRequest,
  adapters: TimelineRenderAdapters,
  options: TimelineRunOptions = {},
): Promise<RenderResult> {
  const { project, times, inputFps, renderSize, overlay } = request;
  const { timeline, source } = project;
  const { signal, onProgress } = options;
  const isCancelled = () => signal?.aborted === true;
  const check = () => {
    if (isCancelled()) throw new RenderCancelledError();
  };
  check();
  if (!timeline || !source) throw new Error('Open Timeline mode before rendering.');
  if (!times.length || times.some((t) => !Number.isFinite(t) || t < 0))
    throw new Error('Choose at least one valid timeline frame to render.');
  if (!Number.isFinite(inputFps) || inputFps <= 0)
    throw new Error('Choose a positive render frame rate.');

  const modulation: ModulationContext = {
    bpm: timeline.bpm ?? (timeline.audio?.analysis?.bpm || 120),
    seed: project.masterSeed,
    audio: timeline.audio?.analysis,
  };
  const { width, height } = renderSize;
  const resize = (image: RenderFrame) =>
    image.width === width && image.height === height
      ? image
      : adapters.resize(image, width, height);
  let encoder: TimelineEncoder | null = null;
  let reader: TimelineFrameReader | null = null;
  let cancellation: Promise<void> | null = null;
  const cancelEncoder = () => {
    const current = encoder;
    if (current)
      cancellation ??= Promise.resolve()
        .then(() => current.cancel())
        .catch(() => {});
    return cancellation;
  };
  const abort = () => {
    try {
      adapters.cancelEffects?.();
    } catch {
      // Cleanup is best effort; encoder cancellation must still run.
    } finally {
      void cancelEncoder();
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const frames = adapters.source;
    const still = frames.kind === 'still' ? await resize(await frames.read()) : null;
    check();
    encoder = await adapters.begin({
      ...request.spec,
      frameCount: times.length,
      fps: inputFps,
      sourceWidth: width,
      sourceHeight: height,
      frameTimes: times,
      withOriginal: overlay,
    });
    check();
    if (
      frames.kind === 'video' &&
      frames.openReader &&
      times.length > 1 &&
      isUniform(times, inputFps)
    )
      reader = await frames.openReader({
        start: times[0]!,
        fps: inputFps,
        count: times.length,
        width,
        height,
      });
    check();
    let subject: SubjectMask | undefined;
    let lastClipFrame: RenderFrame | null = null;
    for (let index = 0; index < times.length; index++) {
      check();
      const t = times[index]!;
      let raw: RenderFrame;
      if (still) raw = still;
      else if (frames.kind === 'video') {
        if (reader) {
          // Hold the last frame after EOF. An empty reader (range wholly past
          // the clip) gets one clamped random-access frame, then holds it too.
          const frame = await reader.read();
          check();
          if (frame) lastClipFrame = await resize(frame);
          if (!lastClipFrame)
            lastClipFrame = await resize(await frames.frameAt(t, Math.max(width, height)));
          raw = lastClipFrame;
        } else raw = await resize(await frames.frameAt(t, Math.max(width, height)));
      } else throw new Error('The render source is unavailable.');
      check();
      const effects = evaluateEffectsAt(project.effects, t, modulation);
      const seed = frameSeed(project.masterSeed, timeline.seed, timeFrame(t, timeline.fps));
      const active = effects.some((effect) => effect.enabled && effect.params.amount > 0);
      if (active && !subject && effectsNeedSubject(effects, raw.pixels))
        subject = await adapters.subject();
      check();
      const rendered = active
        ? await adapters.render(raw, effects, {
            masterSeed: seed,
            ...(subject ? { subjectMask: subject } : {}),
            isCancelled,
          })
        : raw;
      check();
      await encoder.frame(rendered, overlay ? raw : undefined);
      check();
      onProgress?.({ phase: 'rendering', done: index + 1, total: times.length });
    }
    check();
    onProgress?.({ phase: 'encoding', done: times.length, total: times.length });
    check();
    const result = await encoder.finish();
    check();
    encoder = null;
    return result;
  } catch (error) {
    await cancelEncoder();
    if (isCancelled()) throw new RenderCancelledError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (reader) await reader.close().catch(() => {});
  }
}
