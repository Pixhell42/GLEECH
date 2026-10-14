// Only rasterized character coverage travels with a recipe, never font files or paths.
export const FONT_TILE_WIDTH = 64;
export const FONT_TILE_HEIGHT = 96;
export const MAX_FONT_CHARACTERS = 1024;
const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export interface GlyphFontAtlas {
  readonly version: 1;
  readonly id: string;
  readonly family: string;
  readonly style: string;
  readonly postscriptName: string;
  readonly characters: string;
  readonly missing: string;
  readonly data: string;
}
export function encodeFontCoverage(bytes: Uint8Array): string {
  const packed: number[] = [];
  for (let i = 0; i < bytes.length;) {
    let run = 1;
    while (run < 128 && i + run < bytes.length && bytes[i + run] === bytes[i]) run++;
    if (run >= 3) {
      packed.push(128 + run - 1, bytes[i]!);
      i += run;
      continue;
    }
    const start = i;
    i += run;
    while (i - start < 128 && i < bytes.length) {
      if (i + 2 < bytes.length && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2]) break;
      i++;
    }
    packed.push(i - start - 1, ...bytes.subarray(start, i));
  }
  const encoded: string[] = [];
  for (let i = 0; i < packed.length; i += 3) {
    const value = (packed[i]! << 16) | ((packed[i + 1] ?? 0) << 8) | (packed[i + 2] ?? 0);
    encoded.push(
      base64[(value >>> 18) & 63]! +
        base64[(value >>> 12) & 63]! +
        (i + 1 < packed.length ? base64[(value >>> 6) & 63] : '=') +
        (i + 2 < packed.length ? base64[value & 63] : '='),
    );
  }
  return encoded.join('');
}
export function decodeFontCoverage(data: string, count: number): Uint8Array {
  const length = count * FONT_TILE_WIDTH * FONT_TILE_HEIGHT;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_FONT_CHARACTERS ||
    typeof data !== 'string' ||
    data.length > Math.ceil((length * 2) / 3) * 4 ||
    data.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error('Invalid saved font coverage.');
  const binary = new Uint8Array(
      (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0),
    ),
    output = new Uint8Array(length);
  for (let i = 0, position = 0; i < data.length; i += 4) {
    const value =
      (base64.indexOf(data[i]!) << 18) |
      (base64.indexOf(data[i + 1]!) << 12) |
      (Math.max(0, base64.indexOf(data[i + 2]!)) << 6) |
      Math.max(0, base64.indexOf(data[i + 3]!));
    binary[position++] = (value >>> 16) & 255;
    if (position < binary.length) binary[position++] = (value >>> 8) & 255;
    if (position < binary.length) binary[position++] = value & 255;
  }
  let position = 0;
  for (let i = 0; i < binary.length;) {
    const token = binary[i++]!,
      run = (token & 127) + 1;
    if (position + run > length || i + (token >= 128 ? 1 : run) > binary.length)
      throw new Error('Invalid saved font coverage.');
    if (token >= 128) output.fill(binary[i++]!, position, position + run);
    else for (let j = 0; j < run; j++) output[position + j] = binary[i++]!;
    position += run;
  }
  if (position !== length) throw new Error('Incomplete saved font coverage.');
  return output;
}
const validated = new Map<string, GlyphFontAtlas>();
export function assertGlyphFont(value: unknown): asserts value is GlyphFontAtlas {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved glyph font.');
  const atlas = value as GlyphFontAtlas;
  if (
    Object.keys(atlas).some(
      (key) =>
        ![
          'version',
          'id',
          'family',
          'style',
          'postscriptName',
          'characters',
          'missing',
          'data',
        ].includes(key),
    )
  )
    throw new Error('Invalid saved glyph font fields.');
  if (
    atlas.version !== 1 ||
    typeof atlas.id !== 'string' ||
    !atlas.id ||
    atlas.id.length > 128 ||
    [atlas.family, atlas.style, atlas.postscriptName].some(
      (text) =>
        typeof text !== 'string' ||
        !text ||
        text.length > 256 ||
        Array.from(text).some((character) => character.codePointAt(0)! < 32),
    ) ||
    typeof atlas.characters !== 'string' ||
    typeof atlas.missing !== 'string'
  )
    throw new Error('Invalid saved glyph font.');
  const characters = Array.from(atlas.characters),
    missing = Array.from(atlas.missing);
  if (
    !characters.length ||
    characters.length > MAX_FONT_CHARACTERS ||
    new Set(characters).size !== characters.length ||
    missing.length > characters.length ||
    new Set(missing).size !== missing.length ||
    missing.some((character) => !characters.includes(character)) ||
    characters.some((character) => character.codePointAt(0)! < 32)
  )
    throw new Error('Invalid saved font characters.');
  const previous = validated.get(atlas.id);
  if (
    previous &&
    Object.keys(previous).every(
      (key) => previous[key as keyof GlyphFontAtlas] === atlas[key as keyof GlyphFontAtlas],
    )
  )
    return;
  decodeFontCoverage(atlas.data, characters.length);
  if (validated.size >= 4) validated.delete(validated.keys().next().value!);
  validated.set(atlas.id, Object.freeze({ ...atlas }));
}
