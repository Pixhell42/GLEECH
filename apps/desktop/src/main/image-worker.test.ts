import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  decodeImage,
  encodePng,
  encodeImage,
  presetThumbnail,
  renderPresetThumbnail,
} from './image-worker';
import { createEffect } from '@gleech/project-model';
import { renderEffects } from '@gleech/effects';
import { FILE_APPLICATION } from './file-metadata';

const bytes = (buffer: Buffer) => Uint8Array.from(buffer).buffer;

describe('image decoding and PNG encoding', () => {
  it('exports lossless PNG and TIFF with RGBA intact, WebP alpha, and JPEG flattened onto white', async () => {
    const rgba = Buffer.alloc(32 * 16 * 4);
    for (let i = 0; i < rgba.length; i += 4)
      rgba.set([90, 170, 230, i < rgba.length / 2 ? 0 : 128], i);
    const image = { width: 32, height: 16, pixels: bytes(rgba) };
    for (const format of ['png', 'tiff', 'webp', 'jpeg'] as const) {
      const encoded = Buffer.from(await encodeImage(image, { format }));
      const metadata = await sharp(encoded).metadata();
      expect([metadata.width, metadata.height, metadata.format]).toEqual([32, 16, format]);
      expect(metadata.hasAlpha).toBe(format !== 'jpeg');
      const xmp = metadata.xmp?.toString('utf8');
      expect(xmp).toContain(
        `<xmp:CreatorTool>GLEECH ${FILE_APPLICATION.version}</xmp:CreatorTool>`,
      );
      expect(xmp).toContain('<gleech:Application>GLEECH</gleech:Application>');
      expect(xmp).toContain(`<gleech:Version>${FILE_APPLICATION.version}</gleech:Version>`);
      expect(xmp).toContain('<gleech:DeveloperURL>https://x.com/pixhell</gleech:DeveloperURL>');
      expect(xmp).toContain(
        '<gleech:RepositoryURL>https://github.com/Pixhell42/GLEECH</gleech:RepositoryURL>',
      );
      const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer();
      if (format === 'png' || format === 'tiff') expect(decoded).toEqual(rgba);
      else if (format === 'webp')
        for (let i = 3; i < decoded.length; i += 4) expect(decoded[i]).toBe(rgba[i]);
      else expect(Array.from(decoded.subarray(0, 4))).toEqual([255, 255, 255, 255]);
    }
    await expect(encodeImage(image, { format: 'jpeg', quality: 101 })).rejects.toThrow();
    await expect(
      encodeImage({ ...image, pixels: new ArrayBuffer(1) }, { format: 'png' }),
    ).rejects.toThrow();
  });
  it('renders preset thumbnails using the recipe, original pixels, mask and seed', async () => {
    const image = {
      width: 4,
      height: 4,
      pixels: Uint8Array.from({ length: 64 }, (_, i) => (i * 23) % 256).buffer,
    };
    const base = createEffect('bit-crush', 'pattern');
    if (base.type !== 'bit-crush') throw new Error('Invalid fixture effect.');
    const effect = {
      ...base,
      params: { ...base.params, dither: 'random' as const },
      application: { region: 'subject' as const, coverage: 1, softness: 0 },
    };
    const recipe = { masterSeed: 711, effects: [effect] };
    const subjectMask = { width: 4, height: 4, values: new Uint8Array(16).fill(128).buffer };
    const actual = await renderPresetThumbnail(image, recipe, subjectMask);
    expect(actual).toBe(
      await presetThumbnail(
        renderEffects(image, recipe.effects, { masterSeed: recipe.masterSeed, subjectMask }),
      ),
    );
    expect(actual).not.toBe(
      await renderPresetThumbnail(image, { ...recipe, masterSeed: 712 }, subjectMask),
    );
  });
  it('creates a bounded preset thumbnail with aspect ratio and alpha intact', async () => {
    const pixels = new Uint8Array(768 * 384 * 4).fill(128);
    const thumbnail = await presetThumbnail({ width: 768, height: 384, pixels: pixels.buffer });
    const image = sharp(Buffer.from(thumbnail.split(',')[1]!, 'base64'));
    const info = await image.metadata();
    expect([info.width, info.height, info.hasAlpha]).toEqual([384, 192, true]);
    expect((await image.raw().toBuffer())[3]).toBe(128);
    await expect(
      presetThumbnail({ width: 2, height: 2, pixels: new ArrayBuffer(4) }),
    ).rejects.toThrow();
  });
  it('round-trips straight alpha including colored fully transparent pixels', async () => {
    const rgba = Buffer.from([255, 0, 128, 0, 17, 128, 254, 1, 40, 220, 9, 128, 6, 7, 8, 255]);
    const input = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } })
      .png()
      .toBuffer();
    const decoded = await decodeImage(bytes(input));
    expect(Buffer.from(decoded.fullPixels)).toEqual(rgba);
    expect(decoded.hasAlpha).toBe(true);
    const encoded = await encodePng({ width: 2, height: 2, pixels: decoded.fullPixels });
    expect(await sharp(Buffer.from(encoded)).raw().toBuffer()).toEqual(rgba);
  });

  it('creates a reduced preview without reducing the original export pixels', async () => {
    const input = await sharp({
      create: { width: 4096, height: 3072, channels: 4, background: '#dcb85680' },
    })
      .png()
      .toBuffer();
    const decoded = await decodeImage(bytes(input));
    expect([decoded.width, decoded.height]).toEqual([4096, 3072]);
    expect([decoded.preview.width, decoded.preview.height]).toEqual([2048, 1536]);
    expect(decoded.fullPixels.byteLength).toBe(4096 * 3072 * 4);
  });

  it('normalizes EXIF orientation before exposing image dimensions', async () => {
    const input = await sharp({
      create: { width: 4, height: 2, channels: 3, background: '#123456' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const decoded = await decodeImage(bytes(input));
    expect([decoded.width, decoded.height]).toEqual([2, 4]);
    expect(decoded.hasAlpha).toBe(false);
  });

  it('decodes WebP alpha and exports the decoded pixels as PNG', async () => {
    const input = await sharp({
      create: { width: 7, height: 3, channels: 4, background: '#b9854280' },
    })
      .webp({ lossless: true })
      .toBuffer();
    const decoded = await decodeImage(bytes(input));
    expect(decoded.format).toBe('webp');
    expect(decoded.hasAlpha).toBe(true);
    expect([decoded.width, decoded.height]).toEqual([7, 3]);
    const encoded = await encodePng({
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.fullPixels,
    });
    expect(await sharp(Buffer.from(encoded)).raw().toBuffer()).toEqual(
      Buffer.from(decoded.fullPixels),
    );
  });

  it('rejects malformed images and unsupported input without creating pixels', async () => {
    await expect(decodeImage(bytes(Buffer.from('not an image')))).rejects.toThrow();
    const svg = Buffer.from('<svg width="2" height="2" xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(decodeImage(bytes(svg))).rejects.toThrow('still PNG');
    await expect(encodePng({ width: 2, height: 2, pixels: new ArrayBuffer(1) })).rejects.toThrow(
      'Invalid export',
    );
  });
});
