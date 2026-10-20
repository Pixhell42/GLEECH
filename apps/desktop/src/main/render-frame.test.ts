import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addedLightMatte,
  differenceMatte,
  fitGeometry,
  fitImage,
  flattenInPlace,
  hasTransparency,
  matteCurve,
  mixInPlace,
  prepareFrame,
  premultiplyInPlace,
  splitCommand,
  upscalerInvocation,
  type RawImage,
} from './render-frame';
import type { OutputFrame, UpscaleSettings } from '../shared/render';

const pixel = (...values: number[]) => Buffer.from(values);
function solid(width: number, height: number, rgba: readonly number[]): RawImage {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}
const at = (image: RawImage, x: number, y: number) => [
  ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
];
const frame = (width: number, height: number, extra: Partial<OutputFrame> = {}): OutputFrame => ({
  width,
  height,
  fit: 'fit',
  anchor: 'center',
  bars: 'black',
  barColor: '#000000',
  barBlur: 0.6,
  barDarken: 0.35,
  ...extra,
});

describe('overlay mattes', () => {
  it('ramps alpha from threshold to threshold + softness', () => {
    const curve = matteCurve(0.1, 0.2);
    expect(curve[0]).toBe(0);
    expect(curve[25]).toBe(0);
    expect(curve[Math.round(0.2 * 255)]).toBeGreaterThan(100);
    expect(curve[Math.round(0.2 * 255)]).toBeLessThan(155);
    expect(curve[Math.ceil(0.3 * 255)]).toBe(255);
    for (let i = 1; i < 256; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    const hard = matteCurve(0.5, 0);
    expect([hard[127], hard[128], hard[0]]).toEqual([0, 255, 0]);
    expect(matteCurve(0, 0)[0]).toBe(0);
  });

  it('difference keeps changed pixels with their edited color', () => {
    const original = pixel(100, 100, 100, 255, 100, 100, 100, 255, 0, 0, 0, 255);
    const edited = pixel(100, 100, 100, 255, 103, 98, 100, 255, 0, 200, 0, 255);
    const out = differenceMatte(edited, original, 0.05, 0.1);
    expect([...out.subarray(0, 4)]).toEqual([100, 100, 100, 0]);
    expect(out[7]).toBe(0); // 3/255 is under the 5% threshold
    expect([...out.subarray(8, 12)]).toEqual([0, 200, 0, 255]);
  });

  it('added light keeps only what got brighter, as normalized color + alpha', () => {
    const original = pixel(50, 50, 50, 255, 200, 200, 200, 255);
    const edited = pixel(178, 50, 50, 255, 100, 100, 100, 255);
    const out = addedLightMatte(edited, original, 0, 0.05);
    expect([...out.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect(out[3]).toBe(128);
    expect([...out.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    premultiplyInPlace(out);
    expect([...out.subarray(0, 4)]).toEqual([128, 0, 0, 128]);
  });

  it('flattens and detects transparency (aligned or not)', () => {
    const data = pixel(255, 0, 0, 128, 0, 0, 255, 255);
    expect(hasTransparency(data)).toBe(true);
    flattenInPlace(data, [255, 255, 255]);
    expect([...data]).toEqual([255, 127, 127, 255, 0, 0, 255, 255]);
    expect(hasTransparency(data)).toBe(false);
    const unaligned = Buffer.alloc(9).subarray(1);
    unaligned.set([1, 2, 3, 255, 4, 5, 6, 254]);
    expect(hasTransparency(unaligned)).toBe(true);
    const target = pixel(0, 0, 0, 0);
    mixInPlace(target, pixel(200, 200, 200, 200), 0.5);
    expect([...target]).toEqual([100, 100, 100, 100]);
  });
});

describe('fit geometry', () => {
  it('fits, crops, stretches and letterboxes', () => {
    const fit = fitGeometry(1920, 1080, frame(1080, 1920));
    expect(fit.dst).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(fit.src).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const crop = fitGeometry(1920, 1080, frame(1080, 1920, { fit: 'crop' }));
    expect(crop.src).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(crop.dst).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    const top = fitGeometry(1080, 1920, frame(1920, 1080, { fit: 'crop', anchor: 'top' }));
    expect(top.src).toEqual({ x: 0, y: 0, width: 1080, height: 608 });
    expect(fitGeometry(1920, 1080, frame(1080, 1080, { fit: 'stretch' })).src.width).toBe(1920);
    // Letterbox ═ into a taller target adds bars; into a wider one it trims.
    expect(fitGeometry(1920, 1080, frame(1080, 1350, { fit: 'letterbox-h' })).dst).toEqual({
      x: 0,
      y: 371,
      width: 1080,
      height: 608,
    });
    expect(fitGeometry(1920, 1080, frame(2560, 1080, { fit: 'letterbox-h' })).src).toEqual({
      x: 0,
      y: 135,
      width: 1920,
      height: 810,
    });
    expect(fitGeometry(1920, 1080, frame(2560, 1080, { fit: 'letterbox-v' })).dst).toEqual({
      x: 320,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
});

describe('fitting with sharp', () => {
  it('passes same-size frames through untouched', async () => {
    const image = solid(8, 4, [1, 2, 3, 255]);
    expect(await fitImage(image, frame(8, 4))).toBe(image);
  });

  it('adds black, color and transparent bars', async () => {
    const red = solid(4, 2, [255, 0, 0, 255]);
    const black = await fitImage(red, frame(4, 4));
    expect([at(black, 0, 0), at(black, 1, 1), at(black, 2, 2), at(black, 3, 3)]).toEqual([
      [0, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const colored = await fitImage(red, frame(4, 4, { bars: 'color', barColor: '#2040ff' }));
    expect(at(colored, 0, 0)).toEqual([32, 64, 255, 255]);
    const clear = await fitImage(red, frame(4, 4, { bars: 'transparent' }));
    expect(at(clear, 0, 0)[3]).toBe(0);
  });

  it('fills blurred-video bars with a darkened copy', async () => {
    const image = solid(64, 36, [200, 200, 200, 255]);
    const out = await fitImage(image, frame(36, 64, { bars: 'blur' }));
    expect([out.width, out.height, out.data.length]).toEqual([36, 64, 36 * 64 * 4]);
    const bar = at(out, 18, 2);
    expect(bar[0]).toBeGreaterThan(110);
    expect(bar[0]).toBeLessThan(150); // 200 × (1 − 0.35)
    expect(at(out, 18, 32)).toEqual([200, 200, 200, 255]);
  });

  it('upscales with nearest neighbor when chosen', async () => {
    const checker = { width: 2, height: 1, data: pixel(0, 0, 0, 255, 255, 255, 255, 255) };
    const settings: UpscaleSettings = {
      method: 'upscale-result',
      engine: 'nearest',
      model: '',
      mix: 0,
      command: '',
    };
    const out = await fitImage(checker, frame(8, 4, { fit: 'stretch' }), {
      upscale: { settings, tempDir: tmpdir(), locate: async () => null },
    });
    expect([at(out, 3, 2), at(out, 4, 2)]).toEqual([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('runs the overlay pipeline end to end', async () => {
    const original = solid(4, 4, [10, 10, 10, 255]);
    const edited = solid(4, 4, [10, 10, 10, 255]);
    edited.data.set([250, 10, 10, 255], 0);
    const out = await prepareFrame(edited, original, {
      frame: frame(4, 4),
      overlay: {
        enabled: true,
        matte: 'difference',
        threshold: 0.05,
        softness: 0,
        alpha: 'premultiplied',
      },
      alpha: true,
      premultiply: true,
    });
    expect(at(out, 0, 0)).toEqual([250, 10, 10, 255]);
    expect(at(out, 1, 0)).toEqual([0, 0, 0, 0]);
    await expect(
      prepareFrame(edited, undefined, {
        frame: frame(4, 4),
        overlay: {
          enabled: true,
          matte: 'difference',
          threshold: 0,
          softness: 0,
          alpha: 'straight',
        },
        alpha: true,
      }),
    ).rejects.toThrow(/original frame/);
    const flat = await prepareFrame(solid(2, 2, [255, 255, 255, 0]), undefined, {
      frame: frame(2, 2),
      alpha: false,
    });
    expect(at(flat, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('external upscalers', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gleech-upscale-test-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('splits command templates without a shell', () => {
    expect(splitCommand('"C:\\Program Files\\up.exe" -i {in} -o "{out}" -s {scale}')).toEqual([
      'C:\\Program Files\\up.exe',
      '-i',
      '{in}',
      '-o',
      '{out}',
      '-s',
      '{scale}',
    ]);
    expect(splitCommand(`tool --name 'a b' "" x`)).toEqual(['tool', '--name', 'a b', '', 'x']);
    expect(() => splitCommand('tool "open')).toThrow(/unclosed quote/);
  });

  it('picks engine scales and models', () => {
    expect(upscalerInvocation('realesrgan', '', 1.5, 'in.png', 'out.png').args).toEqual([
      '-i',
      'in.png',
      '-o',
      'out.png',
      '-s',
      '2',
      '-n',
      'realesr-animevideov3',
      '-f',
      'png',
    ]);
    expect(upscalerInvocation('realesrgan', 'realesrgan-x4plus (best)', 2, 'a', 'b').scale).toBe(4);
    expect(upscalerInvocation('realcugan', '', 3.5, 'a', 'b').scale).toBe(4);
    expect(upscalerInvocation('waifu2x', 'models-upconv_7_photo', 5, 'a', 'b').args).toContain(
      'models-upconv_7_photo',
    );
    expect(upscalerInvocation('waifu2x', '', 5, 'a', 'b').scale).toBe(8);
  });

  it('runs a custom command per frame and mixes in crisp pixels', async () => {
    // A tiny "upscaler": node copying {in} to {out} (sharp then resizes to the target).
    const script = join(dir, 'copy.js');
    await writeFile(script, "require('fs').copyFileSync(process.argv[2], process.argv[3]);");
    const settings: UpscaleSettings = {
      method: 'upscale-result',
      engine: 'command',
      model: '',
      mix: 1,
      command: `"${process.execPath}" "${script}" {in} {out} {scale} {frame}`,
    };
    const checker = { width: 2, height: 1, data: pixel(0, 0, 0, 255, 255, 255, 255, 255) };
    const out = await fitImage(checker, frame(8, 4, { fit: 'stretch' }), {
      upscale: { settings, tempDir: dir, locate: async () => null },
      frameIndex: 3,
    });
    // mix = 1 means the nearest-neighbor copy wins entirely.
    expect([at(out, 0, 0), at(out, 7, 3)]).toEqual([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('reports missing engines and MCP clearly', async () => {
    const image = solid(2, 2, [0, 0, 0, 255]);
    const upscale = (engine: UpscaleSettings['engine']) => ({
      settings: { method: 'upscale-result' as const, engine, model: '', mix: 0, command: '' },
      tempDir: dir,
      locate: async () => null,
    });
    await expect(fitImage(image, frame(4, 4), { upscale: upscale('realesrgan') })).rejects.toThrow(
      /Real-ESRGAN isn’t installed/,
    );
    await expect(fitImage(image, frame(4, 4), { upscale: upscale('mcp') })).rejects.toThrow(
      /MCP tool isn’t available here yet/,
    );
    await expect(
      fitImage(image, frame(4, 4), {
        upscale: {
          ...upscale('command'),
          settings: {
            ...upscale('command').settings,
            command: join(dir, 'missing-tool.exe') + ' {in} {out}',
          },
        },
      }),
    ).rejects.toThrow(/was not found/);
  });
});
