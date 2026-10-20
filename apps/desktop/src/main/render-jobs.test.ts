import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledFfmpegCandidates, createFfmpegLocator, runFfmpeg } from './ffmpeg';
import {
  createRenderJobs,
  lossyThreshold,
  reuseSimilarPixels,
  safeName,
  validateSpec,
} from './render-jobs';
import {
  applyCompression,
  applyGifPreset,
  applySequenceKind,
  defaultGifSettings,
  defaultVideoSettings,
} from '../shared/render-presets';
import type {
  GifRenderSettings,
  RenderFrame,
  RenderJobSpec,
  VideoRenderSettings,
} from '../shared/render';

const W = 64;
const H = 36;
const FPS = 30;
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'gleech-render-test-'));
const ffmpeg = createFfmpegLocator({
  configFile: join(root, 'ffmpeg.json'),
  bundled: bundledFfmpegCandidates('', appRoot, false),
});
const status = await ffmpeg.status();
const ffmpegPath = status.path ?? '';

function makeFrame(index: number, width = W, height = H, noise = false): RenderFrame {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      pixels[o] = noise ? Math.random() * 256 : (x * 4 + index * 9) & 255;
      pixels[o + 1] = noise ? Math.random() * 256 : (y * 7) & 255;
      pixels[o + 2] = noise ? Math.random() * 256 : (index * 25) & 255;
      pixels[o + 3] = 255;
    }
  return { width, height, pixels: pixels.buffer };
}
function videoSettings(change: (settings: VideoRenderSettings) => VideoRenderSettings = (s) => s) {
  const base = defaultVideoSettings({ width: W, height: H, fps: FPS });
  return change({ ...base, frame: { ...base.frame, width: W, height: H } });
}
function videoSpec(
  outputPath: string,
  video: VideoRenderSettings,
  extra: Partial<RenderJobSpec> = {},
): RenderJobSpec {
  return {
    kind: 'video',
    name: 'Test clip.gleech',
    video,
    frameCount: 10,
    fps: FPS,
    sourceWidth: W,
    sourceHeight: H,
    outputPath,
    ...extra,
  };
}
function gifSpec(
  outputPath: string,
  gif: GifRenderSettings,
  extra: Partial<RenderJobSpec> = {},
): RenderJobSpec {
  return {
    kind: 'gif',
    name: 'loop',
    gif,
    frameCount: 10,
    fps: FPS,
    sourceWidth: W,
    sourceHeight: H,
    outputPath,
    ...extra,
  };
}

async function render(
  jobs: ReturnType<typeof createRenderJobs>,
  spec: RenderJobSpec,
  frames = (i: number) => makeFrame(i),
  original?: (i: number) => RenderFrame,
) {
  const id = await jobs.begin(spec);
  for (let i = 0; i < spec.frameCount; i++) await jobs.frame(id, frames(i), original?.(i));
  return jobs.finish(id);
}

/** Decoded video frame count, via ffmpeg's framecrc muxer. */
async function countFrames(path: string): Promise<number> {
  const result = await runFfmpeg(
    ffmpegPath,
    ['-v', 'error', '-i', path, '-map', '0:v:0', '-f', 'framecrc', '-'],
    60000,
  );
  expect(result.stderr.trim()).toBe('');
  return result.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('#')).length;
}
async function describeStreams(path: string): Promise<string> {
  return (await runFfmpeg(ffmpegPath, ['-hide_banner', '-i', path], 60000)).stderr;
}

describe('job validation and helpers', () => {
  it('rejects malformed specs and cleans names', () => {
    const spec = videoSpec(join(root, 'a.mp4'), videoSettings());
    expect(validateSpec(spec)).toBe(spec);
    expect(() => validateSpec({ ...spec, outputPath: 'relative.mp4' })).toThrow(/where to save/);
    expect(() => validateSpec({ ...spec, frameCount: 0 })).toThrow(/frame count/);
    expect(() => validateSpec({ ...spec, video: { ...spec.video!, format: 'avi' } })).toThrow(
      /video render settings/,
    );
    expect(() =>
      validateSpec({ ...spec, kind: 'gif', gif: { ...defaultGifSettings(), colors: 999 } }),
    ).toThrow(/GIF/);
    expect(safeName('My: clip?.gleech')).toBe('My_ clip_');
    expect(safeName('CON')).toBe('render');
  });

  it('lossy pre-pass reuses near-identical pixels', () => {
    const previous = Uint8Array.from([100, 100, 100, 255, 0, 0, 0, 255]);
    const frame = Uint8Array.from([104, 98, 100, 255, 90, 0, 0, 255]);
    reuseSimilarPixels(frame, previous, lossyThreshold(30));
    expect([...frame]).toEqual([100, 100, 100, 255, 90, 0, 0, 255]);
    expect(lossyThreshold(0)).toBe(0);
  });
});

describe.skipIf(!status.available)('end-to-end encodes with ffmpeg', () => {
  const jobs = createRenderJobs({ ffmpeg, tempRoot: root });
  let out = '';
  let tone = '';
  beforeAll(async () => {
    out = await mkdtemp(join(root, 'out-'));
    tone = join(root, 'tone.wav');
    const made = await runFfmpeg(ffmpegPath, [
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
    ]);
    expect(made.code).toBe(0);
  });
  afterAll(async () => {
    await jobs.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('encodes MP4 (web) with audio and leaves no temp files', async () => {
    const path = join(out, 'web.mp4');
    const result = await render(
      jobs,
      videoSpec(path, videoSettings(), { audio: { path: tone, start: 0.5, duration: 2 } }),
    );
    expect(result).toMatchObject({ outputPath: path, files: 1 });
    expect(result.bytes).toBeGreaterThan(1000);
    expect(await countFrames(path)).toBe(10);
    const info = await describeStreams(path);
    expect(info).toMatch(/Video: h264 \(High\).*yuv420p.*64x36/);
    expect(info).toContain('Audio: aac');
    expect((await readdir(out)).filter((name) => name.includes('partial'))).toEqual([]);
  }, 60000);

  it('fits into another aspect and writes HEVC, ProRes, FFV1 and v210', async () => {
    const vertical = join(out, 'vertical.mp4');
    await render(
      jobs,
      videoSpec(
        vertical,
        videoSettings((s) => ({
          ...s,
          frame: { ...s.frame, width: 36, height: 64, bars: 'blur' },
        })),
      ),
    );
    expect(await describeStreams(vertical)).toContain('36x64');
    const cases: [string, VideoRenderSettings, RegExp][] = [
      [
        'hevc.mp4',
        videoSettings((s) => applyCompression({ ...s, format: 'mp4-hevc' }, 'highest')),
        /hevc.*yuv420p10le/,
      ],
      [
        'master.mov',
        videoSettings((s) => applyCompression({ ...s, format: 'mov-prores' }, 'high')),
        /prores \(HQ\)/,
      ],
      ['lossless.mkv', videoSettings((s) => applyCompression(s, 'lossless')), /ffv1/],
      ['raw.mov', videoSettings((s) => applyCompression(s, 'raw')), /v210/],
    ];
    for (const [name, settings, pattern] of cases) {
      const path = join(out, name);
      const result = await render(jobs, videoSpec(path, settings));
      expect(result.outputPath).toBe(path);
      expect(await describeStreams(path)).toMatch(pattern);
      expect(await countFrames(path)).toBe(10);
    }
  }, 120000);

  it('renders an effects-only overlay as ProRes 4444 with alpha', async () => {
    const path = join(out, 'overlay.mp4');
    const settings = videoSettings((s) => ({ ...s, overlay: { ...s.overlay, enabled: true } }));
    const result = await render(
      jobs,
      videoSpec(path, settings, { withOriginal: true }),
      makeFrame,
      (i) => makeFrame(i + 3),
    );
    expect(result.outputPath).toBe(join(out, 'overlay.mov'));
    expect(result.notes.join(' ')).toContain('ProRes 4444');
    expect(await describeStreams(result.outputPath)).toMatch(/prores \(4444\).*yuva444p/);
  }, 60000);

  it('makes GIF, WebP, APNG and MP4 loops', async () => {
    const gif = defaultGifSettings();
    const boomerang = await render(
      jobs,
      gifSpec(join(out, 'loop.gif'), { ...gif, width: 64, loop: 'boomerang', lossy: 40 }),
    );
    // 10 frames → 18 boomerang frames at 30 fps → 9 frames at 15 fps.
    expect(await countFrames(boomerang.outputPath)).toBe(9);
    expect(await describeStreams(boomerang.outputPath)).toContain('64x36');
    const webp = await render(jobs, gifSpec(join(out, 'loop.webp'), { ...gif, format: 'webp' }));
    const meta = await sharp(webp.outputPath, { animated: true }).metadata();
    expect([meta.format, meta.pages, meta.loop]).toEqual(['webp', 5, 0]);
    const sticker = await render(
      jobs,
      gifSpec(join(out, 'sticker.png'), { ...applyGifPreset(gif, 'sticker'), format: 'apng' }),
    );
    expect(await describeStreams(sticker.outputPath)).toMatch(/apng.*rgba/);
    expect(await countFrames(sticker.outputPath)).toBe(5);
    const mp4 = await render(
      jobs,
      gifSpec(
        join(out, 'loop.mp4'),
        { ...gif, format: 'mp4', audio: true },
        { audio: { path: tone, start: 0, duration: 1 } },
      ),
    );
    expect(await describeStreams(mp4.outputPath)).toContain('Audio: aac');
  }, 120000);

  it('trims a GIF to fit the size limit', async () => {
    const big = { ...defaultGifSettings(), sizeLimitMb: 1 as const, width: 480 };
    const result = await render(
      jobs,
      gifSpec(join(out, 'noise.gif'), big, { frameCount: 30, sourceWidth: 480, sourceHeight: 270 }),
      (i) => makeFrame(i, 480, 270, true),
    );
    expect(result.bytes).toBeLessThanOrEqual(1e6);
    expect(result.notes.join(' ')).toMatch(/→ trimmed to fit 1 MB \(.+\)/);
    expect((await readdir(out)).filter((name) => name.includes('partial'))).toEqual([]);
  }, 120000);

  it('writes 16-bit PNG sequences with a WAV in a subfolder', async () => {
    const settings = videoSettings((s) => ({ ...s, output: 'sequence' }));
    const result = await render(
      jobs,
      videoSpec(out, settings, { clipAudio: { path: tone, start: 0, duration: 1 } }),
    );
    const folder = join(out, 'Test clip_frames');
    expect(result).toMatchObject({ outputPath: folder, files: 11 });
    const names = (await readdir(folder)).sort();
    expect(names[0]).toBe('Test clip_0001.png');
    expect(names).toContain('Test clip_0010.png');
    expect(names).toContain('Test clip_audio.wav');
    const meta = await sharp(join(folder, 'Test clip_0001.png')).metadata();
    expect([meta.width, meta.height, meta.depth, meta.channels]).toEqual([W, H, 'ushort', 3]);
    expect(await describeStreams(join(folder, 'Test clip_audio.wav'))).toContain('pcm_s24le');
    // Effects-only frames keep alpha: 16-bit RGBA, named with _fx.
    const overlay = await render(
      jobs,
      videoSpec(
        out,
        videoSettings((s) => ({
          ...s,
          output: 'sequence',
          overlay: { ...s.overlay, enabled: true },
          sequence: { ...s.sequence, subfolder: false, separateAudio: false },
        })),
      ),
      makeFrame,
      (i) => makeFrame(i + 1),
    );
    expect(overlay).toMatchObject({ outputPath: out, files: 10 });
    const fx = await sharp(join(out, 'Test clip_fx_0003.png')).metadata();
    expect([fx.channels, fx.depth, fx.hasAlpha]).toEqual([4, 'ushort', true]);
  }, 60000);

  it('makes flip book PDFs and sprite sheets', async () => {
    const flip = videoSettings((s) => applySequenceKind(s, 'flipbook'));
    const pdf = await render(
      jobs,
      videoSpec(
        join(out, 'book.pdf'),
        {
          ...flip,
          sequence: {
            ...flip.sequence,
            flipbook: { ...flip.sequence.flipbook, perPage: 4, cover: true },
          },
        },
        { frameTimes: Array.from({ length: 10 }, (_, i) => 2 + (i * 2) / FPS) },
      ),
    );
    const text = (await readFile(pdf.outputPath)).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(4);
    // Every-2nd frames are numbered by source frame.
    expect(text).toContain('(019) Tj');
    expect(text).toContain('(Test clip) Tj');
    const sheet = {
      ...flip,
      sequence: {
        ...flip.sequence,
        flipbook: { ...flip.sequence.flipbook, kind: 'sprite' as const },
      },
    };
    const sprite = await render(
      jobs,
      videoSpec(join(out, 'sheet.png'), sheet, {
        frameTimes: Array.from({ length: 10 }, (_, i) => 1 + i / 30),
      }),
    );
    expect(sprite.files).toBe(2);
    const meta = await sharp(sprite.outputPath).metadata();
    expect([meta.width, meta.height]).toEqual([W * 2, H * 5]);
    const json = JSON.parse(await readFile(join(out, 'sheet.json'), 'utf8'));
    expect(json.frames).toHaveLength(10);
    expect(json.frames[1]).toMatchObject({ index: 1, t: 1.033, x: W, y: 0, w: W, h: H });
  }, 60000);

  it('cancels cleanly and reports bad frames', async () => {
    const folder = await mkdtemp(join(out, 'cancel-'));
    const id = await jobs.begin(videoSpec(join(folder, 'cancel.mp4'), videoSettings()));
    for (let i = 0; i < 3; i++) await jobs.frame(id, makeFrame(i));
    await jobs.cancel(id);
    expect(await readdir(folder)).toEqual([]);
    await expect(jobs.frame(id, makeFrame(0))).rejects.toThrow(/no longer running/);

    const bad = await jobs.begin(videoSpec(join(folder, 'bad.mp4'), videoSettings()));
    await expect(jobs.frame(bad, makeFrame(0, 32, 32))).rejects.toThrow(/must be 64 × 36/);
    await jobs.cancel(bad);

    const overlay = await jobs.begin(
      videoSpec(
        join(folder, 'o.mov'),
        videoSettings((s) => ({ ...s, overlay: { ...s.overlay, enabled: true } })),
      ),
    );
    await jobs.frame(overlay, makeFrame(0)).catch(() => {});
    await expect(jobs.finish(overlay)).rejects.toThrow(/original frame/);
    expect(await readdir(folder)).toEqual([]);
  }, 60000);

  it('runs several jobs at once', async () => {
    const specs = [
      videoSpec(join(out, 'a.mp4'), videoSettings()),
      gifSpec(join(out, 'a.gif'), defaultGifSettings()),
      videoSpec(
        join(out, 'b.mov'),
        videoSettings((s) => applyCompression({ ...s, format: 'mov-prores' }, 'small')),
      ),
    ];
    const ids = await Promise.all(specs.map((spec) => jobs.begin(spec)));
    for (let i = 0; i < 10; i++) await Promise.all(ids.map((id) => jobs.frame(id, makeFrame(i))));
    const results = await Promise.all(ids.map((id) => jobs.finish(id)));
    expect(results.map((result) => result.bytes > 0)).toEqual([true, true, true]);
    expect(await countFrames(results[2]!.outputPath)).toBe(10);
  }, 60000);
});
