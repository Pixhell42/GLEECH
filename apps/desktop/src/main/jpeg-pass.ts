import type sharpModule from 'sharp';
import type { JpegPassOptions } from '@gleech/effects';
import type { PixelImage } from '../shared/image-api';

// Sharp is injected so callers that load it lazily (the CLI) share this exact codec pass.
type Sharp = typeof sharpModule;

export function assertJpegRequest(image: PixelImage, options: JpegPassOptions): void {
  if (
    !image ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > 32768 ||
    image.height > 32768 ||
    image.width * image.height > 64 * 1024 * 1024 ||
    !(image.pixels instanceof ArrayBuffer) ||
    image.pixels.byteLength !== image.width * image.height * 4 ||
    !options ||
    !Number.isInteger(options.quality) ||
    options.quality < 1 ||
    options.quality > 100 ||
    !['420', '444'].includes(options.chromaSubsampling)
  )
    throw new Error('Invalid JPEG recompression request.');
}

/** One real JPEG generation, without flattening partial alpha or exposing hidden RGB. */
export async function recompressJpegWith(
  sharp: Sharp,
  image: PixelImage,
  options: JpegPassOptions,
): Promise<ArrayBuffer> {
  assertJpegRequest(image, options);
  const source = new Uint8Array(image.pixels);
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0, j = 0; i < source.length; i += 4, j += 3)
    for (let c = 0; c < 3; c++) rgb[j + c] = source[i + 3] === 0 ? 128 : source[i + c]!;
  const jpeg = await sharp(rgb, { raw: { width: image.width, height: image.height, channels: 3 } })
    .jpeg({
      quality: options.quality,
      chromaSubsampling: options.chromaSubsampling === '420' ? '4:2:0' : '4:4:4',
    })
    .toBuffer();
  const decoded = await sharp(jpeg).toColourspace('srgb').removeAlpha().raw().toBuffer();
  if (decoded.length !== rgb.length) throw new Error('JPEG codec changed image dimensions.');
  const result = new Uint8Array(source.length);
  for (let i = 0, j = 0; i < source.length; i += 4, j += 3) {
    for (let c = 0; c < 3; c++)
      result[i + c] = source[i + 3] === 0 ? source[i + c]! : decoded[j + c]!;
    result[i + 3] = source[i + 3]!;
  }
  return result.buffer;
}
