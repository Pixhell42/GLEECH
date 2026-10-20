// Builds a background render job from dialog (or MCP) settings. Shared so the
// Render dialog and MCP render_video produce identical jobs.
import { activeVideo, type ProjectState, type Timeline } from '@gleech/project-model';
import type {
  GifRenderSettings,
  MediaInput,
  RenderRange,
  RenderTab,
  VideoRenderSettings,
} from '../../shared/render';
import { resolveVideoOutput } from '../../shared/render-presets';
import { effectRenderSize, gifFrameTimes, gifInputRate, videoFrameTimes } from './render-plan';
import type { RenderRequest } from './render-queue';

/** Size of the frames effects start from: the active clip, else the source image. */
export function renderSourceSize(project: ProjectState, timeline?: Timeline) {
  void timeline;
  const clip = activeVideo(project);
  return clip
    ? { width: clip.width, height: clip.height }
    : { width: project.source?.width ?? 1, height: project.source?.height ?? 1 };
}

export function projectBaseName(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim() || 'GLEECH'
  );
}

/**
 * Which audio the Video tab's source choice uses: the track, the clip's own
 * sound, or both. When the chosen source is missing, the other one is used.
 */
export function videoAudioSources(
  settings: VideoRenderSettings,
  timeline: Timeline,
): { track: boolean; clip: boolean } {
  const track = Boolean(timeline.audio);
  const clip = Boolean(timeline.video?.hasAudio);
  const want = settings.audio.source;
  const useClip = clip && (want !== 'track' || !track);
  const useTrack = track && (want !== 'clip' || !clip);
  return { track: useTrack, clip: useClip };
}

/** Whether the Video tab will carry audio for these settings. */
export function videoAudioActive(settings: VideoRenderSettings, timeline: Timeline): boolean {
  const output = resolveVideoOutput(settings);
  return (
    settings.audio.enabled &&
    Boolean(timeline.audio || timeline.video?.hasAudio) &&
    output.kind !== 'pdf' &&
    output.kind !== 'sprite' &&
    (output.kind === 'movie' || settings.sequence.separateAudio)
  );
}

/** Concat loops jump between ranges, so their audio would not line up. */
export function loopAudioAvailable(settings: GifRenderSettings, timeline: Timeline): boolean {
  return settings.format === 'mp4' && settings.loop !== 'concat' && Boolean(timeline.audio);
}

function mediaInputs(
  timeline: Timeline,
  range: Pick<RenderRange, 'start' | 'end'>,
  wantTrack: boolean,
  wantClip: boolean,
): { audio?: MediaInput; clipAudio?: MediaInput } {
  const duration = Math.max(0, range.end - range.start);
  return {
    ...(wantTrack && timeline.audio
      ? { audio: { path: timeline.audio.path, start: range.start, duration } }
      : {}),
    ...(wantClip && timeline.video?.hasAudio
      ? { clipAudio: { path: timeline.video.path, start: range.start, duration } }
      : {}),
  };
}

export function buildRenderRequest(input: {
  tab: RenderTab;
  video: VideoRenderSettings;
  gif: GifRenderSettings;
  project: ProjectState;
  timeline: Timeline;
  range: Pick<RenderRange, 'start' | 'end'>;
  outputPath: string;
  videoMediaId: string | null;
}): RenderRequest {
  const { tab, video, gif, project, timeline, range, outputPath, videoMediaId } = input;
  if (!(range.end > range.start)) throw new Error('The render range is empty.');
  const clip = activeVideo(project);
  if (clip && !videoMediaId)
    throw new Error(
      'The video clip is offline or still loading. Add it again from the Tracks menu.',
    );
  const label = outputPath.split(/[\\/]/).pop() || outputPath;
  const name = projectBaseName(project.name);
  const sourceSize = renderSourceSize(project);
  const media = videoMediaId && clip ? { videoMediaId } : {};
  if (tab === 'video') {
    const audio = videoAudioActive(video, timeline);
    const sources = videoAudioSources(video, timeline);
    return {
      kind: 'video',
      label,
      project,
      spec: {
        kind: 'video',
        name,
        video,
        outputPath,
        ...mediaInputs(timeline, range, audio && sources.track, audio && sources.clip),
      },
      times: videoFrameTimes(video, range, timeline, project.effects),
      inputFps: video.fps,
      renderSize: effectRenderSize(sourceSize, video.frame, video.upscale.method),
      ...media,
      overlay: video.overlay.enabled,
    };
  }
  return {
    kind: 'gif',
    label,
    project,
    spec: {
      kind: 'gif',
      name,
      gif,
      outputPath,
      ...mediaInputs(timeline, range, gif.audio && loopAudioAvailable(gif, timeline), false),
    },
    times: gifFrameTimes(gif, range, timeline.fps),
    inputFps: gifInputRate(gif, timeline.fps),
    renderSize: sourceSize,
    ...media,
    overlay: gif.transparent && gif.format !== 'mp4',
  };
}
