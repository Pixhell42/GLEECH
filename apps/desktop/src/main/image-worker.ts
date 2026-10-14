import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import { fileMetadataXmp } from './file-metadata';
import { detectSubject } from './subject-detection';
import { renderEffectsAsync, type JpegPassOptions } from '@gleech/effects';
import { recompressJpeg } from './jpeg-codec';
import { analyzePixels } from './image-analysis';
import { layerImages, type EffectInstance } from '@gleech/project-model';
import type { PresetRecipe, SubjectMask } from '@gleech/project-model';
import type { PixelImage, ImageExportOptions } from '../shared/image-api';

export const MAX_PIXELS = 64 * 1024 * 1024;
export const MAX_DIMENSION = 32768;
sharp.cache({ memory: 32, files: 0, items: 32 });
sharp.concurrency(2);

export type ImageJob =
  | { id: number; action: 'analyze'; image: PixelImage; subjectMask?: SubjectMask }
  | { id: number; action: 'jpeg-recompress'; image: PixelImage; options: JpegPassOptions }
  | { id: number; action: 'decode'; bytes: ArrayBuffer; projectSource?: boolean }
  | { id: number; action: 'encode'; image: PixelImage }
  | { id: number; action: 'export'; image: PixelImage; options: ImageExportOptions }
  | {
      id: number;
      action: 'preset-preview';
      image: PixelImage;
      recipe: PresetRecipe;
      subjectMask?: SubjectMask;
    }
  | { id: number; action: 'prepare'; image: PixelImage }
  | { id: number; action: 'thumbnail'; image: PixelImage }
  | { id: number; action: 'shader-preview-source'; image: PixelImage }
  | { id: number; action: 'subject'; image: PixelImage; modelPath: string };

export interface DecodedImage {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  hasAlpha: boolean;
  fullPixels: ArrayBuffer;
  preview: PixelImage;
  thumbnail: string;
}

function ownedBytes(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}

export async function decodeImage(
  bytes: ArrayBuffer,
  projectSource = false,
): Promise<DecodedImage> {
  if (bytes.byteLength > (projectSource ? 300 : 100) * 1024 * 1024)
    throw new Error('The image file is too large.');
  const input = sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  const metadata = await input.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
    throw new Error('Choose a still PNG, JPEG, or WebP image.');
  }
  if ((metadata.width ?? 0) > MAX_DIMENSION || (metadata.height ?? 0) > MAX_DIMENSION) {
    throw new Error('Image dimensions must be 32,768 pixels or smaller.');
  }
  const { data, info } = await input
    .autoOrient()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    ...(await prepareImage({ width: info.width, height: info.height, pixels: ownedBytes(data) })),
    format: metadata.format as DecodedImage['format'],
    hasAlpha: metadata.hasAlpha ?? false,
  };
}

function assertPixels(image: PixelImage): void {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_DIMENSION ||
    image.height > MAX_DIMENSION ||
    image.width * image.height > MAX_PIXELS ||
    !(image.pixels instanceof ArrayBuffer) ||
    image.pixels.byteLength !== image.width * image.height * 4
  )
    throw new Error('Invalid image pixels.');
}

export async function presetThumbnail(image: PixelImage): Promise<string> {
  assertPixels(image);
  const png = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function prepareImage(image: PixelImage): Promise<DecodedImage> {
  assertPixels(image);
  const fullPixels = image.pixels;
  const data = Buffer.from(fullPixels);
  const info = image;
  let preview: PixelImage = { width: info.width, height: info.height, pixels: fullPixels };
  if (Math.max(info.width, info.height) > 2048) {
    const resized = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    preview = {
      width: resized.info.width,
      height: resized.info.height,
      pixels: ownedBytes(resized.data),
    };
  }
  return {
    width: info.width,
    height: info.height,
    format: 'png',
    hasAlpha: true,
    fullPixels,
    preview,
    thumbnail: `data:image/png;base64,${(
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .resize({ width: 160, height: 100, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    ).toString('base64')}`,
  };
}

export async function encodePng(image: PixelImage): Promise<ArrayBuffer> {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > MAX_PIXELS ||
    image.pixels.byteLength !== image.width * image.height * 4
  ) {
    throw new Error('Invalid export pixels.');
  }
  return ownedBytes(
    await sharp(Buffer.from(image.pixels), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png()
      .toBuffer(),
  );
}

export function assertExportOptions(value: unknown): asserts value is ImageExportOptions {
  const options = value as ImageExportOptions | null;
  if (
    !options ||
    !['png', 'jpeg', 'webp', 'tiff'].includes(options.format) ||
    (options.quality !== undefined &&
      (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100))
  )
    throw new Error('Invalid image export options.');
}

export async function encodeImage(
  image: PixelImage,
  options: ImageExportOptions,
): Promise<ArrayBuffer> {
  assertPixels(image);
  assertExportOptions(options);
  const input = sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).withXmp(fileMetadataXmp());
  const quality = options.quality ?? 90;
  const output =
    options.format === 'png'
      ? input.png()
      : options.format === 'jpeg'
        ? input.flatten({ background: '#ffffff' }).jpeg({ quality, chromaSubsampling: '4:4:4' })
        : options.format === 'webp'
          ? input.webp({ quality, alphaQuality: 100 })
          : input.tiff({ compression: 'lzw', predictor: 'horizontal' });
  return ownedBytes(await output.toBuffer());
}

export async function decodeLayerImages(
  effects: readonly EffectInstance[],
): Promise<ReadonlyMap<string, PixelImage>> {
  const result = new Map<string, PixelImage>();
  for (const image of layerImages(effects)) {
    const decoded = await decodeImage(
      Uint8Array.from(Buffer.from(image.png.slice(22), 'base64')).buffer,
      true,
    );
    if (decoded.width !== image.source.width || decoded.height !== image.source.height)
      throw new Error('The embedded layer image dimensions do not match.');
    result.set(image.source.id, {
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.fullPixels,
    });
  }
  return result;
}

export async function renderPresetThumbnail(
  image: PixelImage,
  recipe: PresetRecipe,
  subjectMask?: SubjectMask,
): Promise<string> {
  assertPixels(image);
  return presetThumbnail(
    await renderEffectsAsync(image, recipe.effects, {
      masterSeed: recipe.masterSeed,
      subjectMask,
      layerImages: await decodeLayerImages(recipe.effects),
      recompressJpeg,
      yieldControl: () => new Promise((resolve) => setImmediate(resolve)),
    }),
  );
}

export async function shaderPreviewInput(image: PixelImage): Promise<PixelImage> {
  assertPixels(image);
  const { data, info } = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: Uint8Array.from(data).buffer };
}
parentPort?.on('message', async (job: ImageJob) => {
  try {
    const value =
      job.action === 'analyze'
        ? await analyzeSource(job.image, job.subjectMask)
        : job.action === 'jpeg-recompress'
          ? await recompressJpeg(job.image, job.options)
          : job.action === 'shader-preview-source'
            ? await shaderPreviewInput(job.image)
            : job.action === 'decode'
              ? await decodeImage(job.bytes, job.projectSource)
              : job.action === 'export'
                ? await encodeImage(job.image, job.options)
                : job.action === 'preset-preview'
                  ? await renderPresetThumbnail(job.image, job.recipe, job.subjectMask)
                  : job.action === 'encode'
                    ? await encodePng(job.image)
                    : job.action === 'prepare'
                      ? await prepareImage(job.image)
                      : job.action === 'thumbnail'
                        ? await presetThumbnail(job.image)
                        : await detectSubject(job.image, job.modelPath);
    const transfers =
      typeof value === 'string'
        ? []
        : value instanceof ArrayBuffer
          ? [value]
          : 'values' in value
            ? [value.values]
            : 'pixels' in value
              ? [value.pixels]
              : 'fullPixels' in value
                ? [...new Set([value.fullPixels, value.preview.pixels])]
                : [];
    parentPort?.postMessage({ id: job.id, ok: true, value }, transfers);
  } catch (error) {
    parentPort?.postMessage({
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Image processing failed.',
    });
  }
});
export async function analyzeSource(image: PixelImage, subjectMask?: SubjectMask) {
  const analysis = analyzePixels(image);
  if (!subjectMask) return { analysis };
  const values = new Uint8Array(subjectMask.values);
  if (values.length !== subjectMask.width * subjectMask.height || values.length === 0)
    throw new Error('Invalid subject mask.');
  let sum = 0,
    selected = 0;
  for (const value of values) {
    sum += value;
    if (value >= 128) selected++;
  }
  const png = await sharp(Buffer.from(values), {
    raw: { width: subjectMask.width, height: subjectMask.height, channels: 1 },
  })
    .png()
    .toBuffer();
  return {
    analysis,
    subject: {
      width: subjectMask.width,
      height: subjectMask.height,
      meanConfidence: sum / values.length / 255,
      selectedFraction: selected / values.length,
      threshold: 128,
    },
    png: png.toString('base64'),
  };
}
