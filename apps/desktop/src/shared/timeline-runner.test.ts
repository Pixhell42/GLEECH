import { describe, expect, it, vi } from 'vitest';
import {
  createAudioModulator,
  createEffect,
  createLfo,
  createProject,
  createTimeline,
  frameSeed,
  type EffectInstance,
  type SubjectMask,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import type { RenderFrame, RenderJobSpec } from './render';
import {
  runTimelineRender,
  type TimelineEffectContext,
  type TimelineRenderAdapters,
  type TimelineRenderRequest,
} from './timeline-runner';

const image = (value = 1): RenderFrame => ({
  width: 2,
  height: 1,
  pixels: new Uint8Array([value, 2, 3, 255, value, 5, 6, 255]).buffer,
});

function request(effects: readonly EffectInstance[] = []): TimelineRenderRequest {
  return {
    kind: 'video',
    label: 'render.mp4',
    project: {
      ...createProject('Timeline', 7),
      source: { id: 's', name: 's.png', width: 2, height: 1, format: 'png', hasAlpha: false },
      effects,
      timeline: { ...createTimeline(), seed: { mode: 'every-frame', every: 1 } },
    },
    spec: { kind: 'video', name: 'Timeline', outputPath: 'render.mp4' },
    times: [0, 0.5, 1],
    inputFps: 2,
    renderSize: { width: 2, height: 1 },
    overlay: false,
  };
}

function host() {
  const raw = image();
  const result = { outputPath: 'render.mp4', bytes: 10, files: 1, notes: [] };
  const encoder = {
    frame: vi.fn<(frame: RenderFrame, original?: RenderFrame) => Promise<void>>(async () => {}),
    finish: vi.fn(async () => result),
    cancel: vi.fn(async () => {}),
  };
  const reader = {
    read: vi.fn(async (): Promise<RenderFrame | null> => null),
    close: vi.fn(async () => {}),
  };
  const still = { kind: 'still' as const, read: vi.fn(async () => raw) };
  const video = {
    kind: 'video' as const,
    frameAt: vi.fn<(t: number, size: number) => Promise<RenderFrame>>(async () => raw),
    openReader: vi.fn(async () => reader),
  };
  const adapters = {
    source: still,
    resize: vi.fn(async (frame: RenderFrame, width: number, height: number) => ({
      ...frame,
      width,
      height,
    })),
    render: vi.fn<
      (
        frame: RenderFrame,
        effects: readonly EffectInstance[],
        context: TimelineEffectContext,
      ) => Promise<RenderFrame>
    >(async (frame) => frame),
    subject: vi.fn(async (): Promise<SubjectMask> => ({
      width: 2,
      height: 1,
      values: new Uint8Array([255, 0]).buffer,
    })),
    begin: vi.fn<(spec: RenderJobSpec) => Promise<typeof encoder>>(async () => encoder),
    cancelEffects: vi.fn(),
  } satisfies TimelineRenderAdapters;
  return { raw, result, encoder, reader, still, video, adapters };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('shared timeline runner', () => {
  it('evaluates keys and seeds at timeline time, independently of the output rate', async () => {
    const base = createEffect('rgb-split', 'fx');
    const effect: EffectInstance = {
      ...base,
      animation: {
        amount: {
          keys: [
            { t: 0, value: 0.2, interpolation: 'linear' },
            { t: 1, value: 0.8, interpolation: 'linear' },
          ],
        },
      },
    };
    const job = request([effect]);
    const h = host();
    const progress = vi.fn();
    expect(await runTimelineRender(job, h.adapters, { onProgress: progress })).toBe(h.result);
    expect(h.adapters.render.mock.calls.map(([, effects]) => effects[0]!.params.amount)).toEqual([
      0.2, 0.5, 0.8,
    ]);
    expect(h.adapters.render.mock.calls.map(([, , context]) => context.masterSeed)).toEqual([
      7,
      frameSeed(7, job.project.timeline!.seed, 15),
      frameSeed(7, job.project.timeline!.seed, 30),
    ]);
    expect(h.still.read).toHaveBeenCalledOnce();
    expect(h.adapters.resize).not.toHaveBeenCalled();
    expect(h.adapters.subject).not.toHaveBeenCalled();
    expect(h.adapters.begin).toHaveBeenCalledWith({
      ...job.spec,
      frameCount: 3,
      fps: 2,
      sourceWidth: 2,
      sourceHeight: 1,
      frameTimes: job.times,
      withOriginal: false,
    });
    expect(progress.mock.calls.map(([p]) => p)).toEqual([
      { phase: 'rendering', done: 1, total: 3 },
      { phase: 'rendering', done: 2, total: 3 },
      { phase: 'rendering', done: 3, total: 3 },
      { phase: 'encoding', done: 3, total: 3 },
    ]);
    expect(job.project.effects[0]).toBe(effect);
    expect(h.encoder.cancel).not.toHaveBeenCalled();
  });

  it('uses embedded audio analysis and the timeline tempo for modulators', async () => {
    const base = createEffect('rgb-split', 'fx');
    const spectrum = btoa(String.fromCharCode(...new Uint8Array(48).fill(255)));
    const job = request([
      {
        ...base,
        animation: {
          amount: {
            keys: [],
            modulators: [
              {
                ...createAudioModulator('audio'),
                attackMs: 0,
                releaseMs: 0,
                outMin: 0,
                outMax: 0.2,
              },
              { ...createLfo('lfo'), phase: 0, division: '1/4', depth: 0.1 },
            ],
          },
        },
      },
    ]);
    const h = host();
    await runTimelineRender(
      {
        ...job,
        times: [0.125],
        project: {
          ...job.project,
          timeline: {
            ...job.project.timeline!,
            bpm: 120,
            audio: {
              path: 'song.wav',
              name: 'song.wav',
              duration: 2,
              sampleRate: 48000,
              channels: 2,
              analysis: {
                rate: 1,
                bins: 24,
                minHz: 20,
                maxHz: 20000,
                spectrum,
                peaks: btoa('\xff\xff'),
                beats: [],
                bpm: 60,
              },
            },
          },
        },
      },
      h.adapters,
    );
    expect(h.adapters.render.mock.calls[0]![1][0]!.params.amount).toBeCloseTo(0.3);
  });

  it('bypasses inactive ranges and detects the project subject only once when needed', async () => {
    const base = createEffect('rgb-split', 'fx');
    const effect: EffectInstance = {
      ...base,
      activeRange: { start: 0.5, end: 2 },
      application: { ...base.application, region: 'subject' },
    };
    const h = host();
    await runTimelineRender(request([effect]), h.adapters);
    expect(h.adapters.render).toHaveBeenCalledTimes(2);
    expect(h.adapters.subject).toHaveBeenCalledOnce();
    expect(h.adapters.render.mock.calls[0]![2].subjectMask).toBe(
      h.adapters.render.mock.calls[1]![2].subjectMask,
    );
    expect(h.encoder.frame.mock.calls[0]![0]).toBe(h.raw);
  });

  it('streams uniform video frames and holds the final frame past EOF', async () => {
    const h = host();
    const last = image(9);
    h.reader.read.mockResolvedValueOnce(last);
    await runTimelineRender({ ...request(), overlay: true }, { ...h.adapters, source: h.video });
    expect(h.video.openReader).toHaveBeenCalledWith({
      start: 0,
      fps: 2,
      count: 3,
      width: 2,
      height: 1,
    });
    expect(h.video.frameAt).not.toHaveBeenCalled();
    expect(h.encoder.frame.mock.calls).toEqual([
      [last, last],
      [last, last],
      [last, last],
    ]);
    expect(h.reader.close).toHaveBeenCalledOnce();
  });

  it('gets one clamped frame when the entire streamed range is beyond the clip', async () => {
    const h = host();
    await runTimelineRender(
      { ...request(), times: [10, 10.5, 11] },
      { ...h.adapters, source: h.video },
    );
    expect(h.video.frameAt).toHaveBeenCalledExactlyOnceWith(10, 2);
    expect(h.encoder.frame).toHaveBeenCalledTimes(3);
  });

  it('seeks sparse or reordered times without opening a sequential reader', async () => {
    const h = host();
    await runTimelineRender(
      { ...request(), times: [1, 0.1, 4] },
      { ...h.adapters, source: h.video },
    );
    expect(h.video.openReader).not.toHaveBeenCalled();
    expect(h.video.frameAt.mock.calls).toEqual([
      [1, 2],
      [0.1, 2],
      [4, 2],
    ]);
  });

  it('can render video using only a random-access source adapter', async () => {
    const h = host();
    await runTimelineRender(request(), {
      ...h.adapters,
      source: { kind: 'video', frameAt: h.video.frameAt },
    });
    expect(h.video.frameAt).toHaveBeenCalledTimes(3);
  });

  it('awaits the encoder before decoding another frame', async () => {
    const h = host();
    const gate = deferred<void>();
    h.encoder.frame.mockImplementationOnce(() => gate.promise);
    const running = runTimelineRender(request(), { ...h.adapters, source: h.video });
    await vi.waitFor(() => expect(h.encoder.frame).toHaveBeenCalledOnce());
    expect(h.reader.read).toHaveBeenCalledOnce();
    gate.resolve();
    await running;
    expect(h.reader.read).toHaveBeenCalledTimes(3);
  });

  it('reports decoder failures and releases resources even if cleanup fails', async () => {
    const h = host();
    h.reader.read.mockRejectedValueOnce(new Error('Decoder failed'));
    h.reader.close.mockRejectedValueOnce(new Error('Reader cleanup failed'));
    h.encoder.cancel.mockRejectedValueOnce(new Error('Encoder cleanup failed'));
    await expect(runTimelineRender(request(), { ...h.adapters, source: h.video })).rejects.toThrow(
      'Decoder failed',
    );
    expect(h.encoder.frame).not.toHaveBeenCalled();
    expect(h.encoder.cancel).toHaveBeenCalledOnce();
    expect(h.reader.close).toHaveBeenCalledOnce();
    expect(h.video.frameAt).not.toHaveBeenCalled();
  });

  it('rejects pre-canceled work without allocating a source or encoder', async () => {
    const h = host();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTimelineRender(request(), h.adapters, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(h.still.read).not.toHaveBeenCalled();
    expect(h.adapters.begin).not.toHaveBeenCalled();
  });

  it('cancels an encoder acquired after an abort during setup', async () => {
    const h = host();
    const controller = new AbortController();
    const gate = deferred<typeof h.encoder>();
    h.adapters.begin.mockImplementationOnce(() => gate.promise);
    const running = runTimelineRender(request(), h.adapters, { signal: controller.signal });
    await vi.waitFor(() => expect(h.adapters.begin).toHaveBeenCalledOnce());
    controller.abort();
    gate.resolve(h.encoder);
    await expect(running).rejects.toBeInstanceOf(RenderCancelledError);
    expect(h.encoder.cancel).toHaveBeenCalledOnce();
    expect(h.encoder.frame).not.toHaveBeenCalled();
  });

  it('closes a reader acquired after an abort during setup', async () => {
    const h = host();
    const controller = new AbortController();
    const gate = deferred<typeof h.reader>();
    h.video.openReader.mockImplementationOnce(() => gate.promise);
    const running = runTimelineRender(
      request(),
      { ...h.adapters, source: h.video },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(h.video.openReader).toHaveBeenCalledOnce());
    controller.abort();
    gate.resolve(h.reader);
    await expect(running).rejects.toBeInstanceOf(RenderCancelledError);
    expect(h.encoder.cancel).toHaveBeenCalledOnce();
    expect(h.reader.close).toHaveBeenCalledOnce();
    expect(h.reader.read).not.toHaveBeenCalled();
  });

  it('interrupts final encoding and never reports aborted work as successful', async () => {
    const h = host();
    const controller = new AbortController();
    const gate = deferred<typeof h.result>();
    h.encoder.finish.mockImplementationOnce(() => gate.promise);
    h.encoder.cancel.mockImplementationOnce(async () => {
      gate.reject(new Error('Encoder stopped'));
    });
    const running = runTimelineRender(request(), h.adapters, { signal: controller.signal });
    await vi.waitFor(() => expect(h.encoder.finish).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(RenderCancelledError);
    expect(h.encoder.cancel).toHaveBeenCalledOnce();
    expect(h.adapters.cancelEffects).toHaveBeenCalledOnce();
  });

  it('interrupts effect processing before any more frames reach the encoder', async () => {
    const h = host();
    const controller = new AbortController();
    const gate = deferred<RenderFrame>();
    h.adapters.render.mockImplementationOnce(() => gate.promise);
    h.adapters.cancelEffects.mockImplementationOnce(() => gate.reject(new RenderCancelledError()));
    const running = runTimelineRender(request([createEffect('rgb-split', 'fx')]), h.adapters, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(h.adapters.render).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(RenderCancelledError);
    expect(h.encoder.cancel).toHaveBeenCalledOnce();
    expect(h.encoder.frame).not.toHaveBeenCalled();
    expect(h.encoder.finish).not.toHaveBeenCalled();
  });

  it('does not cancel completed work when its signal is later aborted', async () => {
    const h = host();
    const controller = new AbortController();
    await runTimelineRender(request(), h.adapters, { signal: controller.signal });
    controller.abort();
    expect(h.encoder.cancel).not.toHaveBeenCalled();
    expect(h.adapters.cancelEffects).not.toHaveBeenCalled();
  });
});
