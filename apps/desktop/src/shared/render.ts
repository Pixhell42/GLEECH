// Shared contracts for timeline rendering: the Render dialog (renderer), the
// shared frame loop and the encoder service (main) all use these types.

export type RenderTab = 'video' | 'gif';

// ---------------------------------------------------------------------------
// Video tab

export type VideoPresetId =
  | '8k'
  | '4k'
  | '2k-master'
  | '1080p-social'
  | 'vertical'
  | 'draft'
  | 'edit-master'
  | '4k-edit-master'
  | 'custom';
/** Container + codec choices offered in the Format pop-up. */
export type VideoFormat =
  'mp4-h264' | 'mp4-hevc' | 'mov-prores' | 'mkv-ffv1' | 'mov-v210' | 'webm-vp9' | 'mov-png';
export type Compression = 'highest' | 'high' | 'web' | 'small' | 'lossless' | 'raw';
export type FitMode = 'fit' | 'stretch' | 'crop' | 'letterbox-h' | 'letterbox-v';
export type CropAnchor = 'center' | 'top' | 'subject';
export type BarsMode = 'black' | 'blur' | 'color' | 'transparent';
export type EncoderChoice = 'auto' | 'cpu' | 'nvenc' | 'amf' | 'qsv' | 'mf' | 'videotoolbox';
export type UpscaleMethod = 'native' | 'upscale-result' | 'upscale-source';
export type UpscaleEngine =
  'lanczos' | 'nearest' | 'realesrgan' | 'realcugan' | 'waifu2x' | 'command' | 'mcp';

export interface OutputFrame {
  readonly width: number;
  readonly height: number;
  readonly fit: FitMode;
  readonly anchor: CropAnchor;
  readonly bars: BarsMode;
  /** #RRGGBB, used when bars is color. */
  readonly barColor: string;
  /** 0–1 blur and darken amounts for blurred-video bars. */
  readonly barBlur: number;
  readonly barDarken: number;
}

export interface EncoderAdvanced {
  readonly encoder: EncoderChoice;
  readonly colorDepth: 8 | 10;
  /** Frames between keyframes. 0 = encoder default. */
  readonly keyframeInterval: number;
  readonly speed: 'fast' | 'medium' | 'slow';
  readonly fastStart: boolean;
}

export interface OverlaySettings {
  /** Effects only: leave the source out and keep what the effects add, with alpha. */
  readonly enabled: boolean;
  readonly matte: 'difference' | 'added-light';
  /** 0–1 difference below which pixels become transparent. */
  readonly threshold: number;
  /** 0–1 edge softness of the matte. */
  readonly softness: number;
  readonly alpha: 'straight' | 'premultiplied';
}

export interface AudioOutput {
  readonly enabled: boolean;
  readonly source: 'track' | 'clip' | 'mix';
  readonly codec: 'aac' | 'pcm' | 'opus';
  readonly bitrateKbps: number;
  /** Normalize to −14 LUFS. */
  readonly normalize: boolean;
  /** Seconds. */
  readonly fadeIn: number;
  readonly fadeOut: number;
}

export type SequenceEvery = 'all' | '2' | 'keys' | 'markers';
export interface FlipbookSettings {
  readonly kind: 'pdf' | 'sprite';
  readonly paper: 'letter' | 'a4' | '4x6';
  readonly perPage: 4 | 8 | 12;
  /** Inches. */
  readonly bindingMargin: number;
  readonly cutLines: boolean;
  readonly frameNumbers: boolean;
  readonly cover: boolean;
  readonly columns: 'auto' | 10 | 16 | 'row';
  /** Also write a JSON of frame rectangles beside a sprite sheet. */
  readonly json: boolean;
}
export interface SequenceSettings {
  readonly kind: 'files' | 'flipbook';
  readonly every: SequenceEvery;
  readonly depth: 8 | 16;
  readonly subfolder: boolean;
  readonly flipbook: FlipbookSettings;
  /** Also export the audio as a separate 24-bit WAV. */
  readonly separateAudio: boolean;
}

export interface UpscaleSettings {
  readonly method: UpscaleMethod;
  readonly engine: UpscaleEngine;
  /** Model name for AI engines. */
  readonly model: string;
  /** 0–1 blend of the upscaled result with a crisp nearest-neighbor copy. */
  readonly mix: number;
  /** Command template with {in} {out} {scale} {frame}. */
  readonly command: string;
}

export interface VideoRenderSettings {
  readonly preset: VideoPresetId;
  readonly output: 'movie' | 'sequence';
  readonly format: VideoFormat;
  readonly fps: number;
  readonly compression: Compression;
  readonly advanced: EncoderAdvanced;
  readonly frame: OutputFrame;
  readonly overlay: OverlaySettings;
  readonly audio: AudioOutput;
  readonly sequence: SequenceSettings;
  readonly upscale: UpscaleSettings;
}

// ---------------------------------------------------------------------------
// GIF & Loops tab

export type GifPresetId = 'social' | 'hq' | 'tiny' | 'sticker' | 'crunchy' | 'custom';
export type LoopFormat = 'gif' | 'webp' | 'apng' | 'mp4';
export type LoopStyle = 'forward' | 'reverse' | 'boomerang' | 'concat';
export type Dither = 'none' | 'bayer' | 'floyd-steinberg' | 'sierra';
export interface TimeSegment {
  readonly start: number;
  readonly end: number;
}
export interface GifRenderSettings {
  readonly preset: GifPresetId;
  readonly format: LoopFormat;
  readonly loop: LoopStyle;
  /** Ranges joined in order for Concat. Seconds. */
  readonly segments: readonly TimeSegment[];
  /** 0.25–4 playback speed. */
  readonly speed: number;
  readonly fps: 10 | 12 | 15 | 24 | 30;
  readonly smoothing: 'off' | 'blend' | 'motion';
  readonly repeat: 'forever' | 'once' | '3';
  /** Output width in px; height follows the aspect ratio. */
  readonly width: number;
  readonly scaling: 'lanczos' | 'bicubic' | 'nearest';
  /** Keep the file under this many MB. 0 = no limit. */
  readonly sizeLimitMb: 0 | 1 | 8 | 15;
  /** GIF palette. */
  readonly colors: number;
  readonly palette: 'whole' | 'frame' | 'changes';
  readonly dither: Dither;
  /** 0–100. Reuses near-identical pixels between frames for smaller GIFs. */
  readonly lossy: number;
  /** Effects only, transparent background (GIF, WebP, APNG). */
  readonly transparent: boolean;
  /** MP4 loops only. */
  readonly audio: boolean;
}

// ---------------------------------------------------------------------------
// Jobs

export type RangeKind = 'work' | 'whole' | 'inout';
export interface RenderRange {
  readonly kind: RangeKind;
  /** Seconds. */
  readonly start: number;
  readonly end: number;
}

export interface MediaInput {
  readonly path: string;
  /** Seconds into the media file where the render range starts. */
  readonly start: number;
  readonly duration: number;
  /** Track level 0–1 applied before mixing. Absent means full level. */
  readonly volume?: number;
}

/** Everything the encoder service needs; frames arrive separately. */
export interface RenderJobSpec {
  readonly kind: RenderTab;
  readonly name: string;
  readonly video?: VideoRenderSettings;
  readonly gif?: GifRenderSettings;
  /** Frames the renderer will send, in order. */
  readonly frameCount: number;
  /** Rate of the frames the renderer sends. */
  readonly fps: number;
  /** Size of the frames the renderer sends (the project source size, or upscaled source). */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** For movies a file path; for separate-file sequences a folder path. */
  readonly outputPath: string;
  readonly audio?: MediaInput;
  readonly clipAudio?: MediaInput;
  /** Timeline second for each frame, for frame-number labels and sprite JSON. */
  readonly frameTimes?: readonly number[];
  /** Overlay jobs send the unedited source with each frame. */
  readonly withOriginal?: boolean;
}

export interface RenderFrame {
  readonly width: number;
  readonly height: number;
  /** RGBA8, straight alpha. */
  readonly pixels: ArrayBuffer;
}

export interface RenderResult {
  readonly outputPath: string;
  readonly bytes: number;
  readonly files: number;
  /** Plain-language notes, e.g. "→ trimmed to fit 1 MB". */
  readonly notes: readonly string[];
}

export interface FfmpegStatus {
  readonly available: boolean;
  readonly source: 'bundled' | 'configured' | 'path' | 'none';
  readonly path: string | null;
  readonly version: string | null;
  /** Encoder names reported by `ffmpeg -encoders`, e.g. libx264, h264_nvenc. */
  readonly encoders: readonly string[];
  readonly error?: string;
}

export interface VideoProbe {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly hasAudio: boolean;
  readonly codec: string;
}
export interface AudioProbe {
  readonly duration: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: string;
}
export interface OpenedMedia<T> {
  /** Token for the gleech-media:// protocol and decode requests. */
  readonly mediaId: string;
  readonly path: string;
  readonly name: string;
  readonly info: T;
}
