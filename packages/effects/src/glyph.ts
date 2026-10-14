import { GLYPH_DEFAULTS, type GlyphEffect, type GlyphFontAtlas } from '@gleech/project-model';
import { fontCoverage } from './font-coverage';
import {
  bitmapRows,
  densityRanked,
  EXTENDED_REPERTOIRE,
  UNICODE_REPERTOIRE,
  TERMINAL_REPERTOIRE,
} from './glyph-alphabet';
import { emojiSelection, EMOJI_TILE_SIZE } from './glyph-atlas';
import { createColorSampler } from './color-gradient';
import type { ReductionBlend } from './dither';

// Small original bitmap alphabet. No system font, font rasterizer or external
// font asset participates in saved recipes. Entries increase in painted area.
export const ASCII_GLYPHS = [
  { character: ' ', rows: [0, 0, 0, 0, 0, 0, 0] },
  { character: '.', rows: [0, 0, 0, 0, 0, 4, 0] },
  { character: ':', rows: [0, 0, 4, 0, 0, 4, 0] },
  { character: '-', rows: [0, 0, 0, 14, 0, 0, 0] },
  { character: '=', rows: [0, 0, 14, 0, 14, 0, 0] },
  { character: '+', rows: [0, 4, 4, 31, 4, 4, 0] },
  { character: '*', rows: [0, 0, 10, 31, 10, 0, 0] },
  { character: '%', rows: [25, 26, 4, 8, 22, 6, 0] },
  { character: '#', rows: [10, 31, 10, 10, 31, 10, 0] },
  { character: '@', rows: [14, 17, 23, 21, 23, 16, 14] },
] as const;
// Row-major sampling -> Unicode Braille dot bits (left 1/2/3/7; right 4/5/6/8).
export const BRAILLE_BITS = [0, 3, 1, 4, 2, 5, 6, 7] as const;
const clip = (v: number) => Math.max(0, Math.min(1, v));
export function glyphTone(value: number, p: GlyphEffect['params']): number {
  const tone = clip((value - 0.5) * p.contrast + 0.5);
  return clip((p.invert === 'on' ? 1 - tone : tone) * p.density);
}
export function glyphPattern(
  tones: ArrayLike<number>,
  weights: ArrayLike<number>,
  p: GlyphEffect['params'],
): number {
  if (p.density === 0) return 0;
  if (p.style === 'ascii')
    return weights[0]! > 0
      ? Math.min(ASCII_GLYPHS.length - 1, Math.floor(glyphTone(tones[0]!, p) * ASCII_GLYPHS.length))
      : 0;
  let result = 0;
  for (let i = 0; i < (p.style === 'braille' ? 8 : 4); i++)
    if (weights[i]! > 0 && glyphTone(tones[i]!, p) >= p.threshold - 1e-12)
      result |= 1 << (p.style === 'braille' ? BRAILLE_BITS[i]! : i);
  return result;
}
export function glyphMark(
  style: GlyphEffect['params']['style'],
  pattern: number,
  u: number,
  v: number,
  scale: number,
  aspect: number,
): boolean {
  u = (u - 0.5) / scale + 0.5;
  v = (v - 0.5) / scale + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  if (style === 'ascii') {
    const glyph = ASCII_GLYPHS[pattern]!;
    return (glyph.rows[Math.floor(v * 7)]! & (1 << (4 - Math.floor(u * 5)))) !== 0;
  }
  if (style !== 'braille' && style !== 'blocks') {
    const rows = bitmapRows(String.fromCodePoint(pattern));
    return (rows[Math.floor(v * 7)]! & (1 << (4 - Math.floor(u * 5)))) !== 0;
  }
  const x = Math.floor(u * 2),
    y = Math.floor(v * (style === 'braille' ? 4 : 2));
  if (style === 'blocks') return (pattern & (1 << (y * 2 + x))) !== 0;
  if ((pattern & (1 << BRAILLE_BITS[y * 2 + x]!)) === 0) return false;
  // Circular dots in original canvas pixels, even for nonsquare cells.
  const dx = u - (x + 0.5) / 2,
    dy = (v - (y + 0.5) / 4) * aspect;
  const radius = 0.36 * Math.min(0.5, aspect / 4);
  return dx * dx + dy * dy <= radius * radius;
}

// All positions describe the original canvas, including reduced previews.
export function glyphFalloff(
  u: number,
  v: number,
  direction: string,
  start: number,
  end: number,
  centerX: number,
  centerY: number,
  invert: boolean,
  reference: { width: number; height: number },
): number {
  let field = direction === 'vertical' ? v : u;
  if (direction === 'radial' || direction === 'square') {
    const dx = (u - centerX) * reference.width,
      dy = (v - centerY) * reference.height;
    const farX = Math.max(centerX, 1 - centerX) * reference.width,
      farY = Math.max(centerY, 1 - centerY) * reference.height;
    field =
      direction === 'radial'
        ? Math.hypot(dx, dy) / Math.hypot(farX, farY)
        : Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(farX, farY);
  }
  const ramp = start === end ? Number(field >= start) : clip((field - start) / (end - start));
  return invert ? 1 - ramp : ramp;
}

export function* glyphPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: GlyphEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  random: (x: number, y: number, lane: number) => number = () => 0.5,
  atlas?: GlyphFontAtlas,
): Generator<void> {
  p = { ...GLYPH_DEFAULTS, ...p };
  const controls = { ...GLYPH_DEFAULTS, ...p };
  const font =
    controls.fontSource === 'installed' &&
    atlas &&
    !['emoji', 'braille', 'blocks'].includes(p.style)
      ? fontCoverage(atlas)
      : null;
  output.set(input);
  const cellWidth = p.cellSize,
    cellHeight = cellWidth * p.aspect;
  const columns = Math.ceil(reference.width / cellWidth),
    rows = Math.ceil(reference.height / cellHeight);
  const nx = ['braille', 'blocks'].includes(p.style) ? 2 : 1,
    ny = p.style === 'braille' ? 4 : p.style === 'blocks' ? 2 : 1;
  const tones = new Float64Array(8),
    weights = new Float64Array(8),
    rgb = new Float64Array(3),
    color = new Float64Array(4);
  const foreground = createColorSampler(p, 'foregroundColor', p.foregroundColor, reference);
  const background = createColorSampler(p, 'backgroundColor', p.backgroundColor, reference);
  const ending = [1, 3, 5].map((i) => Number.parseInt(controls.falloffColor.slice(i, i + 2), 16));
  const symbols =
    p.style === 'extended-ascii'
      ? font
        ? font.rank(EXTENDED_REPERTOIRE)
        : densityRanked(EXTENDED_REPERTOIRE)
      : p.style === 'unicode'
        ? font
          ? font.rank(UNICODE_REPERTOIRE)
          : densityRanked(UNICODE_REPERTOIRE)
        : p.style === 'terminal'
          ? font
            ? font.rank(TERMINAL_REPERTOIRE)
            : densityRanked(TERMINAL_REPERTOIRE)
          : Array.from(
              (p.style === 'custom-text' ? controls.text : controls.glyphSet).replace(
                /[\r\n\t]/g,
                ' ',
              ),
            );
  const emojis = emojiSelection(controls.emojiPalette, controls.emojiSet);
  const luminances = emojis.map((g) => g.luminance),
    emojiLow = Math.min(...luminances),
    emojiHigh = Math.max(...luminances);
  const emojiRGB = new Float64Array(3),
    treatedInk = new Float64Array(3),
    offsets = [controls.emojiRed, controls.emojiGreen, controls.emojiBlue];
  // Bounds assign output pixel centers to the fixed original-canvas cells. Empty
  // cells in reduced previews are skipped, rather than moving the whole grid.
  const bound = (cell: number, size: number, actual: number, original: number) =>
    Math.max(0, Math.min(actual, Math.ceil((cell * size * actual) / original - 0.5)));
  for (let cy = 0; cy < rows; cy++) {
    const top = bound(cy, cellHeight, height, reference.height),
      bottom = bound(cy + 1, cellHeight, height, reference.height);
    if (top === bottom) {
      yield;
      continue;
    }
    for (let cx = 0; cx < columns; cx++) {
      if ((cx & 127) === 127) yield;
      const left = bound(cx, cellWidth, width, reference.width),
        right = bound(cx + 1, cellWidth, width, reference.width);
      if (left === right) continue;
      tones.fill(0);
      weights.fill(0);
      rgb.fill(0);
      let totalWeight = 0,
        scanned = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const i = (y * width + x) * 4,
            a = input[i + 3]!;
          if (a > 0) {
            const u = ((x + 0.5) * reference.width) / width / cellWidth - cx;
            const v = ((y + 0.5) * reference.height) / height / cellHeight - cy;
            const slot =
              Math.max(0, Math.min(ny - 1, Math.floor(v * ny))) * nx +
              Math.max(0, Math.min(nx - 1, Math.floor(u * nx)));
            tones[slot] =
              tones[slot]! +
              ((0.2126 * input[i]! + 0.7152 * input[i + 1]! + 0.0722 * input[i + 2]!) * a) / 255;
            weights[slot] = weights[slot]! + a;
            totalWeight += a;
            for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! + input[i + c]! * a;
          }
          if ((++scanned & 127) === 0) yield;
        }
      if (totalWeight === 0) continue;
      for (let i = 0; i < nx * ny; i++) if (weights[i]! > 0) tones[i] = tones[i]! / weights[i]!;
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! / totalWeight;
      let pattern = ['ascii', 'braille', 'blocks'].includes(p.style)
        ? glyphPattern(tones, weights, p)
        : 0;
      let emoji = emojis[0]!;
      const cellIndex = cy * columns + cx,
        tone = glyphTone(tones[0]!, p);
      if (p.style === 'emoji') {
        if (controls.emojiMapping === 'random')
          emoji =
            emojis[Math.min(emojis.length - 1, Math.floor(random(cx, cy, 0) * emojis.length))]!;
        else {
          let best = Infinity;
          for (const candidate of emojis) {
            const luma = (candidate.luminance - emojiLow) / Math.max(1e-9, emojiHigh - emojiLow),
              brightness = (luma - tone) ** 2,
              chroma =
                candidate.average.reduce(
                  (sum, c, index) => sum + ((c - rgb[index]!) / 255) ** 2,
                  0,
                ) / 3,
              distance =
                controls.emojiMapping === 'luminance'
                  ? brightness
                  : controls.emojiMapping === 'color'
                    ? chroma
                    : brightness * 0.5 + chroma * 0.5;
            if (distance < best) {
              best = distance;
              emoji = candidate;
            }
          }
        }
      } else if (!['ascii', 'braille', 'blocks'].includes(p.style)) {
        let character = ' ';
        if (p.style === 'binary' || p.style === 'hexadecimal' || p.style === 'numbers') {
          const length = p.style === 'binary' ? 8 : p.style === 'hexadecimal' ? 2 : 3,
            channel = Math.floor(cellIndex / length) % 3,
            byte = Math.round(glyphTone(rgb[channel]! / 255, p) * 255),
            value =
              p.style === 'binary'
                ? byte.toString(2).padStart(8, '0')
                : p.style === 'hexadecimal'
                  ? byte.toString(16).toUpperCase().padStart(2, '0')
                  : String(byte).padStart(3, '0');
          character = value[cellIndex % length]!;
        } else if (symbols.length)
          character =
            symbols[
              p.style === 'custom-text'
                ? cellIndex % symbols.length
                : Math.min(symbols.length - 1, Math.floor(tone * symbols.length))
            ]!;
        pattern = character.codePointAt(0)!;
      }
      const absent = p.density === 0 || random(cx, cy, 1) < controls.missing;
      if (!absent && random(cx, cy, 2) < controls.glitch) {
        if (p.style === 'emoji')
          emoji =
            emojis[Math.min(emojis.length - 1, Math.floor(random(cx, cy, 3) * emojis.length))]!;
        else if (p.style === 'braille' || p.style === 'blocks')
          pattern ^=
            1 <<
            Math.min(
              p.style === 'braille' ? 7 : 3,
              Math.floor(random(cx, cy, 3) * (p.style === 'braille' ? 8 : 4)),
            );
        else if (p.style === 'ascii')
          pattern = Math.min(
            ASCII_GLYPHS.length - 1,
            Math.floor(random(cx, cy, 3) * ASCII_GLYPHS.length),
          );
        else
          pattern =
            TERMINAL_REPERTOIRE[
              Math.min(
                TERMINAL_REPERTOIRE.length - 1,
                Math.floor(random(cx, cy, 3) * TERMINAL_REPERTOIRE.length),
              )
            ]!.codePointAt(0)!;
      }
      const uCenter = ((cx + 0.5) * cellWidth) / reference.width,
        vCenter = ((cy + 0.5) * cellHeight) / reference.height,
        sizeRamp = glyphFalloff(
          uCenter,
          vCenter,
          controls.sizeDirection,
          controls.sizeStart,
          controls.sizeEnd,
          controls.sizeCenterX,
          controls.sizeCenterY,
          controls.sizeInvert === 'on',
          reference,
        ),
        scale =
          p.glyphScale *
          (controls.sizeFalloff === 'on'
            ? controls.sizeFrom + (controls.sizeTo - controls.sizeFrom) * sizeRamp
            : 1),
        colorRamp = glyphFalloff(
          uCenter,
          vCenter,
          controls.colorDirection,
          controls.colorFalloffStart,
          controls.colorFalloffEnd,
          controls.colorFalloffCenterX,
          controls.colorFalloffCenterY,
          controls.colorInvert === 'on',
          reference,
        ),
        angle =
          ((controls.rotation + (random(cx, cy, 4) * 2 - 1) * controls.rotationJitter) * Math.PI) /
          180,
        cosine = Math.cos(angle),
        sine = Math.sin(angle),
        jitterX = (random(cx, cy, 5) * 2 - 1) * controls.positionJitter,
        jitterY = (random(cx, cy, 6) * 2 - 1) * controls.positionJitter,
        duplicate = random(cx, cy, 7) < controls.duplicate,
        copyX = (random(cx, cy, 8) < 0.5 ? -1 : 1) * 0.22,
        copyY = (random(cx, cy, 9) < 0.5 ? -1 : 1) * 0.22;
      // Integer bitmap samples and fixed cell/lane randoms make cancellation and
      // worker scheduling irrelevant to saved output.
      const sample = (u: number, v: number, copy: boolean): number => {
        if (absent || scale === 0) return -1;
        if (angle !== 0 || jitterX !== 0 || jitterY !== 0 || copy) {
          const dx = u - 0.5 - jitterX - (copy ? copyX : 0),
            dy = (v - 0.5 - jitterY - (copy ? copyY : 0)) * p.aspect;
          u = dx * cosine + dy * sine + 0.5;
          v = (-dx * sine + dy * cosine) / p.aspect + 0.5;
        }
        if (font) {
          u = (u - 0.5) / scale + 0.5;
          v = (v - 0.5) / scale + 0.5;
          return font.sample(
            p.style === 'ascii' ? ASCII_GLYPHS[pattern]!.character : String.fromCodePoint(pattern),
            u,
            v,
          );
        }
        if (p.style !== 'emoji') return glyphMark(p.style, pattern, u, v, scale, p.aspect) ? 0 : -1;
        u = (u - 0.5) / scale + 0.5;
        v = (v - 0.5) / scale + 0.5;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
        const i =
          (Math.floor(v * EMOJI_TILE_SIZE) * EMOJI_TILE_SIZE + Math.floor(u * EMOJI_TILE_SIZE)) * 4;
        return emoji.pixels[i + 3]! > 0 ? i : -1;
      };
      let painted = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const i = (y * width + x) * 4;
          if (input[i + 3]! > 0) {
            let coverage = 0;
            emojiRGB.fill(0);
            for (const oy of [0.25, 0.75])
              for (const ox of [0.25, 0.75]) {
                const u = ((x + ox) * reference.width) / width / cellWidth - cx,
                  v = ((y + oy) * reference.height) / height / cellHeight - cy;
                let mark = sample(u, v, false);
                if (duplicate) {
                  const second = sample(u, v, true);
                  if (second >= 0) mark = font ? Math.max(mark, second) : second;
                }
                if (mark >= 0) {
                  coverage += (font ? mark : 1) * 0.25;
                  if (p.style === 'emoji')
                    for (let c = 0; c < 3; c++)
                      emojiRGB[c] = emojiRGB[c]! + emoji.pixels[mark + c]! * 0.25;
                }
              }
            let ink: ArrayLike<number> =
              p.coloring === 'source' ? rgb : foreground((x + 0.5) / width, (y + 0.5) / height);
            const paper = background((x + 0.5) / width, (y + 0.5) / height);
            if (p.style === 'emoji' && coverage > 0) {
              const bright =
                  (emojiRGB[0]! * 0.2126 + emojiRGB[1]! * 0.7152 + emojiRGB[2]! * 0.0722) /
                  coverage /
                  255,
                chosen = foreground((x + 0.5) / width, (y + 0.5) / height);
              for (let index = 0; index < 3; index++)
                treatedInk[index] = Math.max(
                  0,
                  Math.min(
                    255,
                    (controls.emojiColors === 'native'
                      ? emojiRGB[index]! / coverage
                      : controls.emojiColors === 'source'
                        ? rgb[index]!
                        : controls.emojiColors === 'monochrome'
                          ? chosen[index]!
                          : chosen[index]! * bright) + offsets[index]!,
                  ),
                );
              ink = treatedInk;
            }
            if (controls.colorFalloff === 'on') {
              const chosen = foreground((x + 0.5) / width, (y + 0.5) / height),
                strength = controls.colorFrom + (controls.colorTo - controls.colorFrom) * colorRamp;
              for (let index = 0; index < 3; index++)
                treatedInk[index] =
                  controls.colorSource === 'source'
                    ? paper[index]! + (rgb[index]! - paper[index]!) * strength
                    : chosen[index]! + (ending[index]! - chosen[index]!) * colorRamp;
              ink = treatedInk;
            }
            for (let c = 0; c < 3; c++) color[c] = paper[c]! + (ink[c]! - paper[c]!) * coverage;
            color[3] = input[i + 3]!;
            blend(output, input, i, color, p.amount);
          }
          if ((++painted & 127) === 0) yield;
        }
    }
    yield;
  }
}
