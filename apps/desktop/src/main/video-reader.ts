// FFmpeg frame decoding shared by desktop IPC and terminal timeline exports.
import type { RenderFrame } from '../shared/render';
import { spawnFfmpeg, type FfmpegProcess } from './ffmpeg';

export function describeFfmpegError(stderr: string, fallback: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
    .pop();
  return line ? `${fallback} (ffmpeg: ${line})` : fallback;
}

/**
 * Sequential RGBA frames from one ffmpeg process. Reads exact frame-size
 * chunks and keeps about two frames buffered; ffmpeg blocks on the pipe while
 * the stream is paused.
 */
export class FrameReader {
  private readonly process: FfmpegProcess;
  private readonly frameBytes: number;
  private readonly chunks: Buffer[] = [];
  private buffered = 0;
  private delivered = 0;
  private exited = false;
  private closed = false;
  private reading = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;
  private stderr = '';
  lastUsed = Date.now();

  constructor(
    ffmpegPath: string,
    args: readonly string[],
    private readonly width: number,
    private readonly height: number,
    private readonly count: number,
  ) {
    this.frameBytes = width * height * 4;
    this.process = spawnFfmpeg(ffmpegPath, args);
    this.process.stdin.end();
    const { stdout, stderr } = this.process;
    stdout.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
      if (this.buffered >= this.frameBytes * 2) stdout.pause();
      this.notify();
    });
    stderr.setEncoding('utf8').on('data', (text: string) => {
      this.stderr = (this.stderr + text).slice(-4000);
    });
    this.process.once('error', (error) => {
      this.failure ??= error;
      this.exited = true;
      this.notify();
    });
    // 'close' fires after stdout has ended, so the exit code is known before we report the end.
    this.process.once('close', (code) => {
      this.exited = true;
      // Frames already buffered are still delivered before the error is reported.
      if (code !== 0 && !this.closed)
        this.failure ??= new Error(
          describeFfmpegError(this.stderr, 'The video could not be decoded.'),
        );
      this.notify();
    });
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async next(): Promise<RenderFrame | null> {
    if (this.reading) throw new Error('The previous video frame is still being read.');
    this.reading = true;
    try {
      for (;;) {
        if (this.closed) throw new Error('This video reader was closed.');
        if (this.delivered >= this.count) return null;
        if (this.buffered >= this.frameBytes) return this.take();
        if (this.failure) throw this.failure;
        // The clip ended before `count` frames: there is nothing more to show.
        if (this.exited) return null;
        this.process.stdout.resume();
        await new Promise<void>((resolve) => (this.wake = resolve));
      }
    } finally {
      this.reading = false;
      this.lastUsed = Date.now();
    }
  }

  private take(): RenderFrame {
    const pixels = new ArrayBuffer(this.frameBytes);
    const view = new Uint8Array(pixels);
    let offset = 0;
    while (offset < this.frameBytes) {
      const chunk = this.chunks[0]!;
      const needed = this.frameBytes - offset;
      if (chunk.length <= needed) {
        view.set(chunk, offset);
        offset += chunk.length;
        this.chunks.shift();
      } else {
        view.set(chunk.subarray(0, needed), offset);
        this.chunks[0] = chunk.subarray(needed);
        offset += needed;
      }
    }
    this.buffered -= this.frameBytes;
    this.delivered++;
    if (this.buffered < this.frameBytes * 2 && !this.exited) this.process.stdout.resume();
    return { width: this.width, height: this.height, pixels };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.chunks.length = 0;
    this.buffered = 0;
    if (!this.exited) this.process.kill();
    this.notify();
  }
}
