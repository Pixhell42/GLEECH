import { describe, expect, it } from 'vitest';
import { createEffect, createTimeline, type EffectInstance } from '@gleech/project-model';
import { defaultGifSettings, defaultVideoSettings } from './render-presets';
import {
  effectRenderSize,
  gifFrameTimes,
  gifInputRate,
  isUniform,
  renderRange,
  uniformTimes,
  videoFrameTimes,
} from './render-plan';

describe('render ranges and frame times', () => {
  const timeline = { ...createTimeline(), workArea: { start: 1, end: 7 } };
  it('resolves work area, whole timeline and in/out', () => {
    expect(renderRange('work', timeline)).toMatchObject({ start: 1, end: 7 });
    expect(renderRange('whole', timeline)).toMatchObject({ start: 0, end: 10 });
    expect(renderRange('inout', timeline)).toMatchObject({ kind: 'whole', start: 0 });
    expect(renderRange('inout', { ...timeline, inOut: { start: 2, end: 3 } })).toMatchObject({
      start: 2,
      end: 3,
    });
  });
  it('visits every frame of a movie at the output rate', () => {
    const settings = defaultVideoSettings({ width: 1920, height: 1080, fps: 30 });
    const times = videoFrameTimes(settings, { start: 1, end: 7 }, timeline, []);
    expect(times).toHaveLength(180);
    expect(times[1]! - times[0]!).toBeCloseTo(1 / 30);
    expect(isUniform(times, 30)).toBe(true);
  });
  it('samples every second frame or only keys for sequences', () => {
    const base = defaultVideoSettings({ width: 1920, height: 1080, fps: 30 });
    const every2 = {
      ...base,
      output: 'sequence' as const,
      sequence: { ...base.sequence, every: '2' as const },
    };
    expect(videoFrameTimes(every2, { start: 0, end: 1 }, timeline, [])).toHaveLength(15);
    const effect = {
      ...createEffect('rgb-split', 'fx'),
      animation: {
        amount: {
          keys: [
            { t: 0.5, value: 0, interpolation: 'linear' as const },
            { t: 2, value: 1, interpolation: 'linear' as const },
          ],
        },
      },
    } as EffectInstance;
    const keys = { ...every2, sequence: { ...base.sequence, every: 'keys' as const } };
    expect(videoFrameTimes(keys, { start: 0, end: 1 }, timeline, [effect])).toEqual([0.5]);
  });
  it('renders loops at the rate the loop shows', () => {
    const gif = { ...defaultGifSettings(), fps: 15 as const, speed: 2 };
    expect(gifInputRate(gif, 30)).toBe(7.5);
    expect(gifFrameTimes(gif, { start: 0, end: 2 }, 30)).toHaveLength(15);
    const smooth = { ...gif, smoothing: 'blend' as const };
    expect(gifInputRate(smooth, 30)).toBe(30);
    const concat = {
      ...gif,
      speed: 1,
      loop: 'concat' as const,
      segments: [
        { start: 0, end: 1 },
        { start: 4, end: 5 },
      ],
    };
    const times = gifFrameTimes(concat, { start: 0, end: 10 }, 30);
    expect(times).toHaveLength(30);
    expect(times[15]).toBe(4);
    expect(uniformTimes(0, 0.001, 30)).toHaveLength(1);
  });
});

describe('effect render size', () => {
  it('renders natively when the output is larger', () => {
    expect(
      effectRenderSize(
        { width: 1920, height: 1080 },
        { width: 3840, height: 2160, fit: 'fit' },
        'native',
      ),
    ).toEqual({ width: 3840, height: 2160, scale: 2 });
    expect(
      effectRenderSize(
        { width: 1920, height: 1080 },
        { width: 3840, height: 2160, fit: 'fit' },
        'upscale-result',
      ),
    ).toEqual({ width: 1920, height: 1080, scale: 1 });
    expect(
      effectRenderSize(
        { width: 4000, height: 3000 },
        { width: 1920, height: 1080, fit: 'fit' },
        'native',
      ),
    ).toEqual({ width: 4000, height: 3000, scale: 1 });
  });
  it('stays under the 8192 px texture limit', () => {
    const size = effectRenderSize(
      { width: 2000, height: 1000 },
      { width: 7680, height: 4320, fit: 'crop' },
      'native',
    );
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192);
  });
});
