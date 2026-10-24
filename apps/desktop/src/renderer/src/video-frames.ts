// Preview frames and filmstrip thumbnails for the timeline's Source track.
// Chromium decodes the clip through a hidden <video> on the gleech-media://
// URL; codecs it can't play (ProRes, AVI, …) are decoded by ffmpeg in main.
import { unwrap } from '../../shared/image-api';
import type { VideoProbe } from '../../shared/render';

export const MEDIA_SCHEME = 'gleech-media';

/** URL that streams a registered media file (with HTTP range support). */
export function mediaUrl(mediaId: string): string {
  return `${MEDIA_SCHEME}://media/${encodeURIComponent(mediaId)}`;
}

export interface VideoFramePixels {
  readonly width: number;
  readonly height: number;
  /** RGBA8, straight alpha. The caller owns this buffer. */
  readonly pixels: ArrayBuffer;
  /** Actual presentation time for a live preview; exact seeks omit this. */
  readonly time?: number;
}

/** How a source decodes: Chromium's player, WebCodecs ImageDecoder (GIF) or ffmpeg in main. */
export type VideoDecodePath = 'player' | 'image' | 'ffmpeg';

/** Codecs Chromium's <video> usually decodes; anything else goes straight to ffmpeg. */
const PLAYER_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'theora']);
/** Seeks land 2^-12 s past the requested time, like the export reader (main/media-probe.ts). */
const FRAME_EPSILON = 1 / 4096;
const CACHE_BYTES = 96 * 1024 * 1024;
const CACHE_FRAMES = 48;
const THUMBNAIL_CACHE = 800;
const LOAD_TIMEOUT_MS = 15000;
const SEEK_TIMEOUT_MS = 10000;
/** How long to wait for requestVideoFrameCallback after `seeked` before drawing anyway. */
const PRESENT_WAIT_MS = 80;
/** Frames kept from the playing element (about a quarter second at 30 fps). */
const PLAYBACK_SLOTS = 8;
/** Re-seek the playing element when the playhead is this far from it (loop wrap, scrubbing). */
const PLAYBACK_RESYNC_SECONDS = 0.25;
/** How long a request during playback waits for the element to present its frame. */
const PLAYBACK_WAIT_MS = 250;
const FRAME_CALLBACKS =
  typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype;

/** Fit inside maxDimension without upscaling; matches main's fitFrameSize. */
export function fitFrameSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, Math.max(1, maxDimension) / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

class UnsupportedVideoError extends Error {}

function abortError(): DOMException {
  return new DOMException('The frame request was cancelled.', 'AbortError');
}

/** Rejects as soon as the signal aborts, even if the work keeps going in the background. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Runs async tasks one at a time, in order. */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function canvas2d(): CanvasRenderingContext2D {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('A 2D canvas is not available.');
  return context;
}

/** Resize only when needed: assigning width or height reallocates and clears the canvas. */
function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** A hidden, muted <video> that answers one seek at a time. */
class SeekingPlayer {
  private readonly video: HTMLVideoElement;
  private readonly ready: Promise<void>;
  /** Learned on the first seek: does requestVideoFrameCallback fire after a paused seek? */
  private presentFires: boolean | null = null;
  private decodedOnce = false;

  constructor(url: string) {
    const video = (this.video = document.createElement('video'));
    video.muted = true;
    video.preload = 'auto';
    // CORS mode keeps the canvas readable; the protocol answers with ACAO: *.
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.disablePictureInPicture = true;
    this.ready = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('error', failed);
      };
      // No picture (videoWidth 0) means Chromium kept only the audio track.
      const loaded = () => {
        cleanup();
        if (video.videoWidth > 0) resolve();
        else reject(new UnsupportedVideoError('The preview player cannot decode this video.'));
      };
      const failed = () => {
        cleanup();
        reject(new UnsupportedVideoError('The preview player cannot decode this video.'));
      };
      const timer = setTimeout(failed, LOAD_TIMEOUT_MS);
      video.addEventListener('loadeddata', loaded);
      video.addEventListener('error', failed);
    });
    // Avoid unhandled rejections when nobody seeks before the source fails.
    this.ready.catch(() => {});
    video.src = url;
  }

  async seek(time: number): Promise<void> {
    await this.ready;
    const video = this.video;
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 1e-6)
      return;
    let presented = false;
    let callback: number | null = null;
    const presentation =
      this.presentFires !== false && 'requestVideoFrameCallback' in video
        ? new Promise<void>((resolve) => {
            callback = video.requestVideoFrameCallback(() => {
              presented = true;
              callback = null;
              resolve();
            });
          })
        : null;
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener('seeked', seeked);
          video.removeEventListener('error', failed);
        };
        const seeked = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new UnsupportedVideoError('The preview player cannot decode this video.'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            this.decodedOnce
              ? new Error('The video did not seek in time.')
              : new UnsupportedVideoError('The preview player did not respond.'),
          );
        }, SEEK_TIMEOUT_MS);
        video.addEventListener('seeked', seeked);
        video.addEventListener('error', failed);
        video.currentTime = time;
      });
      // `seeked` can fire before the new frame reaches the compositor; wait briefly for it.
      if (presentation && !presented) {
        await Promise.race([presentation, delay(PRESENT_WAIT_MS)]);
        this.presentFires ??= presented;
      }
      this.decodedOnce = true;
    } finally {
      if (callback !== null) video.cancelVideoFrameCallback(callback);
    }
  }

  draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    sizeCanvas(context.canvas, width, height);
    context.drawImage(this.video, 0, 0, width, height);
  }

  get element(): HTMLVideoElement {
    return this.video;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * Chromium only presents frames of a playing video at full rate while the
   * compositor draws it; a detached element falls back to a few frames a
   * second. Keep it in the page as a 2 px, nearly transparent corner pixel.
   */
  attach(): void {
    if (this.video.isConnected) return;
    Object.assign(this.video.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    this.video.setAttribute('aria-hidden', 'true');
    document.body.append(this.video);
  }

  dispose(): void {
    this.video.pause();
    this.video.remove();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

interface CaptureSlot {
  readonly context: CanvasRenderingContext2D;
  /** Source frame index, or -1 when empty or captured at an old size. */
  index: number;
  time: number;
  pixels?: VideoFramePixels;
}

/**
 * Frames from the playing element, captured with requestVideoFrameCallback
 * into a ring of (GPU) canvases. Pixels are read back only for frames that
 * are asked for, and the canvases are reused across playbacks.
 */
class PlaybackCapture {
  private readonly slots: CaptureSlot[] = [];
  private write = 0;
  private callback: number | null = null;
  private waiters = new Set<() => void>();
  private width = 0;
  private height = 0;
  /** Index of the most recent capture, -1 after a resize or resync. */
  latest = -1;
  active = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly indexOf: (mediaTime: number) => number,
  ) {}

  start(width: number, height: number): void {
    this.resize(width, height);
    if (this.active) return;
    this.active = true;
    this.watch();
  }

  stop(): void {
    this.active = false;
    if (this.callback !== null) this.video.cancelVideoFrameCallback(this.callback);
    this.callback = null;
    this.invalidate();
    this.notify();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.invalidate();
  }

  invalidate(): void {
    for (const slot of this.slots) {
      slot.index = -1;
      delete slot.pixels;
    }
    this.latest = -1;
  }

  /** The canvas holding frame `index`, else a neighbor within one frame (earlier first). */
  find(index: number): CaptureSlot | null {
    for (const wanted of [index, index - 1, index + 1])
      for (const slot of this.slots) if (slot.index === wanted && wanted >= 0) return slot;
    return null;
  }

  /** A live preview can drop missed frames instead of seeking back for each one. */
  nearest(index: number): CaptureSlot | null {
    let nearest: CaptureSlot | null = null;
    for (const slot of this.slots)
      if (
        slot.index >= 0 &&
        (!nearest || Math.abs(slot.index - index) < Math.abs(nearest.index - index))
      )
        nearest = slot;
    return nearest;
  }

  waitForCapture(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, milliseconds);
      function done() {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      }
      const waiters = this.waiters;
      waiters.add(done);
    });
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = new Set();
    for (const wake of waiters) wake();
  }

  private watch(): void {
    if (!this.active) return;
    this.callback = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.callback = null;
      this.capture(metadata.mediaTime);
      this.watch();
    });
  }

  private capture(mediaTime: number): void {
    if (!this.active || !this.width) return;
    let slot = this.slots[this.write];
    if (!slot) {
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      slot = { context, index: -1, time: 0 };
      this.slots[this.write] = slot;
    }
    sizeCanvas(slot.context.canvas, this.width, this.height);
    // Inside the callback the element draws exactly the frame `metadata` describes.
    slot.context.drawImage(this.video, 0, 0, this.width, this.height);
    slot.index = this.indexOf(mediaTime);
    slot.time = mediaTime;
    delete slot.pixels;
    this.latest = slot.index;
    this.write = (this.write + 1) % PLAYBACK_SLOTS;
    this.notify();
  }
}

/** Animated GIF frames through WebCodecs, matching ffmpeg's frame timing. */
class AnimatedImage {
  private readonly starts: number[] = [];
  private ends = 0;
  private constructor(
    private readonly decoder: ImageDecoder,
    private readonly frameCount: number,
  ) {}

  static async open(url: string, type: string): Promise<AnimatedImage> {
    if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(type)))
      throw new UnsupportedVideoError('ImageDecoder is not available.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('The clip could not be read.');
    const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
    await decoder.tracks.ready;
    await decoder.completed;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (!frameCount) {
      decoder.close();
      throw new UnsupportedVideoError('The image has no frames.');
    }
    return new AnimatedImage(decoder, frameCount);
  }

  /** The frame on screen at time t (holding the last frame past the end). */
  async frameAt(t: number): Promise<VideoFrame> {
    // Learn frame start times as we go; GIF delays vary per frame.
    while (this.starts.length < this.frameCount && this.ends <= t) {
      const { image } = await this.decoder.decode({ frameIndex: this.starts.length });
      this.starts.push(this.ends);
      this.ends += Math.max(0, image.duration ?? 0) / 1e6 || 0.1;
      image.close();
    }
    let index = this.starts.length - 1;
    while (index > 0 && this.starts[index]! > t) index--;
    return (await this.decoder.decode({ frameIndex: Math.max(0, index) })).image;
  }

  dispose(): void {
    this.decoder.close();
  }
}

/**
 * Decodes preview frames of one video clip. Requests are serialized; the
 * filmstrip uses a second element so thumbnails never fight playback seeks.
 */
export class VideoFrameSource {
  readonly mediaId: string;
  readonly info: VideoProbe;
  private readonly url: string;
  private path: VideoDecodePath;
  private player: SeekingPlayer | null = null;
  private thumbnailPlayer: SeekingPlayer | null = null;
  private image: Promise<AnimatedImage> | null = null;
  private readonly queue = new SerialQueue();
  private readonly thumbnailQueue = new SerialQueue();
  private readonly frames = new Map<string, VideoFramePixels>();
  private frameBytes = 0;
  private readonly thumbnailUrls = new Map<string, string>();
  private frameContext: CanvasRenderingContext2D | null = null;
  private thumbnailContext: CanvasRenderingContext2D | null = null;
  private capture: PlaybackCapture | null = null;
  private playing = false;
  private playbackRate = 1;
  private playbackClock: { target: number; at: number } | null = null;
  private pendingPreviewSeek = false;
  /** Size of the last request, so playback captures at the size the caller wants. */
  private lastMaxDimension = 0;
  private disposed = false;

  constructor(mediaId: string, info: VideoProbe) {
    this.mediaId = mediaId;
    this.info = info;
    this.url = mediaUrl(mediaId);
    const codec = info.codec.toLowerCase();
    this.path =
      codec === 'gif' && typeof ImageDecoder !== 'undefined'
        ? 'image'
        : PLAYER_CODECS.has(codec)
          ? 'player'
          : 'ffmpeg';
  }

  /** Which decoder is in use; it can fall back to ffmpeg after the first failure. */
  get decodePath(): VideoDecodePath {
    return this.path;
  }

  /** Index of the source frame on screen at time t (constant-rate clips). */
  frameIndex(t: number): number {
    const last = Math.max(0, Math.ceil(this.info.duration * this.info.fps) - 1);
    const time = Math.min(Math.max(0, t), this.info.duration);
    return Math.min(last, Math.floor((time + FRAME_EPSILON) * this.info.fps));
  }

  /** True between startPlayback and stopPlayback on clips the player decodes. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Play the hidden player (muted) from `fromSeconds` so frameAt can return
   * the frames it presents instead of seeking for each one. Calling it again
   * restarts from the new time. A no-op for GIF and ffmpeg-decoded clips.
   */
  startPlayback(fromSeconds: number, rate = 1): void {
    if (this.disposed || this.path !== 'player' || !FRAME_CALLBACKS) return;
    this.playing = true;
    this.playbackRate = rate;
    this.playbackClock = { target: this.seekTime(fromSeconds), at: performance.now() };
    this.pendingPreviewSeek = false;
    const player = (this.player ??= new SeekingPlayer(this.url));
    player.whenReady().then(
      () => {
        if (!this.playing || this.player !== player) return;
        const video = player.element;
        player.attach();
        const capture = (this.capture ??= new PlaybackCapture(video, (time) =>
          this.frameIndex(time),
        ));
        const size = fitFrameSize(
          this.info.width,
          this.info.height,
          this.lastMaxDimension || Math.ceil(Math.max(this.info.width, this.info.height) / 2),
        );
        capture.start(size.width, size.height);
        video.playbackRate = rate;
        this.resync(video, this.seekTime(fromSeconds));
      },
      (error: unknown) => {
        this.playing = false;
        if (this.shouldFallBack(error)) this.useFfmpeg();
      },
    );
  }

  /** Pause the hidden player; frameAt goes back to exact seeks. */
  stopPlayback(): void {
    if (!this.playing) return;
    this.playing = false;
    this.playbackClock = null;
    this.pendingPreviewSeek = false;
    this.capture?.stop();
    this.player?.element.pause();
  }

  /**
   * RGBA pixels of the frame on screen at time t (seconds into the clip), at
   * most maxDimension on the long side. Past the end it holds the last frame.
   * During playback it returns the captured frame within one source frame of
   * t without seeking, when there is one.
   */
  async frameAt(t: number, maxDimension: number, signal?: AbortSignal): Promise<VideoFramePixels> {
    this.assertLive();
    if (signal?.aborted) throw abortError();
    const size = fitFrameSize(this.info.width, this.info.height, maxDimension);
    this.lastMaxDimension = maxDimension;
    if (this.playing) {
      const live = await this.playbackFrame(t, size, signal);
      if (live) return live;
      if (signal?.aborted) throw abortError();
      this.assertLive();
    }
    const key = `${this.frameIndex(t)}:${size.width}x${size.height}`;
    const cached = this.cached(key);
    if (cached) return copyFrame(cached);
    const frame = this.queue.run(async () => {
      if (signal?.aborted) throw abortError();
      this.assertLive();
      const again = this.cached(key);
      if (again) return again;
      const decoded = await this.decode(t, size, maxDimension);
      this.remember(key, decoded);
      return decoded;
    });
    return copyFrame(await abortable(frame, signal));
  }

  /**
   * Wall-clock preview: use the closest presented frame, with its real timestamp,
   * rather than stalling playback to seek a frame the decoder already dropped.
   * Still frames and exports continue using frameAt's exact request path.
   */
  async previewAt(
    t: number,
    maxDimension: number,
    signal?: AbortSignal,
  ): Promise<VideoFramePixels> {
    this.assertLive();
    if (!this.playing || this.path !== 'player') return this.frameAt(t, maxDimension, signal);
    this.lastMaxDimension = maxDimension;
    await abortable(this.player!.whenReady(), signal);
    this.assertLive();
    if (!this.playing) return this.frameAt(t, maxDimension, signal);
    const size = fitFrameSize(this.info.width, this.info.height, maxDimension);
    const frame = await abortable(this.playbackFrame(t, size, signal, true), signal);
    if (signal?.aborted) throw abortError();
    this.assertLive();
    if (frame) return frame;
    // A slow startup gets retried by the next playhead request. It must not
    // enter the paused seek queue and repeatedly reset the running decoder.
    throw new Error('The playing video has not presented a frame yet.');
  }

  /** JPEG data URLs for the filmstrip, `height` px tall, one per time. */
  thumbnails(
    times: readonly number[],
    height: number,
    signal?: AbortSignal,
    onProgress?: (completed: number) => void,
  ): Promise<string[]> {
    this.assertLive();
    const thumbHeight = Math.max(8, Math.min(1024, Math.round(height)));
    const thumbWidth = Math.max(1, Math.round((thumbHeight * this.info.width) / this.info.height));
    const work = this.thumbnailQueue.run(async () => {
      const urls: string[] = [];
      for (const t of times) {
        if (signal?.aborted) throw abortError();
        this.assertLive();
        const key = `${this.frameIndex(t)}:${thumbHeight}`;
        let url = this.thumbnailUrls.get(key);
        if (!url) {
          const context = (this.thumbnailContext ??= canvas2d());
          await this.drawThumbnail(t, context, thumbWidth, thumbHeight);
          if (signal?.aborted) throw abortError();
          url = context.canvas.toDataURL('image/jpeg', 0.72);
          if (this.thumbnailUrls.size >= THUMBNAIL_CACHE)
            this.thumbnailUrls.delete(this.thumbnailUrls.keys().next().value!);
          this.thumbnailUrls.set(key, url);
        }
        urls.push(url);
        onProgress?.(urls.length);
      }
      return urls;
    });
    return abortable(work, signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopPlayback();
    this.disposed = true;
    this.capture = null;
    this.player?.dispose();
    this.thumbnailPlayer?.dispose();
    this.player = this.thumbnailPlayer = null;
    void this.image?.then((image) => image.dispose()).catch(() => {});
    this.image = null;
    this.frames.clear();
    this.frameBytes = 0;
    this.thumbnailUrls.clear();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('This video source was closed.');
  }

  /** A captured frame for t while playing, or null to use the seek path. */
  private async playbackFrame(
    t: number,
    size: { width: number; height: number },
    signal: AbortSignal | undefined,
    realtime = false,
  ): Promise<VideoFramePixels | null> {
    const capture = this.capture;
    const video = this.player?.element;
    if (!capture?.active || !video || this.path !== 'player') return null;
    capture.resize(size.width, size.height);
    const index = this.frameIndex(t);
    const target = this.seekTime(t);
    const now = performance.now();
    const clock = this.playbackClock;
    const expected = clock ? clock.target + ((now - clock.at) / 1000) * this.playbackRate : target;
    if (realtime) this.playbackClock = { target, at: now };
    // Slow decoding is handled by dropping preview frames and nudging the
    // player. Only a playhead discontinuity (scrub/loop) seeks during preview.
    const drift = realtime ? target - expected : video.currentTime - target;
    if (realtime && Math.abs(drift) > PLAYBACK_RESYNC_SECONDS) this.pendingPreviewSeek = true;
    const resync = realtime ? this.pendingPreviewSeek : Math.abs(drift) > PLAYBACK_RESYNC_SECONDS;
    if (!video.seeking && resync) {
      capture.invalidate();
      this.pendingPreviewSeek = false;
      this.resync(video, target);
    } else if (!video.seeking) {
      // Starting playback costs a seek, so the element can trail the playhead by
      // a steady few frames. Run slightly fast until it leads by a frame or two:
      // then each requested frame is already captured.
      const ahead = video.currentTime - target;
      const nudge = ahead < 0 ? 1.25 : ahead > 4 / this.info.fps ? 0.9 : 1;
      const playbackRate = this.playbackRate * nudge;
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
    }
    if (realtime && this.pendingPreviewSeek) return null;
    const deadline = performance.now() + PLAYBACK_WAIT_MS;
    for (;;) {
      if (!capture.active || signal?.aborted || this.disposed) return null;
      const slot =
        capture.find(index) ?? (realtime && !video.seeking ? capture.nearest(index) : null);
      if (slot) {
        slot.pixels ??= { ...this.readBack(slot.context.canvas, size), time: slot.time };
        return copyFrame(slot.pixels);
      }
      // Already past this frame (it left the ring): let the seek path fetch it.
      if (!realtime && capture.latest > index + 1 && !video.seeking) return null;
      const remaining = deadline - performance.now();
      if (remaining <= 0 || !capture.active || signal?.aborted || this.disposed) return null;
      await capture.waitForCapture(remaining);
    }
  }

  /** Seek the playing element and make sure it keeps playing (it pauses at the clip end). */
  private resync(video: HTMLVideoElement, target: number): void {
    video.currentTime = target;
    if (this.playing && video.paused && target < this.info.duration - 1e-3)
      void video.play().catch(() => {});
  }

  private readBack(
    source: CanvasImageSource,
    size: { width: number; height: number },
  ): VideoFramePixels {
    const context = (this.frameContext ??= canvas2d());
    sizeCanvas(context.canvas, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    const data = context.getImageData(0, 0, size.width, size.height).data;
    return { width: size.width, height: size.height, pixels: data.buffer as ArrayBuffer };
  }

  /** Time to seek to for t: just past t, clamped to the clip. */
  private seekTime(t: number): number {
    return Math.min(Math.max(0, t) + FRAME_EPSILON, this.info.duration);
  }

  private async decode(
    t: number,
    size: { width: number; height: number },
    maxDimension: number,
  ): Promise<VideoFramePixels> {
    if (this.path !== 'ffmpeg') {
      const context = (this.frameContext ??= canvas2d());
      try {
        if (this.path === 'image') await this.drawImageFrame(t, context, size.width, size.height);
        else {
          const player = (this.player ??= new SeekingPlayer(this.url));
          await player.seek(this.seekTime(t));
          this.assertLive();
          return this.readBack(player.element, size);
        }
        const data = context.getImageData(0, 0, size.width, size.height).data;
        return { width: size.width, height: size.height, pixels: data.buffer as ArrayBuffer };
      } catch (error) {
        if (!this.shouldFallBack(error)) throw error;
        this.useFfmpeg();
      }
    }
    const frame = unwrap(
      await window.gleech.videoFrameAt(this.mediaId, Math.max(0, t), maxDimension),
    );
    return { width: frame.width, height: frame.height, pixels: frame.pixels };
  }

  private async drawThumbnail(
    t: number,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): Promise<void> {
    if (this.path !== 'ffmpeg') {
      try {
        if (this.path === 'image') return await this.drawImageFrame(t, context, width, height);
        const player = (this.thumbnailPlayer ??= new SeekingPlayer(this.url));
        await player.seek(this.seekTime(t));
        this.assertLive();
        return player.draw(context, width, height);
      } catch (error) {
        if (!this.shouldFallBack(error)) throw error;
        this.useFfmpeg();
      }
    }
    const frame = unwrap(
      await window.gleech.videoFrameAt(this.mediaId, Math.max(0, t), Math.max(width, height)),
    );
    this.assertLive();
    sizeCanvas(context.canvas, frame.width, frame.height);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height),
      0,
      0,
    );
  }

  private async drawImageFrame(
    t: number,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): Promise<void> {
    this.image ??= AnimatedImage.open(this.url, 'image/gif');
    const frame = await (await this.image).frameAt(Math.max(0, t) + FRAME_EPSILON);
    try {
      this.assertLive();
      sizeCanvas(context.canvas, width, height);
      context.drawImage(frame, 0, 0, width, height);
    } finally {
      frame.close();
    }
  }

  /**
   * Unsupported codecs, a canvas the browser won't let us read, or any GIF
   * decoder failure switch this source to ffmpeg; a slow seek is just retried.
   */
  private shouldFallBack(error: unknown): boolean {
    if (this.disposed) return false;
    return (
      error instanceof UnsupportedVideoError || isSecurityError(error) || this.path === 'image'
    );
  }

  private useFfmpeg(): void {
    this.stopPlayback();
    this.capture = null;
    this.path = 'ffmpeg';
    this.player?.dispose();
    this.thumbnailPlayer?.dispose();
    this.player = this.thumbnailPlayer = null;
    void this.image?.then((image) => image.dispose()).catch(() => {});
    this.image = null;
  }

  private cached(key: string): VideoFramePixels | undefined {
    const frame = this.frames.get(key);
    if (!frame) return undefined;
    // Least recently used goes first: move hits to the end.
    this.frames.delete(key);
    this.frames.set(key, frame);
    return frame;
  }

  private remember(key: string, frame: VideoFramePixels): void {
    this.frames.set(key, frame);
    this.frameBytes += frame.pixels.byteLength;
    while (
      this.frames.size > 1 &&
      (this.frames.size > CACHE_FRAMES || this.frameBytes > CACHE_BYTES)
    ) {
      const [oldest, evicted] = this.frames.entries().next().value!;
      this.frames.delete(oldest);
      this.frameBytes -= evicted.pixels.byteLength;
    }
  }
}

function isSecurityError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'SecurityError';
}

/** Callers get their own buffer so they can transfer or modify it freely. */
function copyFrame(frame: VideoFramePixels): VideoFramePixels {
  return { ...frame, pixels: frame.pixels.slice(0) };
}
