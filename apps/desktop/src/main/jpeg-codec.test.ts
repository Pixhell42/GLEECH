import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createEffect, assertEffect, createProject } from '@gleech/project-model';
import { renderEffectsAsync } from '@gleech/effects';
import { recompressJpeg } from './jpeg-codec';
import { renderPresetThumbnail } from './image-worker';
import { encodePreset, decodePreset } from './preset-file';

const width = 67,
  height = 49;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 64, 128, 255][Math.floor(i / 4) % 5]! : (i * 37) % 256,
);
const image = { width, height, pixels: pixels.buffer };

describe('native JPEG recompression', () => {
  it('matches an actual JPEG round trip for both subsampling modes and preserves every alpha byte', async () => {
    const opaque = Uint8Array.from(pixels, (v, i) => (i % 4 === 3 ? 255 : v));
    const source = { ...image, pixels: opaque.buffer };
    for (const chromaSubsampling of ['420', '444'] as const) {
      const jpeg = await sharp(Buffer.from(opaque), { raw: { width, height, channels: 4 } })
        .removeAlpha()
        .jpeg({ quality: 12, chromaSubsampling: chromaSubsampling === '420' ? '4:2:0' : '4:4:4' })
        .toBuffer();
      const expected = await sharp(jpeg).ensureAlpha().raw().toBuffer();
      expect(Buffer.from(await recompressJpeg(source, { quality: 12, chromaSubsampling }))).toEqual(
        expected,
      );
      const result = new Uint8Array(
        await recompressJpeg(image, { quality: 12, chromaSubsampling }),
      );
      for (let i = 3; i < result.length; i += 4) expect(result[i]).toBe(pixels[i]);
    }
    expect(
      new Uint8Array(await recompressJpeg(image, { quality: 12, chromaSubsampling: '420' })),
    ).not.toEqual(
      new Uint8Array(await recompressJpeg(image, { quality: 12, chromaSubsampling: '444' })),
    );
  });
  it('ignores arbitrary hidden RGB inside the codec and restores it only in transparent output pixels', async () => {
    const changed = pixels.slice();
    for (let i = 0; i < changed.length; i += 4)
      if (changed[i + 3] === 0) changed.set([255, 0, 255], i);
    const a = new Uint8Array(await recompressJpeg(image, { quality: 7, chromaSubsampling: '420' }));
    const b = new Uint8Array(
      await recompressJpeg(
        { ...image, pixels: changed.buffer },
        { quality: 7, chromaSubsampling: '420' },
      ),
    );
    for (let i = 0; i < a.length; i += 4) {
      if (pixels[i + 3] !== 0) expect(a.subarray(i, i + 4)).toEqual(b.subarray(i, i + 4));
      else {
        expect(a.subarray(i, i + 4)).toEqual(pixels.subarray(i, i + 4));
        expect(b.subarray(i, i + 4)).toEqual(changed.subarray(i, i + 4));
      }
    }
  });
  it('captures codec parameters in portable presets and renders actual JPEG thumbnail pixels', async () => {
    const effect = createEffect('jpeg-recompression', 'jpeg');
    assertEffect(effect);
    const recipe = { masterSeed: 42, effects: [effect] };
    const rendered = await renderEffectsAsync(image, recipe.effects, {
      ...recipe,
      recompressJpeg,
      yieldControl: async () => {},
    });
    const thumbnail = await renderPresetThumbnail(image, recipe);
    const bytes = await sharp(Buffer.from(thumbnail.split(',')[1]!, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(bytes).toEqual(Buffer.from(rendered.pixels));
    const preset = {
      schemaVersion: 1 as const,
      id: 'jpeg',
      name: 'JPEG test',
      createdAt: '2026-10-09T00:00:00.000Z',
      ...recipe,
      thumbnail,
      thumbnailSource: 'image' as const,
    };
    expect(decodePreset(encodePreset(preset)).effects).toEqual([effect]);
    expect(
      JSON.parse(JSON.stringify({ ...createProject('JPEG test'), effects: [effect] })).effects,
    ).toEqual([effect]);
  });
  it('rejects invalid codec requests without invoking image decoding', async () => {
    for (const quality of [0, 101, 1.5, NaN])
      await expect(recompressJpeg(image, { quality, chromaSubsampling: '420' })).rejects.toThrow(
        'Invalid JPEG',
      );
    await expect(
      recompressJpeg(
        { ...image, pixels: new ArrayBuffer(1) },
        { quality: 12, chromaSubsampling: '420' },
      ),
    ).rejects.toThrow('Invalid JPEG');
    await expect(
      recompressJpeg(image, { quality: 12, chromaSubsampling: 'bad' as '420' }),
    ).rejects.toThrow('Invalid JPEG');
  });
});
