// Integration proof for terminal hosts: real CPU effects and PNG sequence
// encoding through the shared runner, without Electron, a DOM or FFmpeg.
import { expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  createEffect,
  createProject,
  createTimeline,
  type SolidEffect,
} from '@gleech/project-model';
import { createRenderJobs } from '../main/render-jobs';
import { buildTimelineRenderRequest } from '../shared/render-request';
import { defaultGifSettings, defaultVideoSettings } from '../shared/render-presets';
import { runTimelineRender } from '../shared/timeline-runner';
import { renderHeadless } from './engine';
import { resizeImage } from './codec';

it('renders a timeline plan through terminal CPU effects into a PNG sequence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gleech-timeline-node-'));
  const jobs = createRenderJobs({
    ffmpeg: {
      status: async () => {
        throw new Error('PNG sequences must not probe FFmpeg');
      },
      configure: async () => {
        throw new Error('PNG sequences must not configure FFmpeg');
      },
      require: async () => {
        throw new Error('PNG sequences must not require FFmpeg');
      },
    },
  });
  try {
    const pixels = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
    const source = { width: 2, height: 2, pixels: pixels.buffer };
    const base = createEffect('solid', 'paint') as SolidEffect;
    const effect: SolidEffect = {
      ...base,
      params: { ...base.params, content: 'color', fillColor: '#ff0000' },
      animation: {
        amount: {
          keys: [
            { t: 0, value: 0, interpolation: 'linear' },
            { t: 1, value: 1, interpolation: 'linear' },
          ],
        },
      },
    };
    const timeline = createTimeline({ fps: 2, duration: 1.5 });
    const project = {
      ...createProject('Node timeline'),
      timeline,
      effects: [effect],
      source: {
        id: 's',
        name: 's.png',
        width: 2,
        height: 2,
        format: 'png' as const,
        hasAlpha: false,
      },
    };
    const settings = defaultVideoSettings({ width: 2, height: 2, fps: 2 });
    const request = buildTimelineRenderRequest({
      tab: 'video',
      project,
      timeline,
      range: { start: 0, end: 1.5 },
      outputPath: root,
      gif: defaultGifSettings(),
      video: {
        ...settings,
        fps: 2,
        output: 'sequence',
        frame: { ...settings.frame, width: 2, height: 2 },
        sequence: { ...settings.sequence, kind: 'files', subfolder: false },
      },
    });
    const result = await runTimelineRender(request, {
      source: { kind: 'still', read: async () => source },
      resize: resizeImage,
      render: async (frame, effects, context) => {
        const { image, backend } = await renderHeadless({
          source: frame,
          effects,
          masterSeed: context.masterSeed,
          isCancelled: context.isCancelled,
        });
        expect(backend).toBe('cpu');
        return image;
      },
      subject: async () => {
        throw new Error('This stack needs no subject');
      },
      begin: async (spec) => {
        const id = await jobs.begin(spec);
        return {
          frame: (frame, original) => jobs.frame(id, frame, original),
          finish: () => jobs.finish(id),
          cancel: () => jobs.cancel(id),
        };
      },
    });
    expect(result.files).toBe(3);
    const files = (await readdir(root)).filter((name) => name.endsWith('.png')).sort();
    expect(files).toHaveLength(3);
    const frames = await Promise.all(
      files.map(async (file) => [
        ...(await sharp(join(root, file)).ensureAlpha().raw().toBuffer()).subarray(0, 4),
      ]),
    );
    expect(frames).toEqual([
      [0, 0, 255, 255],
      [128, 0, 128, 255],
      [255, 0, 0, 255],
    ]);
    expect([...pixels]).toEqual([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  } finally {
    await jobs.dispose();
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
