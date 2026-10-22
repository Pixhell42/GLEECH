import { stat } from 'node:fs/promises';
import type { VideoClip } from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import { runFfmpeg, type FfmpegLocator } from '../main/ffmpeg';
import { FrameReader } from '../main/video-reader';
import {
  ffmpegInput,
  fitFrameSize,
  parseFfmpegProbe,
  sourceColorMatrix,
  videoReaderArgs,
} from '../main/media-probe';
import type { TimelineFrameSource, TimelineReaderOptions } from '../shared/timeline-runner';
import type { RenderFrame } from '../shared/render';

/** No Electron registry: the saved project's clip path is the source. */
export function cliVideoSource(clip: VideoClip, ffmpeg: FfmpegLocator, signal?: AbortSignal) {
  const readers = new Set<FrameReader>();
  const check = () => {
    if (signal?.aborted) throw new RenderCancelledError();
  };
  const close = () => {
    readers.forEach((reader) => reader.close());
    readers.clear();
  };
  signal?.addEventListener('abort', close, { once: true });
  let probing: ReturnType<typeof probe> | undefined;
  async function probe() {
    check();
    if (!(await stat(clip.path).catch(() => null))?.isFile())
      throw new Error(
        `The video clip was not found at ${clip.path}. Restore the file or relink it in desktop.`,
      );
    const path = await ffmpeg.require();
    check();
    const result = await runFfmpeg(
      path,
      ['-hide_banner', '-nostdin', '-i', ffmpegInput(clip.path)],
      30000,
      signal,
    );
    check();
    const info = parseFfmpegProbe(result.stderr);
    if (info.error || !info.video)
      throw new Error(`Cannot decode video ${clip.path}: ${info.error ?? 'no video stream'}.`);
    return { path, info, video: info.video };
  }
  async function open(options: TimelineReaderOptions) {
    const media = await (probing ??= probe());
    check();
    const reader = new FrameReader(
      media.path,
      videoReaderArgs(clip.path, options, sourceColorMatrix(media.video)),
      options.width,
      options.height,
      options.count,
    );
    readers.add(reader);
    return {
      read: () => reader.next(),
      close: async () => {
        reader.close();
        readers.delete(reader);
      },
    };
  }
  const source: TimelineFrameSource = {
    kind: 'video',
    openReader: open,
    async frameAt(t, maxDimension) {
      const { info, video } = await (probing ??= probe());
      check();
      const size = fitFrameSize(video.width, video.height, Math.min(8192, maxDimension));
      const time = Math.min(
        Math.max(0, t),
        Math.max(0, (info.duration ?? clip.duration) - 1 / video.fps),
      );
      const decode = async (start: number, count: number) => {
        const reader = await open({ start, fps: video.fps, count, ...size });
        try {
          let last: RenderFrame | null = null;
          for (let frame = await reader.read(); frame; frame = await reader.read()) {
            check();
            last = frame;
          }
          return last;
        } finally {
          await reader.close();
        }
      };
      const frame =
        (await decode(time, 1)) ??
        (await decode(Math.max(0, time - 2), Math.ceil(video.fps * 2) + 1));
      if (!frame) throw new Error('No video frame could be decoded at this time.');
      return frame;
    },
  };
  return {
    source,
    dispose: () => {
      close();
      signal?.removeEventListener('abort', close);
    },
  };
}
