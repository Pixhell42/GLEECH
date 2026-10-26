// Render job sessions: frames arrive one at a time from the renderer and are
// fitted, then piped to ffmpeg, written as PNGs, laid out as a flip book or
// spooled for a loop encode. No Electron imports, so it runs under tests.
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { spawnFfmpeg, runFfmpeg, type FfmpegLocator, type FfmpegProcess } from './ffmpeg';
import {
  buildAudioFileArgs,
  buildLoopArgs,
  buildVideoArgs,
  buildVideoAssemblyArgs,
  describeFfmpegError,
  describeOverrides,
  hardwareProbeArgs,
  isHardwareEncoder,
  sizeLimitAttempts,
  videoEncoderCandidates,
  type LoopOverrides,
} from './ffmpeg-args';
import {
  createUpscalerLocator,
  hasTransparency,
  prepareFrame,
  toBuffer,
  type FramePlan,
  type RawImage,
  type UpscaleContext,
} from './render-frame';
import {
  flipbookImageSize,
  flipbookLayout,
  spriteGrid,
  writeFlipbookPdf,
  writeSpriteSheet,
} from './flipbook';
import { gifOutputExtension, gifOutputSize, resolveVideoOutput } from '../shared/render-presets';
import type {
  FfmpegStatus,
  GifRenderSettings,
  MediaInput,
  OutputFrame,
  OverlaySettings,
  RenderJobSpec,
  RenderResult,
  VideoRenderSettings,
} from '../shared/render';
import { renderSafety } from '../shared/render-safety';
import { createMovieParts } from './render-parts';

export interface RenderJobs {
  resumeFrames(jobId: unknown): number;
  begin(spec: unknown): Promise<string>;
  frame(jobId: unknown, frame: unknown, original?: unknown): Promise<void>;
  finish(jobId: unknown): Promise<RenderResult>;
  cancel(jobId: unknown): Promise<void>;
  /** Cancels every running job. */
  dispose(): Promise<void>;
}

export interface RenderJobsOptions {
  readonly ffmpeg: FfmpegLocator;
  /** Where job temp folders go; defaults to the OS temp folder. */
  readonly tempRoot?: string;
  /** Extra folders searched for AI upscalers before the PATH. */
  readonly upscalerDirs?: readonly string[];
  readonly platform?: string;
}

const MAX_SIDE = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;

interface JobImpl {
  readonly resumeFrames?: number;
  /** Called once per frame, in order; may run concurrently with earlier frames. */
  accept(edited: RawImage, original: RawImage | undefined, index: number): Promise<void>;
  finish(received: number): Promise<RenderResult>;
  cancel(): Promise<void>;
}

interface Session {
  readonly spec: RenderJobSpec;
  readonly impl: JobImpl;
  readonly window: number;
  readonly inflight: Set<Promise<void>>;
  received: number;
  error: Error | null;
  state: 'open' | 'finishing' | 'done';
}

// ---------------------------------------------------------------------------
// Validation

function fail(message: string): never {
  throw new Error(message);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const isNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const oneOf = <T extends string | number>(value: unknown, options: readonly T[]): value is T =>
  options.includes(value as T);

function checkMedia(value: unknown, label: string): void {
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    typeof value['path'] !== 'string' ||
    !value['path'] ||
    !isNumber(value['start'], 0, 1e7) ||
    !isNumber(value['duration'], 0, 1e7) ||
    (value['volume'] !== undefined && !isNumber(value['volume'], 0, 1))
  )
    fail(`Invalid ${label} for this render.`);
}

function checkFrame(frame: unknown): void {
  if (
    !isRecord(frame) ||
    !isInt(frame['width'], 2, MAX_SIDE) ||
    !isInt(frame['height'], 2, MAX_SIDE) ||
    (frame['width'] as number) * (frame['height'] as number) > MAX_PIXELS ||
    !oneOf(frame['fit'], ['fit', 'stretch', 'crop', 'letterbox-h', 'letterbox-v']) ||
    !oneOf(frame['anchor'], ['center', 'top', 'subject']) ||
    !oneOf(frame['bars'], ['black', 'blur', 'color', 'transparent']) ||
    typeof frame['barColor'] !== 'string' ||
    !isNumber(frame['barBlur'], 0, 1) ||
    !isNumber(frame['barDarken'], 0, 1)
  )
    fail('Invalid output size or framing.');
}

function checkVideo(video: unknown): void {
  if (!isRecord(video)) fail('Missing video settings.');
  checkFrame(video['frame']);
  const advanced = video['advanced'];
  const overlay = video['overlay'];
  const audio = video['audio'];
  const sequence = video['sequence'];
  const upscale = video['upscale'];
  if (
    !oneOf(video['output'], ['movie', 'sequence']) ||
    !oneOf(video['format'], [
      'mp4-h264',
      'mp4-hevc',
      'mov-prores',
      'mkv-ffv1',
      'mov-v210',
      'webm-vp9',
      'mov-png',
    ]) ||
    !oneOf(video['compression'], ['highest', 'high', 'web', 'small', 'lossless', 'raw']) ||
    !isNumber(video['fps'], 1, 240) ||
    !isRecord(advanced) ||
    !oneOf(advanced['encoder'], ['auto', 'cpu', 'nvenc', 'amf', 'qsv', 'mf', 'videotoolbox']) ||
    !oneOf(advanced['colorDepth'], [8, 10]) ||
    !isInt(advanced['keyframeInterval'], 0, 10000) ||
    !oneOf(advanced['speed'], ['fast', 'medium', 'slow']) ||
    typeof advanced['fastStart'] !== 'boolean' ||
    !isRecord(overlay) ||
    typeof overlay['enabled'] !== 'boolean' ||
    !oneOf(overlay['matte'], ['difference', 'added-light']) ||
    !isNumber(overlay['threshold'], 0, 1) ||
    !isNumber(overlay['softness'], 0, 1) ||
    !oneOf(overlay['alpha'], ['straight', 'premultiplied']) ||
    !isRecord(audio) ||
    typeof audio['enabled'] !== 'boolean' ||
    !oneOf(audio['source'], ['track', 'clip', 'mix']) ||
    !oneOf(audio['codec'], ['aac', 'pcm', 'opus']) ||
    !isNumber(audio['bitrateKbps'], 0, 1536) ||
    typeof audio['normalize'] !== 'boolean' ||
    !isNumber(audio['fadeIn'], 0, 3600) ||
    !isNumber(audio['fadeOut'], 0, 3600) ||
    !isRecord(sequence) ||
    !oneOf(sequence['kind'], ['files', 'flipbook']) ||
    !oneOf(sequence['depth'], [8, 16]) ||
    typeof sequence['subfolder'] !== 'boolean' ||
    typeof sequence['separateAudio'] !== 'boolean' ||
    !isRecord(sequence['flipbook']) ||
    !isRecord(upscale) ||
    !oneOf(upscale['method'], ['native', 'upscale-result', 'upscale-source']) ||
    !oneOf(upscale['engine'], [
      'lanczos',
      'nearest',
      'realesrgan',
      'realcugan',
      'waifu2x',
      'command',
      'mcp',
    ]) ||
    typeof upscale['model'] !== 'string' ||
    !isNumber(upscale['mix'], 0, 1) ||
    typeof upscale['command'] !== 'string'
  )
    fail('Invalid video render settings.');
  const flipbook = sequence['flipbook'] as Record<string, unknown>;
  if (
    !oneOf(flipbook['kind'], ['pdf', 'sprite']) ||
    !oneOf(flipbook['paper'], ['letter', 'a4', '4x6']) ||
    !oneOf(flipbook['perPage'], [4, 8, 12]) ||
    !isNumber(flipbook['bindingMargin'], 0, 3) ||
    !oneOf(flipbook['columns'], ['auto', 10, 16, 'row'])
  )
    fail('Invalid flip book settings.');
}

function checkGif(gif: unknown): void {
  if (
    !isRecord(gif) ||
    !oneOf(gif['format'], ['gif', 'webp', 'apng', 'mp4']) ||
    !oneOf(gif['loop'], ['forward', 'reverse', 'boomerang', 'concat']) ||
    !isNumber(gif['speed'], 0.25, 4) ||
    !oneOf(gif['fps'], [10, 12, 15, 24, 30]) ||
    !oneOf(gif['smoothing'], ['off', 'blend', 'motion']) ||
    !oneOf(gif['repeat'], ['forever', 'once', '3']) ||
    !isInt(gif['width'], 16, 4096) ||
    !oneOf(gif['scaling'], ['lanczos', 'bicubic', 'nearest']) ||
    !oneOf(gif['sizeLimitMb'], [0, 1, 8, 15]) ||
    !isInt(gif['colors'], 2, 256) ||
    !oneOf(gif['palette'], ['whole', 'frame', 'changes']) ||
    !oneOf(gif['dither'], ['none', 'bayer', 'floyd-steinberg', 'sierra']) ||
    !isNumber(gif['lossy'], 0, 100) ||
    typeof gif['transparent'] !== 'boolean' ||
    typeof gif['audio'] !== 'boolean'
  )
    fail('Invalid GIF settings.');
}

/** Checks a job spec received over IPC. */
export function validateSpec(value: unknown): RenderJobSpec {
  if (!isRecord(value)) fail('Invalid render request.');
  if (!oneOf(value['kind'], ['video', 'gif'])) fail('Invalid render kind.');
  if (typeof value['name'] !== 'string' || value['name'].length > 300) fail('Invalid render name.');
  if (!isInt(value['frameCount'], 1, 1_000_000)) fail('Invalid frame count.');
  if (!isNumber(value['fps'], 0.1, 240)) fail('Invalid frame rate.');
  if (
    !isInt(value['sourceWidth'], 1, MAX_SIDE) ||
    !isInt(value['sourceHeight'], 1, MAX_SIDE) ||
    (value['sourceWidth'] as number) * (value['sourceHeight'] as number) > MAX_PIXELS
  )
    fail('Invalid frame size.');
  if (typeof value['outputPath'] !== 'string' || !isAbsolute(value['outputPath']))
    fail('Choose where to save the render.');
  checkMedia(value['audio'], 'audio');
  checkMedia(value['clipAudio'], 'clip audio');
  const times = value['frameTimes'];
  if (
    times !== undefined &&
    (!Array.isArray(times) ||
      times.length > 1_000_000 ||
      times.some((t) => !isNumber(t, -1e7, 1e7)))
  )
    fail('Invalid frame times.');
  if (value['withOriginal'] !== undefined && typeof value['withOriginal'] !== 'boolean')
    fail('Invalid render request.');
  if (value['kind'] === 'video') checkVideo(value['video']);
  else checkGif(value['gif']);
  if (value['safety'] !== undefined) {
    const safety = value['safety'];
    if (
      !isRecord(safety) ||
      typeof safety['checkMemory'] !== 'boolean' ||
      !oneOf(safety['mode'], ['auto', 'standard', 'one-frame', 'tiled']) ||
      !isNumber(safety['segmentSeconds'], 0, 600) ||
      typeof safety['keepParts'] !== 'boolean' ||
      typeof safety['resume'] !== 'boolean' ||
      !oneOf(safety['tileSize'], [256, 512, 1024])
    )
      fail('Invalid export memory settings.');
    if (!oneOf(safety['processing'], ['source', 'output'])) fail('Invalid effect processing size.');
    if ((safety['keepParts'] || safety['resume']) && !(Number(safety['segmentSeconds']) > 0))
      fail('Enable movie parts before keeping or resuming them.');
    if (
      Number(safety['segmentSeconds']) > 0 &&
      (value['kind'] !== 'video' || (value['video'] as VideoRenderSettings).output !== 'movie')
    )
      fail('Parts and resume are available for movie exports.');
  }
  for (const key of ['sourcePath', 'checkpointTarget'])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' ||
        !isAbsolute(value[key] as string) ||
        (value[key] as string).includes('\0'))
    )
      fail(`Invalid ${key}.`);
  if (
    value['resumeIdentity'] !== undefined &&
    (typeof value['resumeIdentity'] !== 'string' || !/^[a-f0-9]{64}$/.test(value['resumeIdentity']))
  )
    fail('Invalid export checkpoint identity.');
  return value as unknown as RenderJobSpec;
}

function frameImage(value: unknown, width: number, height: number, label: string): RawImage {
  if (!isRecord(value) || value['width'] !== width || value['height'] !== height)
    fail(`The ${label} must be ${width} × ${height}.`);
  const pixels = value['pixels'];
  const bytes =
    pixels instanceof ArrayBuffer
      ? toBuffer(pixels)
      : pixels instanceof Uint8Array
        ? toBuffer(pixels)
        : fail(`The ${label} has no pixels.`);
  if (bytes.length !== width * height * 4) fail(`The ${label} has the wrong number of pixels.`);
  return { width, height, data: bytes };
}

// ---------------------------------------------------------------------------
// Helpers

/** Safe file name stem from a project name. */
export function safeName(name: string): string {
  const cleaned = Array.from(name, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/\.(gleech|png|jpe?g|webp|tiff?|mp4|mov|mkv|webm|gif)$/i, '')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) || !cleaned ? 'render' : cleaned;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Renames a finished temp file into place; picks "name (2).ext" if the target is in use. */
async function commit(temp: string, target: string, notes: string[]): Promise<string> {
  try {
    await rename(temp, target);
    return target;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(code)) throw error;
    const extension = extname(target);
    const stem = target.slice(0, target.length - extension.length);
    for (let n = 2; n < 100; n++) {
      const alternative = `${stem} (${n})${extension}`;
      if (await exists(alternative)) continue;
      await rename(temp, alternative);
      notes.push(
        `${basename(target)} was in use, so this render was saved as ${basename(alternative)}.`,
      );
      return alternative;
    }
    throw error;
  }
}

/** Makes the output extension match what is written, with a note when it changed. */
function withExtension(path: string, extension: string, notes: string[]): string {
  const current = extname(path);
  if (current.toLowerCase() === `.${extension}`) return path;
  const known = /^\.(mp4|mov|mkv|webm|gif|webp|png|apng|pdf)$/i.test(current);
  const next = (known ? path.slice(0, path.length - current.length) : path) + `.${extension}`;
  if (known) notes.push(`Saved as .${extension} to match the format.`);
  return next;
}

function partialPath(target: string, id: string): string {
  return join(dirname(target), `.${basename(target)}.${id.slice(0, 8)}.partial`);
}

interface RunningFfmpeg {
  readonly child: FfmpegProcess;
  readonly exited: Promise<{ code: number | null; error?: Error }>;
  stderr(): string;
  write(data: Uint8Array): Promise<void>;
  end(): Promise<void>;
  kill(): Promise<void>;
}

function startFfmpeg(path: string, args: readonly string[]): RunningFfmpeg {
  const child = spawnFfmpeg(path, args);
  let stderr = '';
  let exitInfo: { code: number | null; error?: Error } | null = null;
  child.stdout.resume();
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-32_000);
  });
  // EPIPE when ffmpeg dies is reported through write callbacks and the exit code.
  child.stdin.on('error', () => {});
  const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => {
      exitInfo = { code: null, error };
      resolve(exitInfo);
    });
    child.once('close', (code) => {
      exitInfo ??= { code };
      resolve(exitInfo);
    });
  });
  const failure = (info: { code: number | null; error?: Error }) =>
    new Error(
      info.error && !stderr
        ? `ffmpeg could not start: ${info.error.message}`
        : describeFfmpegError(stderr, info.code),
    );
  const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    child,
    exited,
    stderr: () => stderr,
    write(data) {
      if (exitInfo) return Promise.reject(failure(exitInfo));
      return new Promise<void>((resolve, reject) => {
        child.stdin.write(data, (error) => {
          if (!error) return resolve();
          // Wait briefly for the exit so the message carries ffmpeg's reason.
          void Promise.race([exited, timeout(3000)]).then(() =>
            reject(failure(exitInfo ?? { code: null })),
          );
        });
      });
    },
    async end() {
      child.stdin.end();
      const info = await exited;
      if (info.code !== 0) throw failure(info);
    },
    async kill() {
      if (!exitInfo) child.kill('SIGKILL');
      await Promise.race([exited, timeout(5000)]);
    },
  };
}

/** Runs ffmpeg to completion; `track` lets cancel kill it. */
async function runToEnd(
  path: string,
  args: readonly string[],
  track: (process: RunningFfmpeg | null) => void,
): Promise<void> {
  const running = startFfmpeg(path, args);
  track(running);
  try {
    await running.end();
  } finally {
    track(null);
  }
}

const hardwareChecks = new Map<string, Promise<boolean>>();
function hardwareWorks(path: string, encoder: string): Promise<boolean> {
  const key = `${path}\n${encoder}`;
  let check = hardwareChecks.get(key);
  if (!check) {
    check = runFfmpeg(path, hardwareProbeArgs(encoder), 20000).then(
      (result) => result.code === 0,
      () => false,
    );
    hardwareChecks.set(key, check);
  }
  return check;
}

const FAMILY_NAMES: Record<string, string> = {
  nvenc: 'NVIDIA NVENC',
  amf: 'AMD AMF',
  qsv: 'Intel Quick Sync',
  mf: 'Media Foundation',
  videotoolbox: 'VideoToolbox',
};

/** First candidate that works; forced GPU families fall back to CPU with a note. */
async function chooseEncoder(
  path: string,
  candidates: readonly string[],
  forced: string,
  notes: string[],
): Promise<string> {
  for (const encoder of candidates) {
    if (!isHardwareEncoder(encoder) || (await hardwareWorks(path, encoder))) {
      if (forced !== 'auto' && forced !== 'cpu' && !encoder.endsWith(`_${forced}`))
        notes.push(
          `${FAMILY_NAMES[forced] ?? 'GPU'} encoding isn’t available on this PC, so ${encoder} was used instead.`,
        );
      return encoder;
    }
  }
  throw new Error('This ffmpeg has no working encoder for this format. Try another format.');
}

async function requireFfmpeg(ffmpeg: FfmpegLocator): Promise<FfmpegStatus & { path: string }> {
  const status = await ffmpeg.status();
  if (!status.available || !status.path)
    throw new Error(
      status.error ??
        'ffmpeg was not found. Locate ffmpeg to render movies; image sequences and flip books still work.',
    );
  return { ...status, path: status.path };
}

const DEFAULT_OVERLAY: OverlaySettings = {
  enabled: true,
  matte: 'difference',
  threshold: 0.08,
  softness: 0.25,
  alpha: 'straight',
};

function upscaleContext(
  settings: VideoRenderSettings,
  tempDir: string,
  locate: UpscaleContext['locate'],
): UpscaleContext | undefined {
  return settings.upscale.method === 'upscale-result'
    ? { settings: settings.upscale, tempDir, locate }
    : undefined;
}

function audioInputs(spec: RenderJobSpec): { track?: MediaInput; clip?: MediaInput } {
  return {
    ...(spec.audio ? { track: spec.audio } : {}),
    ...(spec.clipAudio ? { clip: spec.clipAudio } : {}),
  };
}

// ---------------------------------------------------------------------------
// Movie

async function movieJob(
  spec: RenderJobSpec,
  settings: VideoRenderSettings,
  id: string,
  context: JobContext,
  pinned?: { status: FfmpegStatus & { path: string }; encoder: string },
): Promise<JobImpl> {
  const output = resolveVideoOutput(settings);
  if (output.kind !== 'movie') throw new Error('Internal: not a movie output.');
  const notes: string[] = [];
  if (output.switched) notes.push(output.switched);
  const status = pinned?.status ?? (await requireFfmpeg(context.ffmpeg));
  const encoder =
    pinned?.encoder ??
    (await chooseEncoder(
      status.path,
      videoEncoderCandidates(
        output.codec,
        settings.advanced.encoder,
        status.encoders,
        context.platform,
      ),
      settings.advanced.encoder,
      notes,
    ));
  const target = withExtension(spec.outputPath, output.extension, notes);
  await mkdir(dirname(target), { recursive: true });
  const temp = partialPath(target, id);
  const { width, height } = settings.frame;
  const inputs = audioInputs(spec);
  const ffmpeg = startFfmpeg(
    status.path,
    buildVideoArgs({
      settings,
      output,
      width,
      height,
      fps: spec.fps,
      frameCount: spec.frameCount,
      encoder,
      encoders: status.encoders,
      audio: inputs.track,
      clipAudio: inputs.clip,
      outputPath: temp,
      ...(spec.safety?.mode === 'one-frame' || spec.safety?.mode === 'tiled'
        ? { lowMemory: true }
        : {}),
    }),
  );
  const plan: FramePlan = {
    frame: settings.frame,
    overlay: settings.overlay.enabled ? settings.overlay : undefined,
    alpha: output.alpha,
    premultiply: settings.overlay.enabled && settings.overlay.alpha === 'premultiplied',
    upscale: upscaleContext(settings, context.tempDir, context.locate),
  };
  let sink: Promise<void> = Promise.resolve();
  let received = 0;
  return {
    accept(edited, original, index) {
      const prepared = prepareFrame(edited, original, plan, index);
      prepared.catch(() => {});
      sink = sink.then(async () => {
        await ffmpeg.write((await prepared).data);
        received++;
      });
      return sink;
    },
    async finish() {
      await sink;
      if (!received) throw new Error('No frames were rendered.');
      await ffmpeg.end();
      const path = await commit(temp, target, notes);
      return { outputPath: path, bytes: (await stat(path)).size, files: 1, notes };
    },
    async cancel() {
      await ffmpeg.kill();
      await unlink(temp).catch(() => {});
    },
  };
}

async function segmentedMovieJob(
  spec: RenderJobSpec,
  settings: VideoRenderSettings,
  id: string,
  context: JobContext,
): Promise<JobImpl> {
  const output = resolveVideoOutput(settings);
  if (output.kind !== 'movie') throw new Error('Parts require a movie output.');
  const status = await requireFfmpeg(context.ffmpeg);
  const notes: string[] = output.switched ? [output.switched] : [];
  const encoder = await chooseEncoder(
    status.path,
    videoEncoderCandidates(
      output.codec,
      settings.advanced.encoder,
      status.encoders,
      context.platform,
    ),
    settings.advanced.encoder,
    notes,
  );
  const target = withExtension(spec.outputPath, output.extension, notes);
  await mkdir(dirname(target), { recursive: true });
  const temporary = partialPath(target, id);
  const parts = await createMovieParts({
    spec,
    extension: output.extension,
    temporary: context.tempDir,
    encoderSignature: `${encoder}:${status.version}:${status.path}`,
    createPart: (part, partId) => movieJob(part, part.video!, partId, context, { status, encoder }),
    assemble: async (listPath) => {
      await runToEnd(
        status.path,
        buildVideoAssemblyArgs({
          spec,
          listPath,
          outputPath: temporary,
          encoders: status.encoders,
        }),
        (process) => context.track(id, process),
      );
      const path = await commit(temporary, target, notes);
      return { outputPath: path, bytes: (await stat(path)).size, files: 1, notes };
    },
  });
  return {
    ...parts,
    async cancel() {
      await parts.cancel();
      await unlink(temporary).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Image sequence (separate files)

async function filesJob(
  spec: RenderJobSpec,
  settings: VideoRenderSettings,
  id: string,
  context: JobContext,
): Promise<JobImpl> {
  const name = safeName(spec.name);
  const folder = settings.sequence.subfolder
    ? join(spec.outputPath, `${name}_frames`)
    : spec.outputPath;
  const created = !(await exists(folder));
  await mkdir(folder, { recursive: true });
  const prefix = `${name}${settings.overlay.enabled ? '_fx' : ''}_`;
  const digits = Math.max(4, String(spec.frameCount).length);
  const written: string[] = [];
  const temps = new Set<string>();
  const depth = settings.sequence.depth;
  let bytes = 0;
  let canceled = false;
  const plan: FramePlan = {
    frame: settings.frame,
    overlay: settings.overlay.enabled ? settings.overlay : undefined,
    // Keep whatever alpha the frame has; opaque frames are saved as RGB.
    alpha: true,
    premultiply: settings.overlay.enabled && settings.overlay.alpha === 'premultiplied',
    upscale: upscaleContext(settings, context.tempDir, context.locate),
  };
  return {
    async accept(edited, original, index) {
      const image = await prepareFrame(edited, original, plan, index);
      const file = join(folder, `${prefix}${String(index + 1).padStart(digits, '0')}.png`);
      const temp = `${file}.${id.slice(0, 8)}.partial`;
      let pipeline = sharp(image.data, {
        raw: { width: image.width, height: image.height, channels: 4 },
      });
      if (!hasTransparency(image.data)) pipeline = pipeline.removeAlpha();
      if (depth === 16) pipeline = pipeline.toColourspace('rgb16');
      temps.add(temp);
      const info = await pipeline
        .png({ compressionLevel: depth === 16 ? 3 : 6, adaptiveFiltering: false })
        .toFile(temp);
      if (canceled) return;
      await rename(temp, file);
      temps.delete(temp);
      written.push(file);
      bytes += info.size;
    },
    async finish(received) {
      if (!received) throw new Error('No frames were rendered.');
      const notes: string[] = [];
      let files = written.length;
      const inputs = audioInputs(spec);
      if (settings.sequence.separateAudio && (inputs.track || inputs.clip)) {
        const status = await context.ffmpeg.status();
        const wav = join(folder, `${name}_audio.wav`);
        const args = buildAudioFileArgs({
          audio: settings.audio,
          track: inputs.track,
          clip: inputs.clip,
          // Sequences may skip frames (every 2nd, keys), so use the range length.
          duration:
            Math.max(inputs.track?.duration ?? 0, inputs.clip?.duration ?? 0) ||
            spec.frameCount / spec.fps,
          outputPath: `${wav}.${id.slice(0, 8)}.partial`,
        });
        if (!status.available || !status.path)
          notes.push('The audio file was skipped because ffmpeg was not found.');
        else if (args) {
          const temp = args[args.length - 1]!;
          temps.add(temp);
          await runToEnd(status.path, args, (process) => context.track(id, process));
          await rename(temp, wav);
          temps.delete(temp);
          written.push(wav);
          bytes += (await stat(wav)).size;
          files++;
        }
      }
      return { outputPath: folder, bytes, files, notes };
    },
    async cancel() {
      canceled = true;
      await Promise.all([...written, ...temps].map((file) => unlink(file).catch(() => {})));
      if (created) await rmdir(folder).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Flip book (PDF pages or sprite sheet)

async function flipbookJob(
  spec: RenderJobSpec,
  settings: VideoRenderSettings,
  id: string,
  context: JobContext,
): Promise<JobImpl> {
  const book = settings.sequence.flipbook;
  const output = resolveVideoOutput(settings);
  const notes: string[] = [];
  const target = withExtension(spec.outputPath, output.extension, notes);
  await mkdir(dirname(target), { recursive: true });
  const aspect = settings.frame.width / settings.frame.height;
  const pdf = book.kind === 'pdf';
  const layout = pdf ? flipbookLayout(book.paper, book.perPage, book.bindingMargin, aspect) : null;
  let cell: { width: number; height: number };
  if (layout) cell = flipbookImageSize(layout, settings.frame.width, settings.frame.height);
  else {
    const grid = spriteGrid(
      spec.frameCount,
      book.columns,
      settings.frame.width,
      settings.frame.height,
    );
    cell = { width: grid.cellWidth, height: grid.cellHeight };
  }
  const frame: OutputFrame = { ...settings.frame, width: cell.width, height: cell.height };
  const plan: FramePlan = {
    frame,
    overlay: settings.overlay.enabled ? settings.overlay : undefined,
    // Printed pages are white paper; sprite sheets keep alpha.
    alpha: !pdf,
    flattenColor: [255, 255, 255],
    premultiply: !pdf && settings.overlay.enabled && settings.overlay.alpha === 'premultiplied',
    upscale: upscaleContext(settings, context.tempDir, context.locate),
  };
  const cells: string[] = [];
  const temp = partialPath(target, id);
  const jsonPath = !pdf && book.json ? target.replace(/\.png$/i, '') + '.json' : undefined;
  let canceled = false;
  return {
    async accept(edited, original, index) {
      const image = await prepareFrame(edited, original, plan, index);
      const file = join(
        context.tempDir,
        `cell_${String(index).padStart(6, '0')}.${pdf ? 'jpg' : 'png'}`,
      );
      const input = sharp(image.data, {
        raw: { width: image.width, height: image.height, channels: 4 },
      });
      await (
        pdf
          ? input.removeAlpha().jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
          : input.png({ compressionLevel: 1 })
      ).toFile(file);
      cells[index] = file;
    },
    async finish(received) {
      if (!received) throw new Error('No frames were rendered.');
      const files = cells.slice(0, received);
      if (files.some((file) => !file)) throw new Error('Some frames are missing.');
      if (layout) {
        const result = await writeFlipbookPdf({
          outputPath: temp,
          frames: files,
          imageWidth: cell.width,
          imageHeight: cell.height,
          layout,
          cutLines: book.cutLines,
          frameNumbers: book.frameNumbers,
          // Number cards by source frame, so every-2nd books read 001, 003, 005…
          labels: spec.frameTimes
            ? files.map(
                (_, index) =>
                  Math.round(
                    ((spec.frameTimes![index] ?? 0) - (spec.frameTimes![0] ?? 0)) * spec.fps,
                  ) + 1,
              )
            : undefined,
          cover: book.cover ? spec.name.replace(/\.gleech$/i, '') : undefined,
          canceled: () => canceled,
        });
        const path = await commit(temp, target, notes);
        notes.push(`${result.pages} page${result.pages === 1 ? '' : 's'}`);
        return { outputPath: path, bytes: result.bytes, files: 1, notes };
      }
      const grid = spriteGrid(received, book.columns, cell.width, cell.height);
      const times = files.map((_, index) => spec.frameTimes?.[index] ?? index / spec.fps);
      const jsonTemp = jsonPath ? `${jsonPath}.${id.slice(0, 8)}.partial` : undefined;
      const result = await writeSpriteSheet({
        outputPath: temp,
        cells: files,
        grid,
        times,
        fps: spec.fps,
        jsonPath: jsonTemp,
      });
      const path = await commit(temp, target, notes);
      if (jsonPath && jsonTemp) await rename(jsonTemp, jsonPath);
      if (grid.cellWidth < settings.frame.width)
        notes.push(
          `Cells were scaled to ${grid.cellWidth} × ${grid.cellHeight} to keep the sheet within 16384 px.`,
        );
      return {
        outputPath: path,
        bytes: result.bytes + result.jsonBytes,
        files: jsonPath ? 2 : 1,
        notes,
      };
    },
    async cancel() {
      canceled = true;
      await unlink(temp).catch(() => {});
      if (jsonPath) await unlink(`${jsonPath}.${id.slice(0, 8)}.partial`).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// GIF & Loops

/**
 * Lossy pre-pass: pixels within `threshold` of the previous output frame reuse
 * it exactly, so the GIF encoder stores them as unchanged.
 */
export function reuseSimilarPixels(
  frame: Uint8Array,
  previous: Uint8Array,
  threshold: number,
): void {
  if (threshold <= 0) return;
  for (let i = 0; i < frame.length; i += 4) {
    if (
      Math.abs(frame[i]! - previous[i]!) <= threshold &&
      Math.abs(frame[i + 1]! - previous[i + 1]!) <= threshold &&
      Math.abs(frame[i + 2]! - previous[i + 2]!) <= threshold &&
      Math.abs(frame[i + 3]! - previous[i + 3]!) <= threshold
    ) {
      frame[i] = previous[i]!;
      frame[i + 1] = previous[i + 1]!;
      frame[i + 2] = previous[i + 2]!;
      frame[i + 3] = previous[i + 3]!;
    }
  }
}

/** Lossy 0–100 → largest per-channel difference that is reused. */
export function lossyThreshold(lossy: number): number {
  return Math.round((Math.min(100, Math.max(0, lossy)) / 100) * 40);
}

async function loopJob(
  spec: RenderJobSpec,
  settings: GifRenderSettings,
  id: string,
  context: JobContext,
): Promise<JobImpl> {
  const status = await requireFfmpeg(context.ffmpeg);
  const notes: string[] = [];
  if (settings.format === 'webp' && !status.encoders.some((name) => name.startsWith('libwebp')))
    throw new Error('This ffmpeg build can’t write animated WebP. Pick GIF or APNG.');
  if (settings.format === 'apng' && !status.encoders.includes('apng'))
    throw new Error('This ffmpeg build can’t write APNG. Pick GIF or WebP.');
  const mp4Encoder =
    settings.format === 'mp4'
      ? await chooseEncoder(
          status.path,
          videoEncoderCandidates('h264', 'auto', status.encoders, context.platform),
          'auto',
          notes,
        )
      : undefined;
  if (settings.transparent && settings.format === 'mp4')
    notes.push('MP4 loops can’t be transparent, so the background was kept.');
  const target = withExtension(spec.outputPath, gifOutputExtension(settings), notes);
  await mkdir(dirname(target), { recursive: true });
  const size = gifOutputSize(settings, spec.sourceWidth / spec.sourceHeight);
  const alpha = settings.transparent && settings.format !== 'mp4';
  const overlay =
    alpha && spec.withOriginal
      ? { ...(spec.video?.overlay ?? DEFAULT_OVERLAY), enabled: true }
      : undefined;
  const plan: FramePlan = {
    frame: {
      width: size.width,
      height: size.height,
      fit: 'stretch',
      anchor: 'center',
      bars: 'black',
      barColor: '#000000',
      barBlur: 0,
      barDarken: 0,
    },
    overlay,
    alpha,
    kernel: ({ lanczos: 'lanczos3', bicubic: 'cubic', nearest: 'nearest' } as const)[
      settings.scaling
    ],
  };
  const spoolPath = join(context.tempDir, 'frames.rgba');
  const spool: WriteStream = createWriteStream(spoolPath);
  const spoolClosed = new Promise<void>((resolve, reject) => {
    spool.once('close', resolve);
    spool.once('error', reject);
  });
  spoolClosed.catch(() => {});
  const threshold = settings.format === 'gif' ? lossyThreshold(settings.lossy) : 0;
  let previous: Uint8Array | null = null;
  let sink: Promise<void> = Promise.resolve();
  let spooled = 0;
  const outputs = new Set<string>();
  let running: RunningFfmpeg | null = null;
  let canceled = false;
  const encode = async (overrides: LoopOverrides, attempt: number) => {
    const output = `${partialPath(target, id)}${attempt}`;
    outputs.add(output);
    const args = buildLoopArgs({
      settings,
      inputPath: spoolPath,
      inputWidth: size.width,
      inputHeight: size.height,
      inputFps: spec.fps,
      frameCount: spooled,
      outputPath: output,
      encoders: status.encoders,
      ...(mp4Encoder ? { mp4Encoder } : {}),
      audio:
        settings.format === 'mp4' && settings.audio ? (spec.audio ?? spec.clipAudio) : undefined,
      overrides,
    });
    await runToEnd(status.path, args, (process) => {
      running = process;
      context.track(id, process);
    });
    if (canceled) throw new Error('Render canceled.');
    return { path: output, bytes: (await stat(output)).size };
  };
  return {
    accept(edited, original, index) {
      const prepared = prepareFrame(edited, original, plan, index);
      prepared.catch(() => {});
      sink = sink.then(async () => {
        const image = await prepared;
        if (threshold > 0) {
          if (previous) reuseSimilarPixels(image.data, previous, threshold);
          previous = Uint8Array.from(image.data);
        }
        await new Promise<void>((resolve, reject) =>
          spool.write(image.data, (error) => (error ? reject(error) : resolve())),
        );
        spooled++;
      });
      return sink;
    },
    async finish(received) {
      await sink;
      spool.end();
      await spoolClosed;
      if (!received || !spooled) throw new Error('No frames were rendered.');
      let best = await encode({}, 0);
      const limit = settings.sizeLimitMb * 1e6;
      if (limit > 0 && best.bytes > limit) {
        const first = best.bytes;
        const attempts = sizeLimitAttempts(settings);
        let fitted: LoopOverrides | null = null;
        let tries = 0;
        for (let i = 0; i < attempts.length && tries < 4; i++) {
          const attempt = attempts[i]!;
          // Skip steps that clearly can't reach the limit (keep the last as a floor).
          if (first * attempt.factor > limit * 1.15 && i < attempts.length - 1) continue;
          tries++;
          const result = await encode(attempt.overrides, i + 1);
          if (result.bytes < best.bytes) best = result;
          if (result.bytes <= limit) {
            fitted = attempt.overrides;
            break;
          }
        }
        const describe = (overrides: LoopOverrides) => {
          const text = describeOverrides(settings, overrides);
          return text ? ` (${text})` : '';
        };
        notes.push(
          fitted
            ? `→ trimmed to fit ${settings.sizeLimitMb} MB${describe(fitted)}`
            : `Couldn’t get under ${settings.sizeLimitMb} MB; saved the smallest version (${(best.bytes / 1e6).toFixed(1)} MB).`,
        );
      }
      const path = await commit(best.path, target, notes);
      outputs.delete(best.path);
      await Promise.all([...outputs].map((file) => unlink(file).catch(() => {})));
      return { outputPath: path, bytes: (await stat(path)).size, files: 1, notes };
    },
    async cancel() {
      canceled = true;
      spool.destroy();
      await (running as RunningFfmpeg | null)?.kill();
      await Promise.all([...outputs].map((file) => unlink(file).catch(() => {})));
    },
  };
}

// ---------------------------------------------------------------------------
// Sessions

interface JobContext {
  readonly ffmpeg: FfmpegLocator;
  readonly tempDir: string;
  readonly platform: string;
  readonly locate: UpscaleContext['locate'];
  /** Registers the ffmpeg process a finishing step runs, so cancel can stop it. */
  readonly track: (jobId: string, process: RunningFfmpeg | null) => void;
}

export function createRenderJobs(options: RenderJobsOptions): RenderJobs {
  const sessions = new Map<string, Session & { tempDir: string; process: RunningFfmpeg | null }>();
  const locate = createUpscalerLocator(options.upscalerDirs ?? []);
  const platform = options.platform ?? process.platform;

  function session(id: unknown) {
    const found = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!found) throw new Error('This render is no longer running.');
    return found;
  }

  async function settle(current: Session): Promise<void> {
    await Promise.allSettled([...current.inflight]);
  }

  async function discard(id: string): Promise<void> {
    const current = sessions.get(id);
    if (!current) return;
    sessions.delete(id);
    current.state = 'done';
    await current.process?.kill();
    await current.impl.cancel().catch(() => {});
    await settle(current);
    await current.impl.cancel().catch(() => {});
    await rm(current.tempDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    resumeFrames: (jobId) => session(jobId).impl.resumeFrames ?? 0,
    async begin(value) {
      const spec = validateSpec(value);
      const id = randomUUID();
      const tempDir = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'gleech-render-'));
      const context: JobContext = {
        ffmpeg: options.ffmpeg,
        tempDir,
        platform,
        locate,
        track: (jobId, process) => {
          const current = sessions.get(jobId);
          if (current) current.process = process;
        },
      };
      try {
        let impl: JobImpl;
        let pixels: number;
        if (spec.kind === 'gif') {
          impl = await loopJob(spec, spec.gif!, id, context);
          pixels = spec.sourceWidth * spec.sourceHeight;
        } else {
          const video = spec.video!;
          pixels = Math.max(
            spec.sourceWidth * spec.sourceHeight,
            video.frame.width * video.frame.height,
          );
          impl =
            video.output === 'movie'
              ? spec.safety && spec.safety.segmentSeconds > 0
                ? await segmentedMovieJob(spec, video, id, context)
                : await movieJob(spec, video, id, context)
              : video.sequence.kind === 'files'
                ? await filesJob(spec, video, id, context)
                : await flipbookJob(spec, video, id, context);
        }
        sessions.set(id, {
          spec,
          impl,
          // Overlap a couple of frames below 4K-ish sizes; one at a time above.
          window:
            pixels > 16 * 1024 * 1024 ||
            (spec.safety &&
              (renderSafety(spec.safety).mode !== 'standard' || spec.safety.segmentSeconds > 0))
              ? 1
              : 2,
          inflight: new Set(),
          received: impl.resumeFrames ?? 0,
          error: null,
          state: 'open',
          tempDir,
          process: null,
        });
        return id;
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    },

    async frame(jobId, value, originalValue) {
      const current = session(jobId);
      if (current.error) throw current.error;
      if (current.state !== 'open') throw new Error('This render is already finishing.');
      const { spec } = current;
      if (current.received >= spec.frameCount)
        throw new Error(`This render expected ${spec.frameCount} frames.`);
      const edited = frameImage(value, spec.sourceWidth, spec.sourceHeight, 'rendered frame');
      const original =
        originalValue === undefined || originalValue === null
          ? undefined
          : frameImage(originalValue, spec.sourceWidth, spec.sourceHeight, 'original frame');
      const index = current.received++;
      const task = current.impl.accept(edited, original, index).catch((error: unknown) => {
        current.error ??= error instanceof Error ? error : new Error(String(error));
      });
      current.inflight.add(task);
      void task.finally(() => current.inflight.delete(task));
      while (current.inflight.size >= current.window && !current.error)
        await Promise.race(current.inflight);
      if (current.error) throw current.error;
    },

    async finish(jobId) {
      const current = session(jobId);
      if (current.state !== 'open') throw new Error('This render is already finishing.');
      current.state = 'finishing';
      const id = jobId as string;
      try {
        await settle(current);
        if (current.error) throw current.error;
        const result = await current.impl.finish(current.received);
        sessions.delete(id);
        current.state = 'done';
        await rm(current.tempDir, { recursive: true, force: true }).catch(() => {});
        return result;
      } catch (error) {
        await discard(id);
        throw error;
      }
    },

    async cancel(jobId) {
      if (typeof jobId === 'string') await discard(jobId);
    },

    async dispose() {
      await Promise.all([...sessions.keys()].map((id) => discard(id)));
    },
  };
}
