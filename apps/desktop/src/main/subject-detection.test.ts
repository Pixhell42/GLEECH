import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { detectSubject } from './subject-detection';

describe('local photo subject detection', () => {
  it('detects the subject in an opaque photo and repeats without mutating the source', async () => {
    const { data, info } = await sharp(resolve('tooling/fixtures/astronaut.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = { width: info.width, height: info.height, pixels: Uint8Array.from(data).buffer };
    const model = resolve('apps/desktop/resources/models/u2netp.onnx');
    const mask = await detectSubject(image, model);
    const values = new Uint8Array(mask.values);
    expect([mask.width, mask.height, values.length]).toEqual([320, 320, 320 * 320]);
    expect(
      values[Math.floor((170 / 512) * 320) * 320 + Math.floor((220 / 512) * 320)],
    ).toBeGreaterThan(180);
    expect(values[10 * 320 + 10]).toBeLessThan(80);
    const repeated = await detectSubject(image, model);
    expect(Buffer.from(repeated.values).equals(Buffer.from(mask.values))).toBe(true);
    expect(Buffer.from(image.pixels).equals(data)).toBe(true);
    expect(data.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
  }, 15000);
});
