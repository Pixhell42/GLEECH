import {
  encodeFontCoverage,
  FONT_TILE_WIDTH,
  FONT_TILE_HEIGHT,
  GLYPH_DEFAULTS,
  MAX_FONT_CHARACTERS,
  type GlyphEffect,
  type GlyphFontAtlas,
} from '@gleech/project-model';
import { UNICODE_REPERTOIRE, EXTENDED_REPERTOIRE, TERMINAL_REPERTOIRE } from '@gleech/effects';

export interface LocalFont {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
let fonts: Promise<readonly LocalFont[]> | undefined;
export function listLocalFonts(): Promise<readonly LocalFont[]> {
  const query = (window as Window & { queryLocalFonts?: () => Promise<LocalFont[]> })
    .queryLocalFonts;
  if (!query) return Promise.reject(new Error('Installed font access is unavailable in this app.'));
  return (fonts ??= query
    .call(window)
    .then((faces) =>
      faces.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style)),
    )
    .catch((error) => {
      fonts = undefined;
      throw error;
    }));
}
export function atlasCharacters(params: GlyphEffect['params']): string {
  const base =
    Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)).join('') +
    Array.from({ length: 96 }, (_, i) => String.fromCodePoint(160 + i)).join('');
  const custom = (
    (params.text ?? GLYPH_DEFAULTS.text) + (params.glyphSet ?? GLYPH_DEFAULTS.glyphSet)
  ).replace(/[\r\n\t]/g, ' ');
  const result = [
    ...new Set(
      Array.from(base + UNICODE_REPERTOIRE + EXTENDED_REPERTOIRE + TERMINAL_REPERTOIRE + custom),
    ),
  ].join('');
  if (Array.from(result).length > MAX_FONT_CHARACTERS)
    throw new Error('This character sheet is too large. Shorten the custom character set or text.');
  return result;
}

// Read the font's character map so Canvas never silently uses a fallback font.
export function fontCharacterMap(bytes: ArrayBuffer): (codepoint: number) => number | null {
  const view = new DataView(bytes);
  const u16 = (offset: number) => view.getUint16(offset, false),
    u32 = (offset: number) => view.getUint32(offset, false);
  let cmap = -1;
  for (let i = 0; i < u16(4); i++) {
    const entry = 12 + i * 16;
    if (u32(entry) === 0x636d6170) {
      cmap = u32(entry + 8);
      break;
    }
  }
  if (cmap < 0) throw new Error('This font has no supported character map.');
  const maps: { offset: number; format: number; symbol: boolean }[] = [];
  for (let i = 0; i < u16(cmap + 2); i++) {
    const entry = cmap + 4 + i * 8,
      platform = u16(entry),
      encoding = u16(entry + 2),
      offset = cmap + u32(entry + 4),
      format = u16(offset);
    if ((platform === 0 || platform === 3) && [0, 4, 6, 12, 13].includes(format))
      maps.push({ offset, format, symbol: platform === 3 && encoding === 0 });
  }
  if (!maps.length)
    throw new Error('This font uses an unsupported character map. Choose another font.');
  const present = (offset: number, format: number, code: number): boolean => {
    if (format === 0) return code < 256 && view.getUint8(offset + 6 + code) !== 0;
    if (format === 6) {
      const start = u16(offset + 6),
        count = u16(offset + 8);
      return code >= start && code < start + count && u16(offset + 10 + (code - start) * 2) !== 0;
    }
    if (format === 12 || format === 13) {
      let low = 0,
        high = u32(offset + 12) - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1,
          group = offset + 16 + mid * 12,
          start = u32(group),
          end = u32(group + 4);
        if (code < start) high = mid - 1;
        else if (code > end) low = mid + 1;
        else return u32(group + 8) + (format === 12 ? code - start : 0) !== 0;
      }
      return false;
    }
    if (code > 65535) return false;
    const count = u16(offset + 6) / 2,
      ends = offset + 14,
      starts = ends + count * 2 + 2,
      deltas = starts + count * 2,
      ranges = deltas + count * 2;
    for (let i = 0; i < count; i++) {
      if (code > u16(ends + i * 2)) continue;
      if (code < u16(starts + i * 2)) return false;
      const range = u16(ranges + i * 2),
        delta = u16(deltas + i * 2);
      const glyph = range ? u16(ranges + i * 2 + range + (code - u16(starts + i * 2)) * 2) : code;
      return (range && glyph === 0 ? 0 : (glyph + delta) & 65535) !== 0;
    }
    return false;
  };
  return (code) => {
    for (const map of maps) if (present(map.offset, map.format, code)) return code;
    if (code >= 32 && code <= 255)
      for (const map of maps)
        if (map.symbol && present(map.offset, map.format, code + 0xf000)) return code + 0xf000;
    return null;
  };
}
export async function rasterizeFont(font: LocalFont, characters: string): Promise<GlyphFontAtlas> {
  const blob = await font.blob();
  if (blob.size > 64 * 1024 * 1024) throw new Error('Choose a font smaller than 64 MB.');
  const bytes = await blob.arrayBuffer(),
    map = fontCharacterMap(bytes),
    id = crypto.randomUUID();
  const face = await new FontFace(`GLEECH-${id}`, bytes).load();
  document.fonts.add(face);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = FONT_TILE_WIDTH;
    canvas.height = FONT_TILE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const symbols = Array.from(characters),
      pixels = new Uint8Array(symbols.length * FONT_TILE_WIDTH * FONT_TILE_HEIGHT);
    let missing = '';
    for (let index = 0; index < symbols.length; index++) {
      if (index % 32 === 0) await new Promise<void>((done) => setTimeout(done, 0));
      const character = symbols[index]!,
        code = map(character.codePointAt(0)!);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff';
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      if (code === null && character !== ' ' && character !== '\u00a0') {
        missing += character;
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(32, 12);
        context.lineTo(56, 48);
        context.lineTo(32, 84);
        context.lineTo(8, 48);
        context.closePath();
        context.strokeStyle = '#fff';
        context.stroke();
      } else if (code !== null) {
        const drawn = String.fromCodePoint(code);
        context.font = `72px "${face.family}"`;
        let metrics = context.measureText(drawn);
        const fit = Math.min(
          1,
          56 / Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight),
          68 / Math.max(1, metrics.actualBoundingBoxAscent),
          16 / Math.max(1, metrics.actualBoundingBoxDescent),
        );
        context.font = `${72 * fit}px "${face.family}"`;
        metrics = context.measureText(drawn);
        context.fillText(
          drawn,
          (64 - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft)) / 2,
          73,
        );
      }
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const start = index * FONT_TILE_WIDTH * FONT_TILE_HEIGHT;
      for (let i = 0; i < FONT_TILE_WIDTH * FONT_TILE_HEIGHT; i++)
        pixels[start + i] = rgba[i * 4 + 3]!;
    }
    return {
      version: 1,
      id,
      family: font.family,
      style: font.style,
      postscriptName: font.postscriptName,
      characters,
      missing,
      data: encodeFontCoverage(pixels),
    };
  } finally {
    document.fonts.delete(face);
  }
}
