import { imagePayloadSchema, MAX_MCP_IMAGE_BYTES } from '@gleech/mcp/protocol';

/** Validate supplied bytes only. This function never reads a path or URL. */
export function mcpImageData(value: unknown): { bytes: ArrayBuffer; name: string } {
  const payload = imagePayloadSchema.parse(value);
  const bytes = Buffer.from(payload.data, 'base64');
  if (bytes.length > MAX_MCP_IMAGE_BYTES || bytes.toString('base64') !== payload.data)
    throw new Error('Supply canonical base64 for an image no larger than 6 MiB.');
  const matches =
    payload.mimeType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : payload.mimeType === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
          bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!matches)
    throw new Error('Image bytes do not match mimeType. Use a still PNG, JPEG or WebP.');
  return { bytes: Uint8Array.from(bytes).buffer, name: payload.name };
}
