import type { PixelImage } from '../shared/image-api';

/** Full source statistics; hidden RGB in fully transparent pixels contributes no color. */
export function analyzePixels(image: PixelImage) {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > 64 * 1024 * 1024 ||
    !(image.pixels instanceof ArrayBuffer) ||
    image.pixels.byteLength !== image.width * image.height * 4
  )
    throw new Error('Invalid analysis image.');
  const pixels = new Uint8Array(image.pixels);
  const histograms = {
    red: Array<number>(256).fill(0),
    green: Array<number>(256).fill(0),
    blue: Array<number>(256).fill(0),
    alpha: Array<number>(256).fill(0),
    luminance: Array<number>(256).fill(0),
  };
  const sums = [0, 0, 0];
  let weight = 0,
    visible = 0,
    opaque = 0;
  let minX = image.width,
    minY = image.height,
    maxX = -1,
    maxY = -1;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]!,
      g = pixels[index + 1]!,
      b = pixels[index + 2]!,
      a = pixels[index + 3]!;
    histograms.alpha[a]!++;
    if (!a) continue;
    visible++;
    if (a === 255) opaque++;
    const alpha = a / 255;
    weight += alpha;
    sums[0]! += r * alpha;
    sums[1]! += g * alpha;
    sums[2]! += b * alpha;
    histograms.red[r]!++;
    histograms.green[g]!++;
    histograms.blue[b]!++;
    histograms.luminance[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]!++;
    const x = (index / 4) % image.width,
      y = Math.floor(index / 4 / image.width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const total = image.width * image.height;
  return {
    width: image.width,
    height: image.height,
    pixels: total,
    visiblePixels: visible,
    opaquePixels: opaque,
    transparentPixels: total - visible,
    partialAlphaPixels: visible - opaque,
    meanAlpha: weight / total,
    meanColor: sums.map((sum) => (weight ? sum / weight : 0)),
    visibleBounds: visible
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
    histograms,
    colorStatistics:
      'Alpha-weighted sRGB mean; histograms count nonzero-alpha pixels, except Alpha which counts all pixels.',
  };
}
