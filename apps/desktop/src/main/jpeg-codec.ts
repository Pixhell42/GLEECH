import sharp from 'sharp';
import type { JpegPassOptions } from '@gleech/effects';
import type { PixelImage } from '../shared/image-api';
import { recompressJpegWith } from './jpeg-pass';

export { assertJpegRequest } from './jpeg-pass';

/** One real JPEG generation, without flattening partial alpha or exposing hidden RGB. */
export function recompressJpeg(image: PixelImage, options: JpegPassOptions): Promise<ArrayBuffer> {
  return recompressJpegWith(sharp, image, options);
}
