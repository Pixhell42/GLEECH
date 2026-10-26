// Timeline media: a registry of files the user imported (or a saved project
// referenced), the gleech-media:// protocol that streams them into <video> and
// <audio>, and ffmpeg-backed probing and decoding.
import {
  app,
  dialog,
  ipcMain,
  protocol,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { Result } from '../shared/image-api';
import type { AudioProbe, OpenedMedia, RenderFrame, VideoProbe } from '../shared/render';
import { runFfmpeg, spawnFfmpeg, type FfmpegLocator, type FfmpegProcess } from './ffmpeg';
import {
  AUDIO_SAMPLE_RATE,
  MAX_AUDIO_SAMPLE_SECONDS,
  audioProxyArgs,
  audioSampleArgs,
  ffmpegInput,
  fitFrameSize,
  measureDurationArgs,
  parseFfmpegProbe,
  parseProgressDuration,
  sourceColorMatrix,
  videoReaderArgs,
  type FrameReaderOptions,
  type ProbedVideoStream,
} from './media-probe';
import { serveFile } from './media-range';
import { FrameReader, describeFfmpegError } from './video-reader';
import type { OpenFileAccess } from './open-file-access';
import { VIDEO_FILE_EXTENSIONS as VIDEO_EXTENSIONS } from '../shared/open-file';

export const MEDIA_SCHEME = 'gleech-media';
export { VIDEO_EXTENSIONS };
export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] as const;
/** Clip durations the project model accepts. */
const MAX_MEDIA_SECONDS = 4 * 3600;
const MAX_MEDIA_PATH = 4096;
const MAX_FRAME_PIXELS = 8192 * 8192;
const MAX_READERS = 8;
const NO_FFMPEG_VIDEO = 'Locate ffmpeg in Render settings to import video.';

type MediaKind = 'video' | 'audio';
interface MediaEntry {
  readonly id: string;
  readonly path: string;
  readonly kind: MediaKind;
  readonly info: VideoProbe | AudioProbe;
  /** Present when the file has a decodable video stream. */
  readonly video: ProbedVideoStream | null;
  readonly hasAudio: boolean;
  /**
   * For a video file used as audio (a clip's own sound): an audio-only copy the
   * player streams instead, or null to fall back to the file itself.
   */
  readonly playback?: Promise<string | null>;
}

/** Call before app ready: lets gleech-media:// stream into <video>/<audio> and fetch(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readerOptions(value: unknown): FrameReaderOptions {
  const { start, fps, count, width, height, lowMemory } = (value ?? {}) as Record<string, unknown>;
  if (
    !isFiniteNumber(start) ||
    start < 0 ||
    start > MAX_MEDIA_SECONDS ||
    !isFiniteNumber(fps) ||
    fps < 1 ||
    fps > 240 ||
    !Number.isInteger(count) ||
    (count as number) < 1 ||
    (count as number) > MAX_MEDIA_SECONDS * 240 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) * (height as number) > MAX_FRAME_PIXELS ||
    (lowMemory !== undefined && typeof lowMemory !== 'boolean')
  )
    throw new Error('Invalid video reader options.');
  return {
    start,
    fps,
    count: count as number,
    width: width as number,
    height: height as number,
    ...(lowMemory === true ? { lowMemory: true } : {}),
  };
}

/** Registers media:* IPC handlers and the gleech-media protocol. Returns a disposer. */
export function registerMediaHandlers(
  window: BrowserWindow,
  ffmpeg: FfmpegLocator,
  selectedFiles: OpenFileAccess,
): () => void {
  const media = new Map<string, MediaEntry>();
  const readers = new Map<string, FrameReader>();
  const processes = new Set<FfmpegProcess>();
  let disposed = false;

  // Only registered files are served; IDs are random per-session tokens.
  if (protocol.isProtocolHandled(MEDIA_SCHEME)) protocol.unhandle(MEDIA_SCHEME);
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const entry =
      url.hostname === 'media' ? media.get(decodeURIComponent(url.pathname.slice(1))) : undefined;
    if (!entry) return new Response(null, { status: 404 });
    const served = entry.playback ? ((await entry.playback) ?? entry.path) : entry.path;
    return serveFile(request, served);
  });

  /**
   * An audio-only copy of a video file's sound, cached in the temp folder by
   * path, size and modification time. Playing the video file itself as audio
   * streams all of its picture data too, which starves the preview's frame
   * player. Null when ffmpeg is missing or the copy fails.
   */
  async function audioProxy(path: string): Promise<string | null> {
    let partial: string | null = null;
    try {
      const status = await ffmpeg.status();
      if (!status.available || !status.path) return null;
      const info = await stat(path);
      const key = createHash('sha256')
        .update(`${path}\0${info.size}\0${info.mtimeMs}`)
        .digest('hex')
        .slice(0, 32);
      const folder = join(app.getPath('temp'), 'gleech-audio');
      const output = join(folder, `${key}.m4a`);
      const cached = await stat(output).then(
        (file) => file.isFile() && file.size > 0,
        () => false,
      );
      if (cached) return output;
      await mkdir(folder, { recursive: true });
      partial = join(folder, `${key}.${randomUUID()}.part`);
      const child = spawnFfmpeg(status.path, audioProxyArgs(path, partial));
      processes.add(child);
      child.stdin.end();
      child.stdout.resume();
      child.stderr.resume();
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }).finally(() => processes.delete(child));
      if (code !== 0 || disposed) throw new Error('The audio copy failed.');
      await rename(partial, output);
      return output;
    } catch {
      if (partial) await unlink(partial).catch(() => {});
      return null;
    }
  }

  async function ffmpegPath(missing: string): Promise<string> {
    const status = await ffmpeg.status();
    if (!status.available || !status.path) throw new Error(missing);
    return status.path;
  }

  async function probe(
    path: string,
    kind: MediaKind,
  ): Promise<Pick<MediaEntry, 'info' | 'video' | 'hasAudio'>> {
    const name = basename(path);
    const status = await ffmpeg.status();
    if (!status.available || !status.path) {
      if (kind === 'video') throw new Error(NO_FFMPEG_VIDEO);
      // Without ffmpeg the renderer decodes audio with WebAudio and fills these in.
      const info: AudioProbe = { duration: 0, sampleRate: 0, channels: 0, codec: 'unknown' };
      return { info, video: null, hasAudio: true };
    }
    const result = await runFfmpeg(
      status.path,
      ['-hide_banner', '-nostdin', '-i', ffmpegInput(path)],
      30000,
    );
    const probed = parseFfmpegProbe(result.stderr);
    if (probed.error) throw new Error(`GLEECH couldn't read "${name}": ${probed.error}.`);
    if (kind === 'video' && !probed.video) throw new Error(`"${name}" has no video track.`);
    if (kind === 'audio' && !probed.audio) throw new Error(`"${name}" has no audio track.`);
    let duration = probed.duration;
    if (duration === null) {
      // Live recordings (e.g. browser WebM) often have no duration in the header.
      const measured = await runFfmpeg(status.path, measureDurationArgs(path, kind), 120000);
      duration = parseProgressDuration(measured.stdout);
    }
    if (duration === null && probed.video && kind === 'video') duration = 1 / probed.video.fps;
    if (duration === null) throw new Error(`GLEECH couldn't find how long "${name}" is.`);
    if (duration > MAX_MEDIA_SECONDS)
      throw new Error(`"${name}" is longer than 4 hours, which the timeline can't hold.`);
    if (kind === 'video') {
      const video = probed.video!;
      const info: VideoProbe = {
        width: video.width,
        height: video.height,
        fps: video.fps,
        duration,
        hasAudio: probed.audio !== null,
        codec: video.codec,
      };
      return { info, video, hasAudio: probed.audio !== null };
    }
    const audio = probed.audio!;
    const info: AudioProbe = {
      duration,
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      codec: audio.codec,
    };
    return { info, video: probed.video, hasAudio: true };
  }

  async function register(
    path: string,
    kind: MediaKind,
  ): Promise<OpenedMedia<VideoProbe | AudioProbe>> {
    const name = basename(path);
    const isFile = await stat(path).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!isFile)
      throw new Error(
        `The ${kind} "${name}" was not found at ${path}. It may have been moved, renamed or deleted.`,
      );
    const probed = await probe(path, kind);
    if (disposed) throw new Error('The workspace closed.');
    // Re-registering the same file keeps its ID, so open <video> elements stay valid.
    const existing = [...media.values()].find(
      (entry) => entry.path === path && entry.kind === kind,
    );
    const id = existing?.id ?? randomUUID();
    const playback =
      kind === 'audio' &&
      (VIDEO_EXTENSIONS as readonly string[]).includes(extname(path).slice(1).toLowerCase())
        ? (existing?.playback ?? audioProxy(path))
        : undefined;
    media.set(id, { id, path, kind, ...probed, ...(playback ? { playback } : {}) });
    return { mediaId: id, path, name, info: probed.info };
  }

  function getEntry(mediaId: unknown): MediaEntry {
    const entry = typeof mediaId === 'string' ? media.get(mediaId) : undefined;
    if (!entry) throw new Error('This media is no longer available. Import it again.');
    return entry;
  }
  function getVideo(mediaId: unknown): MediaEntry & { video: ProbedVideoStream } {
    const entry = getEntry(mediaId);
    if (!entry.video) throw new Error('This media has no video track.');
    return entry as MediaEntry & { video: ProbedVideoStream };
  }

  function openReader(path: string, entry: MediaEntry, options: FrameReaderOptions): FrameReader {
    return new FrameReader(
      path,
      videoReaderArgs(entry.path, options, entry.video ? sourceColorMatrix(entry.video) : 'auto'),
      options.width,
      options.height,
      options.count,
      options.lowMemory,
    );
  }

  const channels: string[] = [];
  function handle<T>(channel: string, operation: (...args: unknown[]) => Promise<T> | T): void {
    channels.push(channel);
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
        try {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
          )
            throw new Error('Invalid media request.');
          return { ok: true, value: await operation(...args) };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Media operation failed.',
          };
        }
      },
    );
  }

  async function choose(kind: MediaKind): Promise<string | null> {
    const selection = await dialog.showOpenDialog(window, {
      title: kind === 'video' ? 'Import video' : 'Import audio',
      properties: ['openFile'],
      filters: [
        kind === 'video'
          ? { name: 'Video', extensions: [...VIDEO_EXTENSIONS] }
          : { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] },
      ],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  }

  handle('media:open-video', async (selection) => {
    const path =
      selection === undefined ? await choose('video') : selectedFiles.take(selection, 'video');
    return path ? ((await register(path, 'video')) as OpenedMedia<VideoProbe>) : null;
  });
  handle('media:open-audio', async () => {
    const path = await choose('audio');
    return path ? ((await register(path, 'audio')) as OpenedMedia<AudioProbe>) : null;
  });
  handle('media:register', (path, kind) => {
    if (kind !== 'video' && kind !== 'audio') throw new Error('Invalid media kind.');
    if (typeof path !== 'string' || !path || path.length > MAX_MEDIA_PATH || !isAbsolute(path))
      throw new Error('Invalid media path.');
    // Only media files can be served, whatever a project file claims.
    const extension = extname(path).slice(1).toLowerCase();
    // A clip's own sound is registered as audio from the video file itself.
    const allowed: readonly string[] =
      kind === 'video'
        ? VIDEO_EXTENSIONS
        : [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS.filter((extension) => extension !== 'gif')];
    if (!allowed.includes(extension))
      throw new Error(`"${basename(path)}" is not a supported ${kind} file.`);
    return register(path, kind);
  });

  handle('media:audio-samples', async (mediaId) => {
    const entry = getEntry(mediaId);
    if (!entry.hasAudio) throw new Error('This media has no audio track.');
    const path = await ffmpegPath('Locate ffmpeg in Render settings to analyze audio.');
    const maxBytes = AUDIO_SAMPLE_RATE * MAX_AUDIO_SAMPLE_SECONDS * 4;
    const expected = Math.ceil((entry.info.duration + 1) * AUDIO_SAMPLE_RATE) * 4;
    let buffer = new Uint8Array(Math.min(maxBytes, Math.max(expected, 1 << 16)));
    let length = 0;
    const child = spawnFfmpeg(path, audioSampleArgs(entry.path));
    processes.add(child);
    child.stdin.end();
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      stderr = (stderr + text).slice(-4000);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const room = maxBytes - length;
      const bytes = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (length + bytes.length > buffer.length) {
        const grown = new Uint8Array(
          Math.min(maxBytes, Math.max(buffer.length * 2, length + bytes.length)),
        );
        grown.set(buffer.subarray(0, length));
        buffer = grown;
      }
      buffer.set(bytes, length);
      length += bytes.length;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => processes.delete(child));
    if (disposed) throw new Error('The workspace closed.');
    if (code !== 0) throw new Error(describeFfmpegError(stderr, 'The audio could not be decoded.'));
    const usable = length - (length % 4);
    const samples = usable === buffer.byteLength ? buffer.buffer : buffer.buffer.slice(0, usable);
    return { sampleRate: AUDIO_SAMPLE_RATE, samples };
  });

  handle('media:reader-open', async (mediaId, value) => {
    const entry = getVideo(mediaId);
    const options = readerOptions(value);
    const path = await ffmpegPath('Locate ffmpeg in Render settings to render video clips.');
    if (disposed) throw new Error('The workspace closed.');
    if (readers.size >= MAX_READERS) {
      // Forgotten readers would otherwise hold paused ffmpeg processes forever.
      const oldest = [...readers.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]!;
      oldest[1].close();
      readers.delete(oldest[0]);
    }
    const id = randomUUID();
    readers.set(id, openReader(path, entry, options));
    return id;
  });
  handle('media:reader-next', (readerId) => {
    const reader = typeof readerId === 'string' ? readers.get(readerId) : undefined;
    if (!reader) throw new Error('This video reader is closed.');
    return reader.next();
  });
  handle('media:reader-close', (readerId) => {
    if (typeof readerId !== 'string') return;
    readers.get(readerId)?.close();
    readers.delete(readerId);
  });

  handle('media:frame-at', async (mediaId, t, maxDimension) => {
    const entry = getVideo(mediaId);
    if (!isFiniteNumber(t) || !isFiniteNumber(maxDimension) || maxDimension < 1)
      throw new Error('Invalid frame request.');
    const size = fitFrameSize(entry.video.width, entry.video.height, Math.min(8192, maxDimension));
    const path = await ffmpegPath('Locate ffmpeg in Render settings to preview this video.');
    const { fps } = entry.video;
    // Past the end, show the last frame, as the preview player does.
    const time = Math.min(Math.max(0, t), Math.max(0, entry.info.duration - 1 / fps));
    const decode = async (options: FrameReaderOptions): Promise<RenderFrame | null> => {
      const reader = openReader(path, entry, options);
      try {
        let last: RenderFrame | null = null;
        for (let frame = await reader.next(); frame; frame = await reader.next()) last = frame;
        return last;
      } finally {
        reader.close();
      }
    };
    const frame =
      (await decode({ start: time, fps, count: 1, ...size })) ??
      // The container can outlast the video stream (e.g. longer audio): use the last frame.
      (await decode({ start: Math.max(0, time - 2), fps, count: Math.ceil(fps * 2) + 1, ...size }));
    if (!frame) throw new Error('No video frame could be decoded at this time.');
    return frame;
  });

  return () => {
    disposed = true;
    channels.forEach((channel) => ipcMain.removeHandler(channel));
    if (protocol.isProtocolHandled(MEDIA_SCHEME)) protocol.unhandle(MEDIA_SCHEME);
    readers.forEach((reader) => reader.close());
    readers.clear();
    processes.forEach((child) => child.kill());
    processes.clear();
    media.clear();
  };
}
