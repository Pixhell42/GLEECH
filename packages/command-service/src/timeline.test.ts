import { describe, expect, it } from 'vitest';
import { activeVideo, createProject, createTimeline, upsertKey } from '@gleech/project-model';
import { createCommandService } from './index';

const source = {
  id: 's',
  name: 's.png',
  width: 8,
  height: 8,
  format: 'png',
  hasAlpha: false,
} as const;

function service() {
  const commands = createCommandService(createProject('Timeline', 7));
  commands.setSource(source);
  commands.addEffect('rgb-split', 'fx');
  return commands;
}
const clip = (posterId: string) => ({
  path: 'C:/clips/clip.mp4',
  name: 'clip.mp4',
  width: 8,
  height: 8,
  fps: 30,
  duration: 4,
  hasAudio: false,
  posterId,
});
const firstNumberKey = (params: Record<string, unknown>) =>
  Object.entries(params).find(([, value]) => typeof value === 'number')![0];

describe('timeline commands', () => {
  it('creates and removes a timeline with undo', () => {
    const commands = service();
    commands.setTimeline(createTimeline());
    expect(commands.getState().timeline?.fps).toBe(30);
    expect(Object.isFrozen(commands.getState().timeline)).toBe(true);
    commands.undo();
    expect(commands.getState().timeline).toBeUndefined();
    commands.redo();
    commands.setTimeline(null);
    expect('timeline' in commands.getState()).toBe(false);
  });

  it('opening an image replaces the clip but keeps the rest of the timeline', () => {
    const commands = service();
    commands.setTimeline({ ...createTimeline(), video: clip('s'), bpm: 128 });
    expect(activeVideo(commands.getState())).toBeDefined();
    commands.setSource({ ...source, id: 'next', name: 'next.png' });
    const state = commands.getState();
    expect(state.name).toBe('next.png');
    expect(state.timeline?.video).toBeUndefined();
    expect(state.timeline?.bpm).toBe(128);
    commands.undo();
    expect(commands.getState().timeline?.video?.path).toBe('C:/clips/clip.mp4');
  });

  it('uses a clip frame as the source without an undo step', () => {
    const commands = service();
    commands.setTimeline({ ...createTimeline(), video: clip('s') });
    commands.updateEffect('fx', { enabled: false });
    const edited = commands.getState();
    commands.useClipFrame({ ...source, id: 'frame', name: 'clip 00:02:00' }, 2);
    const state = commands.getState();
    expect(state.source?.id).toBe('frame');
    expect(state.origin?.id).toBe('frame');
    expect(state.timeline?.video).toMatchObject({ posterId: 'frame', posterTime: 2 });
    expect(activeVideo(state)).toBeDefined();
    expect(state.effects).toBe(edited.effects);
    expect(Object.isFrozen(state.timeline?.video)).toBe(true);
    // Undo skips the frame swap and reverts the last edit; the frame stays.
    commands.undo();
    expect(commands.getState().effects[0]!.enabled).toBe(true);
    expect(commands.getState().source?.id).toBe('frame');
    commands.redo();
    expect(commands.getState().source?.id).toBe('frame');
    commands.undo();
    expect(() => commands.useClipFrame(source, -1)).toThrow();
    commands.setTimeline(createTimeline());
    expect(() => commands.useClipFrame(source, 0)).toThrow();
  });

  it('adds keys through updateEffect and groups slider drags', () => {
    const commands = service();
    commands.setTimeline(createTimeline());
    const effect = commands.getState().effects[0]!;
    const key = firstNumberKey(effect.params as Record<string, unknown>);
    commands.beginHistoryGroup();
    commands.updateEffect('fx', { animation: { [key]: upsertKey(undefined, 0, 0.1, 30) } });
    commands.updateEffect('fx', {
      animation: { [key]: upsertKey(commands.getState().effects[0]!.animation![key], 1, 0.2, 30) },
    });
    commands.endHistoryGroup();
    expect(commands.getState().effects[0]!.animation![key]!.keys).toHaveLength(2);
    expect(Object.isFrozen(commands.getState().effects[0]!.animation![key]!.keys)).toBe(true);
    commands.undo();
    expect(commands.getState().effects[0]!.animation).toBeUndefined();
    commands.redo();
    commands.updateEffect('fx', { animation: { [key]: null } });
    expect('animation' in commands.getState().effects[0]!).toBe(false);
  });

  it('rejects keys outside a parameter range', () => {
    const commands = service();
    const effect = commands.getState().effects[0]!;
    const key = firstNumberKey(effect.params as Record<string, unknown>);
    expect(() =>
      commands.updateEffect('fx', {
        animation: { [key]: { keys: [{ t: 0, value: 1e9, interpolation: 'linear' }] } },
      }),
    ).toThrow();
    expect(commands.getState().effects[0]!.animation).toBeUndefined();
  });

  it('sets and clears active ranges', () => {
    const commands = service();
    commands.updateEffect('fx', { activeRange: { start: 1.8, end: 7.6 } });
    expect(commands.getState().effects[0]!.activeRange).toEqual({ start: 1.8, end: 7.6 });
    expect(() => commands.updateEffect('fx', { activeRange: { start: 2, end: 1 } })).toThrow();
    commands.updateEffect('fx', { activeRange: null });
    expect('activeRange' in commands.getState().effects[0]!).toBe(false);
  });

  it('re-times keys when the frame rate changes', () => {
    const commands = service();
    commands.setTimeline(createTimeline());
    const key = firstNumberKey(commands.getState().effects[0]!.params as Record<string, unknown>);
    commands.updateEffect('fx', { animation: { [key]: upsertKey(undefined, 1 / 30, 0.2, 30) } });
    commands.updateTimeline({ fps: 10 });
    const lane = commands.getState().effects[0]!.animation![key]!;
    expect(commands.getState().timeline!.fps).toBe(10);
    expect(lane.keys[0]!.t).toBe(0);
    commands.undo();
    expect(commands.getState().timeline!.fps).toBe(30);
    expect(() => commands.updateTimeline({ fps: 0 })).toThrow();
  });

  it('clears optional media with undefined', () => {
    const commands = service();
    commands.setTimeline(createTimeline());
    commands.updateTimeline({
      audio: { path: 'C:/a.wav', name: 'a.wav', duration: 4, sampleRate: 48000, channels: 2 },
    });
    expect(commands.getState().timeline!.audio?.name).toBe('a.wav');
    commands.updateTimeline({ audio: undefined });
    expect('audio' in commands.getState().timeline!).toBe(false);
  });

  it('keeps the work area and In/Out inside a shorter timeline', () => {
    const commands = service();
    commands.setTimeline(createTimeline());
    commands.updateTimeline({ workArea: { start: 6, end: 9 }, inOut: { start: 2, end: 8 } });
    commands.updateTimeline({ duration: 5 });
    expect(commands.getState().timeline!.workArea).toBeNull();
    expect(commands.getState().timeline!.inOut).toEqual({ start: 2, end: 5 });
  });
});
