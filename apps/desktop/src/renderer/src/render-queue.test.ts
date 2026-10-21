import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTimeline } from '@gleech/project-model';
import { defaultVideoSettings } from '../../shared/render-presets';
import { renderQueue, type RenderRequest } from './render-queue';

class WorkerDouble {
  static current: WorkerDouble;
  terminate = vi.fn();
  constructor() {
    WorkerDouble.current = this;
  }
}

const image = { width: 2, height: 1, pixels: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]).buffer };
const ok = <T>(value: T) => ({ ok: true as const, value });
const bridge = () => ({
  beginRender: vi.fn(async () => ok('encoder')),
  openVideoReader: vi.fn(async () => ok('reader')),
  readVideoFrame: vi.fn(async () => ok<typeof image | null>(null)),
  videoFrameAt: vi.fn(async () => ok(image)),
  renderFrame: vi.fn(async () => ok(undefined)),
  finishRender: vi.fn(async () => ok({ outputPath: 'out.mp4', notes: [] })),
  closeVideoReader: vi.fn(async () => ok(undefined)),
  cancelRender: vi.fn(async () => ok(undefined)),
});
let gleech: ReturnType<typeof bridge>;

function request(): RenderRequest {
  return {
    kind: 'video',
    label: 'out.mp4',
    project: {
      ...createProject('Clip'),
      source: {
        id: 'source',
        name: 'clip.mp4',
        width: 2,
        height: 1,
        format: 'png',
        hasAlpha: false,
      },
      timeline: {
        ...createTimeline(),
        video: {
          path: 'clip.mp4',
          name: 'clip.mp4',
          width: 2,
          height: 1,
          duration: 0.5,
          fps: 30,
          hasAudio: false,
        },
      },
    },
    spec: {
      kind: 'video',
      name: 'Clip',
      outputPath: 'out.mp4',
      video: defaultVideoSettings({ width: 2, height: 1, fps: 30 }),
    },
    times: [1, 1 + 1 / 30, 1 + 2 / 30],
    inputFps: 30,
    renderSize: { width: 2, height: 1 },
    videoMediaId: 'clip',
    overlay: true,
  };
}

async function run(expected: 'done' | 'failed' = 'done') {
  const id = renderQueue.enqueue(request());
  await vi.waitFor(() =>
    expect(renderQueue.snapshot().find((job) => job.id === id)?.status).toBe(expected),
  );
  await vi.waitFor(() => expect(WorkerDouble.current.terminate).toHaveBeenCalledOnce());
  expect(gleech.closeVideoReader).toHaveBeenCalledWith('reader');
  return renderQueue.snapshot().find((job) => job.id === id)!;
}

beforeEach(() => {
  gleech = bridge();
  vi.stubGlobal('window', { gleech });
  vi.stubGlobal('Worker', WorkerDouble);
});
afterEach(() => {
  for (const job of renderQueue.snapshot()) renderQueue.dismiss(job.id);
  vi.unstubAllGlobals();
});

describe('render queue video frame hold', () => {
  it('renders a range entirely beyond the clip using the clamped final frame', async () => {
    await run();
    expect(gleech.videoFrameAt).toHaveBeenCalledExactlyOnceWith('clip', 1, 2);
    expect(gleech.renderFrame).toHaveBeenCalledTimes(3);
    for (const call of gleech.renderFrame.mock.calls)
      expect(call).toEqual(['encoder', image, image]);
    expect(gleech.finishRender).toHaveBeenCalledOnce();
    expect(gleech.cancelRender).not.toHaveBeenCalled();
  });

  it('holds the last sequential frame without decoding it again', async () => {
    gleech.readVideoFrame.mockResolvedValueOnce(ok(image));
    await run();
    expect(gleech.videoFrameAt).not.toHaveBeenCalled();
    expect(gleech.renderFrame).toHaveBeenCalledTimes(3);
    for (const call of gleech.renderFrame.mock.calls)
      expect(call).toEqual(['encoder', image, image]);
  });

  it('reports decoder errors instead of hiding them behind the held-frame fallback', async () => {
    gleech.readVideoFrame.mockRejectedValueOnce(new Error('Decoder failed'));
    expect((await run('failed')).error).toBe('Decoder failed');
    expect(gleech.videoFrameAt).not.toHaveBeenCalled();
    expect(gleech.renderFrame).not.toHaveBeenCalled();
    expect(gleech.cancelRender).toHaveBeenCalledWith('encoder');
  });
});

describe('render queue cancellation', () => {
  it('cancels active encoding, skips a canceled queued job and continues the queue', async () => {
    let finish!: (value: Awaited<ReturnType<typeof gleech.finishRender>>) => void;
    gleech.finishRender.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const active = renderQueue.enqueue(request());
    await vi.waitFor(() => expect(gleech.finishRender).toHaveBeenCalledOnce());
    const skipped = renderQueue.enqueue(request());
    const next = renderQueue.enqueue(request());
    renderQueue.cancel(skipped);
    renderQueue.cancel(active);
    await vi.waitFor(() => expect(gleech.cancelRender).toHaveBeenCalledExactlyOnceWith('encoder'));
    finish(ok({ outputPath: 'out.mp4', notes: [] }));
    await vi.waitFor(() =>
      expect(renderQueue.snapshot().find((job) => job.id === next)?.status).toBe('done'),
    );
    expect(renderQueue.snapshot().find((job) => job.id === active)?.status).toBe('canceled');
    expect(renderQueue.snapshot().find((job) => job.id === skipped)?.status).toBe('canceled');
    expect(gleech.beginRender).toHaveBeenCalledTimes(2);
    expect(gleech.closeVideoReader).toHaveBeenCalledTimes(2);
    expect(renderQueue.busy()).toBe(false);
  });
});
