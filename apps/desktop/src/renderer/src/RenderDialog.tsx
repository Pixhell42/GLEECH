import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  activeVideo,
  formatTimecode,
  type ProjectState,
  type Timeline,
} from '@gleech/project-model';
import { unwrap } from '../../shared/image-api';
import type {
  BarsMode,
  CropAnchor,
  FfmpegStatus,
  GifRenderSettings,
  RangeKind,
  RenderTab,
  UpscaleEngine,
  UpscaleMethod,
  VideoRenderSettings,
} from '../../shared/render';
import {
  COMPRESSION_CHOICES,
  CUSTOM_ASPECTS,
  FIT_MODES,
  GIF_PRESETS,
  LOOP_FORMATS,
  LOOP_STYLES,
  MATTE_HINTS,
  VIDEO_FORMATS,
  VIDEO_PRESETS,
  applyCompression,
  applyGifPreset,
  applySequenceKind,
  applyVideoPreset,
  compressionAdvanced,
  defaultGifSettings,
  defaultVideoSettings,
  estimateGifSize,
  estimateVideoSize,
  fitHint,
  formatSize,
  gifAudioHint,
  gifFrameCount,
  gifOutputExtension,
  gifOutputLabel,
  gifOutputSize,
  gifRenderLabel,
  gifTransparencyHint,
  resolveVideoOutput,
  videoOutputLabel,
  videoRenderLabel,
} from '../../shared/render-presets';
import { renderRange, videoFrameTimes } from './render-plan';
import type { RenderRequest } from './render-queue';
import {
  audibleTrack,
  buildRenderRequest,
  loopAudioAvailable,
  renderSourceSize,
  separateClipSound,
  videoAudioActive,
  videoAudioSources,
} from './render-request';
import { shortTime } from './timeline/timeline-math';
import { CloseIcon, LoopIcon, SequenceIcon, VideoIcon, WaveformIcon } from './Icons';

export interface RenderSettingsMemory {
  readonly video: VideoRenderSettings | null;
  readonly gif: GifRenderSettings | null;
  readonly outputFolder: string | null;
  /** The tab used last; the timeline's Render button reopens it. */
  readonly tab: RenderTab;
}

const UPSCALE_ENGINES: readonly {
  id: UpscaleEngine;
  name: string;
  tag: string;
  description: string;
}[] = [
  {
    id: 'realesrgan',
    name: 'Real-ESRGAN',
    tag: 'Free · AI',
    description:
      'Sharp, clean detail on any Vulkan GPU. Needs realesrgan-ncnn-vulkan on your PATH.',
  },
  {
    id: 'realcugan',
    name: 'Real-CUGAN',
    tag: 'Free · AI',
    description: 'Good on flat colors and line art. Needs realcugan-ncnn-vulkan.',
  },
  {
    id: 'waifu2x',
    name: 'waifu2x',
    tag: 'Free · AI',
    description: 'Gentle, low-noise upscaling. Needs waifu2x-ncnn-vulkan.',
  },
  { id: 'lanczos', name: 'Lanczos', tag: 'Built in', description: 'Smooth, fast resampling.' },
  {
    id: 'nearest',
    name: 'Nearest neighbor',
    tag: 'Built in',
    description: 'Crisp pixel blocks. Best for pixel-art glitches.',
  },
  {
    id: 'command',
    name: 'Your own upscaler',
    tag: 'Command line',
    description: 'Run any tool with {in} {out} {scale} {frame}.',
  },
  {
    id: 'mcp',
    name: 'MCP tool',
    tag: 'Connected server',
    description: 'Call another MCP server’s upscale tool. Not available in this build yet.',
  },
];
const AI_MODELS: Partial<Record<UpscaleEngine, readonly string[]>> = {
  realesrgan: ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime'],
  realcugan: ['models-se', 'models-pro', 'models-nose'],
  waifu2x: ['models-cunet', 'models-upconv_7_anime_style_art_rgb'],
};
const UPSCALE_METHODS: readonly { id: UpscaleMethod; label: string; hint: string }[] = [
  {
    id: 'native',
    label: 'Render at full size',
    hint: 'Effects are drawn natively at the target size: the sharpest glitch texture, but the slowest. 8K needs about 8 GB of GPU memory.',
  },
  {
    id: 'upscale-result',
    label: 'Upscale result (fast)',
    hint: 'Renders at the source size, then upscales each finished frame with the engine below.',
  },
  {
    id: 'upscale-source',
    label: 'Upscale source first',
    hint: 'Enlarges the source before the effects run, so effects work on more pixels.',
  },
];
const FRAME_RATE_CHOICES = [12, 15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const AUDIO_QUALITY = [
  { label: 'AAC · 128 kbps', codec: 'aac', kbps: 128 },
  { label: 'AAC · 160 kbps', codec: 'aac', kbps: 160 },
  { label: 'AAC · 256 kbps', codec: 'aac', kbps: 256 },
  { label: 'AAC · 320 kbps', codec: 'aac', kbps: 320 },
  { label: 'PCM · 48 kHz 24-bit', codec: 'pcm', kbps: 0 },
] as const;

/** "1.7–17 MB" when both ends share a unit, else "900 MB – 1.2 GB". */
function sizeRange(low: number, high: number): string {
  const from = formatSize(low);
  const to = formatSize(high);
  const unit = to.split(' ')[1];
  return from.split(' ')[1] === unit ? `${from.split(' ')[0]}–${to}` : `${from} – ${to}`;
}
function baseName(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim() || 'GLEECH'
  );
}
function withExtension(path: string, extension: string): string {
  if (!extension) return path.replace(/\.[a-z0-9]{2,5}$/i, '');
  return /\.[a-z0-9]{2,5}$/i.test(path)
    ? path.replace(/\.[a-z0-9]{2,5}$/i, `.${extension}`)
    : `${path}.${extension}`;
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  wide,
}: {
  label: string;
  value: T;
  options: readonly {
    value: T;
    label: ReactNode;
    disabled?: boolean | undefined;
    title?: string | undefined;
  }[];
  onChange(value: T): void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`render-segmented${wide ? ' wide' : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const enabled = options.filter((option) => !option.disabled);
        const index = enabled.findIndex((option) => option.value === value);
        const next =
          enabled[
            (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
          ];
        if (next) onChange(next.value);
      }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={disabled || option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A number box that commits on Enter or blur, so typing isn't clamped mid-number. */
function NumberField({
  value,
  onCommit,
  ...rest
}: {
  value: number;
  onCommit(value: number): void;
  'aria-label': string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    onCommit(Number(draft));
  };
  return (
    <input
      type="number"
      {...rest}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape' && draft !== null) {
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="render-switch"
      aria-label={label}
      aria-checked={checked}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function Row({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="render-row">
      <div className="render-row-main">
        <span className="render-row-label">{label}</span>
        <div className="render-row-control">{children}</div>
      </div>
      {hint && <p className="render-hint">{hint}</p>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <div className="render-row render-slider-row">
      <div className="render-row-main">
        <span className="render-row-label">{label}</span>
        <output className="render-value">{format(value)}</output>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}

/** Framing diagram: the source picture inside the target frame. */
function FramingDiagram({
  sourceAspect,
  width,
  height,
  fit,
}: {
  sourceAspect: number;
  width: number;
  height: number;
  fit: VideoRenderSettings['frame']['fit'];
}) {
  const box = 96;
  const targetAspect = width / height;
  const frameW = targetAspect >= 1 ? box : box * targetAspect;
  const frameH = targetAspect >= 1 ? box / targetAspect : box;
  const fitScale = Math.min(frameW / sourceAspect, frameH);
  const coverScale = Math.max(frameW / sourceAspect, frameH);
  const scale =
    fit === 'crop'
      ? coverScale
      : fit === 'letterbox-h'
        ? frameW / sourceAspect
        : fit === 'letterbox-v'
          ? frameH
          : fitScale;
  const pictureW = fit === 'stretch' ? frameW : sourceAspect * scale;
  const pictureH = fit === 'stretch' ? frameH : scale;
  const x = (box - frameW) / 2;
  const y = (box - frameH) / 2;
  return (
    <svg
      className="framing-diagram"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="framing-clip">
          <rect x={x} y={y} width={frameW} height={frameH} />
        </clipPath>
      </defs>
      <rect className="framing-frame" x={x} y={y} width={frameW} height={frameH} rx={3} />
      <rect
        className="framing-picture"
        clipPath="url(#framing-clip)"
        x={box / 2 - pictureW / 2}
        y={box / 2 - pictureH / 2}
        width={pictureW}
        height={pictureH}
      />
      <rect className="framing-outline" x={x} y={y} width={frameW} height={frameH} rx={3} />
    </svg>
  );
}

export function RenderDialog({
  initialTab,
  project,
  timeline,
  frame,
  preview,
  memory,
  videoMediaId,
  onMemory,
  onClose,
  onQueue,
}: {
  initialTab: RenderTab;
  project: ProjectState;
  timeline: Timeline;
  frame: number;
  preview: string | null;
  memory: RenderSettingsMemory;
  videoMediaId: string | null;
  onMemory(memory: RenderSettingsMemory): void;
  onClose(): void;
  /** Queue a job; `close` is true for Render, false for Add to Queue. */
  onQueue(request: RenderRequest, close: boolean): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const sourceSize = renderSourceSize(project);
  const sourceAspect = sourceSize.width / sourceSize.height;
  const sourceInfo = { ...sourceSize, fps: timeline.fps };
  const [tab, setTab] = useState<RenderTab>(initialTab);
  const [video, setVideo] = useState<VideoRenderSettings>(
    () => memory.video ?? defaultVideoSettings(sourceInfo),
  );
  const [gif, setGif] = useState<GifRenderSettings>(() => memory.gif ?? defaultGifSettings());
  const [rangeKind, setRangeKind] = useState<RangeKind>(timeline.workArea ? 'work' : 'whole');
  const [folder, setFolder] = useState<string | null>(memory.outputFolder);
  const [chosen, setChosen] = useState<{ tab: RenderTab; path: string } | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [aspectLock, setAspectLock] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let active = true;
    void window.gleech.renderStatus().then((result) => {
      if (active && result.ok) setFfmpeg(result.value);
    });
    if (!folder)
      void window.gleech.defaultRenderFolder().then((result) => {
        if (active && result.ok) setFolder(result.value);
      });
    return () => {
      active = false;
    };
  }, [folder]);
  useEffect(() => {
    onMemory({ video, gif, outputFolder: folder, tab });
  }, [video, gif, folder, tab, onMemory]);

  const range = useMemo(() => renderRange(rangeKind, timeline), [rangeKind, timeline]);
  const seconds = Math.max(0, range.end - range.start);
  const name = baseName(project.name);
  const separator = window.gleech.platform === 'win32' ? '\\' : '/';
  const resolved = resolveVideoOutput(video);
  const videoTimes = useMemo(
    () => videoFrameTimes(video, range, timeline, project.effects),
    [video, range, timeline, project.effects],
  );
  const extension = tab === 'video' ? resolved.extension : gifOutputExtension(gif);
  const sequenceFolder = tab === 'video' && resolved.kind === 'files';
  const defaultPath = folder
    ? sequenceFolder
      ? folder
      : `${folder}${separator}${name}_gleech${tab === 'gif' ? '_loop' : ''}.${extension}`
    : null;
  const outputPath =
    chosen?.tab === tab && chosen.path
      ? sequenceFolder
        ? chosen.path
        : withExtension(chosen.path, extension)
      : defaultPath;

  const hasTrack = Boolean(timeline.audio);
  // When the audio track is the clip's own sound, there is only one source.
  const hasClip = separateClipSound(timeline);
  const videoAudioOn =
    video.audio.enabled &&
    (hasTrack || hasClip) &&
    resolved.kind !== 'pdf' &&
    resolved.kind !== 'sprite';
  const target = video.frame;
  const aspectDiffers = Math.abs(target.width / target.height - sourceAspect) > 0.01 * sourceAspect;
  const upscale = Math.max(target.width / sourceSize.width, target.height / sourceSize.height);
  const needsFfmpeg =
    tab === 'gif' ||
    (tab === 'video' &&
      (resolved.kind === 'movie' || (videoAudioOn && video.sequence.separateAudio)));
  const ffmpegMissing = needsFfmpeg && ffmpeg !== null && !ffmpeg.available;
  const clipOffline = Boolean(activeVideo(project)) && !videoMediaId;
  const gifSize = gifOutputSize(gif, sourceAspect);
  const gifFrames = gifFrameCount(gif, seconds);
  const estimate =
    tab === 'video'
      ? estimateVideoSize(
          video,
          videoTimes.length,
          video.fps,
          videoAudioOn && videoAudioActive(video, timeline),
        )
      : estimateGifSize(gif, gifFrames, sourceAspect);
  const summaryAudio =
    tab === 'video'
      ? resolved.kind === 'pdf' || resolved.kind === 'sprite'
        ? 'None'
        : !videoAudioOn
          ? hasTrack || hasClip
            ? 'Off'
            : 'No audio track'
          : resolved.kind === 'files' && !video.sequence.separateAudio
            ? 'Off'
            : !videoAudioActive(video, timeline)
              ? 'Track muted'
              : resolved.kind === 'files'
                ? 'Separate WAV · 24-bit'
                : video.audio.codec === 'pcm'
                  ? 'PCM · 48 kHz 24-bit'
                  : `AAC · ${video.audio.bitrateKbps} kbps${video.audio.normalize ? ' · −14 LUFS' : ''}`
      : gif.format === 'mp4' && gif.audio && hasTrack
        ? audibleTrack(timeline)
          ? 'AAC · 160 kbps'
          : 'Track muted'
        : 'None';
  const overLimit = tab === 'gif' && Boolean((estimate as { overLimit?: boolean }).overLimit);
  const transparentOutput =
    tab === 'video' ? resolved.alpha : gif.transparent && gif.format !== 'mp4';

  const updateVideo = (change: Partial<VideoRenderSettings>) =>
    setVideo((previous) => ({ ...previous, ...change }));
  const updateFrame = (change: Partial<VideoRenderSettings['frame']>) =>
    setVideo((previous) => ({ ...previous, frame: { ...previous.frame, ...change } }));
  const updateGif = (change: Partial<GifRenderSettings>, keepPreset = false) =>
    setGif((previous) => ({
      ...previous,
      ...change,
      ...(keepPreset ? {} : { preset: 'custom' as const }),
    }));

  const build = (): RenderRequest | null => {
    if (!outputPath) {
      setError('Choose where to save first.');
      return null;
    }
    try {
      return buildRenderRequest({
        tab,
        video,
        gif,
        project,
        timeline,
        range,
        outputPath,
        videoMediaId,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not prepare this render.');
      return null;
    }
  };
  const submit = (close: boolean) => {
    setError(null);
    const request = build();
    if (request) onQueue(request, close);
  };

  const presetTile = (
    key: string,
    selected: boolean,
    label: string,
    hint: string,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className="render-preset"
      aria-pressed={selected}
      onClick={onClick}
    >
      <strong>{label}</strong>
      <span>{hint}</span>
    </button>
  );

  return (
    <dialog
      ref={modal}
      className="render-dialog"
      aria-labelledby="render-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="render-header">
        <h2 id="render-title">Render</h2>
        <div className="render-tabs" role="tablist" aria-label="Render output">
          {(
            [
              ['video', <VideoIcon key="v" />, 'Video'],
              ['gif', <LoopIcon key="g" />, 'GIF & Loops'],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              id={`render-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                const next = tab === 'video' ? 'gif' : 'video';
                setTab(next);
                document.getElementById(`render-tab-${next}`)?.focus();
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <span className="render-context">
          {name} · {Number(timeline.fps.toFixed(3))} fps ·{' '}
          {shortTime(timeline.duration).replace(/\.0$/, '')}
        </span>
        <button type="button" className="render-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="render-body">
        <aside className="render-side">
          <div className={`render-preview${transparentOutput ? ' transparent' : ''}`}>
            {preview ? (
              <img src={preview} alt="Frame at the playhead" />
            ) : (
              <span>Preparing preview…</span>
            )}
            <span className="render-preview-tag">Frame {formatTimecode(frame, timeline.fps)}</span>
          </div>
          <h3>Range</h3>
          <Segmented<RangeKind>
            label="Range"
            value={range.kind}
            options={[
              {
                value: 'work',
                label: 'Work area',
                disabled: !timeline.workArea,
                title: timeline.workArea ? undefined : 'Drag the ruler band to set a work area',
              },
              { value: 'whole', label: 'Whole timeline' },
              {
                value: 'inout',
                label: 'In / Out',
                disabled: !timeline.inOut,
                title: timeline.inOut
                  ? undefined
                  : 'Press I and O in Timeline mode to set In and Out',
              },
            ]}
            onChange={setRangeKind}
            wide
          />
          <p className="render-range-text">
            {shortTime(range.start)} → {shortTime(range.end)} · {seconds.toFixed(1)} s
          </p>
          <dl className="render-summary">
            <div>
              <dt>Output</dt>
              <dd>{tab === 'video' ? videoOutputLabel(video) : gifOutputLabel(gif)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {tab === 'video'
                  ? `${video.frame.width} × ${video.frame.height}`
                  : `${gifSize.width} × ${gifSize.height}`}
              </dd>
            </div>
            <div>
              <dt>Frames</dt>
              <dd>
                {tab === 'video'
                  ? `${videoTimes.length.toLocaleString('en-US')} @ ${Number(video.fps.toFixed(3))} fps`
                  : `${gifFrames.toLocaleString('en-US')} @ ${gif.fps} fps`}
              </dd>
            </div>
            <div>
              <dt>Audio</dt>
              <dd>{summaryAudio}</dd>
            </div>
            <div className="render-estimate">
              <dt>Estimated</dt>
              <dd>
                ≈ {formatSize(estimate.typical)} ({sizeRange(estimate.low, estimate.high)})
                {tab === 'gif' && overLimit && (
                  <small> → trimmed to fit {gif.sizeLimitMb} MB</small>
                )}
              </dd>
            </div>
          </dl>
          <div className="render-save">
            <h3>Save to</h3>
            <div className="render-save-row">
              <output title={outputPath ?? ''}>{outputPath ?? 'Choosing a folder…'}</output>
              <button
                type="button"
                onClick={() =>
                  void window.gleech
                    .chooseRenderOutput(
                      sequenceFolder ? 'folder' : 'file',
                      `${name}_gleech${tab === 'gif' ? '_loop' : ''}`,
                      extension,
                    )
                    .then(unwrap)
                    .then((path) => {
                      if (path) setChosen({ tab, path });
                    })
                    .catch((failure) =>
                      setError(
                        failure instanceof Error ? failure.message : 'Could not choose a location.',
                      ),
                    )
                }
              >
                Change…
              </button>
            </div>
          </div>
        </aside>
        <div className="render-main">
          {ffmpegMissing && (
            <div className="render-warning" role="alert">
              <span>
                ffmpeg was not found, so movies and loops can’t be encoded. Image sequences and flip
                books still work.
              </span>
              <button
                type="button"
                onClick={() =>
                  void window.gleech
                    .locateFfmpeg()
                    .then(unwrap)
                    .then((status) => {
                      if (status) setFfmpeg(status);
                    })
                    .catch((failure) =>
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : 'That is not a working ffmpeg.',
                      ),
                    )
                }
              >
                Locate ffmpeg…
              </button>
            </div>
          )}
          {tab === 'video' ? (
            <>
              <h3>Preset</h3>
              <div className="render-presets">
                {VIDEO_PRESETS.map((preset) =>
                  presetTile(preset.id, video.preset === preset.id, preset.label, preset.hint, () =>
                    setVideo((previous) => applyVideoPreset(previous, preset.id, sourceInfo)),
                  ),
                )}
              </div>
              <h3>Output</h3>
              <Segmented<'movie' | 'sequence'>
                label="Output"
                value={video.output}
                options={[
                  {
                    value: 'movie',
                    label: (
                      <>
                        <VideoIcon /> Movie file
                      </>
                    ),
                  },
                  {
                    value: 'sequence',
                    label: (
                      <>
                        <SequenceIcon /> Image sequence
                      </>
                    ),
                  },
                ]}
                onChange={(output) => updateVideo({ output })}
                wide
              />
              {video.output === 'movie' ? (
                <section className="render-card">
                  <Row label="Format">
                    <select
                      aria-label="Format"
                      value={video.format}
                      onChange={(event) =>
                        updateVideo({ format: event.target.value as VideoRenderSettings['format'] })
                      }
                    >
                      {VIDEO_FORMATS.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row label="Resolution">
                    <span className="render-mono">
                      {video.frame.width} × {video.frame.height}
                    </span>
                    <select
                      aria-label="Resolution"
                      value={
                        video.preset === 'custom'
                          ? 'custom'
                          : `${video.frame.width}x${video.frame.height}`
                      }
                      onChange={(event) => {
                        if (event.target.value === 'custom') {
                          setVideo((previous) => ({ ...previous, preset: 'custom' }));
                          return;
                        }
                        const [width, height] = event.target.value.split('x').map(Number);
                        updateFrame({ width: width!, height: height! });
                      }}
                    >
                      {[
                        ['7680x4320', '8K'],
                        ['3840x2160', '4K'],
                        ['2048x1152', '2K'],
                        ['1920x1080', '1080p'],
                        ['1080x1920', '1080 × 1920'],
                        ['1280x720', '720p'],
                        ['960x540', '540p'],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      {![
                        '7680x4320',
                        '3840x2160',
                        '2048x1152',
                        '1920x1080',
                        '1080x1920',
                        '1280x720',
                        '960x540',
                      ].includes(`${video.frame.width}x${video.frame.height}`) &&
                        video.preset !== 'custom' && (
                          <option value={`${video.frame.width}x${video.frame.height}`}>
                            Current
                          </option>
                        )}
                      <option value="custom">Custom…</option>
                    </select>
                  </Row>
                  <Row label="Frame rate">
                    <select
                      aria-label="Frame rate"
                      value={String(video.fps)}
                      onChange={(event) => {
                        const fps = Number(event.target.value);
                        setVideo((previous) => ({
                          ...previous,
                          fps,
                          advanced: { ...previous.advanced, keyframeInterval: Math.round(fps * 2) },
                        }));
                      }}
                    >
                      {[...new Set([timeline.fps, ...FRAME_RATE_CHOICES])].map((fps) => (
                        <option key={fps} value={String(fps)}>
                          {Number(fps.toFixed(3))} fps{fps === timeline.fps ? ' (project)' : ''}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <div className="render-row">
                    <span className="render-row-label">Compression</span>
                    <Segmented
                      label="Compression"
                      value={video.compression}
                      options={COMPRESSION_CHOICES.map((choice) => ({
                        value: choice.id,
                        label: choice.label,
                        title: choice.detail,
                      }))}
                      onChange={(compression) =>
                        setVideo((previous) => applyCompression(previous, compression))
                      }
                      wide
                    />
                    <p className="render-hint">
                      {COMPRESSION_CHOICES.find((choice) => choice.id === video.compression)?.hint}
                    </p>
                    {resolved.kind === 'movie' && resolved.switched && (
                      <p className="render-note">{resolved.switched}</p>
                    )}
                    <details className="render-advanced">
                      <summary>Advanced encoder settings</summary>
                      <Row label="Encoder">
                        <select
                          aria-label="Encoder"
                          value={video.advanced.encoder}
                          onChange={(event) =>
                            updateVideo({
                              advanced: {
                                ...video.advanced,
                                encoder: event.target
                                  .value as VideoRenderSettings['advanced']['encoder'],
                              },
                            })
                          }
                        >
                          {(
                            [
                              ['auto', 'Automatic'],
                              ['cpu', 'CPU (x264 / x265)'],
                              ['nvenc', 'NVIDIA NVENC'],
                              ['amf', 'AMD AMF'],
                              ['qsv', 'Intel Quick Sync'],
                              ['mf', 'Windows Media Foundation'],
                              ['videotoolbox', 'Apple VideoToolbox'],
                            ] as const
                          ).map(([value, label]) => (
                            <option
                              key={value}
                              value={value}
                              disabled={
                                value !== 'auto' &&
                                value !== 'cpu' &&
                                ffmpeg !== null &&
                                !ffmpeg.encoders.some((encoder) => encoder.endsWith(`_${value}`))
                              }
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </Row>
                      <Row label="Color depth">
                        <Segmented<8 | 10>
                          label="Color depth"
                          value={video.advanced.colorDepth}
                          options={[
                            { value: 8, label: '8-bit' },
                            { value: 10, label: '10-bit' },
                          ]}
                          onChange={(colorDepth) =>
                            updateVideo({ advanced: { ...video.advanced, colorDepth } })
                          }
                        />
                      </Row>
                      <Row label="Encoder speed">
                        <Segmented
                          label="Encoder speed"
                          value={video.advanced.speed}
                          options={[
                            { value: 'slow', label: 'Slow' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'fast', label: 'Fast' },
                          ]}
                          onChange={(speed) =>
                            updateVideo({ advanced: { ...video.advanced, speed } })
                          }
                        />
                      </Row>
                      <Row label="Keyframe every">
                        <NumberField
                          aria-label="Keyframe interval in frames"
                          min={1}
                          max={600}
                          value={video.advanced.keyframeInterval}
                          onCommit={(committed) =>
                            updateVideo({
                              advanced: {
                                ...video.advanced,
                                keyframeInterval: Math.max(
                                  1,
                                  Math.min(600, Math.round(committed || 1)),
                                ),
                              },
                            })
                          }
                        />
                        <span className="render-unit">frames</span>
                      </Row>
                      <Row label="Fast start (plays while downloading)">
                        <Switch
                          label="Fast start"
                          checked={video.advanced.fastStart}
                          onChange={(fastStart) =>
                            updateVideo({ advanced: { ...video.advanced, fastStart } })
                          }
                        />
                      </Row>
                      <button
                        type="button"
                        className="render-link"
                        onClick={() =>
                          updateVideo({
                            advanced: compressionAdvanced(video.compression, video.fps),
                          })
                        }
                      >
                        Reset encoder settings
                      </button>
                    </details>
                  </div>
                </section>
              ) : (
                <section className="render-card">
                  <Row label="Save as">
                    <Segmented<'files' | 'flipbook'>
                      label="Save as"
                      value={video.sequence.kind}
                      options={[
                        { value: 'files', label: 'Separate files' },
                        { value: 'flipbook', label: 'Flip book' },
                      ]}
                      onChange={(kind) => setVideo((previous) => applySequenceKind(previous, kind))}
                    />
                  </Row>
                  {video.sequence.kind === 'flipbook' && (
                    <Row
                      label="Layout"
                      hint={
                        video.sequence.flipbook.kind === 'pdf'
                          ? 'Print, cut and bind into a real flip book. Every 2nd frame keeps it a comfortable thickness.'
                          : 'One PNG grid of frames, for game engines and the web.'
                      }
                    >
                      <Segmented<'pdf' | 'sprite'>
                        label="Flip book layout"
                        value={video.sequence.flipbook.kind}
                        options={[
                          { value: 'pdf', label: 'Printable pages (PDF)' },
                          { value: 'sprite', label: 'Sprite sheet' },
                        ]}
                        onChange={(kind) =>
                          updateVideo({
                            sequence: {
                              ...video.sequence,
                              flipbook: { ...video.sequence.flipbook, kind },
                            },
                          })
                        }
                      />
                    </Row>
                  )}
                  <Row label="Which frames">
                    <Segmented
                      label="Which frames"
                      value={video.sequence.every}
                      options={[
                        { value: 'all', label: 'Every frame' },
                        { value: '2', label: 'Every 2nd' },
                        { value: 'keys', label: 'Keyframes' },
                        {
                          value: 'markers',
                          label: 'Markers',
                          disabled: timeline.markers.length === 0,
                        },
                      ]}
                      onChange={(every) => updateVideo({ sequence: { ...video.sequence, every } })}
                    />
                  </Row>
                  {video.sequence.kind === 'files' && (
                    <>
                      <Row label="File names">
                        <span className="render-mono">{name}_####.png</span>
                      </Row>
                      <Row label="Color depth">
                        <Segmented<8 | 16>
                          label="PNG bit depth"
                          value={video.sequence.depth}
                          options={[
                            { value: 8, label: '8-bit' },
                            { value: 16, label: '16-bit' },
                          ]}
                          onChange={(depth) =>
                            updateVideo({ sequence: { ...video.sequence, depth } })
                          }
                        />
                      </Row>
                      <Row label="Put in a subfolder">
                        <Switch
                          label="Put in a subfolder"
                          checked={video.sequence.subfolder}
                          onChange={(subfolder) =>
                            updateVideo({ sequence: { ...video.sequence, subfolder } })
                          }
                        />
                      </Row>
                    </>
                  )}
                  {video.sequence.kind === 'flipbook' && video.sequence.flipbook.kind === 'pdf' && (
                    <>
                      <Row label="Paper">
                        <Segmented
                          label="Paper"
                          value={video.sequence.flipbook.paper}
                          options={[
                            { value: 'letter', label: 'Letter' },
                            { value: 'a4', label: 'A4' },
                            { value: '4x6', label: '4×6 cards' },
                          ]}
                          onChange={(paper) =>
                            updateVideo({
                              sequence: {
                                ...video.sequence,
                                flipbook: { ...video.sequence.flipbook, paper },
                              },
                            })
                          }
                        />
                      </Row>
                      <Row label="Frames per page">
                        <Segmented<4 | 8 | 12>
                          label="Frames per page"
                          value={video.sequence.flipbook.perPage}
                          options={[
                            { value: 4, label: '4' },
                            { value: 8, label: '8' },
                            { value: 12, label: '12' },
                          ]}
                          onChange={(perPage) =>
                            updateVideo({
                              sequence: {
                                ...video.sequence,
                                flipbook: { ...video.sequence.flipbook, perPage },
                              },
                            })
                          }
                        />
                      </Row>
                      <Row label="Binding margin (left edge)">
                        <NumberField
                          aria-label="Binding margin in inches"
                          min={0}
                          max={2}
                          step={0.125}
                          value={video.sequence.flipbook.bindingMargin}
                          onCommit={(committed) =>
                            updateVideo({
                              sequence: {
                                ...video.sequence,
                                flipbook: {
                                  ...video.sequence.flipbook,
                                  bindingMargin: Math.max(0, Math.min(2, committed || 0)),
                                },
                              },
                            })
                          }
                        />
                        <span className="render-unit">in</span>
                      </Row>
                      {(
                        [
                          ['cutLines', 'Cut lines'],
                          ['frameNumbers', 'Frame numbers'],
                          ['cover', 'Cover page'],
                        ] as const
                      ).map(([key, label]) => (
                        <Row key={key} label={label}>
                          <Switch
                            label={label}
                            checked={video.sequence.flipbook[key]}
                            onChange={(value) =>
                              updateVideo({
                                sequence: {
                                  ...video.sequence,
                                  flipbook: { ...video.sequence.flipbook, [key]: value },
                                },
                              })
                            }
                          />
                        </Row>
                      ))}
                    </>
                  )}
                  {video.sequence.kind === 'flipbook' &&
                    video.sequence.flipbook.kind === 'sprite' && (
                      <>
                        <Row label="Columns">
                          <Segmented<'auto' | 10 | 16 | 'row'>
                            label="Columns"
                            value={video.sequence.flipbook.columns}
                            options={[
                              { value: 'auto', label: 'Auto' },
                              { value: 10, label: '10' },
                              { value: 16, label: '16' },
                              { value: 'row', label: '1 row' },
                            ]}
                            onChange={(columns) =>
                              updateVideo({
                                sequence: {
                                  ...video.sequence,
                                  flipbook: { ...video.sequence.flipbook, columns },
                                },
                              })
                            }
                          />
                        </Row>
                        <Row label="Also save frame data (JSON)">
                          <Switch
                            label="Also save frame data (JSON)"
                            checked={video.sequence.flipbook.json}
                            onChange={(json) =>
                              updateVideo({
                                sequence: {
                                  ...video.sequence,
                                  flipbook: { ...video.sequence.flipbook, json },
                                },
                              })
                            }
                          />
                        </Row>
                      </>
                    )}
                </section>
              )}
              {video.preset === 'custom' && (
                <section className="render-card">
                  <h4>Custom size</h4>
                  <Row label="Aspect">
                    <div className="render-chips">
                      {CUSTOM_ASPECTS.map((aspect) => (
                        <button
                          key={aspect.label}
                          type="button"
                          aria-pressed={
                            Math.abs(
                              video.frame.width / video.frame.height - aspect.width / aspect.height,
                            ) < 0.005
                          }
                          onClick={() =>
                            updateFrame({ width: aspect.width, height: aspect.height })
                          }
                        >
                          {aspect.label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label="Size">
                    <NumberField
                      aria-label="Width"
                      min={16}
                      max={7680}
                      step={2}
                      value={video.frame.width}
                      onCommit={(committed) => {
                        const width = Math.max(16, Math.min(7680, Math.round(committed || 16)));
                        updateFrame({
                          width,
                          ...(aspectLock
                            ? {
                                height: Math.max(
                                  16,
                                  Math.round((width * video.frame.height) / video.frame.width / 2) *
                                    2,
                                ),
                              }
                            : {}),
                        });
                      }}
                    />
                    <span className="render-unit">×</span>
                    <NumberField
                      aria-label="Height"
                      min={16}
                      max={4320}
                      step={2}
                      value={video.frame.height}
                      onCommit={(committed) => {
                        const height = Math.max(16, Math.min(4320, Math.round(committed || 16)));
                        updateFrame({
                          height,
                          ...(aspectLock
                            ? {
                                width: Math.max(
                                  16,
                                  Math.round(
                                    (height * video.frame.width) / video.frame.height / 2,
                                  ) * 2,
                                ),
                              }
                            : {}),
                        });
                      }}
                    />
                    <span className="render-unit">px</span>
                    <Switch
                      label="Lock aspect ratio"
                      checked={aspectLock}
                      onChange={setAspectLock}
                    />
                  </Row>
                </section>
              )}
              {aspectDiffers && (
                <section className="render-card">
                  <h4>
                    Fit · {sourceSize.width} × {sourceSize.height} source into {video.frame.width} ×{' '}
                    {video.frame.height}
                  </h4>
                  <div className="render-fit">
                    <FramingDiagram
                      sourceAspect={sourceAspect}
                      width={video.frame.width}
                      height={video.frame.height}
                      fit={video.frame.fit}
                    />
                    <div className="render-fit-controls">
                      <Segmented
                        label="Fit"
                        value={video.frame.fit}
                        options={FIT_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
                        onChange={(fit) => updateFrame({ fit })}
                        wide
                      />
                      <p className="render-hint">
                        {fitHint(
                          video.frame.fit,
                          sourceAspect,
                          video.frame.width / video.frame.height,
                        )}
                      </p>
                    </div>
                  </div>
                  {video.frame.fit !== 'stretch' && video.frame.fit !== 'crop' && (
                    <>
                      <Row label="Bars">
                        <Segmented<BarsMode>
                          label="Bars"
                          value={video.frame.bars}
                          options={[
                            { value: 'black', label: 'Black' },
                            { value: 'blur', label: 'Blurred video' },
                            { value: 'color', label: 'Color' },
                            { value: 'transparent', label: 'Transparent' },
                          ]}
                          onChange={(bars) => updateFrame({ bars })}
                        />
                      </Row>
                      {video.frame.bars === 'blur' && (
                        <>
                          <SliderRow
                            label="Blur"
                            value={video.frame.barBlur}
                            min={0}
                            max={1}
                            step={0.01}
                            format={(v) => `${Math.round(v * 100)}%`}
                            onChange={(barBlur) => updateFrame({ barBlur })}
                          />
                          <SliderRow
                            label="Darken"
                            value={video.frame.barDarken}
                            min={0}
                            max={1}
                            step={0.01}
                            format={(v) => `${Math.round(v * 100)}%`}
                            onChange={(barDarken) => updateFrame({ barDarken })}
                          />
                        </>
                      )}
                      {video.frame.bars === 'color' && (
                        <Row label="Bar color">
                          <input
                            type="color"
                            aria-label="Bar color"
                            value={video.frame.barColor}
                            onChange={(event) => updateFrame({ barColor: event.target.value })}
                          />
                        </Row>
                      )}
                    </>
                  )}
                  {video.frame.fit === 'crop' && (
                    <Row
                      label="Keep in frame"
                      hint={
                        video.frame.anchor === 'subject'
                          ? 'Follow subject keeps the picture centered for now; subject tracking for crops is coming.'
                          : undefined
                      }
                    >
                      <Segmented<CropAnchor>
                        label="Keep in frame"
                        value={video.frame.anchor}
                        options={[
                          { value: 'center', label: 'Center' },
                          { value: 'top', label: 'Top' },
                          { value: 'subject', label: 'Follow subject' },
                        ]}
                        onChange={(anchor) => updateFrame({ anchor })}
                      />
                    </Row>
                  )}
                </section>
              )}
              {upscale > 1.001 && (
                <section className="render-card">
                  <h4>
                    Upscaling · source is {sourceSize.width} × {sourceSize.height}, target is{' '}
                    {video.frame.width} × {video.frame.height} (
                    {upscale.toFixed(upscale >= 10 ? 0 : 1)}×)
                  </h4>
                  <Segmented<UpscaleMethod>
                    label="Upscaling method"
                    value={video.upscale.method}
                    options={UPSCALE_METHODS.map((method) => ({
                      value: method.id,
                      label: method.label,
                    }))}
                    onChange={(method) => updateVideo({ upscale: { ...video.upscale, method } })}
                    wide
                  />
                  <p className="render-hint">
                    {UPSCALE_METHODS.find((method) => method.id === video.upscale.method)?.hint}
                  </p>
                  {video.upscale.method === 'upscale-result' && (
                    <>
                      <div className="render-engines" role="radiogroup" aria-label="Upscaler">
                        {UPSCALE_ENGINES.map((engine) => (
                          <button
                            key={engine.id}
                            type="button"
                            role="radio"
                            aria-checked={video.upscale.engine === engine.id}
                            disabled={engine.id === 'mcp'}
                            onClick={() =>
                              updateVideo({
                                upscale: {
                                  ...video.upscale,
                                  engine: engine.id,
                                  model: AI_MODELS[engine.id]?.[0] ?? video.upscale.model,
                                },
                              })
                            }
                          >
                            <strong>{engine.name}</strong>
                            <span className="render-engine-tag">{engine.tag}</span>
                            <span>{engine.description}</span>
                          </button>
                        ))}
                      </div>
                      {AI_MODELS[video.upscale.engine] && (
                        <>
                          <Row label="Model">
                            <select
                              aria-label="Upscaler model"
                              value={video.upscale.model}
                              onChange={(event) =>
                                updateVideo({
                                  upscale: { ...video.upscale, model: event.target.value },
                                })
                              }
                            >
                              {AI_MODELS[video.upscale.engine]!.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                          </Row>
                          <SliderRow
                            label="Mix with original"
                            value={video.upscale.mix}
                            min={0}
                            max={1}
                            step={0.01}
                            format={(v) => `${Math.round(v * 100)}%`}
                            onChange={(mix) => updateVideo({ upscale: { ...video.upscale, mix } })}
                          />
                          <p className="render-hint">
                            Blends some sharp nearest-neighbor pixels back in, so AI smoothing
                            doesn’t erase the glitch texture.
                          </p>
                        </>
                      )}
                      {video.upscale.engine === 'command' && (
                        <Row
                          label="Command line"
                          hint="GLEECH passes each frame as a PNG, fills in {in}, {out}, {scale} and {frame}, then waits for {out}."
                        >
                          <input
                            type="text"
                            className="render-command"
                            aria-label="Upscaler command line"
                            placeholder="C:\Tools\my-upscaler.exe -i {in} -o {out} -s {scale}"
                            value={video.upscale.command}
                            onChange={(event) =>
                              updateVideo({
                                upscale: { ...video.upscale, command: event.target.value },
                              })
                            }
                          />
                        </Row>
                      )}
                    </>
                  )}
                </section>
              )}
              <section className="render-card">
                <Row
                  label={
                    <span className="render-card-title">
                      Effects only (transparent overlay)
                      <small>
                        Leaves out the source footage and keeps what the effects add, with an alpha
                        channel.
                      </small>
                    </span>
                  }
                >
                  <Switch
                    label="Effects only (transparent overlay)"
                    checked={video.overlay.enabled}
                    onChange={(enabled) => updateVideo({ overlay: { ...video.overlay, enabled } })}
                  />
                </Row>
                {video.overlay.enabled && (
                  <>
                    <Row label="Matte" hint={MATTE_HINTS[video.overlay.matte]}>
                      <Segmented
                        label="Matte"
                        value={video.overlay.matte}
                        options={[
                          { value: 'difference', label: 'Difference from source' },
                          { value: 'added-light', label: 'Added light only' },
                        ]}
                        onChange={(matte) => updateVideo({ overlay: { ...video.overlay, matte } })}
                      />
                    </Row>
                    <SliderRow
                      label="Threshold"
                      value={video.overlay.threshold}
                      min={0}
                      max={0.5}
                      step={0.005}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(threshold) =>
                        updateVideo({ overlay: { ...video.overlay, threshold } })
                      }
                    />
                    <SliderRow
                      label="Edge softness"
                      value={video.overlay.softness}
                      min={0}
                      max={1}
                      step={0.01}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(softness) =>
                        updateVideo({ overlay: { ...video.overlay, softness } })
                      }
                    />
                    <Row label="Alpha">
                      <Segmented
                        label="Alpha"
                        value={video.overlay.alpha}
                        options={[
                          { value: 'straight', label: 'Straight' },
                          { value: 'premultiplied', label: 'Premultiplied' },
                        ]}
                        onChange={(alpha) => updateVideo({ overlay: { ...video.overlay, alpha } })}
                      />
                    </Row>
                  </>
                )}
              </section>
              {resolved.kind !== 'pdf' && resolved.kind !== 'sprite' && (
                <section className="render-card">
                  <Row
                    label={
                      <span className="render-card-title with-icon">
                        <WaveformIcon />{' '}
                        {resolved.kind === 'files'
                          ? 'Also export audio as a separate file'
                          : 'Audio'}
                      </span>
                    }
                    hint={
                      !hasTrack && !hasClip
                        ? 'Add an audio track in Timeline mode to include sound.'
                        : undefined
                    }
                  >
                    <Switch
                      label={
                        resolved.kind === 'files' ? 'Also export audio as a separate file' : 'Audio'
                      }
                      checked={
                        resolved.kind === 'files'
                          ? video.sequence.separateAudio && video.audio.enabled
                          : video.audio.enabled
                      }
                      disabled={!hasTrack && !hasClip}
                      onChange={(enabled) =>
                        resolved.kind === 'files'
                          ? updateVideo({
                              sequence: { ...video.sequence, separateAudio: enabled },
                              audio: { ...video.audio, enabled: enabled || video.audio.enabled },
                            })
                          : updateVideo({ audio: { ...video.audio, enabled } })
                      }
                    />
                  </Row>
                  {videoAudioOn && (resolved.kind === 'movie' || video.sequence.separateAudio) && (
                    <>
                      <Row label="Source">
                        <Segmented
                          label="Audio source"
                          value={
                            videoAudioSources(video, timeline).track &&
                            videoAudioSources(video, timeline).clip
                              ? 'mix'
                              : videoAudioSources(video, timeline).clip
                                ? 'clip'
                                : 'track'
                          }
                          options={[
                            {
                              value: 'track',
                              label: timeline.audio?.name ?? 'Audio track',
                              disabled: !hasTrack,
                            },
                            { value: 'clip', label: 'Clip audio', disabled: !hasClip },
                            { value: 'mix', label: 'Mix both', disabled: !hasTrack || !hasClip },
                          ]}
                          onChange={(sourceChoice) =>
                            updateVideo({ audio: { ...video.audio, source: sourceChoice } })
                          }
                        />
                      </Row>
                      {resolved.kind === 'movie' && (
                        <Row label="Quality">
                          <select
                            aria-label="Audio quality"
                            value={`${video.audio.codec}:${video.audio.bitrateKbps}`}
                            onChange={(event) => {
                              const [codec, kbps] = event.target.value.split(':');
                              updateVideo({
                                audio: {
                                  ...video.audio,
                                  codec: codec as 'aac' | 'pcm',
                                  bitrateKbps: Number(kbps),
                                },
                              });
                            }}
                          >
                            {AUDIO_QUALITY.map((quality) => (
                              <option
                                key={quality.label}
                                value={`${quality.codec}:${quality.kbps}`}
                              >
                                {quality.label}
                              </option>
                            ))}
                          </select>
                        </Row>
                      )}
                      <Row label="Sample rate">
                        <span className="render-mono">48 kHz</span>
                      </Row>
                      <Row
                        label="Normalize loudness"
                        hint="−14 LUFS, the streaming and social standard"
                      >
                        <Switch
                          label="Normalize loudness"
                          checked={video.audio.normalize}
                          onChange={(normalize) =>
                            updateVideo({ audio: { ...video.audio, normalize } })
                          }
                        />
                      </Row>
                      <SliderRow
                        label="Fade in"
                        value={video.audio.fadeIn}
                        min={0}
                        max={3}
                        step={0.05}
                        format={(v) => `${v.toFixed(2)} s`}
                        onChange={(fadeIn) => updateVideo({ audio: { ...video.audio, fadeIn } })}
                      />
                      <SliderRow
                        label="Fade out"
                        value={video.audio.fadeOut}
                        min={0}
                        max={3}
                        step={0.05}
                        format={(v) => `${v.toFixed(2)} s`}
                        onChange={(fadeOut) => updateVideo({ audio: { ...video.audio, fadeOut } })}
                      />
                    </>
                  )}
                </section>
              )}
            </>
          ) : (
            <>
              <h3>Preset</h3>
              <div className="render-presets five">
                {GIF_PRESETS.map((preset) =>
                  presetTile(preset.id, gif.preset === preset.id, preset.label, preset.hint, () =>
                    setGif((previous) => applyGifPreset(previous, preset.id)),
                  ),
                )}
              </div>
              <h3>Format</h3>
              <Segmented
                label="Loop format"
                value={gif.format}
                options={LOOP_FORMATS.map((format) => ({ value: format.id, label: format.label }))}
                onChange={(format) =>
                  updateGif({ format, ...(format === 'mp4' ? {} : { audio: false }) }, true)
                }
                wide
              />
              <p className="render-hint">
                {LOOP_FORMATS.find((format) => format.id === gif.format)?.hint}
              </p>
              <section className="render-card">
                <h4>Playback</h4>
                <Row
                  label="Loop style"
                  hint={LOOP_STYLES.find((style) => style.id === gif.loop)?.hint}
                >
                  <Segmented
                    label="Loop style"
                    value={gif.loop}
                    options={LOOP_STYLES.map((style) => ({ value: style.id, label: style.label }))}
                    onChange={(loop) => updateGif({ loop }, true)}
                  />
                </Row>
                {gif.loop === 'concat' && (
                  <div className="render-segments">
                    {gif.segments.map((segment, index) => (
                      <span key={`${segment.start}:${index}`} className="render-segment-chip">
                        {index + 1} · {shortTime(segment.start)}–{shortTime(segment.end)}
                        <button
                          type="button"
                          aria-label={`Remove segment ${index + 1}`}
                          onClick={() =>
                            updateGif(
                              { segments: gif.segments.filter((_, i) => i !== index) },
                              true,
                            )
                          }
                        >
                          <CloseIcon />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="render-add-segment"
                      onClick={() =>
                        updateGif(
                          { segments: [...gif.segments, { start: range.start, end: range.end }] },
                          true,
                        )
                      }
                    >
                      + Add segment (
                      {rangeKind === 'work'
                        ? 'work area'
                        : rangeKind === 'inout'
                          ? 'In / Out'
                          : 'whole timeline'}
                      )
                    </button>
                    {timeline.markers.length > 1 && (
                      <button
                        type="button"
                        className="render-add-segment"
                        onClick={() => {
                          const sorted = [...timeline.markers].sort((a, b) => a.t - b.t);
                          updateGif(
                            {
                              segments: sorted
                                .slice(0, -1)
                                .map((marker, index) => ({
                                  start: marker.t,
                                  end: sorted[index + 1]!.t,
                                }))
                                .filter((segment) => segment.end > segment.start),
                            },
                            true,
                          );
                        }}
                      >
                        Use markers
                      </button>
                    )}
                  </div>
                )}
                <SliderRow
                  label="Speed"
                  value={gif.speed}
                  min={0.25}
                  max={4}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(speed) => updateGif({ speed }, true)}
                />
                <Row label="Frame rate">
                  <Segmented<GifRenderSettings['fps']>
                    label="Loop frame rate"
                    value={gif.fps}
                    options={[10, 12, 15, 24, 30].map((fps) => ({
                      value: fps as GifRenderSettings['fps'],
                      label: String(fps),
                    }))}
                    onChange={(fps) => updateGif({ fps })}
                  />
                </Row>
                <Row label="Smoothing" hint="Fills in frames when the frame rate drops">
                  <Segmented
                    label="Smoothing"
                    value={gif.smoothing}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'blend', label: 'Frame blend' },
                      { value: 'motion', label: 'Motion', disabled: gif.transparent },
                    ]}
                    onChange={(smoothing) => updateGif({ smoothing }, true)}
                  />
                </Row>
                <Row label="Repeat">
                  <Segmented
                    label="Repeat"
                    value={gif.repeat}
                    options={[
                      { value: 'forever', label: 'Forever' },
                      { value: 'once', label: 'Once' },
                      { value: '3', label: '3×' },
                    ]}
                    onChange={(repeat) => updateGif({ repeat }, true)}
                  />
                </Row>
              </section>
              <section className="render-card">
                <h4>Size</h4>
                <Row label="Width" hint="Height follows the aspect ratio.">
                  <NumberField
                    aria-label="Loop width in pixels"
                    min={16}
                    max={2048}
                    value={gif.width}
                    onCommit={(committed) =>
                      updateGif({
                        width: Math.max(16, Math.min(2048, Math.round(committed || 16))),
                      })
                    }
                  />
                  <span className="render-unit">px · {gifSize.height} px high</span>
                </Row>
                <Row label="Scaling">
                  <Segmented
                    label="Scaling"
                    value={gif.scaling}
                    options={[
                      { value: 'lanczos', label: 'Lanczos' },
                      { value: 'bicubic', label: 'Bicubic' },
                      { value: 'nearest', label: 'Nearest (pixel art)' },
                    ]}
                    onChange={(scaling) => updateGif({ scaling })}
                  />
                </Row>
                <Row
                  label="Keep file under"
                  hint={
                    overLimit
                      ? `→ trimmed to fit ${gif.sizeLimitMb} MB: frame rate, colors or width are lowered automatically.`
                      : 'Quality is lowered automatically to fit.'
                  }
                >
                  <Segmented<GifRenderSettings['sizeLimitMb']>
                    label="Keep file under"
                    value={gif.sizeLimitMb}
                    options={[
                      { value: 0, label: 'No limit' },
                      { value: 8, label: '8 MB' },
                      { value: 15, label: '15 MB' },
                      { value: 1, label: '1 MB' },
                    ]}
                    onChange={(sizeLimitMb) => updateGif({ sizeLimitMb })}
                  />
                </Row>
              </section>
              {gif.format === 'gif' && (
                <section className="render-card">
                  <h4>Color palette (palettegen)</h4>
                  <SliderRow
                    label="Colors"
                    value={gif.colors}
                    min={2}
                    max={256}
                    step={1}
                    format={(v) => String(v)}
                    onChange={(colors) => updateGif({ colors })}
                  />
                  <Row label="Palette from">
                    <Segmented
                      label="Palette from"
                      value={gif.palette}
                      options={[
                        { value: 'whole', label: 'Whole clip' },
                        { value: 'frame', label: 'Each frame' },
                        { value: 'changes', label: 'Changes only' },
                      ]}
                      onChange={(palette) => updateGif({ palette })}
                    />
                  </Row>
                  <Row label="Dither">
                    <Segmented
                      label="Dither"
                      value={gif.dither}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'bayer', label: 'Bayer' },
                        { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
                        { value: 'sierra', label: 'Sierra' },
                      ]}
                      onChange={(dither) => updateGif({ dither })}
                    />
                  </Row>
                  <SliderRow
                    label="Lossy"
                    value={gif.lossy}
                    min={0}
                    max={100}
                    step={1}
                    format={(v) => String(v)}
                    onChange={(lossy) => updateGif({ lossy })}
                  />
                </section>
              )}
              <section className="render-card">
                <Row
                  label="Effects only (transparent background)"
                  hint={gifTransparencyHint(gif.format)}
                >
                  <Switch
                    label="Effects only (transparent background)"
                    checked={gif.transparent && gif.format !== 'mp4'}
                    disabled={gif.format === 'mp4'}
                    onChange={(transparent) =>
                      updateGif(
                        {
                          transparent,
                          ...(transparent && gif.smoothing === 'motion'
                            ? { smoothing: 'blend' }
                            : {}),
                        },
                        true,
                      )
                    }
                  />
                </Row>
                <Row
                  label="Audio"
                  hint={
                    !hasTrack
                      ? 'Add an audio track in Timeline mode to include sound.'
                      : !audibleTrack(timeline)
                        ? 'The audio track is muted in the timeline.'
                        : gif.loop === 'concat' && gif.format === 'mp4'
                          ? 'Concat loops jump between ranges, so they are silent.'
                          : gifAudioHint(gif.format)
                  }
                >
                  <Switch
                    label="Loop audio"
                    checked={gif.audio && loopAudioAvailable(gif, timeline)}
                    disabled={
                      !loopAudioAvailable({ ...gif, format: 'mp4' }, timeline) ||
                      gif.format !== 'mp4'
                    }
                    onChange={(audio) => updateGif({ audio }, true)}
                  />
                </Row>
              </section>
            </>
          )}
        </div>
      </div>
      <footer className="render-footer">
        <span className="render-footer-note">
          <span className="mode-chip-dot" aria-hidden="true" />
          {error ??
            (clipOffline
              ? 'The video clip is offline or still loading.'
              : 'Renders on the GPU in the background, so you can keep editing')}
        </span>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={ffmpegMissing || clipOffline || !outputPath}
          onClick={() => submit(false)}
        >
          Add to Queue
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={ffmpegMissing || clipOffline || !outputPath}
          onClick={() => submit(true)}
        >
          {tab === 'video' ? videoRenderLabel(video, videoTimes.length) : gifRenderLabel(gif)}
        </button>
      </footer>
    </dialog>
  );
}
