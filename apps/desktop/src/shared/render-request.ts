// Builds the same timeline render plan for desktop and terminal hosts.
import {
  activeVideo,
  audioIsClipSound,
  audioTrackLevel,
  type ProjectState,
  type Timeline,
} from '@gleech/project-model';
import type {
  GifRenderSettings,
  MediaInput,
  RenderRange,
  RenderTab,
  VideoRenderSettings,
} from './render';
import { gifOutputSize, resolveVideoOutput } from './render-presets';
import { effectRenderSize, gifFrameTimes, gifInputRate, videoFrameTimes } from './render-plan';
import type { TimelineRenderRequest } from './timeline-runner';

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

/** Matches the main process's limit for frame and folder names. */
const STEM_LIMIT = 80;
const OUTPUT_EXTENSION = /\.(gleech|mp4|mov|mkv|webm|gif|webp|png|apng|pdf)$/i;

/** Drops characters a file name can't contain, as the user types. */
export function fileNameInput(text: string): string {
  return Array.from(text)
    .filter((character) => character.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(character))
    .join('');
}

/** A typed or file name as a render name: no extension, safe on every platform. */
export function outputStem(name: string): string {
  const stem = fileNameInput(name)
    .trim()
    .replace(OUTPUT_EXTENSION, '')
    .replace(/^[\s.]+/, '')
    .slice(0, STEM_LIMIT)
    .replace(/[\s.]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? `${stem}_` : stem;
}

/**
 * The name a render starts with: the saved project file's name, else the
 * project name plus `suffix` ("_gleech" for movies, "_gleech_loop" for loops).
 */
export function defaultOutputStem(
  projectFile: string | null,
  projectName: string,
  suffix: string,
): string {
  return (
    (projectFile && outputStem(projectFile)) || outputStem(projectBaseName(projectName) + suffix)
  );
}

/** The clip's own sound as a source separate from the audio track. */
export function separateClipSound(timeline: Timeline): boolean {
  return Boolean(timeline.video?.hasAudio) && !audioIsClipSound(timeline);
}

/** Whether the audio track exists and isn't muted or silent. */
export function audibleTrack(timeline: Timeline): boolean {
  return Boolean(timeline.audio && audioTrackLevel(timeline.audio) > 0);
}

/**
 * Which audio the Video tab's source choice uses: the track, the clip's own
 * sound, or both. When the chosen source is missing, the other one is used.
 * A muted track is still chosen; it just adds no sound.
 */
export function videoAudioSources(
  settings: VideoRenderSettings,
  timeline: Timeline,
): { track: boolean; clip: boolean } {
  const track = Boolean(timeline.audio);
  const clip = separateClipSound(timeline);
  const want = settings.audio.source;
  const useClip = clip && (want !== 'track' || !track);
  const useTrack = track && (want !== 'clip' || !clip);
  return { track: useTrack, clip: useClip };
}

/** Whether the Video tab will carry audio for these settings. */
export function videoAudioActive(settings: VideoRenderSettings, timeline: Timeline): boolean {
  const output = resolveVideoOutput(settings);
  const sources = videoAudioSources(settings, timeline);
  return (
    settings.audio.enabled &&
    ((sources.track && audibleTrack(timeline)) || sources.clip) &&
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
  // A muted track is left out; a quieter one carries its level.
  const level = timeline.audio ? audioTrackLevel(timeline.audio) : 0;
  return {
    ...(wantTrack && timeline.audio && level > 0
      ? {
          audio: {
            path: timeline.audio.path,
            start: range.start,
            duration,
            ...(level < 1 ? { volume: level } : {}),
          },
        }
      : {}),
    ...(wantClip && timeline.video && separateClipSound(timeline)
      ? { clipAudio: { path: timeline.video.path, start: range.start, duration } }
      : {}),
  };
}

export function buildTimelineRenderRequest(input: {
  tab: RenderTab;
  video: VideoRenderSettings;
  gif: GifRenderSettings;
  project: ProjectState;
  timeline: Timeline;
  range: Pick<RenderRange, 'start' | 'end'>;
  outputPath: string;
  /** Names image-sequence frames and their subfolder; defaults to the project name. */
  name?: string;
  safety?: import('./render-safety').RenderSafetySettings;
}): TimelineRenderRequest {
  const { tab, video, gif, project, timeline, range, outputPath } = input;
  if (!(range.end > range.start)) throw new Error('The render range is empty.');
  const label = outputPath.split(/[\\/]/).pop() || outputPath;
  const name = input.name || projectBaseName(project.name);
  const sourceSize = renderSourceSize(project);
  const processingSize = (size: { width: number; height: number }) => {
    if (input.safety?.processing !== 'output') return size;
    const target =
      tab === 'video' ? video.frame : gifOutputSize(gif, sourceSize.width / sourceSize.height);
    const scale = Math.min(
      1,
      tab === 'video' && ['crop', 'stretch'].includes(video.frame.fit)
        ? Math.max(target.width / size.width, target.height / size.height)
        : Math.min(target.width / size.width, target.height / size.height),
    );
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    };
  };
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
        ...(input.safety ? { safety: input.safety } : {}),
        ...(timeline.video?.path ? { sourcePath: timeline.video.path } : {}),
        outputPath,
        ...mediaInputs(timeline, range, audio && sources.track, audio && sources.clip),
      },
      times: videoFrameTimes(video, range, timeline, project.effects),
      inputFps: video.fps,
      renderSize: processingSize(effectRenderSize(sourceSize, video.frame, video.upscale.method)),
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
      ...(input.safety ? { safety: input.safety } : {}),
      outputPath,
      ...mediaInputs(timeline, range, gif.audio && loopAudioAvailable(gif, timeline), false),
    },
    times: gifFrameTimes(gif, range, timeline.fps),
    inputFps: gifInputRate(gif, timeline.fps),
    renderSize: processingSize(sourceSize),
    overlay: gif.transparent && gif.format !== 'mp4',
  };
}
