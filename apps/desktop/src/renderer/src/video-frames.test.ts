import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VideoProbe } from '../../shared/render';

class VideoDouble extends EventTarget {
  static current: VideoDouble;
  muted = true;
  readyState = 2;
  videoWidth = 64;
  seeking = false;
  paused = true;
  isConnected = false;
  style = {};
  playbackRate = 1;
  seeks: number[] = [];
  callbacks = new Map<number, VideoFrameRequestCallback>();
  private sequence = 0;
  private time = 0;
  constructor() {
    super();
    VideoDouble.current = this;
  }
  set src(_url: string) {
    queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(time: number) {
    this.time = time;
    this.seeks.push(time);
    queueMicrotask(() => {
      this.dispatchEvent(new Event('seeked'));
      this.present(time);
    });
  }
  present(time: number) {
    this.time = time;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks)
      callback(performance.now(), { mediaTime: time } as VideoFrameCallbackMetadata);
  }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
    const id = ++this.sequence;
    this.callbacks.set(id, callback);
    return id;
  }
  cancelVideoFrameCallback(id: number) {
    this.callbacks.delete(id);
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  setAttribute() {}
  removeAttribute() {}
  remove() {
    this.isConnected = false;
  }
  load() {}
}

const readbacks = vi.fn();
const probe: VideoProbe = {
  width: 64,
  height: 32,
  fps: 30,
  duration: 10,
  hasAudio: false,
  codec: 'h264',
};
let VideoFrameSource: typeof import('./video-frames').VideoFrameSource;
const sources: import('./video-frames').VideoFrameSource[] = [];
function source() {
  const value = new VideoFrameSource('clip', probe);
  sources.push(value);
  return value;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  readbacks.mockClear();
  vi.stubGlobal('HTMLVideoElement', VideoDouble);
  vi.stubGlobal('document', {
    body: {
      append(video: VideoDouble) {
        video.isConnected = true;
      },
    },
    createElement(tag: string) {
      if (tag === 'video') return new VideoDouble();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: () => 'data:image/jpeg;base64,thumbnail',
      };
      const context = {
        canvas,
        drawImage() {},
        getImageData(_x: number, _y: number, width: number, height: number) {
          readbacks(width, height);
          return { data: new Uint8ClampedArray(width * height * 4) };
        },
      };
      return canvas;
    },
  });
  ({ VideoFrameSource } = await import('./video-frames'));
});
afterEach(() => {
  for (const value of sources.splice(0)) value.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reports filmstrip progress for both decoded thumbnails and cache hits', async () => {
  const frames = source();
  const progress = vi.fn();
  const pending = frames.thumbnails([0, 0.5, 1], 48, undefined, progress);
  await vi.advanceTimersByTimeAsync(0);
  expect(await pending).toHaveLength(3);
  expect(progress.mock.calls).toEqual([[1], [2], [3]]);
  const seeks = VideoDouble.current.seeks.length;
  progress.mockClear();
  expect(await frames.thumbnails([0, 0.5, 1], 48, undefined, progress)).toHaveLength(3);
  expect(VideoDouble.current.seeks).toHaveLength(seeks);
  expect(progress.mock.calls).toEqual([[1], [2], [3]]);
});

it('stops cancelled filmstrip generation instead of decoding the remaining thumbnails', async () => {
  const frames = source();
  const controller = new AbortController();
  const progress = vi.fn((completed: number) => {
    if (completed === 2) controller.abort();
  });
  const pending = frames.thumbnails([0, 0.5, 1, 1.5], 48, controller.signal, progress);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0);
  await rejected;
  expect(progress.mock.calls).toEqual([[1], [2]]);
  expect(VideoDouble.current.seeks).toHaveLength(2);
});

it('drops missed live frames without seeking back, preserving their actual presentation time', async () => {
  const frames = source();
  frames.startPlayback(0);
  await vi.advanceTimersByTimeAsync(0);
  const video = VideoDouble.current;
  video.present(0.1);
  await vi.advanceTimersByTimeAsync(500);
  const first = await frames.previewAt(0.5, 32);
  expect(first.time).toBe(0.1);
  expect(first.width).toBe(32);
  expect(video.seeks).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(33);
  const again = await frames.previewAt(0.533, 32);
  expect(again.time).toBe(0.1);
  expect(readbacks).toHaveBeenCalledTimes(1);
  expect(again.pixels).not.toBe(first.pixels);
  expect(video.seeks).toHaveLength(1);
});

it('seeks once on loop wrap and discards captures from the previous loop', async () => {
  const frames = source();
  frames.startPlayback(5);
  await vi.advanceTimersByTimeAsync(0);
  expect((await frames.previewAt(5, 32)).time).toBeCloseTo(5, 3);
  const pending = frames.previewAt(0, 32);
  await vi.advanceTimersByTimeAsync(0);
  expect((await pending).time).toBeLessThan(0.01);
  expect(VideoDouble.current.seeks).toHaveLength(2);
});

it('resizes captures before readback and restores exact full-size frames when paused', async () => {
  const frames = source();
  frames.startPlayback(0);
  await vi.advanceTimersByTimeAsync(0);
  const small = frames.previewAt(0, 16);
  await vi.advanceTimersByTimeAsync(0);
  VideoDouble.current.present(0);
  await vi.advanceTimersByTimeAsync(0);
  expect((await small).pixels.byteLength).toBe(16 * 8 * 4);
  frames.stopPlayback();
  const exact = frames.frameAt(2, 64);
  await vi.advanceTimersByTimeAsync(0);
  expect(await exact).toMatchObject({ width: 64, height: 32 });
  expect((await exact).time).toBeUndefined();
  expect(VideoDouble.current.currentTime).toBeCloseTo(2, 3);
  expect(readbacks).toHaveBeenLastCalledWith(64, 32);
});

it('retains a loop resync requested while the previous seek is still pending', async () => {
  const frames = source();
  frames.startPlayback(5);
  await vi.advanceTimersByTimeAsync(0);
  const video = VideoDouble.current;
  video.seeking = true;
  await expect(frames.previewAt(0, 32)).rejects.toThrow('has not presented a frame');
  video.seeking = false;
  const next = frames.previewAt(0.03, 32);
  await vi.advanceTimersByTimeAsync(0);
  expect((await next).time).toBeLessThan(0.04);
  expect(video.seeks).toHaveLength(2);
});

it('aborts a pending live request without falling back to a seek', async () => {
  const frames = source();
  frames.startPlayback(0);
  await vi.advanceTimersByTimeAsync(0);
  const controller = new AbortController();
  const pending = frames.previewAt(0, 16, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await vi.advanceTimersByTimeAsync(250);
  await rejected;
  expect(VideoDouble.current.seeks).toHaveLength(1);
});
