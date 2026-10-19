import { resizeRgba, type RgbaImage } from '../png';
import type { Rgb } from '../style';

/** zoom 0 fits the whole image; 1, 2, 4 show image pixels at that many screen pixels. */
export interface View {
  zoom: 0 | 1 | 2 | 4;
  /** Center of the view in normalized image coordinates. */
  cx: number;
  cy: number;
}

export const ZOOMS: readonly View['zoom'][] = [0, 1, 2, 4];

function backdrop(x: number, y: number, canvas: Rgb): Rgb {
  // The same quiet checkerboard the app uses behind transparent pixels.
  const light = ((x >> 3) + (y >> 3)) % 2 === 0;
  return light
    ? [canvas[0] + 22, canvas[1] + 22, canvas[2] + 24]
    : [canvas[0] + 10, canvas[1] + 10, canvas[2] + 12];
}

function put(
  out: Uint8Array,
  o: number,
  src: Uint8Array,
  i: number,
  x: number,
  y: number,
  canvas: Rgb,
) {
  const a = src[i + 3]!;
  if (a === 255) {
    out[o] = src[i]!;
    out[o + 1] = src[i + 1]!;
    out[o + 2] = src[i + 2]!;
  } else {
    const under = backdrop(x, y, canvas);
    const t = a / 255;
    out[o] = Math.round(src[i]! * t + under[0] * (1 - t));
    out[o + 1] = Math.round(src[i + 1]! * t + under[1] * (1 - t));
    out[o + 2] = Math.round(src[i + 2]! * t + under[2] * (1 - t));
  }
  out[o + 3] = 255;
}

/** Clamp a view so a zoomed image never scrolls past its edges. */
export function clampView(
  view: View,
  full: { width: number; height: number },
  width: number,
  height: number,
): View {
  if (!view.zoom) return { zoom: 0, cx: 0.5, cy: 0.5 };
  const halfW = width / view.zoom / 2 / full.width;
  const halfH = height / view.zoom / 2 / full.height;
  const clamp = (v: number, half: number) =>
    half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, v));
  return { zoom: view.zoom, cx: clamp(view.cx, halfW), cy: clamp(view.cy, halfH) };
}

/**
 * Compose the visible part of an image into an opaque viewport of exactly
 * width × height pixels. `src` may be a reduced render of an image whose
 * full size is `full`; zoomed views map through full-resolution coordinates.
 */
export function viewportImage(
  src: RgbaImage,
  full: { width: number; height: number },
  view: View,
  width: number,
  height: number,
  canvas: Rgb,
): RgbaImage {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = canvas[0];
    out[i + 1] = canvas[1];
    out[i + 2] = canvas[2];
    out[i + 3] = 255;
  }
  if (!view.zoom) {
    const scale = Math.min(width / full.width, height / full.height);
    const w = Math.max(1, Math.min(width, Math.round(full.width * scale)));
    const h = Math.max(1, Math.min(height, Math.round(full.height * scale)));
    const fitted = new Uint8Array(resizeRgba(src, w, h).pixels);
    const ox = Math.floor((width - w) / 2);
    const oy = Math.floor((height - h) / 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        put(out, ((oy + y) * width + ox + x) * 4, fitted, (y * w + x) * 4, x, y, canvas);
    return { width, height, pixels: out.buffer };
  }
  const v = clampView(view, full, width, height);
  const px = new Uint8Array(src.pixels);
  const left = v.cx * full.width - width / v.zoom / 2;
  const top = v.cy * full.height - height / v.zoom / 2;
  const sx = src.width / full.width;
  const sy = src.height / full.height;
  for (let y = 0; y < height; y++) {
    const fy = Math.floor(top + y / v.zoom);
    if (fy < 0 || fy >= full.height) continue;
    const row = Math.min(src.height - 1, Math.floor(fy * sy)) * src.width;
    for (let x = 0; x < width; x++) {
      const fx = Math.floor(left + x / v.zoom);
      if (fx < 0 || fx >= full.width) continue;
      const i = (row + Math.min(src.width - 1, Math.floor(fx * sx))) * 4;
      put(out, (y * width + x) * 4, px, i, fx, fy, canvas);
    }
  }
  return { width, height, pixels: out.buffer };
}
