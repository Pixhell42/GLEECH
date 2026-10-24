import { expect, it } from 'vitest';
import { fitFrameSize } from './video-frames';
import {
  playbackDimension,
  videoPlaybackDimension,
  PlaybackPreviewBudget,
} from './playback-preview';

it('backs off sustained slow playback, keeps its budget across frames, and restores quality gradually', () => {
  const budget = new PlaybackPreviewBudget();
  budget.configure('clip', 640, true, 30);
  budget.record(60);
  expect(budget.maximum).toBe(640);
  budget.configure('clip', 640, true, 30);
  budget.record(60);
  expect(budget.maximum).toBe(480);
  for (let frame = 0; frame < 11; frame++) {
    budget.configure('clip', 640, true, 30);
    budget.record(20);
  }
  expect(budget.maximum).toBe(480);
  budget.record(20);
  expect(budget.maximum).toBe(640);
  budget.record(500);
  expect(budget.maximum).toBe(320);
  for (let frame = 0; frame < 20; frame++) budget.record(500);
  expect(budget.maximum).toBe(96);
  budget.configure('clip', 640, false);
  budget.configure('clip', 640, true);
  expect(budget.maximum).toBe(640);
});

it('uses the timeline frame rate and isolates a replacement source from the old playback budget', () => {
  const budget = new PlaybackPreviewBudget();
  budget.configure('clip', 640, true, 10);
  budget.record(60);
  budget.record(60);
  expect(budget.maximum).toBe(640);
  budget.record(500);
  budget.configure('replacement', 480, true, 30);
  expect(budget.maximum).toBe(480);
  budget.record(NaN);
  budget.record(-1);
  expect(budget.maximum).toBe(480);
});

it('retains the half-size source preview when no effects need a processed draft', () => {
  expect(fitFrameSize(3840, 2160, videoPlaybackDimension(3840, 2160, false))).toEqual({
    width: 1920,
    height: 1080,
  });
});

it.each([
  [640, 360],
  [1920, 1080],
  [3840, 2160],
  [7680, 4320],
  [2160, 3840],
  [1921, 1081],
])(
  'decodes %ix%i at the same processed draft size without the oversized readback',
  (width, height) => {
    const oldDecode = fitFrameSize(width, height, Math.ceil(Math.max(width, height) / 2));
    const oldDraft = fitFrameSize(
      oldDecode.width,
      oldDecode.height,
      playbackDimension(oldDecode.width, oldDecode.height),
    );
    const draft = fitFrameSize(width, height, videoPlaybackDimension(width, height));
    // Rounding an odd source can differ by one pixel; ordinary sizes are exact.
    expect(Math.abs(draft.width - oldDraft.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(draft.height - oldDraft.height)).toBeLessThanOrEqual(1);
    expect(draft.width * draft.height).toBeLessThanOrEqual(oldDecode.width * oldDecode.height);
  },
);
