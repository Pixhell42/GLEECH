import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  imagePayloadSchema,
  MAX_MCP_IMAGE_BYTES,
  requestSchema,
  isMutation,
  requiresFullControl,
} from '@gleech/mcp/protocol';
import { mcpImageData } from './mcp-image-data';
import { decodeImage } from './image-worker';

describe('MCP image payload imports', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes a supplied %s without a filesystem path',
    async (format) => {
      const bytes = await sharp({
        create: {
          width: 7,
          height: 5,
          channels: 4,
          background: { r: 70, g: 140, b: 210, alpha: 0.5 },
        },
      })
        .toFormat(format)
        .toBuffer();
      const payload = {
        data: bytes.toString('base64'),
        mimeType: `image/${format}`,
        name: `frame.${format}`,
      };
      const actual = mcpImageData(payload);
      expect(Buffer.from(actual.bytes)).toEqual(bytes);
      const decoded = await decodeImage(actual.bytes);
      expect([decoded.width, decoded.height, decoded.format]).toEqual([7, 5, format]);
      expect(decoded.hasAlpha).toBe(format !== 'jpeg');
      const request = requestSchema.parse({ action: 'load_image_data', ...payload });
      expect(isMutation(request)).toBe(true);
      expect(requiresFullControl(request)).toBe(false);
    },
  );

  it('preserves PNG RGBA pixels, including transparency', async () => {
    const pixels = Buffer.from([10, 20, 30, 0, 60, 90, 120, 128, 150, 180, 210, 255]);
    const png = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } })
      .png()
      .toBuffer();
    const payload = mcpImageData({ data: png.toString('base64'), mimeType: 'image/png' });
    expect(payload.name).toBe('MCP image');
    expect(Buffer.from((await decodeImage(payload.bytes)).fullPixels)).toEqual(pixels);
  });

  it('rejects MIME mismatches, malformed and noncanonical base64, URLs, paths and unsupported media', () => {
    for (const data of ['abc', '!!!!', 'data:image/png;base64,iVBORw==', 'a b=', 'ab=c', 'AB=='])
      expect(() => mcpImageData({ data, mimeType: 'image/png' })).toThrow();
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
    expect(() => mcpImageData({ data: pngHeader, mimeType: 'image/jpeg' })).toThrow(/mimeType/);
    expect(() => mcpImageData({ data: pngHeader, mimeType: 'image/svg+xml' })).toThrow();
    expect(() =>
      mcpImageData({ data: pngHeader, mimeType: 'image/png', path: '/private/image.png' }),
    ).toThrow();
    for (const name of ['../image.png', 'folder\\image.png', '..', 'bad\0name'])
      expect(
        imagePayloadSchema.safeParse({ data: pngHeader, mimeType: 'image/png', name }).success,
      ).toBe(false);
  });

  it('rejects payloads exceeding the wire budget before decoding', () => {
    const oversized = Buffer.alloc(MAX_MCP_IMAGE_BYTES + 1).toString('base64');
    expect(() => mcpImageData({ data: oversized, mimeType: 'image/png' })).toThrow();
  });

  it('passes signature-matching corrupt images to the bounded decoder for rejection', async () => {
    const payload = mcpImageData({
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
      mimeType: 'image/png',
    });
    await expect(decodeImage(payload.bytes)).rejects.toThrow();
  });

  it('does not allow a folder grant request to carry a caller-selected path', () => {
    const request = { action: 'request_folder_access', kind: 'imports' };
    expect(requiresFullControl(requestSchema.parse(request))).toBe(true);
    expect(requestSchema.safeParse({ ...request, path: '/private' }).success).toBe(false);
  });
});
