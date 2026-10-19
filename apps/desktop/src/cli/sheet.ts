import { resizeRgba, type RgbaImage } from './png';

/** Arrange equally sized variants into a contact sheet on the app's canvas color. */
export function contactSheet(images: readonly RgbaImage[], cellSize = 512, gap = 12): RgbaImage {
  if (!images.length) throw new Error('No images for the contact sheet.');
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const first = images[0]!;
  const scale = Math.min(1, cellSize / Math.max(first.width, first.height));
  const cellW = Math.max(1, Math.round(first.width * scale));
  const cellH = Math.max(1, Math.round(first.height * scale));
  const width = columns * cellW + (columns + 1) * gap;
  const height = rows * cellH + (rows + 1) * gap;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 16;
    out[i + 1] = 16;
    out[i + 2] = 17;
    out[i + 3] = 255;
  }
  images.forEach((image, index) => {
    const tile = new Uint8Array(resizeRgba(image, cellW, cellH).pixels);
    const ox = gap + (index % columns) * (cellW + gap);
    const oy = gap + Math.floor(index / columns) * (cellH + gap);
    for (let y = 0; y < cellH; y++)
      for (let x = 0; x < cellW; x++) {
        const s = (y * cellW + x) * 4;
        const d = ((oy + y) * width + ox + x) * 4;
        const a = tile[s + 3]! / 255;
        for (let c = 0; c < 3; c++)
          out[d + c] = Math.round(tile[s + c]! * a + out[d + c]! * (1 - a));
      }
  });
  return { width, height, pixels: out.buffer };
}
