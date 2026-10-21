// Render dialog presets, labels and size estimates. Pure: shared by the
// Render dialog (renderer) and the encoder service (main).
import type {
  AudioOutput,
  Compression,
  EncoderAdvanced,
  FitMode,
  GifPresetId,
  GifRenderSettings,
  LoopFormat,
  LoopStyle,
  OutputFrame,
  SequenceSettings,
  VideoFormat,
  VideoPresetId,
  VideoRenderSettings,
} from './render';

export interface SourceInfo {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

// ---------------------------------------------------------------------------
// Video presets

export interface VideoPreset {
  readonly id: VideoPresetId;
  readonly label: string;
  /** One line under the preset tile. */
  readonly hint: string;
  /** Output size; null for Custom (keeps the current size). */
  readonly width: number | null;
  readonly height: number | null;
  readonly format: VideoFormat;
  readonly compression: Compression;
  readonly audio: Pick<AudioOutput, 'codec' | 'bitrateKbps' | 'normalize'>;
  /** Audio quality line for the summary, e.g. "AAC · 256 kbps". */
  readonly audioLabel: string;
}

const aac = (kbps: number, normalize = false) => ({
  codec: 'aac' as const,
  bitrateKbps: kbps,
  normalize,
});
const pcm = { codec: 'pcm' as const, bitrateKbps: 0, normalize: false };

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  {
    id: '8k',
    label: '8K',
    hint: 'HEVC · 7680 × 4320',
    width: 7680,
    height: 4320,
    format: 'mp4-hevc',
    compression: 'highest',
    audio: aac(320),
    audioLabel: 'AAC · 320 kbps',
  },
  {
    id: '4k',
    label: '4K UHD',
    hint: 'HEVC · 3840 × 2160',
    width: 3840,
    height: 2160,
    format: 'mp4-hevc',
    compression: 'highest',
    audio: aac(320),
    audioLabel: 'AAC · 320 kbps',
  },
  {
    id: '2k-master',
    label: '2K Master',
    hint: 'HEVC · CRF 18',
    width: 2048,
    height: 1152,
    format: 'mp4-hevc',
    compression: 'high',
    audio: aac(320),
    audioLabel: 'AAC · 320 kbps',
  },
  {
    id: '1080p-social',
    label: '1080p Social',
    hint: 'H.264 · CRF 22',
    width: 1920,
    height: 1080,
    format: 'mp4-h264',
    compression: 'web',
    audio: aac(256, true),
    audioLabel: 'AAC · 256 kbps · −14 LUFS',
  },
  {
    id: 'vertical',
    label: 'Vertical 9:16',
    hint: 'Reels · TikTok',
    width: 1080,
    height: 1920,
    format: 'mp4-h264',
    compression: 'web',
    audio: aac(256, true),
    audioLabel: 'AAC · 256 kbps · −14 LUFS',
  },
  {
    id: 'draft',
    label: 'Half-res Draft',
    hint: 'Fast preview',
    width: 960,
    height: 540,
    format: 'mp4-h264',
    compression: 'small',
    audio: aac(128),
    audioLabel: 'AAC · 128 kbps',
  },
  {
    id: 'edit-master',
    label: 'Edit Master',
    hint: 'ProRes 422 HQ',
    width: 1920,
    height: 1080,
    format: 'mov-prores',
    compression: 'high',
    audio: pcm,
    audioLabel: 'PCM · 48 kHz 24-bit',
  },
  {
    id: '4k-edit-master',
    label: '4K Edit Master',
    hint: 'ProRes 422 HQ · 4K',
    width: 3840,
    height: 2160,
    format: 'mov-prores',
    compression: 'high',
    audio: pcm,
    audioLabel: 'PCM · 48 kHz 24-bit',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Any size · fit or crop',
    width: null,
    height: null,
    format: 'mp4-h264',
    compression: 'high',
    audio: aac(256),
    audioLabel: 'AAC · 256 kbps',
  },
];

export function videoPreset(id: VideoPresetId): VideoPreset {
  return (
    VIDEO_PRESETS.find((preset) => preset.id === id) ?? VIDEO_PRESETS[VIDEO_PRESETS.length - 1]!
  );
}

/** Aspect buttons for Custom size. */
export const CUSTOM_ASPECTS: readonly { label: string; width: number; height: number }[] = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '21:9', width: 2560, height: 1080 },
  { label: '4:3', width: 1440, height: 1080 },
];

export interface CompressionChoice {
  readonly id: Compression;
  readonly label: string;
  /** Plain-language hint shown under the segmented control. */
  readonly hint: string;
  /** What it does technically (spec table). */
  readonly detail: string;
}

export const COMPRESSION_CHOICES: readonly CompressionChoice[] = [
  {
    id: 'highest',
    label: 'Highest quality',
    hint: 'Visually perfect, for archiving or re-editing. Large files, slow encode.',
    detail: 'CRF 14 (or ProRes 4444 XQ), 10-bit, slow encode',
  },
  {
    id: 'high',
    label: 'High',
    hint: 'Excellent quality at a reasonable size. The default for masters.',
    detail: 'CRF 18 (or ProRes 422 HQ)',
  },
  {
    id: 'web',
    label: 'Web',
    hint: 'Plays everywhere (browsers, phones, social), starts playing instantly, and upload-friendly bitrate.',
    detail: 'H.264 High, CRF 22 capped at 12 Mbps, fast start',
  },
  {
    id: 'small',
    label: 'Small file',
    hint: 'For previews, drafts and chat. Visible softening on fine glitch detail.',
    detail: 'CRF 28',
  },
  {
    id: 'lossless',
    label: 'Lossless',
    hint: 'Identical to the render, but still compressed. Switches to FFV1 in an MKV (or the PNG codec in a MOV with alpha). Big files; best for handing off to another editor.',
    detail: 'FFV1 in MKV (PNG codec in MOV with alpha)',
  },
  {
    id: 'raw',
    label: 'Raw',
    hint: 'No compression at all: every pixel stored as-is in a MOV. Huge files (about 1 GB per 6 s at 1080p) and heavy to play back; use only when a tool needs uncompressed input.',
    detail: 'Uncompressed 10-bit 4:2:2 (v210) in MOV',
  },
];

export const VIDEO_FORMATS: readonly { id: VideoFormat; label: string; extension: string }[] = [
  { id: 'mp4-h264', label: 'MP4 · H.264', extension: 'mp4' },
  { id: 'mp4-hevc', label: 'MP4 · H.265 (HEVC)', extension: 'mp4' },
  { id: 'mov-prores', label: 'MOV · ProRes', extension: 'mov' },
  { id: 'mkv-ffv1', label: 'MKV · FFV1 (lossless)', extension: 'mkv' },
  { id: 'mov-v210', label: 'MOV · Uncompressed 10-bit 4:2:2', extension: 'mov' },
  { id: 'webm-vp9', label: 'WebM · VP9', extension: 'webm' },
  { id: 'mov-png', label: 'MOV · PNG (lossless)', extension: 'mov' },
];

export const FIT_MODES: readonly { id: FitMode; label: string }[] = [
  { id: 'fit', label: 'Fit' },
  { id: 'stretch', label: 'Stretch' },
  { id: 'crop', label: 'Crop' },
  { id: 'letterbox-h', label: 'Letterbox ═' },
  { id: 'letterbox-v', label: 'Letterbox ‖' },
];

/** Hint under the Fit control; mentions when a letterbox trims instead. */
export function fitHint(mode: FitMode, sourceAspect: number, targetAspect: number): string {
  switch (mode) {
    case 'fit':
      return 'Shows the whole picture at the largest size that fits. Bars fill whatever space is left.';
    case 'stretch':
      return 'Fills the frame by squashing or stretching the picture. Nothing is cut off, but shapes distort.';
    case 'crop':
      return 'Fills the frame and trims the edges that don’t fit. No bars.';
    case 'letterbox-h':
      return (
        'Horizontal letterbox: fits the width and adds bars above and below.' +
        (targetAspect > sourceAspect * 1.001
          ? ' This target is wider than the source, so the top and bottom get trimmed instead.'
          : '')
      );
    case 'letterbox-v':
      return (
        'Vertical letterbox: fits the height and adds bars at the sides.' +
        (targetAspect < sourceAspect / 1.001
          ? ' This target is taller than the source, so the sides get trimmed instead.'
          : '')
      );
  }
}

export const MATTE_HINTS = {
  difference:
    'Keeps any pixel the effects changed. Works with every effect, including datamosh and pixel sort.',
  'added-light':
    'Keeps only what glows or is drawn on top (bloom, glyphs, dots). Composite it with Screen or Add.',
} as const;

// ---------------------------------------------------------------------------
// Video settings factories

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Encoder defaults that follow a compression choice (keeps the encoder family). */
export function compressionAdvanced(
  compression: Compression,
  fps: number,
  encoder: EncoderAdvanced['encoder'] = 'auto',
): EncoderAdvanced {
  const gop = Math.max(1, Math.round(fps * 2));
  switch (compression) {
    case 'highest':
      return { encoder, colorDepth: 10, keyframeInterval: gop, speed: 'slow', fastStart: true };
    case 'high':
      return { encoder, colorDepth: 8, keyframeInterval: gop, speed: 'medium', fastStart: true };
    case 'web':
      return { encoder, colorDepth: 8, keyframeInterval: gop, speed: 'medium', fastStart: true };
    case 'small':
      return { encoder, colorDepth: 8, keyframeInterval: gop, speed: 'fast', fastStart: true };
    case 'lossless':
      return { encoder, colorDepth: 8, keyframeInterval: 1, speed: 'medium', fastStart: false };
    case 'raw':
      return { encoder, colorDepth: 10, keyframeInterval: 1, speed: 'fast', fastStart: false };
  }
}

/**
 * Framing for a source going into a target size. Blurred video fills bars
 * nicely when the aspect differs (e.g. 16:9 into 9:16); a bars choice the user
 * made other than the defaults is kept.
 */
function frameFor(
  width: number,
  height: number,
  source: SourceInfo,
  previous?: OutputFrame,
): OutputFrame {
  const matches =
    Math.abs(width / height - source.width / source.height) <= 0.01 * (width / height);
  const keepBars = previous && previous.bars !== 'black' && previous.bars !== 'blur';
  return {
    width,
    height,
    fit: previous?.fit ?? 'fit',
    anchor: previous?.anchor ?? 'center',
    bars: keepBars ? previous.bars : matches ? 'black' : 'blur',
    barColor: previous?.barColor ?? '#000000',
    barBlur: previous?.barBlur ?? 0.6,
    barDarken: previous?.barDarken ?? 0.35,
  };
}

function defaultSequence(): SequenceSettings {
  return {
    kind: 'files',
    every: 'all',
    depth: 16,
    subfolder: true,
    separateAudio: true,
    flipbook: {
      kind: 'pdf',
      paper: 'letter',
      perPage: 8,
      bindingMargin: 0.5,
      cutLines: true,
      frameNumbers: true,
      cover: false,
      columns: 'auto',
      json: true,
    },
  };
}

/** The dialog's starting point: 1080p Social, framed for the source aspect. */
export function defaultVideoSettings(source: SourceInfo): VideoRenderSettings {
  const preset = videoPreset('1080p-social');
  const width = preset.width ?? even(source.width);
  const height = preset.height ?? even(source.height);
  return {
    preset: preset.id,
    output: 'movie',
    format: preset.format,
    fps: source.fps,
    compression: preset.compression,
    advanced: compressionAdvanced(preset.compression, source.fps),
    frame: frameFor(width, height, source),
    overlay: {
      enabled: false,
      matte: 'difference',
      threshold: 0.08,
      softness: 0.25,
      alpha: 'straight',
    },
    audio: {
      enabled: true,
      source: 'track',
      ...preset.audio,
      fadeIn: 0,
      fadeOut: 0,
    },
    sequence: defaultSequence(),
    upscale: {
      method: 'native',
      engine: 'realesrgan',
      model: 'realesr-animevideov3',
      mix: 0.3,
      command: '',
    },
  };
}

/** Applies a preset's size, format, compression and audio quality. */
export function applyVideoPreset(
  settings: VideoRenderSettings,
  presetId: VideoPresetId,
  source: SourceInfo,
): VideoRenderSettings {
  const preset = videoPreset(presetId);
  const width = preset.width ?? settings.frame.width;
  const height = preset.height ?? settings.frame.height;
  const sizeChanged = width !== settings.frame.width || height !== settings.frame.height;
  return {
    ...settings,
    preset: preset.id,
    format: preset.format,
    compression: preset.compression,
    advanced: compressionAdvanced(preset.compression, settings.fps, settings.advanced.encoder),
    frame: sizeChanged ? frameFor(width, height, source, settings.frame) : settings.frame,
    audio: { ...settings.audio, ...preset.audio },
  };
}

/** Changes compression and the advanced encoder defaults that follow it. */
export function applyCompression(
  settings: VideoRenderSettings,
  compression: Compression,
): VideoRenderSettings {
  return {
    ...settings,
    compression,
    advanced: compressionAdvanced(compression, settings.fps, settings.advanced.encoder),
  };
}

/** Switches separate files / flip book; flip books default to every 2nd frame. */
export function applySequenceKind(
  settings: VideoRenderSettings,
  kind: SequenceSettings['kind'],
): VideoRenderSettings {
  return {
    ...settings,
    output: 'sequence',
    sequence: { ...settings.sequence, kind, every: kind === 'flipbook' ? '2' : 'all' },
  };
}

// ---------------------------------------------------------------------------
// Resolved output: what actually gets written once compression and overlay
// have had their say (e.g. MP4 can't hold alpha, so overlays become ProRes 4444).

export type VideoCodec = 'h264' | 'hevc' | 'prores' | 'ffv1' | 'v210' | 'vp9' | 'png' | 'rawvideo';
export type MovieContainer = 'mp4' | 'mov' | 'mkv' | 'webm';

export interface ResolvedMovie {
  readonly kind: 'movie';
  readonly container: MovieContainer;
  readonly codec: VideoCodec;
  /** prores_ks profile: 0 Proxy, 1 LT, 2 Standard, 3 HQ, 4 4444, 5 4444 XQ. */
  readonly proresProfile?: 0 | 1 | 2 | 3 | 4 | 5;
  readonly alpha: boolean;
  readonly extension: string;
  readonly label: string;
  /** Set when the chosen format had to change; plain-language reason. */
  readonly switched?: string;
}
export interface ResolvedSequence {
  readonly kind: 'files' | 'pdf' | 'sprite';
  readonly alpha: boolean;
  /** '' for a folder of files. */
  readonly extension: string;
  readonly label: string;
}
export type ResolvedVideoOutput = ResolvedMovie | ResolvedSequence;

function movie(
  container: MovieContainer,
  codec: VideoCodec,
  label: string,
  alpha: boolean,
  extra: { proresProfile?: ResolvedMovie['proresProfile']; switched?: string } = {},
): ResolvedMovie {
  return {
    kind: 'movie',
    container,
    codec,
    alpha,
    extension: container,
    label,
    ...(extra.proresProfile !== undefined ? { proresProfile: extra.proresProfile } : {}),
    ...(extra.switched ? { switched: extra.switched } : {}),
  };
}

function overlayMovie(settings: VideoRenderSettings): ResolvedMovie {
  const { compression, format } = settings;
  if (compression === 'raw') return movie('mov', 'rawvideo', 'MOV · Uncompressed RGBA', true);
  if (compression === 'lossless' || format === 'mov-png')
    return movie('mov', 'png', 'MOV · PNG codec + alpha (lossless)', true);
  if (format === 'webm-vp9') return movie('webm', 'vp9', 'WebM · VP9 + alpha', true);
  if (format === 'mkv-ffv1') return movie('mkv', 'ffv1', 'MKV · FFV1 + alpha (lossless)', true);
  const xq = compression === 'highest';
  return movie('mov', 'prores', `MOV · ProRes 4444${xq ? ' XQ' : ''} + alpha`, true, {
    proresProfile: xq ? 5 : 4,
    ...(format === 'mov-prores'
      ? {}
      : {
          switched: `${format.startsWith('mp4') ? 'MP4' : 'This format'} can't store transparency, so the format switched to ProRes 4444. WebM (VP9) and PNG sequences also keep alpha.`,
        }),
  });
}

function plainMovie(settings: VideoRenderSettings): ResolvedMovie {
  const { compression, format } = settings;
  if (compression === 'raw' || format === 'mov-v210')
    return movie('mov', 'v210', 'MOV · Uncompressed 10-bit 4:2:2', false);
  if (format === 'mov-png') return movie('mov', 'png', 'MOV · PNG codec (lossless)', false);
  if (compression === 'lossless' || format === 'mkv-ffv1')
    return movie('mkv', 'ffv1', 'MKV · FFV1 (lossless)', false);
  if (format === 'webm-vp9') return movie('webm', 'vp9', 'WebM · VP9', false);
  if (compression === 'web') return movie('mp4', 'h264', 'MP4 · H.264 (web)', false);
  if (format === 'mov-prores') {
    const profile = compression === 'highest' ? 5 : compression === 'high' ? 3 : 0;
    const name = { 5: 'ProRes 4444 XQ', 3: 'ProRes 422 HQ', 0: 'ProRes 422 Proxy' }[profile];
    return movie('mov', 'prores', `MOV · ${name}`, false, { proresProfile: profile });
  }
  if (format === 'mp4-hevc') return movie('mp4', 'hevc', 'MP4 · H.265 (HEVC)', false);
  return movie('mp4', 'h264', 'MP4 · H.264', false);
}

/** What the Video tab will actually write. */
export function resolveVideoOutput(settings: VideoRenderSettings): ResolvedVideoOutput {
  const transparentBars = settings.frame.bars === 'transparent';
  if (settings.output === 'sequence') {
    const alpha = settings.overlay.enabled || transparentBars;
    const sequence = settings.sequence;
    if (sequence.kind === 'files')
      return {
        kind: 'files',
        alpha,
        extension: '',
        label: `PNG · ${sequence.depth}-bit` + (alpha ? ' + alpha' : ''),
      };
    if (sequence.flipbook.kind === 'pdf')
      return { kind: 'pdf', alpha: false, extension: 'pdf', label: 'Flip book · PDF pages' };
    return {
      kind: 'sprite',
      alpha,
      extension: 'png',
      label: 'Sprite sheet · PNG' + (alpha ? ' + alpha' : ''),
    };
  }
  if (settings.overlay.enabled) return overlayMovie(settings);
  const resolved = plainMovie(settings);
  // Transparent bars keep alpha only where the codec already carries it.
  const carriesAlpha =
    resolved.codec === 'vp9' ||
    resolved.codec === 'png' ||
    resolved.codec === 'ffv1' ||
    (resolved.codec === 'prores' && (resolved.proresProfile ?? 0) >= 4);
  if (!transparentBars || !carriesAlpha) return resolved;
  const label = resolved.label.endsWith(' (lossless)')
    ? resolved.label.replace(' (lossless)', ' + alpha (lossless)')
    : resolved.label + ' + alpha';
  return { ...resolved, alpha: true, label };
}

/** File extension for the video tab output; '' when it is a folder of files. */
export function videoOutputExtension(settings: VideoRenderSettings): string {
  return resolveVideoOutput(settings).extension;
}

/** Short output label, e.g. "MP4 · H.264 (web)" or "MOV · ProRes 4444 + alpha". */
export function videoOutputLabel(settings: VideoRenderSettings): string {
  return resolveVideoOutput(settings).label;
}

/** Gold Render button label for the Video tab. */
export function videoRenderLabel(settings: VideoRenderSettings, frameCount: number): string {
  const output = resolveVideoOutput(settings);
  if (output.kind === 'pdf') return 'Make Flip Book';
  if (output.kind === 'sprite') return 'Make Sprite Sheet';
  if (output.kind === 'files')
    return `Render ${frameCount.toLocaleString('en-US')} Frame${frameCount === 1 ? '' : 's'}`;
  return 'Render Video';
}

// ---------------------------------------------------------------------------
// GIF & Loops

export interface GifPreset {
  readonly id: Exclude<GifPresetId, 'custom'>;
  readonly label: string;
  readonly hint: string;
  readonly width: number;
  readonly fps: GifRenderSettings['fps'];
  readonly colors: number;
  readonly dither: GifRenderSettings['dither'];
  readonly scaling: GifRenderSettings['scaling'];
  readonly sizeLimitMb: GifRenderSettings['sizeLimitMb'];
  /** Sticker turns transparency on; the others leave it as it is. */
  readonly transparent?: boolean;
  /** Measured size of the 6 s reference clip as a GIF, in MB. */
  readonly measuredMb: number;
}

export const GIF_PRESETS: readonly GifPreset[] = [
  {
    id: 'social',
    label: 'Social Loop',
    hint: '480 px · 15 fps',
    width: 480,
    fps: 15,
    colors: 256,
    dither: 'bayer',
    scaling: 'lanczos',
    sizeLimitMb: 8,
    measuredMb: 6.4,
  },
  {
    id: 'hq',
    label: 'High Quality',
    hint: '720 px · 24 fps',
    width: 720,
    fps: 24,
    colors: 256,
    dither: 'floyd-steinberg',
    scaling: 'lanczos',
    sizeLimitMb: 0,
    measuredMb: 27.5,
  },
  {
    id: 'tiny',
    label: 'Tiny',
    hint: 'under 1 MB',
    width: 240,
    fps: 12,
    colors: 64,
    dither: 'bayer',
    scaling: 'bicubic',
    sizeLimitMb: 1,
    measuredMb: 1.43,
  },
  {
    id: 'sticker',
    label: 'Sticker',
    hint: '320 px · transparent',
    width: 320,
    fps: 15,
    colors: 128,
    dither: 'none',
    scaling: 'lanczos',
    sizeLimitMb: 0,
    transparent: true,
    measuredMb: 2.76,
  },
  {
    id: 'crunchy',
    label: 'Crunchy Pixels',
    hint: '256 px · 32 colors',
    width: 256,
    fps: 10,
    colors: 32,
    dither: 'none',
    scaling: 'nearest',
    sizeLimitMb: 0,
    measuredMb: 1.02,
  },
];

export const LOOP_FORMATS: readonly {
  id: LoopFormat;
  label: string;
  hint: string;
  extension: string;
}[] = [
  {
    id: 'gif',
    label: 'GIF',
    hint: 'Works everywhere. Max 256 colors, and transparency is on or off per pixel.',
    extension: 'gif',
  },
  {
    id: 'webp',
    label: 'Animated WebP',
    hint: 'About 6× smaller than the same GIF in our tests, with full color and smooth transparency. Supported by most browsers and Discord.',
    extension: 'webp',
  },
  {
    id: 'apng',
    label: 'APNG',
    hint: 'Lossless full color with smooth transparency, but about 5× the size of a GIF. Best for short stickers.',
    extension: 'png',
  },
  {
    id: 'mp4',
    label: 'MP4 loop',
    hint: 'About 6× smaller than a GIF, loops in chats and on social. No transparency, but audio is possible.',
    extension: 'mp4',
  },
];

export const LOOP_STYLES: readonly { id: LoopStyle; label: string; hint: string }[] = [
  { id: 'forward', label: 'Forward', hint: 'Plays start to end, then loops.' },
  { id: 'reverse', label: 'Reverse', hint: 'Plays end to start.' },
  {
    id: 'boomerang',
    label: 'Boomerang',
    hint: 'Plays forward, then backward. A seamless loop with no jump.',
  },
  {
    id: 'concat',
    label: 'Concat',
    hint: 'Joins several ranges or stages into one loop, in order.',
  },
];

export function gifTransparencyHint(format: LoopFormat): string {
  if (format === 'mp4') return 'Not available for MP4. Pick WebP or APNG for smooth transparency.';
  if (format === 'gif')
    return 'GIF transparency is on or off per pixel; soft edges get a dark fringe.';
  return 'Full smooth transparency.';
}

export function gifAudioHint(format: LoopFormat): string {
  return format === 'mp4'
    ? 'AAC 160 kbps · trimmed to the loop'
    : 'GIF, WebP and APNG can’t carry sound. Switch to MP4 loop for audio.';
}

export function gifPreset(id: GifPresetId): GifPreset | undefined {
  return GIF_PRESETS.find((preset) => preset.id === id);
}

export function defaultGifSettings(): GifRenderSettings {
  return applyGifPreset(
    {
      preset: 'social',
      format: 'gif',
      loop: 'forward',
      segments: [],
      speed: 1,
      fps: 15,
      smoothing: 'off',
      repeat: 'forever',
      width: 480,
      scaling: 'lanczos',
      sizeLimitMb: 8,
      colors: 256,
      palette: 'whole',
      dither: 'bayer',
      lossy: 0,
      transparent: false,
      audio: false,
    },
    'social',
  );
}

export function applyGifPreset(settings: GifRenderSettings, id: GifPresetId): GifRenderSettings {
  const preset = gifPreset(id);
  if (!preset) return { ...settings, preset: 'custom' };
  return {
    ...settings,
    preset: preset.id,
    width: preset.width,
    fps: preset.fps,
    colors: preset.colors,
    dither: preset.dither,
    scaling: preset.scaling,
    sizeLimitMb: preset.sizeLimitMb,
    transparent: preset.transparent ?? settings.transparent,
  };
}

export function gifOutputExtension(settings: GifRenderSettings): string {
  return LOOP_FORMATS.find((format) => format.id === settings.format)?.extension ?? 'gif';
}

/** e.g. "GIF", "Animated WebP + alpha", "MP4 loop · H.264". */
export function gifOutputLabel(settings: GifRenderSettings): string {
  const base = {
    gif: 'GIF',
    webp: 'Animated WebP',
    apng: 'APNG',
    mp4: 'MP4 loop · H.264',
  }[settings.format];
  return base + (settings.transparent && settings.format !== 'mp4' ? ' + alpha' : '');
}

/** Gold Render button label for the GIF & Loops tab. */
export function gifRenderLabel(settings: GifRenderSettings): string {
  return 'Export ' + { gif: 'GIF', webp: 'WebP', apng: 'APNG', mp4: 'Loop' }[settings.format];
}

/** Output size of a loop for a source aspect (width/height); MP4 needs even sizes. */
export function gifOutputSize(
  settings: Pick<GifRenderSettings, 'width' | 'format'>,
  sourceAspect: number,
): { width: number; height: number } {
  const width = Math.max(2, Math.round(settings.width));
  const height = Math.max(2, Math.round(width / sourceAspect));
  return settings.format === 'mp4'
    ? { width: even(width), height: even(height) }
    : { width, height };
}

/**
 * Frames in the finished loop: the range (or Concat segments) after speed,
 * at the loop frame rate; Boomerang plays forward then back without repeating
 * the end frames.
 */
export function gifFrameCount(settings: GifRenderSettings, rangeSeconds: number): number {
  const seconds =
    settings.loop === 'concat' && settings.segments.length
      ? settings.segments.reduce(
          (sum, segment) => sum + Math.max(0, segment.end - segment.start),
          0,
        )
      : rangeSeconds;
  const forward = Math.max(
    1,
    Math.round((seconds / Math.max(0.01, settings.speed)) * settings.fps),
  );
  return settings.loop === 'boomerang' && forward > 2 ? forward * 2 - 2 : forward;
}

// ---------------------------------------------------------------------------
// Size estimates. Sizes come from real ffmpeg encodes of a 6 s, 30 fps glitch
// test clip at 1080p (blocky datamosh texture); low/high bounds from a calm
// clip and a full-frame-grain clip. Bytes, decimal MB (1 MB = 1e6 bytes).

export interface SizeEstimate {
  readonly typical: number;
  readonly low: number;
  readonly high: number;
}
export interface GifSizeEstimate extends SizeEstimate {
  /** The typical size is over the size limit, so the export will be trimmed to fit. */
  readonly overLimit: boolean;
}

const MB = 1e6;
const REF_PIXELS = 1920 * 1080;
const REF_SECONDS = 6;
const REF_FRAMES = 180;
type Lossy = 'highest' | 'high' | 'web' | 'small';
/** MB per 6 s at 1080p. */
const LOSSY_MB: Record<'h264' | 'hevc', Record<Lossy, number>> = {
  h264: { highest: 15.3, high: 10.8, web: 7.7, small: 5.5 },
  // HEVC Small wasn't measured; it follows HEVC's ~0.8× of H.264.
  hevc: { highest: 12.3, high: 8.8, web: 7.7, small: 4.5 },
};
/** Calm and heavy clips relative to the typical one. */
const LOSSY_RANGE: Record<Lossy, readonly [number, number]> = {
  highest: [2.6 / 15.3, 108 / 15.3],
  high: [1.8 / 10.8, 59 / 10.8],
  web: [1.0 / 7.7, 10.1 / 7.7],
  small: [0.4 / 5.5, 1],
};
/** 12 Mbps cap: measured 4K Web came out at 9.9 MB per 6 s. */
const WEB_CAP_MB_PER_S = 9.9 / 6;
/** ProRes MB per 6 s at 1080p by profile (4444 from Apple's 1.5× 422 HQ rate). */
const PRORES_MB: Record<number, number> = { 0: 36, 1: 80, 2: 116, 3: 174, 4: 261, 5: 318 };
const PRORES_ALPHA_MB: Record<number, number> = { 4: 319, 5: 389 };

function lossyKey(compression: Compression): Lossy {
  return compression === 'lossless' || compression === 'raw' ? 'high' : compression;
}

function audioBytes(audio: AudioOutput, container: MovieContainer, seconds: number): number {
  if (container === 'webm') return ((audio.bitrateKbps || 160) * 1000 * seconds) / 8;
  if (audio.codec === 'pcm' && container !== 'mp4') return 48000 * 3 * 2 * seconds;
  return ((audio.bitrateKbps || 256) * 1000 * seconds) / 8;
}

const scaled = (typical: number, low: number, high: number): SizeEstimate => ({
  typical: Math.round(typical),
  low: Math.round(Math.min(low, typical)),
  high: Math.round(Math.max(high, typical)),
});

/**
 * Estimated output size. `frameCount` frames at `fps`. Lossy codecs scale with
 * pixels^0.7 and duration; ProRes, lossless and image sequences scale with
 * pixels and frame count; v210 and raw RGBA are exact.
 */
export function estimateVideoSize(
  settings: VideoRenderSettings,
  frameCount: number,
  fps: number,
  hasAudio = settings.audio.enabled,
): SizeEstimate {
  const frames = Math.max(0, frameCount);
  const seconds = frames / Math.max(1, fps);
  const { width, height } = settings.frame;
  const pixels = (width * height) / REF_PIXELS;
  const perFrame = frames / REF_FRAMES;
  const output = resolveVideoOutput(settings);

  if (output.kind === 'files') {
    const mbPerFrame = (output.alpha ? 341 : 325) / REF_FRAMES;
    const typical = mbPerFrame * MB * pixels * frames * (settings.sequence.depth === 8 ? 0.5 : 1);
    return scaled(typical, typical * 0.35, typical * 1.5);
  }
  if (output.kind === 'pdf') {
    const typical = 20_000 + frames * 0.3 * MB;
    return scaled(typical, typical * 0.4, typical * 1.8);
  }
  if (output.kind !== 'movie') {
    // Sprite sheet: cells shrink to keep the sheet within 16384 px; 8-bit PNG ≈ 0.44 bytes/px.
    const area = Math.min(width * height * frames, 16384 * 16384);
    const typical = area * 0.44 * (output.alpha ? 1.05 : 1);
    return scaled(typical, typical * 0.35, typical * 1.5);
  }

  const audio = hasAudio ? audioBytes(settings.audio, output.container, seconds) : 0;
  let typical: number;
  let range: readonly [number, number] = [1, 1];
  switch (output.codec) {
    case 'v210':
      typical = Math.ceil(width / 48) * 128 * height * frames;
      break;
    case 'rawvideo':
      typical = width * height * 4 * frames;
      break;
    case 'prores': {
      const profile = output.proresProfile ?? 3;
      const mb = (output.alpha ? PRORES_ALPHA_MB[profile] : undefined) ?? PRORES_MB[profile] ?? 174;
      typical = mb * MB * pixels * perFrame;
      range = [0.6, 1.4];
      break;
    }
    case 'ffv1':
      typical = 75 * MB * pixels * perFrame * (output.alpha ? 1.1 : 1);
      range = [0.4, 620 / 75];
      break;
    case 'png':
      typical = (output.alpha ? 223 : 212) * MB * pixels * perFrame;
      range = [0.35, 2.5];
      break;
    case 'vp9': {
      const key = lossyKey(settings.compression);
      const relative = LOSSY_MB.h264[key] / LOSSY_MB.h264.high;
      typical =
        ((9.6 * relative * (output.alpha ? 6.5 / 9.6 : 1)) / REF_SECONDS) *
        MB *
        Math.pow(pixels, 0.7) *
        seconds;
      range = LOSSY_RANGE[key];
      break;
    }
    default: {
      const key = lossyKey(settings.compression);
      let rate =
        (LOSSY_MB[output.codec === 'hevc' ? 'hevc' : 'h264'][key] / REF_SECONDS) *
        Math.pow(pixels, 0.7);
      range = LOSSY_RANGE[key];
      if (key === 'web') {
        rate = Math.min(rate, WEB_CAP_MB_PER_S);
        typical = rate * MB * seconds;
        const high = Math.min(rate * range[1], WEB_CAP_MB_PER_S * 1.06) * MB * seconds;
        return scaled(typical + audio, typical * range[0] + audio, high + audio);
      }
      typical = rate * MB * seconds;
    }
  }
  return scaled(typical + audio, typical * range[0] + audio, typical * range[1] + audio);
}

const DITHER_FACTOR: Record<GifRenderSettings['dither'], number> = {
  none: 0.9,
  bayer: 1,
  sierra: 1.35,
  'floyd-steinberg': 1.5,
};
/** WebP / APNG / MP4 relative to the same Social Loop GIF (1.1 / 30.7 / 1.0 vs 6.4 MB). */
const LOOP_FORMAT_FACTOR: Record<LoopFormat, number> = {
  gif: 1,
  webp: 1.1 / 6.4,
  apng: 30.7 / 6.4,
  mp4: 1.0 / 6.4,
};

/**
 * Estimated loop size for `frameCount` frames in the finished file (see
 * gifFrameCount). Anchored on the measured preset rows and scaled by area
 * (^0.7, ^1 for APNG), frame count, colors, dither and lossy.
 */
export function estimateGifSize(
  settings: GifRenderSettings,
  frameCount: number,
  sourceAspect = 16 / 9,
): GifSizeEstimate {
  const anchor = gifPreset(settings.preset) ?? GIF_PRESETS[0]!;
  const size = gifOutputSize(settings, sourceAspect);
  const anchorArea = anchor.width * Math.round((anchor.width * 9) / 16);
  const area = (size.width * size.height) / anchorArea;
  const frames = Math.max(0, frameCount) / (anchor.fps * REF_SECONDS);
  let typical: number;
  if (settings.format === 'gif') {
    const bits = Math.log2(Math.min(256, Math.max(2, settings.colors)));
    typical =
      anchor.measuredMb *
      MB *
      Math.pow(area, 0.7) *
      frames *
      (bits / Math.log2(anchor.colors)) *
      (DITHER_FACTOR[settings.dither] / DITHER_FACTOR[anchor.dither]) *
      (1 - 0.5 * (Math.min(100, Math.max(0, settings.lossy)) / 100)) *
      (settings.palette === 'frame' ? 1.05 : settings.palette === 'changes' ? 0.95 : 1);
  } else {
    // Other formats don't use the palette; scale the anchor GIF as measured.
    typical =
      anchor.measuredMb *
      MB *
      Math.pow(area, settings.format === 'apng' ? 1 : 0.7) *
      frames *
      LOOP_FORMAT_FACTOR[settings.format];
    if (settings.format === 'mp4' && settings.audio)
      typical += (160_000 * frameCount) / settings.fps / 8;
  }
  const limit = settings.sizeLimitMb * MB;
  return {
    ...scaled(typical, typical * 0.3, typical * 2.5),
    overLimit: limit > 0 && typical > limit,
  };
}

/** "≈ 7.7 MB" style size text (decimal units, like the measured table). */
export function formatSize(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1000) return (mb / 1000).toFixed(1) + ' GB';
  if (mb >= 10) return Math.round(mb) + ' MB';
  return Math.max(0.1, mb).toFixed(1) + ' MB';
}
