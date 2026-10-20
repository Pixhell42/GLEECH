import { describe, expect, it } from 'vitest';
import { createProject, createTimeline, type Timeline } from '@gleech/project-model';
import { defaultGifSettings, defaultVideoSettings } from '../../shared/render-presets';
import type { VideoRenderSettings } from '../../shared/render';
import {
  buildRenderRequest,
  defaultOutputStem,
  fileNameInput,
  outputStem,
  videoAudioActive,
  videoAudioSources,
} from './render-request';

const clipPath = 'C:/clips/clip.mp4';
const video = {
  path: clipPath,
  name: 'clip.mp4',
  width: 64,
  height: 36,
  fps: 30,
  duration: 4,
  hasAudio: true,
};
const track = (path: string, extra: Partial<NonNullable<Timeline['audio']>> = {}) => ({
  path,
  name: path.split('/').pop()!,
  duration: 4,
  sampleRate: 48000,
  channels: 2,
  ...extra,
});
const settings = (source: 'track' | 'clip' | 'mix'): VideoRenderSettings => {
  const base = defaultVideoSettings({ width: 64, height: 36, fps: 30 });
  return { ...base, audio: { ...base.audio, enabled: true, source } };
};
function request(timeline: Timeline, source: 'track' | 'clip' | 'mix') {
  const project = {
    ...createProject('Audio'),
    source: {
      id: 's',
      name: 's.png',
      width: 64,
      height: 36,
      format: 'png' as const,
      hasAlpha: false,
    },
    timeline,
  };
  return buildRenderRequest({
    tab: 'video',
    video: settings(source),
    gif: defaultGifSettings(),
    project,
    timeline,
    range: { start: 1, end: 3 },
    outputPath: 'C:/out/render.mp4',
    videoMediaId: 'media-1',
  }).spec;
}

describe('render audio sources', () => {
  it('treats the clip sound on the audio track as one source', () => {
    const timeline = { ...createTimeline(), video, audio: track(clipPath) };
    expect(videoAudioSources(settings('mix'), timeline)).toEqual({ track: true, clip: false });
    const spec = request(timeline, 'mix');
    expect(spec.audio).toEqual({ path: clipPath, start: 1, duration: 2 });
    expect(spec.clipAudio).toBeUndefined();
  });

  it('mixes a separate music track with the clip sound and carries the track level', () => {
    const timeline = {
      ...createTimeline(),
      video,
      audio: track('C:/music/song.wav', { volume: 0.5 }),
    };
    const spec = request(timeline, 'mix');
    expect(spec.audio).toEqual({ path: 'C:/music/song.wav', start: 1, duration: 2, volume: 0.5 });
    expect(spec.clipAudio).toEqual({ path: clipPath, start: 1, duration: 2 });
  });

  it('leaves a muted track out without falling back to the clip sound', () => {
    const timeline = {
      ...createTimeline(),
      video,
      audio: track('C:/music/song.wav', { muted: true }),
    };
    expect(videoAudioActive(settings('track'), timeline)).toBe(false);
    const spec = request(timeline, 'track');
    expect(spec.audio).toBeUndefined();
    expect(spec.clipAudio).toBeUndefined();
    // Mixing still keeps the clip sound.
    expect(videoAudioActive(settings('mix'), timeline)).toBe(true);
    expect(request(timeline, 'mix').clipAudio).toEqual({ path: clipPath, start: 1, duration: 2 });
  });
});

describe('render output names', () => {
  it('names renders after the saved project file', () => {
    expect(defaultOutputStem('Skate Night.gleech', 'photo.png', '_gleech')).toBe('Skate Night');
    expect(defaultOutputStem('Skate Night.gleech', 'photo.png', '_gleech_loop')).toBe(
      'Skate Night',
    );
  });

  it('falls back to the project name when the project is unsaved', () => {
    expect(defaultOutputStem(null, 'photo.png', '_gleech')).toBe('photo_gleech');
    expect(defaultOutputStem(null, 'photo.png', '_gleech_loop')).toBe('photo_gleech_loop');
    expect(defaultOutputStem(null, 'photo.png', '')).toBe('photo');
  });

  it('cleans typed names', () => {
    expect(fileNameInput('a/b\\c:d*e?f"g<h>i|j\u0001k')).toBe('abcdefghijk');
    expect(outputStem('  final cut.mp4 ')).toBe('final cut');
    expect(outputStem('v1.2 take')).toBe('v1.2 take');
    expect(outputStem('...')).toBe('');
    expect(outputStem('con')).toBe('con_');
    expect(outputStem('x'.repeat(100))).toHaveLength(80);
  });

  it('uses the typed name for image-sequence frames', () => {
    const timeline = { ...createTimeline() };
    const project = { ...createProject('Audio'), timeline };
    const base = defaultVideoSettings({ width: 64, height: 36, fps: 30 });
    const built = buildRenderRequest({
      tab: 'video',
      video: { ...base, output: 'sequence', sequence: { ...base.sequence, kind: 'files' } },
      gif: defaultGifSettings(),
      project: {
        ...project,
        source: {
          id: 's',
          name: 's.png',
          width: 64,
          height: 36,
          format: 'png' as const,
          hasAlpha: false,
        },
      },
      timeline,
      range: { start: 0, end: 1 },
      outputPath: 'C:/out',
      videoMediaId: null,
      name: 'shot 4',
    });
    expect(built.spec.name).toBe('shot 4');
  });
});
