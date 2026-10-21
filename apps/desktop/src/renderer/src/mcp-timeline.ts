// MCP actions the renderer answers for Timeline mode: the playhead, render
// presets and background render jobs. Timeline edits (keys, modulators, active
// ranges, timeline settings) are project edits and go through
// @gleech/mcp/commands like every other stack edit.
import {
  GIF_PRESET_IDS,
  MCP_UPSCALE_ENGINES,
  VIDEO_FORMAT_IDS,
  VIDEO_PRESET_IDS,
  renderOutputIsFolder,
  renderOverrides,
  type McpGifOverrides,
  type McpRequest,
  type McpVideoOverrides,
} from '@gleech/mcp/protocol';
import { timelineInfo } from '@gleech/mcp/commands';
import {
  clampFrame,
  formatTimecode,
  frameCount,
  frameTime,
  timeFrame,
  type ProjectState,
  type Timeline,
  activeVideo,
} from '@gleech/project-model';
import { unwrap } from '../../shared/image-api';
import type {
  GifRenderSettings,
  RenderRange,
  RenderTab,
  UpscaleMethod,
  VideoRenderSettings,
} from '../../shared/render';
import {
  COMPRESSION_CHOICES,
  FIT_MODES,
  GIF_PRESETS,
  LOOP_FORMATS,
  LOOP_STYLES,
  VIDEO_FORMATS,
  VIDEO_PRESETS,
  applyGifPreset,
  applyVideoPreset,
  compressionAdvanced,
  defaultGifSettings,
  defaultVideoSettings,
  estimateGifSize,
  estimateVideoSize,
  formatSize,
  gifFrameCount,
  gifOutputExtension,
  gifOutputLabel,
  gifOutputSize,
  resolveVideoOutput,
  type SourceInfo,
} from '../../shared/render-presets';
import { renderRange } from '../../shared/render-plan';
import { buildRenderRequest, renderSourceSize, videoAudioActive } from './render-request';
import { renderQueue, type RenderJob } from './render-queue';

/** Actions runTimelineMcp answers; App routes these here instead of the command adapter. */
export const TIMELINE_MCP_ACTIONS: readonly string[] = [
  'get_timeline',
  'set_playhead',
  'list_render_presets',
  'render_video',
  'render_status',
];

export interface TimelineMcpContext {
  /** MCP dispatch ID; main reads the pending request through it. */
  readonly dispatchId: string;
  project(): ProjectState;
  /** The command adapter's revision (adapter.state().revision). */
  revision(): number;
  /** Current playhead frame. */
  playhead(): number;
  setPlayhead(frame: number): void;
  /** Registered media ID of the timeline's video clip, if one is open. */
  videoMediaId(): string | null;
  readonly signal: AbortSignal;
  /** Milliseconds since the epoch. */
  readonly deadline: number;
}

type RenderVideoRequest = Extract<McpRequest, { action: 'render_video' }>;

// The protocol mirrors shared/render.ts. These fail to compile when they drift.
type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> | undefined }
    : T;
const videoOverrides = (value: McpVideoOverrides): DeepPartial<VideoRenderSettings> => value;
const gifOverrides = (value: McpGifOverrides): DeepPartial<GifRenderSettings> => value;

const ACTIVE = new Set<RenderJob['status']>(['queued', 'rendering', 'encoding']);
/** Jobs queued through MCP; only these report full paths to clients. */
const mcpJobs = new Set<string>();

const UPSCALE_METHODS = [
  {
    id: 'native',
    label: 'Render at full size',
    hint: 'Effects are drawn natively at the target size: the sharpest glitch texture, but the slowest. 8K needs about 8 GB of GPU memory.',
  },
  {
    id: 'upscale-result',
    label: 'Upscale result (fast)',
    hint: 'Renders at the source size, then upscales each finished frame with upscale.engine.',
  },
  {
    id: 'upscale-source',
    label: 'Upscale source first',
    hint: 'Enlarges the source before the effects run, so effects work on more pixels.',
  },
] as const satisfies readonly { id: UpscaleMethod; label: string; hint: string }[];
const UPSCALE_ENGINES = [
  {
    id: 'realesrgan',
    label: 'Real-ESRGAN',
    hint: 'AI; sharp, clean detail on any Vulkan GPU. Needs realesrgan-ncnn-vulkan.',
    models: ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime'],
  },
  {
    id: 'realcugan',
    label: 'Real-CUGAN',
    hint: 'AI; good on flat colors and line art. Needs realcugan-ncnn-vulkan.',
    models: ['models-se', 'models-pro', 'models-nose'],
  },
  {
    id: 'waifu2x',
    label: 'waifu2x',
    hint: 'AI; gentle, low-noise upscaling. Needs waifu2x-ncnn-vulkan.',
    models: ['models-cunet', 'models-upconv_7_anime_style_art_rgb'],
  },
  { id: 'lanczos', label: 'Lanczos', hint: 'Built in; smooth, fast resampling.', models: [] },
  {
    id: 'nearest',
    label: 'Nearest neighbor',
    hint: 'Built in; crisp pixel blocks for pixel-art glitches.',
    models: [],
  },
] as const satisfies readonly {
  id: (typeof MCP_UPSCALE_ENGINES)[number];
  label: string;
  hint: string;
  models: readonly string[];
}[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Deep-merge validated overrides: groups merge key by key; values and lists replace. */
function merged<T>(base: T, change: unknown): T {
  if (!isRecord(base) || !isRecord(change)) return (change === undefined ? base : change) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(change))
    if (value !== undefined) result[key] = merged(base[key], value);
  return result as T;
}
function omit<T extends object>(value: T, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
/** Video settings as clients may override them (no preset id, subfolder or command). */
function videoSettingsView(video: VideoRenderSettings) {
  return {
    ...omit(video, 'preset'),
    sequence: omit(video.sequence, 'subfolder'),
    upscale: omit(video.upscale, 'command'),
  };
}
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
const round = (value: number, places = 3) => Number(value.toFixed(places));
function noTimeline(): never {
  throw new Error('This project has no timeline yet. Create one with set_timeline first.');
}

/** Preset settings with the request's overrides, as the Render dialog would hold them. */
export function mcpRenderSettings(
  request: Pick<RenderVideoRequest, 'tab' | 'preset' | 'overrides'>,
  source: SourceInfo,
): { tab: RenderTab; video: VideoRenderSettings; gif: GifRenderSettings } {
  const settings = renderOverrides(request);
  let video = defaultVideoSettings(source);
  let gif = defaultGifSettings();
  if (settings.tab === 'video') {
    const overrides = settings.overrides;
    const preset = VIDEO_PRESET_IDS.find((id) => id === request.preset) ?? '1080p-social';
    video = merged(applyVideoPreset(video, preset, source), videoOverrides(overrides));
    // Encoder defaults follow compression and frame rate, as in the dialog.
    if (overrides.compression !== undefined || overrides.fps !== undefined)
      video = {
        ...video,
        advanced: merged(
          compressionAdvanced(video.compression, video.fps, video.advanced.encoder),
          overrides.advanced,
        ),
      };
    if (overrides.sequence?.kind !== undefined && overrides.output === undefined)
      video = { ...video, output: 'sequence' };
    if (overrides.sequence?.kind === 'flipbook' && overrides.sequence.every === undefined)
      video = { ...video, sequence: { ...video.sequence, every: '2' } };
    // MCP names the exact folder that receives sequence frames.
    video = { ...video, sequence: { ...video.sequence, subfolder: false } };
  } else {
    const preset = GIF_PRESET_IDS.find((id) => id === request.preset) ?? 'social';
    gif = merged(applyGifPreset(gif, preset), gifOverrides(settings.overrides));
  }
  return { tab: settings.tab, video, gif };
}

function resolveRange(
  range: RenderVideoRequest['range'],
  timeline: Timeline,
): RenderRange | { kind: 'custom'; start: number; end: number } {
  const end = frameCount(timeline) / timeline.fps;
  if (range === undefined) return renderRange(timeline.workArea ? 'work' : 'whole', timeline);
  if (range === 'work' && !timeline.workArea)
    throw new Error(
      'This timeline has no work area. Use range "whole", an explicit {start, end}, or set workArea with set_timeline.',
    );
  if (range === 'inout' && !timeline.inOut)
    throw new Error(
      'This timeline has no In/Out points. Use range "whole", an explicit {start, end}, or set inOut with set_timeline.',
    );
  if (typeof range === 'string') return renderRange(range, timeline);
  if (range.end > end + 1e-6)
    throw new Error(
      `The range end (${range.end} s) is after the timeline end (${round(end)} s). Extend the timeline with set_timeline first.`,
    );
  const start = frameTime(timeFrame(range.start, timeline.fps), timeline.fps);
  const stop = Math.min(end, frameTime(timeFrame(range.end, timeline.fps), timeline.fps));
  if (!(stop > start))
    throw new Error(`The render range must cover at least one frame at ${timeline.fps} fps.`);
  return { kind: 'custom', start, end: stop };
}

function jobInfo(job: RenderJob) {
  const mine = mcpJobs.has(job.id);
  return {
    jobId: job.id,
    kind: job.kind,
    label: job.result ? fileName(job.result.outputPath) : job.label,
    status: job.status,
    framesDone: job.done,
    framesTotal: job.total,
    progress: job.total ? round(job.done / job.total) : 0,
    startedBy: mine ? 'mcp' : 'app',
    // The encoder may correct the extension or pick "name (2)" for a busy file.
    ...(mine ? { requestedPath: job.outputPath } : {}),
    ...(mine && job.result ? { outputPath: job.result.outputPath } : {}),
    ...(job.result
      ? {
          bytes: job.result.bytes,
          size: formatSize(job.result.bytes),
          files: job.result.files,
          notes: job.result.notes,
        }
      : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.startedAt !== null && ACTIVE.has(job.status)
      ? { elapsedSeconds: round((performance.now() - job.startedAt) / 1000, 1) }
      : {}),
  };
}

function findJob(jobId: string): RenderJob {
  const job = renderQueue.snapshot().find((entry) => entry.id === jobId);
  if (!job)
    throw new Error(
      'Render job does not exist (finished jobs disappear when dismissed in the app). Call render_status without jobId to list jobs.',
    );
  return job;
}

/** Wait for a job to finish; resolves with its latest state at the deadline. */
function waitForJob(jobId: string, signal: AbortSignal, deadline: number): Promise<RenderJob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      finish();
    };
    const check = () => {
      const job = renderQueue.snapshot().find((entry) => entry.id === jobId);
      if (!job) settle(() => reject(new Error('The render job was dismissed.')));
      else if (!ACTIVE.has(job.status)) settle(() => resolve(job));
    };
    const abort = () => {
      renderQueue.cancel(jobId);
      settle(() =>
        reject(new Error('Render request cancelled; its render job was cancelled too.')),
      );
    };
    const unsubscribe = renderQueue.subscribe(check);
    // Reply before main's own timeout so the client still gets the job ID.
    const timer = setTimeout(
      () => settle(() => resolve(findJob(jobId))),
      Math.max(0, deadline - Date.now() - 2500),
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}

async function renderVideo(request: RenderVideoRequest, context: TimelineMcpContext) {
  const project = context.project();
  const timeline = project.timeline;
  if (!project.source) throw new Error('Open an image in GLEECH before rendering.');
  if (!timeline) noTimeline();
  if (request.expectedRevision !== undefined && request.expectedRevision !== context.revision())
    throw new Error(
      'Project changed since it was inspected. Refresh get_project_state and retry with its revision.',
    );
  const videoMediaId = context.videoMediaId();
  if (activeVideo(project) && !videoMediaId)
    throw new Error(
      'The timeline’s video clip is not loaded yet. Open Timeline mode in GLEECH and retry.',
    );
  const sourceSize = renderSourceSize(project, timeline);
  const { tab, video, gif } = mcpRenderSettings(request, { ...sourceSize, fps: timeline.fps });
  const range = resolveRange(request.range, timeline);
  const end = frameCount(timeline) / timeline.fps;
  const resolved = resolveVideoOutput(video);
  const folder = tab === 'video' && resolved.kind === 'files';
  if (folder !== renderOutputIsFolder(request))
    throw new Error('GLEECH could not decide whether this render writes a file or a folder.');
  if (tab === 'video' && video.frame.width * video.frame.height > 64 * 1024 * 1024)
    throw new Error('The output frame is too large. Keep width × height under 64 megapixels.');
  if (tab === 'gif' && gif.loop === 'concat')
    for (const segment of gif.segments)
      if (segment.end > end + 1e-6)
        throw new Error(
          `A Concat segment ends at ${segment.end} s, after the timeline end (${round(end)} s).`,
        );
  const extension = tab === 'video' ? resolved.extension : gifOutputExtension(gif);
  const outputLabel = tab === 'video' ? resolved.label : gifOutputLabel(gif);
  if (extension && !request.path.toLowerCase().endsWith(`.${extension}`))
    throw new Error(
      `This render writes ${outputLabel}. End path with .${extension}, or change the format.`,
    );
  const needsFfmpeg =
    tab === 'gif' ||
    resolved.kind === 'movie' ||
    (videoAudioActive(video, timeline) && video.sequence.separateAudio);
  if (needsFfmpeg && !unwrap(await window.gleech.renderStatus()).available)
    throw new Error(
      'ffmpeg is not available, so GLEECH cannot encode this render. Locate ffmpeg in the Render dialog, or render a PNG sequence (overrides.output "sequence").',
    );
  // Main validates the path against approved Exports folders and overwrite.
  const outputPath = unwrap(await window.gleech.mcpRenderTarget(context.dispatchId));
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new Error('GLEECH render request expired.');
  if (context.project() !== project)
    throw new Error(
      'The project changed while the render was being prepared. Inspect it and retry.',
    );
  if (extension && !outputPath.toLowerCase().endsWith(`.${extension}`))
    throw new Error(`End path with .${extension}.`);
  // The target check passes for a path a queued render has not written yet.
  if (
    renderQueue
      .snapshot()
      .some(
        (entry) =>
          ACTIVE.has(entry.status) && entry.outputPath.toLowerCase() === outputPath.toLowerCase(),
      )
  )
    throw new Error('Another queued render already writes to this path. Choose a different path.');
  const job = buildRenderRequest({
    tab,
    video,
    gif,
    project,
    timeline,
    range,
    outputPath,
    videoMediaId,
  });
  const seconds = range.end - range.start;
  const sourceAspect = sourceSize.width / sourceSize.height;
  const estimate =
    tab === 'video'
      ? estimateVideoSize(video, job.times.length, video.fps, videoAudioActive(video, timeline))
      : estimateGifSize(gif, gifFrameCount(gif, seconds), sourceAspect);
  const notes: string[] = [];
  if (tab === 'video' && resolved.kind === 'movie' && resolved.switched)
    notes.push(resolved.switched);
  if (tab === 'gif' && 'overLimit' in estimate && estimate.overLimit)
    notes.push(
      `The typical size is over the ${gif.sizeLimitMb} MB limit, so the encoder will reduce the loop to fit.`,
    );
  const jobId = renderQueue.enqueue(job);
  mcpJobs.add(jobId);
  const summary = {
    revision: context.revision(),
    jobId,
    tab,
    preset: tab === 'video' ? video.preset : gif.preset,
    output: outputLabel,
    outputKind: tab === 'video' ? resolved.kind : 'loop',
    requestedPath: outputPath,
    range: { kind: range.kind, start: round(range.start, 6), end: round(range.end, 6) },
    framesRendered: job.times.length,
    ...(tab === 'gif' ? { loopFrames: gifFrameCount(gif, seconds), loopFps: gif.fps } : {}),
    fps: tab === 'video' ? video.fps : job.inputFps,
    size:
      tab === 'video'
        ? { width: video.frame.width, height: video.frame.height }
        : gifOutputSize(gif, sourceAspect),
    estimate: {
      typical: estimate.typical,
      low: estimate.low,
      high: estimate.high,
      text: `≈ ${formatSize(estimate.typical)}`,
    },
    notes,
    settings: tab === 'video' ? videoSettingsView(video) : omit(gif, 'preset'),
  };
  if (!request.wait) return { ...summary, job: jobInfo(findJob(jobId)) };
  const finished = await waitForJob(jobId, context.signal, context.deadline);
  if (finished.status === 'failed')
    throw new Error(`Render ${jobId} failed: ${finished.error ?? 'unknown error'}`);
  if (finished.status === 'canceled') throw new Error(`Render ${jobId} was cancelled.`);
  return {
    ...summary,
    finished: finished.status === 'done',
    ...(finished.status === 'done'
      ? {}
      : {
          note: 'Still rendering. Poll render_status with this jobId for progress and the result.',
        }),
    job: jobInfo(finished),
  };
}

async function listRenderPresets(context: TimelineMcpContext) {
  const project = context.project();
  const timeline = project.timeline;
  const sourceSize = timeline
    ? renderSourceSize(project, timeline)
    : { width: project.source?.width ?? 1920, height: project.source?.height ?? 1080 };
  const defaults = mcpRenderSettings(
    { tab: 'video', overrides: {} },
    { ...sourceSize, fps: timeline?.fps ?? 30 },
  );
  const ffmpeg = await window.gleech
    .renderStatus()
    .then((result) =>
      result.ok
        ? { available: result.value.available, version: result.value.version }
        : { available: false, version: null },
    )
    .catch(() => ({ available: false, version: null }));
  const range = (kind: 'work' | 'whole' | 'inout') => {
    if (
      !timeline ||
      (kind === 'work' && !timeline.workArea) ||
      (kind === 'inout' && !timeline.inOut)
    )
      return null;
    const { start, end } = renderRange(kind, timeline);
    return { start: round(start, 6), end: round(end, 6) };
  };
  return {
    revision: context.revision(),
    video: {
      defaultPreset: '1080p-social',
      presets: VIDEO_PRESETS.map((preset) => ({
        id: preset.id satisfies (typeof VIDEO_PRESET_IDS)[number],
        label: preset.label,
        hint: preset.hint,
        width: preset.width,
        height: preset.height,
        format: preset.format,
        compression: preset.compression,
        audio: preset.audioLabel,
      })),
      formats: VIDEO_FORMATS.map((format) => ({
        id: format.id satisfies (typeof VIDEO_FORMAT_IDS)[number],
        label: format.label,
        extension: format.extension,
      })),
      compression: COMPRESSION_CHOICES,
      fit: FIT_MODES,
      outputs:
        'output "movie" writes one video file. output "sequence" with sequence.kind "files" writes PNG frames directly into the path folder; sequence.kind "flipbook" writes a PDF (flipbook.kind "pdf") or a PNG sprite sheet ("sprite") file.',
      defaults: videoSettingsView(defaults.video),
    },
    gif: {
      defaultPreset: 'social',
      presets: GIF_PRESETS.map((preset) => ({
        id: preset.id satisfies (typeof GIF_PRESET_IDS)[number],
        label: preset.label,
        hint: preset.hint,
        width: preset.width,
        fps: preset.fps,
        colors: preset.colors,
        dither: preset.dither,
        scaling: preset.scaling,
        sizeLimitMb: preset.sizeLimitMb,
        transparent: preset.transparent ?? false,
      })),
      formats: LOOP_FORMATS,
      loopStyles: LOOP_STYLES,
      defaults: omit(defaults.gif, 'preset'),
    },
    upscale: { methods: UPSCALE_METHODS, engines: UPSCALE_ENGINES },
    ranges: timeline
      ? {
          default: timeline.workArea ? 'work' : 'whole',
          whole: range('whole'),
          work: range('work'),
          inout: range('inout'),
        }
      : null,
    ffmpeg,
    overrides:
      'render_video starts from a preset and deep-merges overrides onto it: pass only the keys to change, shaped like video.defaults or gif.defaults (for example {"frame": {"width": 1280, "height": 720}} or {"output": "sequence"}). Changing compression or fps also resets advanced encoder defaults unless advanced is given.',
    ...(timeline ? {} : { note: 'Create a timeline with set_timeline before rendering.' }),
  };
}

export async function runTimelineMcp(
  request: McpRequest,
  context: TimelineMcpContext,
): Promise<Record<string, unknown>> {
  switch (request.action) {
    case 'get_timeline': {
      const project = context.project();
      const timeline = project.timeline;
      const frame = timeline ? clampFrame(context.playhead(), timeline) : 0;
      return {
        ...timelineInfo(project, context.revision()),
        playhead: timeline
          ? {
              frame,
              time: frameTime(frame, timeline.fps),
              timecode: formatTimecode(frame, timeline.fps),
            }
          : null,
      };
    }
    case 'set_playhead': {
      const timeline = context.project().timeline;
      if (!timeline) noTimeline();
      const requested = request.frame ?? timeFrame(request.time ?? 0, timeline.fps);
      const frame = clampFrame(requested, timeline);
      context.setPlayhead(frame);
      return {
        revision: context.revision(),
        frame,
        time: frameTime(frame, timeline.fps),
        timecode: formatTimecode(frame, timeline.fps),
        frameCount: frameCount(timeline),
        fps: timeline.fps,
        clamped: frame !== requested,
      };
    }
    case 'list_render_presets':
      return listRenderPresets(context);
    case 'render_video':
      return renderVideo(request, context);
    case 'render_status': {
      if (request.cancel) {
        const job = findJob(request.jobId!);
        if (!ACTIVE.has(job.status))
          throw new Error(`This render already ended (${job.status}); nothing to cancel.`);
        renderQueue.cancel(job.id);
        return {
          cancelled: true,
          job: jobInfo(findJob(job.id)),
          note: 'A running render stops at its next frame; poll render_status to confirm.',
        };
      }
      if (request.jobId) return { job: jobInfo(findJob(request.jobId)) };
      const jobs = renderQueue.snapshot();
      return {
        jobs: jobs.map(jobInfo),
        active: jobs.filter((job) => ACTIVE.has(job.status)).length,
      };
    }
    default:
      throw new Error(`${request.action} is not a timeline action.`);
  }
}
