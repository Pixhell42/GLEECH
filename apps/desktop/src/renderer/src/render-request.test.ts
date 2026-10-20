import { describe, expect, it } from 'vitest';
import { createProject, createTimeline, type Timeline } from '@gleech/project-model';
import { defaultGifSettings, defaultVideoSettings } from '../../shared/render-presets';
import type { VideoRenderSettings } from '../../shared/render';
import { buildRenderRequest, videoAudioActive, videoAudioSources } from './render-request';

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
