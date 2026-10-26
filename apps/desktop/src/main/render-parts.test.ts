import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledFfmpegCandidates, createFfmpegLocator, runFfmpeg, spawnFfmpeg } from './ffmpeg';
import { createRenderJobs } from './render-jobs';
import { defaultVideoSettings } from '../shared/render-presets';
import { renderSafety } from '../shared/render-safety';
import type { RenderJobSpec } from '../shared/render';

const root = await mkdtemp(join(tmpdir(), 'gleech-parts-test-'));
const app = fileURLToPath(new URL('../../', import.meta.url));
const ffmpeg = createFfmpegLocator({
  configFile: join(root, 'ffmpeg.json'),
  bundled: bundledFfmpegCandidates('', app, false),
});
const status = await ffmpeg.status();
const jobs = createRenderJobs({ ffmpeg, tempRoot: root });
afterAll(async () => {
  await jobs.dispose();
  expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
  expect(basename(root)).toMatch(/^gleech-parts-test-/);
  await rm(root, { recursive: true, force: true });
});
function frame(index: number, size = 16) {
  const pixels = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < pixels.length; offset += 4)
    pixels.set([index * 17, 80, 180 - index * 7, 255], offset);
  return { width: size, height: size, pixels: pixels.buffer };
}
function spec(name: string, resume = false): RenderJobSpec {
  const video = defaultVideoSettings({ width: 16, height: 16, fps: 5 });
  return {
    kind: 'video',
    name,
    outputPath: join(root, `${name}.mkv`),
    fps: 5,
    frameCount: 12,
    sourceWidth: 16,
    sourceHeight: 16,
    resumeIdentity: 'a'.repeat(64),
    safety: renderSafety({ mode: 'one-frame', segmentSeconds: 1, keepParts: true, resume }),
    video: {
      ...video,
      format: 'mkv-ffv1',
      compression: 'lossless',
      fps: 5,
      frame: { ...video.frame, width: 16, height: 16 },
      advanced: { ...video.advanced, encoder: 'cpu', colorDepth: 8 },
      audio: { ...video.audio, enabled: false },
    },
  };
}
async function decode(path: string): Promise<Buffer> {
  const child = spawnFfmpeg(status.path!, [
    '-v',
    'error',
    '-i',
    path,
    '-map',
    '0:v:0',
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]);
  child.stdin.end();
  const chunks: Buffer[] = [];
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((yes, no) => {
    child.once('error', no);
    child.once('close', (code) =>
      code === 0 ? yes(Buffer.concat(chunks)) : no(new Error(stderr)),
    );
  });
}
async function finish(request: RenderJobSpec) {
  const id = await jobs.begin(request);
  const resumed = jobs.resumeFrames(id);
  for (let index = resumed; index < request.frameCount; index++) await jobs.frame(id, frame(index));
  return jobs.finish(id);
}

describe.skipIf(!status.available)('movie part checkpoints with real FFmpeg', () => {
  it.each(['mp4-hevc', 'webm-vp9', 'mov-prores', 'mov-v210', 'mov-png'] as const)(
    'uses bounded encoder settings and assembles %s parts',
    async (format) => {
      const base = spec(`codec-${format}`);
      const extension = format.startsWith('mp4')
        ? 'mp4'
        : format.startsWith('webm')
          ? 'webm'
          : 'mov';
      const request: RenderJobSpec = {
        ...base,
        outputPath: join(root, `${format}.${extension}`),
        frameCount: 6,
        sourceWidth: 64,
        sourceHeight: 64,
        video: {
          ...base.video!,
          format,
          compression: 'high',
          frame: { ...base.video!.frame, width: 64, height: 64 },
        },
      };
      const id = await jobs.begin(request);
      for (let index = 0; index < 6; index++) await jobs.frame(id, frame(index, 64));
      const result = await jobs.finish(id);
      expect((await decode(result.outputPath)).length).toBe(6 * 64 * 64 * 4);
    },
  );

  it('keeps fractional-rate part boundaries free of repeated or missing frames', async () => {
    const request = { ...spec('ntsc'), fps: 29.97, frameCount: 65 };
    const result = await finish(request);
    expect(await decode(result.outputPath)).toEqual(
      Buffer.concat(Array.from({ length: 65 }, (_, index) => Buffer.from(frame(index).pixels))),
    );
  });
  it('reassembles every lossless frame in order and preserves completed parts', async () => {
    const result = await finish(spec('full'));
    expect(result.files).toBe(1);
    const pixels = await decode(result.outputPath);
    expect(pixels).toEqual(
      Buffer.concat(Array.from({ length: 12 }, (_, index) => Buffer.from(frame(index).pixels))),
    );
    const manifest = JSON.parse(
      await readFile(join(result.checkpointPath!, 'gleech-parts.json'), 'utf8'),
    );
    expect(manifest.parts.map((part: { frames: number }) => part.frames)).toEqual([5, 5, 2]);
    expect((await readdir(result.checkpointPath!)).includes('active.json')).toBe(false);
  });
  it('resumes completed parts after cancellation and publishes no partial movie', async () => {
    const request = spec('resume');
    const id = await jobs.begin(request);
    for (let index = 0; index < 6; index++) await jobs.frame(id, frame(index));
    await jobs.cancel(id);
    expect((await readdir(root)).includes('resume.mkv')).toBe(false);
    const result = await finish(spec('resume', true));
    expect(result.resumedFrames).toBe(5);
    expect(await decode(result.outputPath)).toEqual(
      Buffer.concat(Array.from({ length: 12 }, (_, index) => Buffer.from(frame(index).pixels))),
    );
  });
  it('refuses tampered saved parts and simultaneous writers', async () => {
    const request = spec('tamper');
    const id = await jobs.begin(request);
    await expect(jobs.begin(spec('tamper', true))).rejects.toThrow(/Another export/);
    for (let index = 0; index < 5; index++) await jobs.frame(id, frame(index));
    await jobs.cancel(id);
    const folder = (await readdir(root)).find(
      (name) => name.startsWith('.tamper.mkv.') && name.endsWith('.gleech-parts'),
    )!;
    const part = join(root, folder, 'part-000000.mkv');
    await writeFile(part, Buffer.concat([await readFile(part), Buffer.from('changed')]));
    await expect(jobs.begin(spec('tamper', true))).rejects.toThrow(/part has changed/);
    expect(await readFile(part)).toContain(Buffer.from('changed')[0]);
    expect((await readdir(join(root, folder))).includes('active.json')).toBe(false);
  });
  it('muxes continuous audio once after assembling an MP4', async () => {
    const tone = join(root, 'tone.wav');
    expect(
      (
        await runFfmpeg(status.path!, [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=3',
          '-ac',
          '2',
          tone,
        ])
      ).code,
    ).toBe(0);
    const base = spec('audio');
    const request: RenderJobSpec = {
      ...base,
      outputPath: join(root, 'audio.mp4'),
      frameCount: 12,
      video: {
        ...base.video!,
        format: 'mp4-h264',
        compression: 'web',
        audio: { ...base.video!.audio, enabled: true, fadeIn: 0.2, fadeOut: 0.2 },
      },
      audio: { path: tone, start: 0.2, duration: 2.4 },
    };
    const result = await finish(request);
    expect((await decode(result.outputPath)).length).toBe(12 * 16 * 16 * 4);
    const description = (await runFfmpeg(status.path!, ['-hide_banner', '-i', result.outputPath]))
      .stderr;
    expect(description).toContain('Audio: aac');
    expect(description).toMatch(/Duration: 00:00:02\.4\d/);
  });
});
