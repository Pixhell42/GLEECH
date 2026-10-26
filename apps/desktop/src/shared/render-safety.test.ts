import { describe, expect, it } from 'vitest';
import {
  createEffect,
  createProject,
  createTimeline,
  type HueSaturationEffect,
  type PhotoAdjustmentsEffect,
  type LevelsCurvesEffect,
  type GradientMapEffect,
} from '@gleech/project-model';
import { renderEffectsAsync } from '@gleech/effects';
import {
  assessRenderMemory,
  renderSafety,
  renderTiledFrame,
  tiledRenderUnavailable,
} from './render-safety';
import { buildTimelineRenderRequest } from './render-request';
import { defaultGifSettings, defaultVideoSettings } from './render-presets';

function request() {
  const size = { width: 7680, height: 4320 };
  const timeline = { ...createTimeline(), duration: 10 };
  const project = {
    ...createProject('Memory', 7),
    timeline,
    source: { ...size, id: 'source', name: 'source.png', format: 'png' as const, hasAlpha: false },
    effects: [createEffect('noise-grain', 'grain'), createEffect('mirroring', 'mirror')],
  };
  return buildTimelineRenderRequest({
    tab: 'video',
    project,
    timeline,
    range: { start: 0, end: 10 },
    video: defaultVideoSettings({ ...size, fps: 30 }),
    gif: defaultGifSettings(),
    outputPath: 'movie.mp4',
    safety: renderSafety(),
  });
}
const budget = (available: number) => ({
  totalRAMBytes: 16 * 1024 ** 3,
  availableRAMBytes: available,
  availableGPUBytes: null,
});

describe('export memory planning', () => {
  it('reduces buffering for one-frame mode without depending on video duration', () => {
    const job = request();
    const normal = assessRenderMemory(job, null, renderSafety({ mode: 'standard' }));
    const serial = assessRenderMemory(job, null, renderSafety({ mode: 'one-frame' }));
    expect(serial.estimatedPeakBytes).toBeLessThan(normal.estimatedPeakBytes);
    expect(
      assessRenderMemory(
        { ...job, times: [...job.times, ...job.times] },
        null,
        renderSafety({ mode: 'one-frame' }),
      ).estimatedPeakBytes,
    ).toBe(serial.estimatedPeakBytes);
  });
  it('auto chooses serial buffering under pressure and still rejects a frame that cannot fit', () => {
    const job = request();
    const standard = assessRenderMemory(job, null, renderSafety({ mode: 'standard' }));
    const serial = assessRenderMemory(job, null, renderSafety({ mode: 'one-frame' }));
    const available =
      (standard.estimatedPeakBytes + serial.estimatedPeakBytes) / 2 + 1.6 * 1024 ** 3;
    expect(assessRenderMemory(job, budget(available)).mode).toBe('one-frame');
    expect(assessRenderMemory(job, budget(256 * 1024 ** 2)).status).toBe('insufficient');
    expect(
      assessRenderMemory(
        job,
        budget(256 * 1024 ** 2),
        renderSafety({ mode: 'one-frame', segmentSeconds: 5 }),
      ).status,
    ).toBe('insufficient');
  });
  it('only explicitly selected smaller effect processing reduces working resolution', () => {
    const original = request();
    const project = original.project;
    const video = {
      ...original.spec.video!,
      frame: { ...original.spec.video!.frame, width: 1920, height: 1080 },
    };
    const build = (processing: 'source' | 'output') =>
      buildTimelineRenderRequest({
        tab: 'video',
        project,
        timeline: project.timeline!,
        range: { start: 0, end: 1 },
        video,
        gif: defaultGifSettings(),
        outputPath: 'movie.mp4',
        safety: renderSafety({ processing }),
      });
    expect(build('source').renderSize.width).toBe(7680);
    expect(build('output').renderSize).toEqual({ width: 1920, height: 1080 });
  });
  it('reports unknown GPU availability rather than claiming a GPU allocation will fit', () => {
    const job = request();
    const result = assessRenderMemory(job, null);
    expect(result.availableGPUBytes).toBeNull();
    expect(result.status).toBe('unknown');
  });
});

describe('compatible tiled effect rendering', () => {
  it('matches a full-frame color stack byte-for-byte across partial edge tiles', async () => {
    const width = 269,
      height = 259;
    const pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 13 + 19) % 256;
    const image = { width, height, pixels: pixels.buffer };
    const hue = createEffect('hue-saturation', 'hue') as HueSaturationEffect;
    const photo = createEffect('photo-adjustments', 'photo') as PhotoAdjustmentsEffect;
    const levels = createEffect('levels-curves', 'levels') as LevelsCurvesEffect;
    const gradient = createEffect('gradient-map', 'gradient') as GradientMapEffect;
    const effects = [
      { ...hue, params: { ...hue.params, hue: 0.2, saturation: 0.3, amount: 0.7 } },
      { ...photo, params: { ...photo.params, exposure: 0.4, contrast: 0.2, amount: 0.8 } },
      { ...levels, params: { ...levels.params, gamma: 0.8, amount: 0.5 } },
      {
        ...gradient,
        params: { ...gradient.params, shadows: '#102030', highlights: '#e0f080', amount: 0.3 },
      },
    ];
    expect(tiledRenderUnavailable(effects)).toBeNull();
    const render = (frame: typeof image) =>
      renderEffectsAsync(frame, effects, {
        masterSeed: 7,
        yieldControl: async () => {},
      });
    const full = await render(image);
    const tiled = await renderTiledFrame(image, 256, render, () => false);
    expect(new Uint8Array(tiled.pixels)).toEqual(new Uint8Array(full.pixels));
  });
  it('refuses spatial effects and coordinate-dependent masks', () => {
    expect(tiledRenderUnavailable([createEffect('mirroring', 'm')])).toMatch(/mirroring/);
    const hue = createEffect('hue-saturation', 'h');
    expect(
      tiledRenderUnavailable([{ ...hue, application: { ...hue.application, region: 'left' } }]),
    ).toMatch(/current settings/);
    expect(
      tiledRenderUnavailable([{ ...hue, application: { ...hue.application, coverage: 0.5 } }]),
    ).toMatch(/current settings/);
  });
});
