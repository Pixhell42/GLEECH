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
import {
  assessRenderMemory,
  renderSafety,
  renderTiledFrame,
  RenderMemoryError,
  tiledRenderUnavailable,
  type RenderMemoryBudget,
} from './render-safety';

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
  readonly lowMemory?: boolean;
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
  readonly resumeFrames?: number;
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
  memoryBudget?(): Promise<RenderMemoryBudget> | RenderMemoryBudget;
  /** Drop disposable caches between parts, only for frame-independent stacks. */
  releaseEffects?(): void | Promise<void>;
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

export async function timelineCheckpointIdentity(
  request: TimelineRenderRequest,
  sourcePixels?: ArrayBuffer,
): Promise<string> {
  const hash = async (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  const sourceHash = sourcePixels ? await hash(sourcePixels) : undefined;
  const text = JSON.stringify(
    {
      project: request.project,
      times: request.times,
      inputFps: request.inputFps,
      renderSize: request.renderSize,
      overlay: request.overlay,
      video: request.spec.video,
      gif: request.spec.gif,
      segmentSeconds: request.spec.safety?.segmentSeconds,
      sourceHash,
    },
    function (key, value: unknown) {
      // Desktop remaps image registry IDs when reopening a saved project. They
      // do not change pixels or effect seeds, so cannot invalidate recovery.
      if (key === 'posterId') return undefined;
      if (
        key === 'id' &&
        typeof this.width === 'number' &&
        typeof this.height === 'number' &&
        typeof this.format === 'string' &&
        typeof this.hasAlpha === 'boolean'
      )
        return undefined;
      return value;
    },
  );
  return hash(new TextEncoder().encode(text).buffer as ArrayBuffer);
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
  const assessment = assessRenderMemory(
    request,
    adapters.memoryBudget ? await adapters.memoryBudget() : null,
  );
  const safety = renderSafety(request.spec.safety);
  if (safety.mode === 'tiled' && assessment.tiledUnavailable)
    throw new Error(assessment.tiledUnavailable);
  if (safety.checkMemory && assessment.status === 'insufficient')
    throw new RenderMemoryError(assessment);
  const effectiveSafety = { ...safety, mode: assessment.mode };
  const lowMemory = assessment.mode !== 'standard';
  const replay = project.effects.some((e) => e.type === 'shader-import');
  let resumeIdentity: string | undefined;
  let savedStill: RenderFrame | null = null;
  if (safety.segmentSeconds > 0 && (safety.keepParts || safety.resume)) {
    if (adapters.source.kind === 'still') {
      const image = await adapters.source.read();
      savedStill =
        image.width === renderSize.width && image.height === renderSize.height
          ? image
          : await adapters.resize(image, renderSize.width, renderSize.height);
      check();
      resumeIdentity = await timelineCheckpointIdentity(request, image.pixels);
    } else resumeIdentity = await timelineCheckpointIdentity(request);
  }
  check();

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
  let readerClosure: Promise<void> | null = null;
  const closeReader = () => {
    const current = reader;
    if (current)
      readerClosure ??= Promise.resolve()
        .then(() => current.close())
        .catch(() => {});
    return readerClosure;
  };
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
      // A decoder may be waiting for bytes when cancellation arrives.
      // Closing it wakes that read instead of waiting for another frame.
      void closeReader();
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const frames = adapters.source;
    encoder = await adapters.begin({
      ...request.spec,
      ...(request.spec.safety || assessment.mode !== 'standard' ? { safety: effectiveSafety } : {}),
      ...(resumeIdentity ? { resumeIdentity } : {}),
      frameCount: times.length,
      fps: inputFps,
      sourceWidth: width,
      sourceHeight: height,
      frameTimes: times,
      withOriginal: overlay,
    });
    check();
    const resumed = encoder.resumeFrames ?? 0;
    if (!Number.isSafeInteger(resumed) || resumed < 0 || resumed > times.length)
      throw new Error('The saved export has an invalid frame position.');
    const first = resumed === times.length ? resumed : replay ? 0 : resumed;
    const still =
      first < times.length && frames.kind === 'still'
        ? (savedStill ?? (await resize(await frames.read())))
        : null;
    check();
    if (
      frames.kind === 'video' &&
      frames.openReader &&
      times.length - first > 1 &&
      isUniform(times, inputFps)
    )
      reader = await frames.openReader({
        start: times[first]!,
        fps: inputFps,
        count: times.length - first,
        width,
        height,
        ...(lowMemory ? { lowMemory: true } : {}),
      });
    check();
    let subject: SubjectMask | undefined;
    let lastClipFrame: RenderFrame | null = null;
    if (resumed > 0 && !replay)
      onProgress?.({ phase: 'rendering', done: resumed, total: times.length });
    const partFrames =
      safety.segmentSeconds > 0 ? Math.max(1, Math.round(safety.segmentSeconds * inputFps)) : 0;
    for (let index = first; index < times.length; index++) {
      check();
      if (partFrames && index > first && index % partFrames === 0 && !replay) {
        await adapters.releaseEffects?.();
        if (reader && frames.kind === 'video' && frames.openReader) {
          await closeReader();
          reader = null;
          readerClosure = null;
          reader = await frames.openReader({
            start: times[index]!,
            fps: inputFps,
            count: times.length - index,
            width,
            height,
            ...(lowMemory ? { lowMemory: true } : {}),
          });
          lastClipFrame = null;
        }
        check();
      }
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
      const context: TimelineEffectContext = {
        masterSeed: seed,
        ...(subject ? { subjectMask: subject } : {}),
        isCancelled,
      };
      let rendered = raw;
      if (active) {
        if (assessment.mode === 'tiled') {
          const unavailable = tiledRenderUnavailable(effects);
          if (unavailable) throw new Error(unavailable);
          rendered = await renderTiledFrame(
            raw,
            safety.tileSize,
            (tile) => adapters.render(tile, effects, context),
            isCancelled,
          );
        } else rendered = await adapters.render(raw, effects, context);
      }
      check();
      if (index >= resumed) await encoder.frame(rendered, overlay ? raw : undefined);
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
    await closeReader();
  }
}
