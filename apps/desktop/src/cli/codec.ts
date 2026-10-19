import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { JpegPassOptions } from '@gleech/effects';
import { fileMetadataXmp, FILE_APPLICATION } from '../main/file-metadata';
import { recompressJpegWith } from '../main/jpeg-pass';
import { decodePng, encodePng, isPng, resizeRgba, type RgbaImage } from './png';
import { loadSharp } from './runtime';

export type { RgbaImage } from './png';
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'tiff';

// Same bounds as the desktop image worker.
export const MAX_PIXELS = 64 * 1024 * 1024;
export const MAX_DIMENSION = 32768;

export interface DecodedImage {
  image: RgbaImage;
  format: 'png' | 'jpeg' | 'webp';
  hasAlpha: boolean;
}

export function codecName(): 'sharp' | 'built-in PNG' {
  return loadSharp() ? 'sharp' : 'built-in PNG';
}

const owned = (buffer: Buffer): ArrayBuffer => Uint8Array.from(buffer).buffer;

function assertBounds(width: number, height: number): void {
  if (width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new Error('Image dimensions must be 32,768 pixels or smaller.');
  if (width * height > MAX_PIXELS) throw new Error('The image exceeds 64 megapixels.');
}

export async function decodeImageBytes(bytes: Uint8Array): Promise<DecodedImage> {
  if (bytes.byteLength > 300 * 1024 * 1024) throw new Error('The image file is too large.');
  const sharp = loadSharp();
  if (!sharp) {
    if (!isPng(bytes))
      throw new Error('Only PNG can be read without Sharp. Run pnpm install for JPEG/WebP.');
    const image = decodePng(bytes, MAX_PIXELS);
    assertBounds(image.width, image.height);
    const px = new Uint8Array(image.pixels);
    let hasAlpha = false;
    for (let i = 3; i < px.length; i += 4)
      if (px[i] !== 255) {
        hasAlpha = true;
        break;
      }
    return { image, format: 'png', hasAlpha };
  }
  const input = sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  const metadata = await input.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
    throw new Error('Choose a still PNG, JPEG, or WebP image.');
  assertBounds(metadata.width ?? 0, metadata.height ?? 0);
  const { data, info } = await input
    .autoOrient()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    image: { width: info.width, height: info.height, pixels: owned(data) },
    format: metadata.format as DecodedImage['format'],
    hasAlpha: metadata.hasAlpha ?? false,
  };
}

export async function readImage(path: string): Promise<DecodedImage> {
  return decodeImageBytes(await readFile(path));
}

export function formatFromPath(path: string): ExportFormat | null {
  const ext = extname(path).toLowerCase();
  return ext === '.png'
    ? 'png'
    : ext === '.jpg' || ext === '.jpeg'
      ? 'jpeg'
      : ext === '.webp'
        ? 'webp'
        : ext === '.tif' || ext === '.tiff'
          ? 'tiff'
          : null;
}

/** Mirrors the desktop export encoder, including the XMP application metadata. */
export async function encodeImage(
  image: RgbaImage,
  format: ExportFormat,
  quality = 90,
): Promise<Buffer> {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error('Quality must be an integer from 1 to 100.');
  const sharp = loadSharp();
  if (!sharp) {
    if (format !== 'png') throw new Error(`Writing ${format.toUpperCase()} needs Sharp. Use .png.`);
    return encodePng(
      image,
      {
        Software: `${FILE_APPLICATION.name} ${FILE_APPLICATION.version}`,
        DeveloperURL: FILE_APPLICATION.developerUrl,
        RepositoryURL: FILE_APPLICATION.repositoryUrl,
      },
      { xmp: fileMetadataXmp() },
    );
  }
  const input = sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).withXmp(fileMetadataXmp());
  const output =
    format === 'png'
      ? input.png()
      : format === 'jpeg'
        ? input.flatten({ background: '#ffffff' }).jpeg({ quality, chromaSubsampling: '4:4:4' })
        : format === 'webp'
          ? input.webp({ quality, alphaQuality: 100 })
          : input.tiff({ compression: 'lzw', predictor: 'horizontal' });
  return output.toBuffer();
}

export async function resizeImage(
  image: RgbaImage,
  width: number,
  height: number,
): Promise<RgbaImage> {
  if (width === image.width && height === image.height) return image;
  const sharp = loadSharp();
  if (!sharp) return resizeRgba(image, width, height);
  const { data, info } = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .resize({ width, height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: owned(data) };
}

export function fitInside(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function jpegPass():
  ((image: RgbaImage, options: JpegPassOptions) => Promise<ArrayBuffer>) | undefined {
  const sharp = loadSharp();
  return sharp ? (image, options) => recompressJpegWith(sharp, image, options) : undefined;
}
