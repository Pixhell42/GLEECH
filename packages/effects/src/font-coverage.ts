import {
  decodeFontCoverage,
  FONT_TILE_WIDTH,
  FONT_TILE_HEIGHT,
  type GlyphFontAtlas,
} from '@gleech/project-model';

const cache = new Map<
  string,
  {
    atlas: GlyphFontAtlas;
    pixels: Uint8Array;
    indices: ReadonlyMap<string, number>;
    densities: ReadonlyMap<string, number>;
  }
>();
export function fontCoverage(atlas: GlyphFontAtlas) {
  let entry = cache.get(atlas.id);
  if (!entry || entry.atlas.data !== atlas.data || entry.atlas.characters !== atlas.characters) {
    const characters = Array.from(atlas.characters),
      pixels = decodeFontCoverage(atlas.data, characters.length);
    const indices = new Map(characters.map((character, index) => [character, index]));
    const densities = new Map<string, number>();
    const size = FONT_TILE_WIDTH * FONT_TILE_HEIGHT;
    for (const [index, character] of characters.entries()) {
      let sum = 0;
      for (let i = index * size; i < (index + 1) * size; i++) sum += pixels[i]!;
      densities.set(character, sum);
    }
    entry = { atlas, pixels, indices, densities };
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(atlas.id, entry);
  }
  const { indices, pixels, densities } = entry;
  return {
    rank(text: string): string[] {
      return Array.from(text)
        .map((character, index) => ({
          character,
          index,
          density: densities.get(character) ?? Infinity,
        }))
        .sort((a, b) => a.density - b.density || a.index - b.index)
        .map((item) => item.character);
    },
    sample(character: string, u: number, v: number): number {
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
      const index = indices.get(character);
      if (index === undefined) {
        // A saved atlas can still render new text without silently substituting a font.
        return Math.abs(u - 0.5) + Math.abs(v - 0.5) > 0.34 &&
          Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.41
          ? 1
          : 0;
      }
      const x = u * FONT_TILE_WIDTH - 0.5,
        y = v * FONT_TILE_HEIGHT - 0.5;
      const left = Math.floor(x),
        top = Math.floor(y),
        fx = x - left,
        fy = y - top;
      const get = (dx: number, dy: number) =>
        dx < 0 || dy < 0 || dx >= FONT_TILE_WIDTH || dy >= FONT_TILE_HEIGHT
          ? 0
          : pixels[index * FONT_TILE_WIDTH * FONT_TILE_HEIGHT + dy * FONT_TILE_WIDTH + dx]! / 255;
      return (
        (get(left, top) * (1 - fx) + get(left + 1, top) * fx) * (1 - fy) +
        (get(left, top + 1) * (1 - fx) + get(left + 1, top + 1) * fx) * fy
      );
    },
  };
}
