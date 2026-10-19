import { resizeRgba, type RgbaImage } from './png';
import { bgCode, fgCode, type ColorLevel, type Rgb } from './style';

/** A terminal cell drawn with the upper-half block: fg = top pixel, bg = bottom pixel. */
export interface BlockCell {
  top: Rgb;
  bottom: Rgb;
}

/** Fit an image into cols × rows terminal cells, two pixels tall per cell. */
export function blockSize(
  width: number,
  height: number,
  cols: number,
  rows: number,
  cellAspect = 1,
): { cols: number; rows: number } {
  // Each cell shows 1×2 pixels; terminal cells are ~2× taller than wide, so the
  // half-block grid is close to square. cellAspect corrects unusual fonts.
  const scale = Math.min(cols / width, (rows * 2 * cellAspect) / height);
  return {
    cols: Math.max(1, Math.min(cols, Math.round(width * scale))),
    rows: Math.max(1, Math.min(rows, Math.round((height * scale) / (2 * cellAspect)))),
  };
}

function checker(x: number, y: number): Rgb {
  return ((x >> 1) + (y >> 1)) % 2 ? [40, 40, 44] : [26, 26, 29];
}

/** Down-sample to a grid of half-block cells, compositing alpha over a checkerboard. */
export function blockCells(image: RgbaImage, cols: number, rows: number): BlockCell[][] {
  const small = resizeRgba(image, cols, rows * 2);
  const px = new Uint8Array(small.pixels);
  const at = (x: number, y: number): Rgb => {
    const i = (y * cols + x) * 4;
    const a = px[i + 3]! / 255;
    const under = checker(x, y);
    return [
      Math.round(px[i]! * a + under[0] * (1 - a)),
      Math.round(px[i + 1]! * a + under[1] * (1 - a)),
      Math.round(px[i + 2]! * a + under[2] * (1 - a)),
    ];
  };
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => ({ top: at(x, y * 2), bottom: at(x, y * 2 + 1) })),
  );
}

/** Pre-rendered ANSI lines for line-oriented output (gleech render --show). */
export function blockLines(
  image: RgbaImage,
  cols: number,
  rows: number,
  level: ColorLevel,
): string[] {
  const size = blockSize(image.width, image.height, cols, rows);
  const cells = blockCells(image, size.cols, size.rows);
  if (!level) return cells.map((row) => row.map((c) => shade(c)).join(''));
  return cells.map(
    (row) =>
      row.map((c) => `\x1b[${fgCode(c.top, level)};${bgCode(c.bottom, level)}m▀`).join('') +
      '\x1b[0m',
  );
}

const RAMP = ' .:-=+*#%@';
function shade({ top, bottom }: BlockCell): string {
  const l = (top[0] + top[1] + top[2] + bottom[0] + bottom[1] + bottom[2]) / (6 * 255);
  return RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))]!;
}
