import { describe, expect, it } from 'vitest';
import {
  assertProject,
  createEffect,
  createProject,
  evaluateEffectAt,
  evaluateEffectsAt,
  animationDefinition,
  withoutAnimation,
  type EffectInstance,
  type ParameterDefinition,
} from './index';
import {
  adjacentKeyFrame,
  applyModulators,
  assertTimeline,
  audioValue,
  createAudioModulator,
  createLfo,
  createTimeline,
  easeProgress,
  evaluateKeys,
  formatTimecode,
  frameCount,
  frameSeed,
  lfoValue,
  mixColor,
  moveKeys,
  removeKeyAtFrame,
  seedChangeFrames,
  setKeysInterpolation,
  snapAnimationToRate,
  upsertKey,
  type AudioAnalysis,
  type Keyframe,
} from './timeline';

const number: ParameterDefinition = {
  kind: 'number',
  label: 'Phase',
  description: '',
  min: 0,
  max: 1,
  step: 0.01,
  unit: 'percent',
  default: 0.5,
};
const keys = (...pairs: [number, number, Keyframe['interpolation']?][]): Keyframe[] =>
  pairs.map(([t, value, interpolation]) => ({
    t,
    value,
    interpolation: interpolation ?? 'linear',
  }));

describe('timeline time helpers', () => {
  it('formats MM:SS:FF timecodes', () => {
    expect(formatTimecode(96, 30)).toBe('00:03:06');
    expect(formatTimecode(300, 30)).toBe('00:10:00');
    expect(formatTimecode(30 * 61 + 5, 30)).toBe('01:01:05');
  });
  it('counts frames from rate and duration', () => {
    expect(frameCount({ fps: 30, duration: 10 })).toBe(300);
    expect(frameCount({ fps: 24, duration: 0.01 })).toBe(1);
  });
  it('validates timelines', () => {
    const timeline = createTimeline();
    expect(() => assertTimeline(timeline)).not.toThrow();
    expect(() => assertTimeline({ ...timeline, fps: 0 })).toThrow();
    expect(() => assertTimeline({ ...timeline, workArea: { start: 2, end: 1 } })).toThrow();
    expect(() => assertTimeline({ ...timeline, seed: { mode: 'every-n', every: 0 } })).toThrow();
    expect(() =>
      assertTimeline({ ...timeline, markers: [{ id: 'a', t: 1, name: 'A' }] }),
    ).not.toThrow();
  });
});

describe('keyframe interpolation', () => {
  it('holds outside the keyed range and interpolates linearly inside', () => {
    const lane = keys([1, 0.2], [3, 0.6]);
    expect(evaluateKeys(lane, 0, number)).toBe(0.2);
    expect(evaluateKeys(lane, 2, number)).toBeCloseTo(0.4);
    expect(evaluateKeys(lane, 9, number)).toBe(0.6);
  });
  it('eases with the left key interpolation', () => {
    const easeIn = keys([0, 0, 'ease-in'], [1, 1]);
    const easeOut = keys([0, 0, 'ease-out'], [1, 1]);
    expect(Number(evaluateKeys(easeIn, 0.5, number))).toBeLessThan(0.5);
    expect(Number(evaluateKeys(easeOut, 0.5, number))).toBeGreaterThan(0.5);
    expect(easeProgress('ease-in-out', 0.5)).toBeCloseTo(0.5, 5);
    expect(easeProgress('ease-in-out', 0)).toBe(0);
    expect(easeProgress('ease-in-out', 1)).toBeCloseTo(1, 6);
  });
  it('steps for hold keys and choice parameters', () => {
    expect(evaluateKeys(keys([0, 0, 'hold'], [1, 1]), 0.99, number)).toBe(0);
    const choice: ParameterDefinition = {
      kind: 'choice',
      label: 'Mode',
      description: '',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const lane: Keyframe[] = [
      { t: 0, value: 'a', interpolation: 'linear' },
      { t: 1, value: 'b', interpolation: 'linear' },
    ];
    expect(evaluateKeys(lane, 0.9, choice)).toBe('a');
    expect(evaluateKeys(lane, 1, choice)).toBe('b');
  });
  it('blends colors smoothly', () => {
    expect(mixColor('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixColor('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    const middle = mixColor('#000000', '#FFFFFF', 0.5);
    expect(Number.parseInt(middle.slice(1, 3), 16)).toBeGreaterThan(128);
  });
  it('follows custom bezier handles', () => {
    const lane: Keyframe[] = [
      { t: 0, value: 0, interpolation: 'bezier', outHandle: { dt: 0.5, dv: 1 } },
      { t: 1, value: 0, interpolation: 'linear', inHandle: { dt: -0.5, dv: 1 } },
    ];
    // Both handles pull upward, so the middle bulges to 0.75 of the range.
    expect(Number(evaluateKeys(lane, 0.5, number))).toBeCloseTo(0.75, 3);
    expect(Number(evaluateKeys(lane, 0, number))).toBe(0);
  });
});

describe('key editing', () => {
  it('adds and updates keys on frame boundaries', () => {
    let lane = upsertKey(undefined, 0.51, 0.3, 30);
    expect(lane.keys[0]!.t).toBeCloseTo(15 / 30);
    lane = upsertKey(lane, 0.5, 0.4, 30);
    expect(lane.keys).toHaveLength(1);
    expect(lane.keys[0]!.value).toBe(0.4);
    lane = upsertKey(lane, 0.1, 0.1, 30);
    expect(lane.keys.map((key) => key.value)).toEqual([0.1, 0.4]);
    expect(adjacentKeyFrame(lane, 10, 30, 1)).toBe(15);
    expect(adjacentKeyFrame(lane, 10, 30, -1)).toBe(3);
    expect(removeKeyAtFrame(lane, 15, 30)!.keys).toHaveLength(1);
    expect(removeKeyAtFrame({ keys: [lane.keys[0]!] }, 3, 30)).toBeNull();
  });
  it('moves keys and replaces collisions', () => {
    const lane = { keys: keys([0, 0], [1, 0.5], [2, 1]) };
    const moved = moveKeys(lane, [0], 30, 30, 300);
    expect(moved.keys.map((key) => key.t)).toEqual([1, 2]);
    expect(moved.keys[0]!.value).toBe(0);
  });
  it('keeps the incoming bezier handle when a key changes ease', () => {
    const lane = {
      keys: [
        { t: 0, value: 0, interpolation: 'bezier' as const, outHandle: { dt: 0.3, dv: 0.2 } },
        { t: 1, value: 1, interpolation: 'bezier' as const, inHandle: { dt: -0.3, dv: 0.1 } },
      ],
    };
    const next = setKeysInterpolation(lane, [1], 'linear');
    expect(next.keys[1]!.inHandle).toEqual({ dt: -0.3, dv: 0.1 });
    expect(next.keys[0]!.outHandle).toEqual({ dt: 0.3, dv: 0.2 });
    expect(setKeysInterpolation(lane, [0], 'linear').keys[0]!.outHandle).toBeUndefined();
  });
  it('changes interpolation and snaps keys to a new rate', () => {
    const lane = { keys: keys([0, 0], [1.01, 1]) };
    expect(
      setKeysInterpolation(lane, 'all', 'hold').keys.every((k) => k.interpolation === 'hold'),
    ).toBe(true);
    expect(snapAnimationToRate(lane, 10).keys[1]!.t).toBe(1);
  });
});

describe('modulators', () => {
  it('computes LFOs from time and tempo', () => {
    const lfo = { ...createLfo('a'), phase: 0, division: '1/4' as const };
    const context = { bpm: 120, seed: 1 };
    expect(lfoValue(lfo, 0, context)).toBeCloseTo(0);
    // One cycle per beat at 120 BPM is 0.5 s; a quarter cycle peaks.
    expect(lfoValue(lfo, 0.125, context)).toBeCloseTo(1);
    const random = { ...lfo, shape: 'random' as const };
    expect(lfoValue(random, 0.1, context)).toBe(lfoValue(random, 0.2, context));
    expect(lfoValue(random, 0.1, { ...context, seed: 2 })).not.toBe(lfoValue(random, 0.1, context));
  });
  it('applies modulators in order and clamps', () => {
    const lfo = { ...createLfo('a'), shape: 'square' as const, depth: 0.5, phase: 0 };
    expect(applyModulators(0.8, [lfo], 0.01, { bpm: 120, seed: 0 })).toBe(1);
  });
  it('follows audio band energy with replace', () => {
    const frames = 4;
    const bins = 24;
    const spectrum = new Uint8Array(frames * bins);
    for (let frame = 0; frame < frames; frame++)
      for (let bin = 0; bin < bins; bin++) spectrum[frame * bins + bin] = frame % 2 ? 255 : 0;
    const analysis: AudioAnalysis = {
      rate: 10,
      bins,
      minHz: 20,
      maxHz: 20000,
      spectrum: btoa(String.fromCharCode(...spectrum)),
      peaks: btoa(String.fromCharCode(...new Uint8Array(frames))),
      beats: [],
      bpm: 120,
    };
    const audio = { ...createAudioModulator('m'), attackMs: 0, releaseMs: 0 };
    const context = { bpm: 120, seed: 0, audio: analysis };
    expect(audioValue(audio, 0, context)).toBe(0);
    expect(audioValue(audio, 0.1, context)).toBe(1);
    expect(applyModulators(0.5, [audio], 0.1, context)).toBe(1);
    expect(applyModulators(0.5, [audio], 0, context)).toBeCloseTo(0.4);
  });
});

describe('seed track', () => {
  it('keeps frame zero and Fixed mode on the project seed', () => {
    expect(frameSeed(8172, { mode: 'fixed', every: 2 }, 50)).toBe(8172);
    expect(frameSeed(8172, { mode: 'every-frame', every: 2 }, 0)).toBe(8172);
    expect(frameSeed(8172, { mode: 'every-n', every: 2 }, 1)).toBe(8172);
    expect(frameSeed(8172, { mode: 'every-n', every: 2 }, 2)).not.toBe(8172);
    expect(frameSeed(8172, { mode: 'every-n', every: 2 }, 3)).toBe(
      frameSeed(8172, { mode: 'every-n', every: 2 }, 2),
    );
    expect(seedChangeFrames({ mode: 'every-n', every: 2 }, 7)).toEqual([2, 4, 6]);
  });
});

describe('effect evaluation', () => {
  const base = createEffect('rgb-split', 'fx');
  const key = Object.entries((base as { params: Record<string, unknown> }).params).find(
    ([name]) => animationDefinition(base, name)?.kind === 'number',
  )![0];
  const definition = animationDefinition(base, key) as Extract<
    ParameterDefinition,
    { kind: 'number' }
  >;
  const animated = {
    ...base,
    animation: {
      [key]: {
        keys: [
          { t: 0, value: definition.min, interpolation: 'linear' as const },
          { t: 2, value: definition.max, interpolation: 'linear' as const },
        ],
      },
    },
  } as EffectInstance;

  it('validates animation against parameter definitions', () => {
    const project = { ...createProject('P'), source: null };
    expect(() =>
      assertProject({
        ...project,
        source: { id: 's', name: 's.png', width: 4, height: 4, format: 'png', hasAlpha: false },
        origin: { id: 's', name: 's.png', width: 4, height: 4, format: 'png', hasAlpha: false },
        effects: [animated],
        timeline: createTimeline(),
      }),
    ).not.toThrow();
    const invalid = {
      ...base,
      animation: {
        [key]: { keys: [{ t: 0, value: definition.max + 1, interpolation: 'linear' }] },
      },
    } as unknown as EffectInstance;
    expect(() =>
      assertProject({
        ...project,
        source: { id: 's', name: 's.png', width: 4, height: 4, format: 'png', hasAlpha: false },
        origin: { id: 's', name: 's.png', width: 4, height: 4, format: 'png', hasAlpha: false },
        effects: [invalid],
      }),
    ).toThrow();
  });
  it('resolves keyed params at a time and keeps identity when static', () => {
    const middle = evaluateEffectAt(animated, 1) as { params: Record<string, number> };
    expect(middle.params[key]).toBeCloseTo((definition.min + definition.max) / 2, 1);
    expect(evaluateEffectAt(base, 1)).toBe(base);
    const stack = [base];
    expect(evaluateEffectsAt(stack, 3)).toBe(stack);
  });
  it('switches effects off outside their active range', () => {
    const ranged = { ...base, activeRange: { start: 1, end: 2 } } as EffectInstance;
    expect(evaluateEffectAt(ranged, 0.5).enabled).toBe(false);
    expect(evaluateEffectAt(ranged, 1.5).enabled).toBe(true);
    expect(evaluateEffectAt(ranged, 2).enabled).toBe(false);
  });
  it('strips animation for still recipes', () => {
    const still = withoutAnimation({
      ...animated,
      activeRange: { start: 0, end: 1 },
    } as EffectInstance);
    expect('animation' in still).toBe(false);
    expect('activeRange' in still).toBe(false);
  });
});
