import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  createEffect,
  createProject,
  createTimeline,
  type ProjectState,
  type SolidEffect,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import { encodeProject } from '../main/project-file';
import { runCli } from './commands';
import { configureRendering } from './gpu';
import { decodePng, encodePng } from './png';
import { Session } from './session';
import { cliTimelinePlan, validateTimelineOptions } from './timeline-plan';
import { exportTimeline } from './timeline';
import { terminalFfmpeg } from './timeline-host';

// Export behavior must not depend on other tests consuming the runner's RAM.
// Real budget reporting and low-memory rejection have their own tests.
vi.mock('../main/render-memory', () => ({
  renderMemoryBudget: () => ({
    totalRAMBytes: 16 * 1024 ** 3,
    availableRAMBytes: 12 * 1024 ** 3,
    availableGPUBytes: null,
  }),
}));

const pixels = Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
const png = encodePng({ width: 2, height: 2, pixels: pixels.buffer });
function project(): ProjectState {
  const solid = createEffect('solid', 'paint') as SolidEffect;
  return {
    ...createProject('Animation', 17),
    source: { id: 'source', name: 'blue.png', width: 2, height: 2, format: 'png', hasAlpha: false },
    timeline: {
      ...createTimeline({ fps: 2, duration: 1.5 }),
      workArea: { start: 0.5, end: 1.5 },
      inOut: { start: 0, end: 1 },
    },
    effects: [
      {
        ...solid,
        params: { ...solid.params, content: 'color', fillColor: '#ff0000' },
        animation: {
          amount: {
            keys: [
              { t: 0, value: 0, interpolation: 'linear' },
              { t: 1, value: 1, interpolation: 'linear' },
            ],
          },
        },
      } as SolidEffect,
    ],
  };
}
const options = { timeline: true, format: 'png' };
async function temporary(work: (directory: string, session: Session) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-cli-timeline-'));
  try {
    const path = join(directory, 'animation ü #1.gleech');
    await writeFile(
      path,
      encodeProject(project(), new Map([['source', { png: Uint8Array.from(png).buffer }]])),
    );
    await work(directory, await Session.open(path));
  } finally {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}
beforeEach(() => configureRendering({ renderer: 'cpu', skipUnsupportedShaders: false }));

describe('CLI timeline plans', () => {
  const path = resolve('animation.gleech');
  it('uses the shared range and frame schedule while preserving timeline time', () => {
    const plan = cliTimelinePlan(project(), path, { ...options, range: 'work', fps: '4' });
    expect(plan.request.times).toEqual([0.5, 0.75, 1, 1.25]);
    expect(plan.request.project.masterSeed).toBe(17);
    expect(plan.outputPath).toBe(join(dirname(path), 'animation-frames'));
    expect(plan.request.spec.video?.sequence.subfolder).toBe(false);
  });
  it('infers MP4/GIF, preserves aspect, and uses explicit time overrides', () => {
    const movie = cliTimelinePlan(project(), path, {
      timeline: true,
      output: 'movie.mp4',
      start: '0.5',
      end: '1',
    });
    expect(movie.format).toBe('mp4');
    expect(movie.request.times).toEqual([0.5]);
    expect(movie.request.spec.video?.audio.source).toBe('mix');
    const gif = cliTimelinePlan(project(), path, {
      timeline: true,
      output: 'movie.gif',
      width: '32',
      fps: '10',
    });
    expect(gif.request.spec.gif).toMatchObject({ width: 32, fps: 10, sizeLimitMb: 0 });
    expect(gif.request.times).toHaveLength(15);
  });
  it('resolves external media beside the project without modifying its snapshot', () => {
    const state = project();
    const withVideo = {
      ...state,
      timeline: {
        ...state.timeline!,
        video: {
          path: 'clip ü #1.mp4',
          name: 'clip',
          width: 2,
          height: 2,
          fps: 2,
          duration: 1,
          hasAudio: true,
        },
      },
    };
    const plan = cliTimelinePlan(withVideo, path, { timeline: true });
    expect(plan.request.project.timeline?.video?.path).toBe(join(dirname(path), 'clip ü #1.mp4'));
    expect(withVideo.timeline.video.path).toBe('clip ü #1.mp4');
  });
  it('passes selected memory and recovery controls to the shared runner', () => {
    const plan = cliTimelinePlan(project(), path, {
      timeline: true,
      'memory-mode': 'one-frame',
      'no-memory-check': true,
      'segment-seconds': '20',
      'keep-parts': true,
      resume: true,
      'tile-size': '256',
      'processing-resolution': 'output',
    });
    expect(plan.request.spec.safety).toEqual({
      checkMemory: false,
      mode: 'one-frame',
      segmentSeconds: 20,
      keepParts: true,
      resume: true,
      tileSize: 256,
      processing: 'output',
    });
  });
  it.each([
    { fps: 'NaN' },
    { fps: '0' },
    { format: 'webm' },
    { range: 'missing' },
    { start: '-1' },
    { end: '3' },
    { start: '1', end: '0.5' },
    { format: 'gif', fps: '2' },
    { width: '2.5' },
    { width: '99999' },
    { output: 'wrong.jpg' },
    { quality: '80' },
    { show: true },
    { 'memory-mode': 'unbounded' },
    { 'segment-seconds': '-1' },
    { 'segment-seconds': '601' },
    { 'segment-seconds': 'NaN' },
    { 'keep-parts': true },
    { resume: true },
    { format: 'gif', 'segment-seconds': '30' },
    { format: 'png', 'segment-seconds': '30' },
    { 'tile-size': '300' },
    { 'processing-resolution': 'preview' },
  ])('rejects invalid timeline options: %o', (values) => {
    expect(() => cliTimelinePlan(project(), path, { timeline: true, ...values })).toThrow();
  });
  it('rejects timeline-only flags on still renders and projects without a timeline', () => {
    expect(() => validateTimelineOptions({ fps: '24' })).toThrow('requires --timeline');
    expect(() => validateTimelineOptions({ 'memory-mode': 'one-frame' })).toThrow(
      'requires --timeline',
    );
    expect(() => cliTimelinePlan(createProject('Still'), path, options)).toThrow('no timeline');
  });
});

describe('terminal timeline exports', () => {
  it('resumes saved movie parts across terminal sessions with a new staging folder', async (context) => {
    await temporary(async (directory, session) => {
      if (!(await terminalFfmpeg(session).status()).available) {
        context.skip();
        return;
      }
      const output = join(directory, 'recover.mp4');
      const values = {
        timeline: true,
        output,
        width: '16',
        'memory-mode': 'one-frame',
        'segment-seconds': '1',
        'keep-parts': true,
      };
      const controller = new AbortController();
      await expect(
        exportTimeline(session, values, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.done === 2) controller.abort();
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
      expect(await readdir(directory)).not.toContain('recover.mp4');
      const reopened = await Session.open(session.path!);
      const result = await exportTimeline(reopened, { ...values, resume: true });
      expect(result.resumedFrames).toBe(2);
      expect(result.checkpointPath).toContain('.gleech-parts');
      expect(dirname(result.checkpointPath!)).toBe(directory);
      expect((await readFile(output)).subarray(4, 8).toString()).toBe('ftyp');
      expect((await readdir(directory)).some((name) => name.startsWith('.gleech-timeline-'))).toBe(
        false,
      );
    });
  });
  it('exports animated pixels through the production CLI command and reports JSON', async () => {
    await temporary(async (directory, session) => {
      let stdout = '';
      const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
      });
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const folder = join(directory, 'frames');
        expect(
          await runCli([
            'render',
            session.path!,
            '--timeline',
            '-f',
            'png',
            '-o',
            folder,
            '--renderer',
            'cpu',
            '--json',
          ]),
        ).toBe(0);
        const result = JSON.parse(stdout);
        expect(result).toMatchObject({
          frames: 3,
          files: 3,
          fps: 2,
          format: 'png',
          backends: ['cpu'],
          warnings: [],
        });
        const names = (await readdir(folder)).sort();
        const frames = await Promise.all(
          names.map(async (name) => [
            ...new Uint8Array(decodePng(await readFile(join(folder, name))).pixels).slice(0, 4),
          ]),
        );
        expect(frames).toEqual([
          [0, 0, 255, 255],
          [128, 0, 128, 255],
          [255, 0, 0, 255],
        ]);
        expect(
          (await readdir(directory)).some((name) => name.startsWith('.gleech-timeline-')),
        ).toBe(false);
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
    });
  });
  it('preserves prior output on cancellation and replaces a sequence only on success', async () => {
    await temporary(async (directory, session) => {
      const output = join(directory, 'frames');
      await exportTimeline(session, { ...options, output });
      const names = (await readdir(output)).sort();
      const before = await Promise.all(names.map((name) => readFile(join(output, name))));
      await expect(exportTimeline(session, { ...options, output })).rejects.toThrow('exists');
      const controller = new AbortController();
      await expect(
        exportTimeline(
          session,
          { ...options, output, overwrite: true },
          { signal: controller.signal, onProgress: () => controller.abort() },
        ),
      ).rejects.toBeInstanceOf(RenderCancelledError);
      expect(await readdir(output)).toHaveLength(3);
      expect(await Promise.all(names.map((name) => readFile(join(output, name))))).toEqual(before);
      await exportTimeline(session, { ...options, output, overwrite: true, end: '0.5' });
      expect(await readdir(output)).toHaveLength(1);
      await writeFile(join(output, 'keep.txt'), 'keep');
      await expect(
        exportTimeline(session, { ...options, output, overwrite: true }),
      ).rejects.toThrow('outside this sequence');
      expect(await readFile(join(output, 'keep.txt'), 'utf8')).toBe('keep');
      expect((await readdir(directory)).some((name) => name.startsWith('.gleech-timeline-'))).toBe(
        false,
      );
    });
  });
  it('reports missing external video instead of exporting its poster', async () => {
    await temporary(async (directory, session) => {
      const state = project();
      const bytes = encodeProject(
        {
          ...state,
          timeline: {
            ...state.timeline!,
            video: {
              path: 'missing.mp4',
              name: 'missing',
              width: 2,
              height: 2,
              fps: 2,
              duration: 1,
              hasAudio: false,
            },
          },
        },
        new Map([['source', { png: Uint8Array.from(png).buffer }]]),
      );
      const video = Session.fromProjectBytes(bytes, session.path);
      await expect(
        exportTimeline(video, { ...options, output: join(directory, 'frames') }),
      ).rejects.toThrow('video clip was not found');
      expect(await readdir(directory)).toEqual([basename(session.path!)]);
    });
  });
  it('refuses to overwrite the source clip, including Windows path casing', async () => {
    await temporary(async (directory, session) => {
      const state = project();
      const path = join(directory, 'clip.mp4');
      const video = Session.fromProjectBytes(
        encodeProject(
          {
            ...state,
            timeline: {
              ...state.timeline!,
              video: {
                path,
                name: 'clip',
                width: 2,
                height: 2,
                fps: 2,
                duration: 1,
                hasAudio: false,
              },
            },
          },
          new Map([['source', { png: Uint8Array.from(png).buffer }]]),
        ),
        session.path,
      );
      await expect(
        exportTimeline(video, {
          timeline: true,
          output: process.platform === 'win32' ? path.toUpperCase() : path,
          overwrite: true,
        }),
      ).rejects.toThrow('output must differ');
    });
  });
  it('handles CLI SIGINT with exit 130, releases listeners and preserves output', async () => {
    await temporary(async (directory, session) => {
      const output = join(directory, 'frames');
      await exportTimeline(session, { ...options, output });
      const listeners = process.listenerCount('SIGINT');
      const original = process.once.bind(process);
      let sent = false;
      const once = vi.spyOn(process, 'once').mockImplementation((event, listener) => {
        const result = original(event, listener);
        if (event === 'SIGINT' && !sent) {
          sent = true;
          setImmediate(() => process.emit('SIGINT'));
        }
        return result;
      });
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        expect(
          await runCli([
            'render',
            session.path!,
            '--timeline',
            '-f',
            'png',
            '-o',
            output,
            '-y',
            '--renderer',
            'cpu',
          ]),
        ).toBe(130);
        expect(process.listenerCount('SIGINT')).toBe(listeners);
        expect(await readdir(output)).toHaveLength(3);
        expect(
          (await readdir(directory)).some((name) => name.startsWith('.gleech-timeline-')),
        ).toBe(false);
      } finally {
        once.mockRestore();
        stderr.mockRestore();
      }
    });
  });
});
