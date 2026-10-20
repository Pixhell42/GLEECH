// Pure ffmpeg argument builders for movie, audio and loop (GIF tab) encodes.
// Type-only imports keep this runnable without a bundler.
import type {
  AudioOutput,
  Compression,
  EncoderAdvanced,
  EncoderChoice,
  GifRenderSettings,
  MediaInput,
  VideoRenderSettings,
} from '../shared/render';
import type { MovieContainer, ResolvedMovie, VideoCodec } from '../shared/render-presets';

const HARDWARE = /_(nvenc|amf|qsv|mf|videotoolbox|vaapi)$/;

export function isHardwareEncoder(name: string): boolean {
  return HARDWARE.test(name);
}

/** Video encoders to try for a codec, best first, limited to those ffmpeg has. */
export function videoEncoderCandidates(
  codec: VideoCodec,
  choice: EncoderChoice,
  encoders: readonly string[],
  platform: string,
): string[] {
  const available = (names: readonly string[]) => [
    ...new Set(names.filter((name) => encoders.includes(name))),
  ];
  switch (codec) {
    case 'h264':
    case 'hevc': {
      const cpu = codec === 'h264' ? 'libx264' : 'libx265';
      const families =
        platform === 'win32'
          ? ['nvenc', 'amf', 'qsv', 'mf']
          : platform === 'darwin'
            ? ['videotoolbox']
            : ['nvenc', 'qsv'];
      const hardware = families.map((family) => `${codec}_${family}`);
      const forced = choice === 'auto' || choice === 'cpu' ? [] : [`${codec}_${choice}`];
      return available([...forced, cpu, ...hardware, ...(codec === 'h264' ? ['libopenh264'] : [])]);
    }
    case 'prores':
      return available(['prores_ks', 'prores']);
    case 'vp9':
      return available(['libvpx-vp9']);
    default:
      return available([codec]);
  }
}

/** A tiny encode that proves a hardware encoder actually works on this PC. */
export function hardwareProbeArgs(encoder: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:r=30:d=0.2',
    '-pix_fmt',
    'nv12',
    '-c:v',
    encoder,
    '-f',
    'null',
    '-',
  ];
}

/** ffmpeg frame-rate text; NTSC rates become exact rationals. */
export function formatRate(fps: number): string {
  for (const base of [24, 30, 60, 120]) {
    if (Math.abs(fps - (base * 1000) / 1001) < 0.002) return `${base * 1000}/1001`;
  }
  return Number.isInteger(fps) ? String(fps) : String(Math.round(fps * 1000) / 1000);
}

function seconds(value: number): string {
  return String(Math.max(0, Math.round(value * 1000) / 1000));
}

const CRF: Record<Exclude<Compression, 'lossless' | 'raw'>, number> = {
  highest: 14,
  high: 18,
  web: 22,
  small: 28,
};
/** Measured H.264 Mbps at 1080p30 (6 s clip), for bitrate-only encoders. */
const MBPS_1080P: Record<Exclude<Compression, 'lossless' | 'raw'>, number> = {
  highest: 20.4,
  high: 14.4,
  web: 10.3,
  small: 7.3,
};

function lossyCompression(compression: Compression): Exclude<Compression, 'lossless' | 'raw'> {
  return compression === 'lossless' || compression === 'raw' ? 'high' : compression;
}

function targetBitrate(
  codec: 'h264' | 'hevc',
  compression: Compression,
  width: number,
  height: number,
): string {
  const key = lossyCompression(compression);
  let mbps = MBPS_1080P[key] * Math.pow((width * height) / (1920 * 1080), 0.7);
  if (codec === 'hevc') mbps *= 0.8;
  if (key === 'web') mbps = Math.min(mbps, 10);
  return `${Math.max(0.5, Math.round(mbps * 10) / 10)}M`;
}

function h264Level(width: number, height: number): string {
  const pixels = width * height;
  if (pixels <= 2048 * 1088) return '4.2';
  if (pixels <= 4096 * 2304) return '5.2';
  return '6.2';
}

interface LossyOptions {
  readonly codec: 'h264' | 'hevc';
  readonly encoder: string;
  readonly compression: Compression;
  readonly crf: number;
  readonly advanced: EncoderAdvanced;
  readonly width: number;
  readonly height: number;
  readonly container: MovieContainer;
}

/** Pixel format for an H.264/HEVC encoder at a color depth. */
function lossyPixFmt(options: LossyOptions): string {
  const tenBit = options.advanced.colorDepth === 10;
  if (options.encoder.startsWith('lib')) {
    if (options.encoder === 'libopenh264') return 'yuv420p';
    return tenBit ? 'yuv420p10le' : 'yuv420p';
  }
  // Hardware H.264 encoders are 8-bit; HEVC ones take P010 for 10-bit, except
  // AMF, which tags 10-bit output as HDR (BT.2020/PQ).
  return tenBit && options.codec === 'hevc' && !options.encoder.endsWith('_amf')
    ? 'p010le'
    : 'nv12';
}

function lossyArgs(options: LossyOptions): string[] {
  const { encoder, codec, compression, advanced, crf } = options;
  const web = compression === 'web';
  const tenBit = lossyPixFmt(options).includes('10');
  const pixFmt = lossyPixFmt(options);
  const cap = web ? ['-maxrate', '12M', '-bufsize', '24M'] : [];
  const gop = advanced.keyframeInterval > 0 ? ['-g', String(advanced.keyframeInterval)] : [];
  const tag = codec === 'hevc' && options.container !== 'mkv' ? ['-tag:v', 'hvc1'] : [];
  const args: string[] = ['-c:v', encoder];
  if (encoder === 'libx264') {
    const profile = tenBit ? 'high10' : compression === 'small' ? 'main' : 'high';
    args.push('-preset', advanced.speed, '-crf', String(crf), '-profile:v', profile);
    if (web) args.push('-level:v', h264Level(options.width, options.height));
  } else if (encoder === 'libx265') {
    args.push('-preset', advanced.speed, '-crf', String(crf), '-x265-params', 'log-level=error');
  } else if (encoder.endsWith('_nvenc')) {
    const preset = { slow: 'p6', medium: 'p5', fast: 'p3' }[advanced.speed];
    args.push('-preset', preset, '-tune', 'hq', '-rc', 'vbr', '-cq', String(crf + 1), '-b:v', '0');
    // Without an explicit ceiling NVENC quietly caps the bitrate and CQ stops scaling.
    if (!web) args.push('-maxrate', '250M', '-bufsize', '500M');
    args.push('-profile:v', codec === 'h264' ? 'high' : tenBit ? 'main10' : 'main');
  } else if (encoder.endsWith('_amf')) {
    const quality = { slow: 'quality', medium: 'balanced', fast: 'speed' }[advanced.speed];
    args.push('-quality', quality, '-profile:v', codec === 'h264' ? 'high' : 'main');
    if (web) args.push('-rc', 'vbr_peak', '-b:v', '8M');
    else args.push('-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf + 2));
  } else if (encoder.endsWith('_qsv')) {
    const preset = { slow: 'slower', medium: 'medium', fast: 'faster' }[advanced.speed];
    args.push('-preset', preset);
    if (web) args.push('-b:v', '8M');
    else args.push('-global_quality', String(crf + 2));
  } else if (encoder.endsWith('_mf')) {
    // Media Foundation: quality 0–100, higher is better; 100 = H.264 High profile.
    if (codec === 'h264') args.push('-profile:v', '100');
    if (web) args.push('-rate_control', 'pc_vbr', '-b:v', '8M');
    else
      args.push(
        '-rate_control',
        'quality',
        '-quality',
        String(Math.round(Math.min(100, Math.max(1, 100 - (crf - 10) * 3)))),
      );
  } else {
    // VideoToolbox, OpenH264: average bitrate from the measured sizes.
    args.push('-b:v', targetBitrate(codec, compression, options.width, options.height));
    if (encoder.endsWith('_videotoolbox')) {
      args.push('-allow_sw', '1');
      if (tenBit) args.push('-profile:v', 'main10');
    }
  }
  args.push('-pix_fmt', pixFmt, ...cap, ...gop, ...tag);
  return args;
}

const YUV_TAGS = [
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
];

interface CodecPlan {
  readonly args: string[];
  /** Pixel format the filter graph converts to. */
  readonly pixFmt: string;
  readonly yuv: boolean;
}

function videoCodecPlan(
  settings: VideoRenderSettings,
  output: ResolvedMovie,
  encoder: string,
  width: number,
  height: number,
): CodecPlan {
  const { advanced } = settings;
  const tenBit = advanced.colorDepth === 10;
  const gop = advanced.keyframeInterval > 0 ? ['-g', String(advanced.keyframeInterval)] : [];
  switch (output.codec) {
    case 'h264':
    case 'hevc': {
      const options: LossyOptions = {
        codec: output.codec,
        encoder,
        compression: settings.compression,
        crf: CRF[lossyCompression(settings.compression)],
        advanced,
        width,
        height,
        container: output.container,
      };
      return { args: lossyArgs(options), pixFmt: lossyPixFmt(options), yuv: true };
    }
    case 'prores': {
      const profile = output.proresProfile ?? 3;
      const pixFmt = output.alpha ? 'yuva444p10le' : profile >= 4 ? 'yuv444p10le' : 'yuv422p10le';
      const args = ['-c:v', encoder, '-profile:v', String(profile), '-pix_fmt', pixFmt];
      if (encoder === 'prores_ks') {
        args.push('-vendor', 'apl0');
        if (output.alpha) args.push('-alpha_bits', '16');
      }
      return { args, pixFmt, yuv: true };
    }
    case 'ffv1': {
      // RGB modes are bit-exact with the 8-bit render; 10-bit widens exactly.
      const pixFmt = output.alpha ? (tenBit ? 'gbrap10le' : 'bgra') : tenBit ? 'gbrp10le' : 'bgr0';
      return {
        args: [
          '-c:v',
          'ffv1',
          '-level',
          '3',
          '-coder',
          '1',
          '-context',
          '1',
          '-g',
          '1',
          '-slices',
          '16',
          '-slicecrc',
          '1',
          '-pix_fmt',
          pixFmt,
        ],
        pixFmt,
        yuv: false,
      };
    }
    case 'v210':
      return {
        args: ['-c:v', 'v210', '-pix_fmt', 'yuv422p10le'],
        pixFmt: 'yuv422p10le',
        yuv: true,
      };
    case 'png': {
      const pixFmt = output.alpha ? 'rgba' : 'rgb24';
      return { args: ['-c:v', 'png', '-pred', 'mixed', '-pix_fmt', pixFmt], pixFmt, yuv: false };
    }
    case 'rawvideo':
      return { args: ['-c:v', 'rawvideo', '-pix_fmt', 'argb'], pixFmt: 'argb', yuv: false };
    case 'vp9': {
      const key = lossyCompression(settings.compression);
      const crf = { highest: 15, high: 24, web: 31, small: 40 }[key];
      const pixFmt = output.alpha ? 'yuva420p' : tenBit ? 'yuv420p10le' : 'yuv420p';
      const cpuUsed = { slow: '1', medium: '2', fast: '4' }[advanced.speed];
      return {
        args: [
          '-c:v',
          encoder,
          '-crf',
          String(crf),
          '-b:v',
          key === 'web' ? '12M' : '0',
          '-deadline',
          'good',
          '-cpu-used',
          cpuUsed,
          '-row-mt',
          '1',
          '-pix_fmt',
          pixFmt,
          ...gop,
        ],
        pixFmt,
        yuv: true,
      };
    }
  }
}

/** Chroma-subsampled formats need even sizes. */
function subsampled(pixFmt: string): boolean {
  return /^(yuva?42[02]|nv12|p010)/.test(pixFmt);
}

/** RGB(A) → target pixel format, cropping a stray odd row/column for 4:2:x. */
function convertFilters(
  plan: Pick<CodecPlan, 'pixFmt' | 'yuv'>,
  width: number,
  height: number,
): string[] {
  const filters: string[] = [];
  if (subsampled(plan.pixFmt) && (width % 2 || height % 2))
    filters.push(`crop=${width - (width % 2)}:${height - (height % 2)}:0:0`);
  if (plan.yuv) filters.push('scale=out_color_matrix=bt709:out_range=tv');
  filters.push(`format=${plan.pixFmt}`);
  return filters;
}

// ---------------------------------------------------------------------------
// Audio

export interface AudioPlan {
  readonly inputs: string[];
  /** filter_complex fragment ending in [aout]. */
  readonly filter: string;
}

/** Speed change for audio; atempo takes 0.5–2 per instance. */
export function atempoChain(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0001) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.4999) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0001)
    filters.push(`atempo=${Math.round(remaining * 10000) / 10000}`);
  return filters;
}

/**
 * Audio inputs and filters: the chosen source(s) cut to the render range,
 * set to their track level, mixed, faded, normalized to −14 LUFS when asked and resampled to 48 kHz.
 * `duration` is the output length; `tempo` speeds the audio up to match.
 */
export function audioPlan(options: {
  readonly audio: Pick<AudioOutput, 'source' | 'normalize' | 'fadeIn' | 'fadeOut'>;
  readonly track?: MediaInput | undefined;
  readonly clip?: MediaInput | undefined;
  readonly duration: number;
  readonly firstInput: number;
  readonly tempo?: number;
}): AudioPlan | null {
  const { audio, track, clip, duration, firstInput } = options;
  const tempo = options.tempo ?? 1;
  // A missing source falls back to the other one.
  const chosen =
    audio.source === 'mix'
      ? [track, clip]
      : [audio.source === 'clip' ? (clip ?? track) : (track ?? clip)];
  const sources = chosen.filter((input): input is MediaInput => !!input);
  if (!sources.length || duration <= 0) return null;
  const inputs: string[] = [];
  const parts: string[] = [];
  sources.forEach((source, index) => {
    const length = Math.min(source.duration > 0 ? source.duration : Infinity, duration * tempo);
    inputs.push('-ss', seconds(source.start));
    if (Number.isFinite(length)) inputs.push('-t', seconds(length));
    inputs.push('-i', source.path);
    const level =
      source.volume !== undefined && source.volume < 1
        ? `,volume=${Math.round(source.volume * 10000) / 10000}`
        : '';
    parts.push(
      `[${firstInput + index}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${level}[a${index}]`,
    );
  });
  let current = 'a0';
  if (sources.length > 1) {
    parts.push(`[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[amix]`);
    current = 'amix';
  }
  const chain = [...atempoChain(tempo)];
  if (audio.fadeIn > 0)
    chain.push(`afade=t=in:st=0:d=${seconds(Math.min(audio.fadeIn, duration))}`);
  if (audio.fadeOut > 0) {
    const fade = Math.min(audio.fadeOut, duration);
    chain.push(`afade=t=out:st=${seconds(duration - fade)}:d=${seconds(fade)}`);
  }
  if (audio.normalize) chain.push('loudnorm=I=-14:TP=-1.5:LRA=11', 'aresample=48000');
  chain.push(`atrim=0:${seconds(duration)}`);
  parts.push(`[${current}]${chain.join(',')}[aout]`);
  return { inputs, filter: parts.join(';') };
}

function audioCodecArgs(
  audio: Pick<AudioOutput, 'codec' | 'bitrateKbps'>,
  container: MovieContainer,
  encoders: readonly string[],
): string[] {
  const bitrate = `${Math.max(32, Math.round(audio.bitrateKbps || 256))}k`;
  const opus = () =>
    encoders.includes('libopus')
      ? ['-c:a', 'libopus', '-b:a', bitrate]
      : ['-c:a', 'opus', '-strict', '-2', '-b:a', bitrate];
  if (container === 'webm') return opus();
  if (audio.codec === 'pcm' && container !== 'mp4') return ['-c:a', 'pcm_s24le', '-ar', '48000'];
  if (audio.codec === 'opus' && container === 'mkv') return opus();
  return ['-c:a', 'aac', '-b:a', bitrate, '-ar', '48000'];
}

// ---------------------------------------------------------------------------
// Movies

export interface VideoArgsInput {
  readonly settings: VideoRenderSettings;
  readonly output: ResolvedMovie;
  /** Size of the RGBA frames written to stdin (already fitted). */
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  /** One of videoEncoderCandidates(). */
  readonly encoder: string;
  readonly encoders: readonly string[];
  readonly audio?: MediaInput | undefined;
  readonly clipAudio?: MediaInput | undefined;
  readonly outputPath: string;
}

export function buildVideoArgs(input: VideoArgsInput): string[] {
  const { settings, output, width, height } = input;
  const plan = videoCodecPlan(settings, output, input.encoder, width, height);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${width}x${height}`,
    '-r',
    formatRate(input.fps),
    '-i',
    'pipe:0',
  ];
  const duration = input.frameCount / input.fps;
  const audio = settings.audio.enabled
    ? audioPlan({
        audio: settings.audio,
        track: input.audio,
        clip: input.clipAudio,
        duration,
        firstInput: 1,
      })
    : null;
  if (audio) args.push(...audio.inputs);
  const graph = [`[0:v]${convertFilters(plan, width, height).join(',')}[vout]`];
  if (audio) graph.push(audio.filter);
  args.push('-filter_complex', graph.join(';'), '-map', '[vout]');
  if (audio) args.push('-map', '[aout]');
  args.push(...plan.args);
  if (plan.yuv) args.push(...YUV_TAGS);
  if (audio) args.push(...audioCodecArgs(settings.audio, output.container, input.encoders));
  // Video arrives slowly from the GPU; let audio packets queue meanwhile.
  args.push('-max_muxing_queue_size', '9999');
  const interFrame = output.codec === 'h264' || output.codec === 'hevc';
  if (interFrame && output.container !== 'mkv' && settings.advanced.fastStart)
    args.push('-movflags', '+faststart');
  args.push('-f', output.container === 'mkv' ? 'matroska' : output.container, input.outputPath);
  return args;
}

/** 24-bit WAV of the render range, for image sequences. */
export function buildAudioFileArgs(input: {
  readonly audio: Pick<AudioOutput, 'source' | 'normalize' | 'fadeIn' | 'fadeOut'>;
  readonly track?: MediaInput | undefined;
  readonly clip?: MediaInput | undefined;
  readonly duration: number;
  readonly outputPath: string;
}): string[] | null {
  const plan = audioPlan({ ...input, firstInput: 0 });
  if (!plan) return null;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...plan.inputs,
    '-filter_complex',
    plan.filter,
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s24le',
    '-ar',
    '48000',
    '-f',
    'wav',
    input.outputPath,
  ];
}

// ---------------------------------------------------------------------------
// Loops (GIF & Loops tab)

export interface LoopOverrides {
  readonly width?: number;
  readonly fps?: number;
  readonly colors?: number;
  /** WebP quality 0–100. */
  readonly quality?: number;
  /** MP4 CRF. */
  readonly crf?: number;
}

export interface LoopArgsInput {
  readonly settings: GifRenderSettings;
  /** Raw RGBA spool of every frame, in order. */
  readonly inputPath: string;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly inputFps: number;
  readonly frameCount: number;
  readonly outputPath: string;
  readonly encoders: readonly string[];
  /** MP4 loops: H.264 encoder from videoEncoderCandidates(). */
  readonly mp4Encoder?: string;
  readonly audio?: MediaInput | undefined;
  readonly overrides?: LoopOverrides;
}

export const LOOP_DEFAULTS = { webpQuality: 75, mp4Crf: 23 } as const;

const SCALE_FLAGS = { lanczos: 'lanczos', bicubic: 'bicubic', nearest: 'neighbor' } as const;
const DITHER = {
  none: 'dither=none',
  bayer: 'dither=bayer:bayer_scale=3',
  'floyd-steinberg': 'dither=floyd_steinberg',
  sierra: 'dither=sierra2_4a',
} as const;

/** Muxer repeat flags; gif counts extra loops, webp and apng count plays. */
export function loopRepeatArgs(
  format: GifRenderSettings['format'],
  repeat: GifRenderSettings['repeat'],
): string[] {
  if (format === 'gif') return ['-loop', { forever: '0', once: '-1', '3': '2' }[repeat]];
  if (format === 'webp') return ['-loop', { forever: '0', once: '1', '3': '3' }[repeat]];
  if (format === 'apng') return ['-plays', { forever: '0', once: '1', '3': '3' }[repeat]];
  return [];
}

/** Frames in the loop after the loop style (before speed and frame rate). */
export function loopStyleFrames(loop: GifRenderSettings['loop'], frames: number): number {
  return loop === 'boomerang' && frames > 2 ? frames * 2 - 2 : frames;
}

/** Output size for a width override, keeping aspect; MP4 sizes are even. */
export function loopSize(
  input: Pick<LoopArgsInput, 'inputWidth' | 'inputHeight' | 'settings' | 'overrides'>,
): { width: number; height: number } {
  const target = input.overrides?.width ?? input.inputWidth;
  let width = Math.max(2, Math.round(target));
  let height = Math.max(2, Math.round((width * input.inputHeight) / input.inputWidth));
  if (input.settings.format === 'mp4') {
    width -= width % 2;
    height -= height % 2;
  }
  return { width, height };
}

export function buildLoopArgs(input: LoopArgsInput): string[] {
  const { settings, overrides = {} } = input;
  const fps = overrides.fps ?? settings.fps;
  const colors = Math.round(Math.min(256, Math.max(2, overrides.colors ?? settings.colors)));
  const alpha = settings.transparent && settings.format !== 'mp4';
  const size = loopSize(input);
  const parts: string[] = [];
  let current = '0:v';
  let label = 0;
  const chain = (filters: readonly string[]) => {
    if (!filters.length) return;
    const next = `v${label++}`;
    parts.push(`[${current}]${filters.join(',')}[${next}]`);
    current = next;
  };

  if (size.width !== input.inputWidth || size.height !== input.inputHeight)
    chain([`scale=${size.width}:${size.height}:flags=${SCALE_FLAGS[settings.scaling]}`]);

  // Loop style on the source-rate frames, where the frame count is exact.
  if (settings.loop === 'reverse') chain(['reverse']);
  else if (settings.loop === 'boomerang' && input.frameCount > 2) {
    parts.push(`[${current}]split[fwd][back]`);
    parts.push(
      `[back]reverse,trim=start_frame=1:end_frame=${input.frameCount - 1},setpts=PTS-STARTPTS[rev]`,
    );
    parts.push('[fwd][rev]concat=n=2:v=1:a=0[boom]');
    current = 'boom';
  }

  const speed = Math.min(4, Math.max(0.25, settings.speed));
  const timing: string[] = [];
  if (Math.abs(speed - 1) > 0.001) timing.push(`setpts=PTS/${Math.round(speed * 10000) / 10000}`);
  const effective = input.inputFps * speed;
  if (settings.smoothing !== 'off' && effective < fps * 0.99) {
    // Fill in frames: crossfade, or motion-interpolate (no alpha support there).
    if (alpha) {
      chain(timing);
      parts.push(`[${current}]split[col][alp]`);
      parts.push(`[alp]alphaextract,framerate=fps=${fps}[alpf]`);
      parts.push(`[col]framerate=fps=${fps}[colf]`);
      parts.push('[colf][alpf]alphamerge[smooth]');
      current = 'smooth';
    } else
      chain([
        ...timing,
        settings.smoothing === 'motion'
          ? `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
          : `framerate=fps=${fps}`,
      ]);
  } else {
    // Dropping frames: blend neighbours first so motion stays smooth.
    const blend = settings.smoothing !== 'off' && effective >= fps * 1.5;
    chain([...timing, ...(blend ? ['tblend=all_mode=average'] : []), `fps=${fps}`]);
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${input.inputWidth}x${input.inputHeight}`,
    '-r',
    formatRate(input.inputFps),
    '-i',
    input.inputPath,
  ];

  if (settings.format === 'gif') {
    const stats = { whole: 'full', frame: 'single', changes: 'diff' }[settings.palette];
    const use: string[] = [DITHER[settings.dither]];
    if (settings.palette === 'frame') use.push('new=1');
    if (settings.palette === 'changes') use.push('diff_mode=rectangle');
    if (alpha) use.push('alpha_threshold=128');
    parts.push(`[${current}]split[pa][pb]`);
    parts.push(
      `[pa]palettegen=max_colors=${colors}:stats_mode=${stats}:reserve_transparent=${alpha ? 1 : 0}[pal]`,
    );
    parts.push(`[pb][pal]paletteuse=${use.join(':')}[out]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[out]');
    args.push('-c:v', 'gif', ...loopRepeatArgs('gif', settings.repeat), '-f', 'gif');
  } else if (settings.format === 'webp') {
    // libwebp converts from RGB itself; opaque frames simply carry alpha 255.
    chain(['format=bgra']);
    const encoder = input.encoders.includes('libwebp_anim') ? 'libwebp_anim' : 'libwebp';
    args.push('-filter_complex', parts.join(';'), '-map', `[${current}]`);
    args.push(
      '-c:v',
      encoder,
      '-lossless',
      '0',
      '-quality',
      String(overrides.quality ?? LOOP_DEFAULTS.webpQuality),
      '-compression_level',
      '4',
      '-pix_fmt',
      'bgra',
      ...loopRepeatArgs('webp', settings.repeat),
      '-f',
      'webp',
    );
  } else if (settings.format === 'apng') {
    const pixFmt = alpha ? 'rgba' : 'rgb24';
    chain([`format=${pixFmt}`]);
    args.push('-filter_complex', parts.join(';'), '-map', `[${current}]`);
    args.push(
      '-c:v',
      'apng',
      '-pred',
      'mixed',
      '-pix_fmt',
      pixFmt,
      ...loopRepeatArgs('apng', settings.repeat),
      '-f',
      'apng',
    );
  } else {
    const encoder = input.mp4Encoder ?? 'libx264';
    const crf = overrides.crf ?? LOOP_DEFAULTS.mp4Crf;
    const options: LossyOptions = {
      codec: 'h264',
      encoder,
      compression: crf >= 26 ? 'small' : 'high',
      crf,
      advanced: {
        encoder: 'auto',
        colorDepth: 8,
        keyframeInterval: Math.round(fps * 2),
        speed: 'slow',
        fastStart: true,
      },
      width: size.width,
      height: size.height,
      container: 'mp4',
    };
    chain(convertFilters({ pixFmt: lossyPixFmt(options), yuv: true }, size.width, size.height));
    const loopSeconds = loopStyleFrames(settings.loop, input.frameCount) / effective;
    const audio = settings.audio
      ? audioPlan({
          audio: { source: 'track', normalize: false, fadeIn: 0, fadeOut: 0 },
          track: input.audio,
          duration: loopSeconds,
          firstInput: 1,
          tempo: speed,
        })
      : null;
    if (audio) {
      args.push(...audio.inputs);
      parts.push(audio.filter);
    }
    args.push('-filter_complex', parts.join(';'), '-map', `[${current}]`);
    if (audio) args.push('-map', '[aout]');
    args.push(...lossyArgs(options), ...YUV_TAGS);
    if (audio) args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
    args.push('-movflags', '+faststart', '-f', 'mp4');
  }
  args.push(input.outputPath);
  return args;
}

const FPS_STEPS = [30, 24, 15, 12, 10, 8];
function lowerFps(fps: number): number {
  return FPS_STEPS.find((step) => step < fps) ?? fps;
}

export interface LimitAttempt {
  readonly overrides: LoopOverrides;
  /** Predicted size relative to the first encode. */
  readonly factor: number;
}

/**
 * Progressively smaller encodes for "Keep file under": fewer colors, then a
 * lower frame rate, then a smaller width (quality/CRF for WebP and MP4).
 */
export function sizeLimitAttempts(settings: GifRenderSettings): LimitAttempt[] {
  const { width, fps, colors, format } = settings;
  const bits = (value: number) => Math.log2(Math.max(2, value));
  const fps1 = lowerFps(fps);
  const fps2 = lowerFps(fps1);
  const steps: LoopOverrides[] =
    format === 'gif'
      ? [
          { colors: Math.max(32, Math.round(colors * 0.5)) },
          { colors: Math.max(32, Math.round(colors * 0.5)), fps: fps1 },
          { colors: Math.max(24, Math.round(colors * 0.375)), fps: fps1, width: width * 0.8 },
          { colors: Math.max(16, Math.round(colors * 0.25)), fps: fps2, width: width * 0.65 },
          { colors: 16, fps: fps2, width: width * 0.5 },
        ]
      : format === 'webp'
        ? [
            { quality: 60 },
            { quality: 45, fps: fps1 },
            { quality: 35, fps: fps1, width: width * 0.8 },
            { quality: 25, fps: fps2, width: width * 0.65 },
            { quality: 20, fps: fps2, width: width * 0.5 },
          ]
        : format === 'mp4'
          ? [
              { crf: 27 },
              { crf: 31 },
              { crf: 33, width: width * 0.8 },
              { crf: 35, fps: fps1, width: width * 0.65 },
              { crf: 37, fps: fps2, width: width * 0.5 },
            ]
          : [
              { fps: fps1 },
              { fps: fps1, width: width * 0.8 },
              { fps: fps2, width: width * 0.65 },
              { fps: fps2, width: width * 0.5 },
            ];
  return steps.map((overrides) => {
    const area = Math.pow((overrides.width ?? width) / width, 2);
    const frames = (overrides.fps ?? fps) / fps;
    let factor = frames;
    if (format === 'gif')
      factor *= Math.pow(area, 0.7) * (bits(overrides.colors ?? colors) / bits(colors));
    else if (format === 'apng') factor *= area;
    else if (format === 'webp')
      factor *=
        Math.pow(area, 0.7) *
        Math.pow(0.75, (LOOP_DEFAULTS.webpQuality - (overrides.quality ?? 75)) / 15);
    else
      factor *=
        Math.pow(area, 0.7) * Math.pow(0.65, ((overrides.crf ?? 23) - LOOP_DEFAULTS.mp4Crf) / 4);
    return { overrides, factor };
  });
}

/** "64 → 32 colors, 12 → 10 fps, 240 → 192 px" for a size-limit note. */
export function describeOverrides(settings: GifRenderSettings, overrides: LoopOverrides): string {
  const parts: string[] = [];
  if (overrides.colors !== undefined && overrides.colors !== settings.colors)
    parts.push(`${settings.colors} → ${overrides.colors} colors`);
  if (overrides.fps !== undefined && overrides.fps !== settings.fps)
    parts.push(`${settings.fps} → ${overrides.fps} fps`);
  if (overrides.width !== undefined && Math.round(overrides.width) !== settings.width)
    parts.push(`${settings.width} → ${Math.round(overrides.width)} px`);
  if (overrides.quality !== undefined) parts.push(`quality ${overrides.quality}`);
  if (overrides.crf !== undefined) parts.push(`CRF ${overrides.crf}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Errors

const PROGRESS = /^(frame=|size=|video:|press \[q\]|input #|output #|stream mapping)/i;

/** Plain-language reason plus the last useful lines of ffmpeg's stderr. */
export function describeFfmpegError(stderr: string, code: number | null): string {
  const text = stderr.toLowerCase();
  const reasons: [RegExp, string][] = [
    [/no space left|enospc|disk full|there is not enough space/, 'The disk is full.'],
    [/permission denied|access is denied|eacces|eperm/, 'GLEECH can’t write to that location.'],
    [
      /cannot load nvcuda|no nvenc capable|openencodesessionex failed|nvenc.*(not available|unsupported)|driver does not support/,
      'The NVIDIA encoder isn’t available on this PC.',
    ],
    [
      /amf.*(failed|not supported|unavailable)|amfrt/,
      'The AMD encoder isn’t available on this PC.',
    ],
    [
      /(qsv|mfx|libvpl).*(error|failed|unsupported)/,
      'Intel Quick Sync isn’t available on this PC.',
    ],
    [
      /unknown encoder|encoder.*not found/,
      'This ffmpeg build is missing the encoder for this format.',
    ],
    [
      /could not find tag for codec|not currently supported in container/,
      'That codec can’t be stored in this container.',
    ],
    [/no such file or directory/, 'A file the render needed was missing.'],
    [/out of memory|cannot allocate memory|enomem/, 'ffmpeg ran out of memory.'],
  ];
  const reason =
    reasons.find(([pattern]) => pattern.test(text))?.[1] ??
    (code === null ? 'ffmpeg was stopped.' : `ffmpeg stopped with an error (code ${code}).`);
  const tail = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !PROGRESS.test(line))
    .slice(-3)
    .map((line) => (line.length > 240 ? line.slice(0, 237) + '…' : line));
  return tail.length ? `${reason} ffmpeg said: ${tail.join(' / ')}` : reason;
}
