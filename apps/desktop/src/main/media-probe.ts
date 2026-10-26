// Pure helpers for timeline media: parse `ffmpeg -hide_banner -i <file>` stderr
// and build ffmpeg decode arguments. No Electron or child-process imports, so
// everything here is unit-testable.

export interface ProbedVideoStream {
  /** Display size: rotation and non-square pixels are already applied. */
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly codec: string;
  /** Clockwise display rotation in degrees (0, 90, 180 or 270). */
  readonly rotation: number;
  /** Stored height before rotation; decides the color matrix of untagged video. */
  readonly codedHeight: number;
  /** ffmpeg's colorspace tag (bt709, smpte170m, …), or null when the file has none. */
  readonly colorMatrix: string | null;
}
export interface ProbedAudioStream {
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: string;
}
export interface ProbedMedia {
  /** Seconds, or null when ffmpeg reports N/A. */
  readonly duration: number | null;
  readonly video: ProbedVideoStream | null;
  readonly audio: ProbedAudioStream | null;
  /** ffmpeg's complaint when it could not open the file at all. */
  readonly error: string | null;
}

/** Decoded audio for analysis: 22.05 kHz mono covers the analysis bins up to ~11 kHz. */
export const AUDIO_SAMPLE_RATE = 22050;
export const MAX_AUDIO_SAMPLE_SECONDS = 30 * 60;
/**
 * Decoders look this far past the requested time, so float rounding never lands
 * one frame early. 2^-12 s can't coincide with frame boundaries of common
 * rational rates (a millisecond does: 30 NTSC frames last exactly 1.001 s).
 * The renderer's preview seeks use the same offset.
 */
export const FRAME_EPSILON = 1 / 4096;

function parseClock(text: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseRate(text: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(text ?? '');
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** ffmpeg prints NTSC rates rounded to two decimals; return the conventional values. */
function normalizeFps(value: number): number {
  for (const base of [24, 30, 48, 60, 120]) {
    const ntsc = (base * 1000) / 1001;
    if (Math.abs(value - ntsc) < 0.006) return Math.round(ntsc * 1000) / 1000;
  }
  return value;
}

const LAYOUT_CHANNELS: Readonly<Record<string, number>> = {
  mono: 1,
  stereo: 2,
  downmix: 2,
  binaural: 2,
  quad: 4,
  hexagonal: 6,
  octagonal: 8,
  cube: 8,
  hexadecagonal: 16,
};
function channelCount(layout: string | undefined): number {
  const text = (layout ?? '').trim().toLowerCase();
  const named = LAYOUT_CHANNELS[text];
  if (named) return named;
  const count = /^(\d+) channels?$/.exec(text);
  if (count) return Number(count[1]);
  // Speaker layouts such as 5.1, 7.1.4 or 22.2 add up to the channel count.
  if (/^\d+(?:\.\d+){1,2}$/.test(text))
    return text.split('.').reduce((sum, part) => sum + Number(part), 0);
  return 2;
}

/** Remove (…) groups, including nested ones, so commas inside them don't split fields. */
function stripParentheses(text: string): string {
  let current = text;
  for (let pass = 0; pass < 4 && /\([^()]*\)/.test(current); pass++)
    current = current.replace(/\([^()]*\)/g, '');
  return current;
}

interface StreamBlock {
  readonly kind: string;
  readonly description: string;
  readonly details: string[];
}

function streamBlocks(lines: readonly string[]): StreamBlock[] {
  const blocks: { kind: string; description: string; details: string[]; indent: number }[] = [];
  let current: (typeof blocks)[number] | null = null;
  for (const line of lines) {
    // Log lines ("[mov @ 0x…] …") can interleave with the dump; they aren't stream details.
    if (line.startsWith('[')) continue;
    const stream = /^(\s*)Stream #0:\d+\S*?: (\w+): (.*)$/.exec(line);
    if (stream) {
      current = {
        kind: stream[2]!,
        description: stream[3]!,
        details: [],
        indent: stream[1]!.length,
      };
      blocks.push(current);
      continue;
    }
    const indent = /^\s*/.exec(line)![0].length;
    if (current && indent > current.indent) current.details.push(line.trim());
    else current = null;
  }
  return blocks;
}

const COLOR_SPACES = new Set([
  'gbr',
  'bt709',
  'fcc',
  'bt470bg',
  'smpte170m',
  'smpte240m',
  'ycgco',
  'bt2020nc',
  'bt2020c',
  'smpte2085',
  'chroma-derived-nc',
  'chroma-derived-c',
  'ictcp',
]);
/** The matrix from "yuv420p(tv, bt709, progressive)" or "…(pc, bt709/bt709/iec61966-2-1)". */
function colorMatrix(description: string): string | null {
  const details = /,\s*\w+\(([^()]*)\)/.exec(description)?.[1] ?? '';
  for (const token of details.split(',')) {
    const matrix = token.trim().split('/')[0]!;
    if (COLOR_SPACES.has(matrix)) return matrix;
  }
  return null;
}

function parseVideo(block: StreamBlock): ProbedVideoStream | null {
  if (/\(attached pic\)/.test(block.description)) return null;
  const sar = /\bSAR (\d+):(\d+)/.exec(block.description);
  const fields = stripParentheses(block.description)
    .split(',')
    .map((field) => field.trim());
  const codec = /^[\w-]+/.exec(fields[0] ?? '')?.[0] ?? 'unknown';
  let width = 0;
  let height = 0;
  let fps: number | null = null;
  let tbr: number | null = null;
  for (const field of fields) {
    const size = /^(\d+)x(\d+)(?:\s|$)/.exec(field);
    if (size && !width) {
      width = Number(size[1]);
      height = Number(size[2]);
    }
    const rate = /^(\S+) (fps|tbr)$/.exec(field);
    if (rate?.[2] === 'fps') fps ??= parseRate(rate[1]);
    if (rate?.[2] === 'tbr') tbr ??= parseRate(rate[1]);
  }
  if (!width || !height) return null;
  const codedHeight = height;
  // Non-square pixels: show the clip at its display aspect, as players do.
  if (sar) {
    const ratio = Number(sar[1]) / Number(sar[2]);
    if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) > 1e-3)
      width = Math.max(1, Math.round(width * ratio));
  }
  let rotation = 0;
  for (const detail of block.details) {
    const matrix = /display ?matrix: rotation of (-?\d+(?:\.\d+)?) degrees/i.exec(detail);
    const tag = /^rotate\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(detail);
    const degrees = matrix ? -Number(matrix[1]) : tag ? Number(tag[1]) : null;
    // ffmpeg reports the display matrix counter-clockwise; the rotate tag is clockwise.
    if (degrees !== null) rotation = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  }
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  // A bare "1k tbr" comes from variable-rate recordings; fall back to a common rate.
  const rate = fps ?? (tbr !== null && tbr <= 240 ? tbr : 30);
  return {
    width,
    height,
    fps: normalizeFps(rate),
    codec,
    rotation,
    codedHeight,
    colorMatrix: colorMatrix(block.description),
  };
}

function parseAudio(block: StreamBlock): ProbedAudioStream | null {
  const fields = stripParentheses(block.description)
    .split(',')
    .map((field) => field.trim());
  const codec = /^[\w-]+/.exec(fields[0] ?? '')?.[0] ?? 'unknown';
  const rateIndex = fields.findIndex((field) => /^\d+ Hz$/.test(field));
  if (rateIndex < 0) return null;
  const sampleRate = Number.parseInt(fields[rateIndex]!, 10);
  if (!sampleRate) return null;
  return { sampleRate, channels: channelCount(fields[rateIndex + 1]), codec };
}

/** Parse what `ffmpeg -hide_banner -i <file>` prints about the first input. */
export function parseFfmpegProbe(stderr: string): ProbedMedia {
  const lines = stderr.split(/\r?\n/);
  const start = lines.findIndex((line) => /^Input #0\b/.test(line));
  if (start < 0) {
    const last = lines
      .map((line) => line.trim())
      .filter((line) => line && !/output file must be specified/i.test(line))
      .pop();
    // "C:\clip.mp4: Invalid data found when processing input" → the reason only.
    const reason = last ? (/: ([^:]+)$/.exec(last)?.[1] ?? last) : 'ffmpeg could not read it';
    return { duration: null, video: null, audio: null, error: reason.trim() };
  }
  const end = lines.findIndex((line, index) => index > start && /^[^\s[]/.test(line));
  const input = lines.slice(start + 1, end < 0 ? undefined : end);
  let duration: number | null = null;
  for (const line of input) {
    const match = /^\s*Duration: ([^,]+)/.exec(line);
    if (match) {
      duration = parseClock(match[1]!);
      break;
    }
  }
  let video: ProbedVideoStream | null = null;
  let audio: ProbedAudioStream | null = null;
  let tagged = 0;
  for (const block of streamBlocks(input)) {
    if (block.kind === 'Video') video ??= parseVideo(block);
    if (block.kind === 'Audio') audio ??= parseAudio(block);
    // Matroska writers without a container duration still tag each stream.
    for (const detail of block.details) {
      const match = /^DURATION\s*:\s*(\S+)$/i.exec(detail);
      const seconds = match ? parseClock(match[1]!) : null;
      if (seconds !== null) tagged = Math.max(tagged, seconds);
    }
  }
  if ((duration === null || duration <= 0) && tagged > 0) duration = tagged;
  return { duration: duration && duration > 0 ? duration : null, video, audio, error: null };
}

/** Read the final `out_time_us` from `-progress pipe:1` output. */
export function parseProgressDuration(stdout: string): number | null {
  let last: number | null = null;
  for (const match of stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)) last = Number(match[1]) / 1e6;
  return last && last > 0 ? last : null;
}

/** ffmpeg rate syntax for a frame rate, exact for integer and NTSC rates. */
export function fpsRational(fps: number): string {
  if (Number.isInteger(fps)) return `${fps}/1`;
  const ntsc = fps * 1.001;
  if (Math.abs(ntsc - Math.round(ntsc)) < 1e-6) return `${Math.round(ntsc) * 1000}/1001`;
  const numerator = Math.round(fps * 1000);
  let a = numerator;
  let b = 1000;
  while (b) [a, b] = [b, a % b];
  return `${numerator / a}/${1000 / a}`;
}

/** Fit a frame inside maxDimension without upscaling, keeping the aspect ratio. */
export function fitFrameSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** ffmpeg reads paths that look like URLs ("concat:", "http:") as protocols; force a file. */
export function ffmpegInput(path: string): string {
  return `file:${path}`;
}

export interface FrameReaderOptions {
  readonly lowMemory?: boolean;
  /** Timeline time of frame 0, in media seconds. */
  readonly start: number;
  readonly fps: number;
  readonly count: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The YUV matrix Chromium's player uses, so exported frames match the preview:
 * the file's tag when present, otherwise BT.601 below 720 lines and BT.709 from 720 up.
 */
export function sourceColorMatrix(
  video: Pick<ProbedVideoStream, 'colorMatrix' | 'codedHeight'>,
): string {
  if (video.colorMatrix) return 'auto';
  return video.codedHeight < 720 ? 'bt601' : 'bt709';
}

/**
 * Exact-frame RGBA decode. Frame N is the source frame on screen at time
 * start + N/fps (the last frame whose timestamp is at or before it), the same
 * rule <video> uses after a seek.
 */
export function videoReaderArgs(
  path: string,
  options: FrameReaderOptions,
  colorMatrixName = 'auto',
): string[] {
  // Decode from a little earlier so the frame already showing at `start` is
  // available to the fps filter, which then picks one frame per output tick.
  const seek = Math.max(0, options.start - 1);
  // ffmpeg parses -ss to whole microseconds; shift by exactly what remains.
  const seekText = seek.toFixed(6);
  const margin = options.start - Number(seekText);
  const filters = [
    // Microsecond timestamps first: setpts truncates to the stream timebase (10 ms for GIF).
    'settb=AVTB',
    `setpts=PTS-${((margin + FRAME_EPSILON) * 1e6).toFixed(3)}`,
    `fps=fps=${fpsRational(options.fps)}:start_time=0:round=up`,
    // Accurate rounding and full chroma keep colors within a level of Chromium's.
    `scale=${options.width}:${options.height}:flags=bicubic+accurate_rnd+full_chroma_int:in_color_matrix=${colorMatrixName}`,
    'format=rgba',
  ];
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    ...(options.lowMemory ? ['-threads', '1', '-filter_threads', '1'] : []),
    ...(seek > 0 ? ['-ss', seekText] : []),
    '-i',
    ffmpegInput(path),
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    filters.join(','),
    '-frames:v',
    String(options.count),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ];
}

/**
 * Copy a video file's first audio stream into a small stereo AAC file for
 * preview playback, so the audio player doesn't also stream the video data.
 * Fast start puts the index first so playback can begin right away.
 */
export function audioProxyArgs(path: string, output: string): string[] {
  return [
    ...['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'],
    ...['-i', ffmpegInput(path)],
    ...['-map', '0:a:0', '-vn', '-sn', '-dn'],
    ...['-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k'],
    ...['-movflags', '+faststart', '-f', 'mp4', ffmpegInput(output)],
  ];
}

/** Mono float32 PCM for analysis, capped at maxSeconds. */
export function audioSampleArgs(
  path: string,
  sampleRate = AUDIO_SAMPLE_RATE,
  maxSeconds = MAX_AUDIO_SAMPLE_SECONDS,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    ffmpegInput(path),
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-t',
    String(maxSeconds),
    '-f',
    'f32le',
    'pipe:1',
  ];
}

/** Stream-copies one stream to nowhere to measure a file whose header has no duration. */
export function measureDurationArgs(path: string, kind: 'video' | 'audio'): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    ffmpegInput(path),
    '-map',
    kind === 'video' ? '0:V:0' : '0:a:0',
    '-c',
    'copy',
    '-f',
    'null',
    '-progress',
    'pipe:1',
    '-nostats',
    '-',
  ];
}
