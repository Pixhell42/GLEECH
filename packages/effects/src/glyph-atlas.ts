// GLEECH original pixel-emoji atlas v1. All artwork is generated from these
// geometric definitions; no third-party art, fonts, network or system emoji.
export const EMOJI_ATLAS_VERSION = 'gleech-pixel-emoji-v1';
export const EMOJI_TILE_SIZE = 24;
type Category = 'faces' | 'objects' | 'symbols' | 'nature' | 'geometric';
type RGB = readonly [number, number, number];
const ink: RGB = [36, 29, 35],
  gold: RGB = [255, 199, 53],
  white: RGB = [255, 250, 224],
  red: RGB = [243, 70, 101],
  blue: RGB = [52, 155, 239],
  green: RGB = [73, 194, 113],
  purple: RGB = [167, 105, 225];
const circle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x: number, y: number, l: number, t: number, r: number, b: number) =>
  x >= l && x <= r && y >= t && y <= b;
const heart = (x: number, y: number) =>
  (x * x + y * y - 0.5) ** 3 - x * x * (-y) ** 3 <= 0 && y < 0.78;
const defs: readonly {
  character: string;
  name: string;
  category: Category;
  paint(x: number, y: number): RGB | null;
}[] = [
  ...(['😀', '🙂', '😢', '😎', '😉', '😮'] as const).map((character, i) => ({
    character,
    name: [
      'Grinning face',
      'Smiling face',
      'Sad face',
      'Cool face',
      'Winking face',
      'Surprised face',
    ][i]!,
    category: 'faces' as const,
    paint: (x: number, y: number): RGB | null => {
      if (!circle(x, y, 0, 0, 0.9)) return null;
      if (i === 3 && rect(x, y, -0.72, -0.33, 0.72, -0.04)) return ink;
      if (
        circle(x, y, -0.32, -0.25, 0.1) ||
        (i === 4 ? rect(x, y, 0.21, -0.28, 0.44, -0.21) : circle(x, y, 0.32, -0.25, 0.1))
      )
        return ink;
      if (i === 2 && circle(x, y, 0.44, 0.02, 0.11)) return blue;
      if (i === 5 && circle(x, y, 0, 0.34, 0.21)) return ink;
      if (i === 0 && circle(x, y, 0, 0.05, 0.53) && y > 0.16) return y < 0.28 ? white : ink;
      if (
        i !== 0 &&
        i !== 5 &&
        Math.abs(y - (i === 2 ? 0.44 - 0.8 * x * x : 0.24 + 0.8 * x * x)) < 0.055 &&
        Math.abs(x) < 0.43
      )
        return ink;
      return gold;
    },
  })),
  {
    character: '💡',
    name: 'Light bulb',
    category: 'objects',
    paint: (x, y) =>
      circle(x, y, 0, -0.27, 0.58)
        ? gold
        : rect(x, y, -0.26, 0.21, 0.26, 0.69)
          ? [176, 185, 194]
          : null,
  },
  {
    character: '🔑',
    name: 'Key',
    category: 'objects',
    paint: (x, y) =>
      (circle(x, y, -0.41, -0.34, 0.34) && !circle(x, y, -0.41, -0.34, 0.15)) ||
      rect(x, y, -0.25, -0.18, 0.64, 0.03) ||
      rect(x, y, 0.38, 0, 0.57, 0.32)
        ? gold
        : null,
  },
  {
    character: '📦',
    name: 'Box',
    category: 'objects',
    paint: (x, y) =>
      rect(x, y, -0.73, -0.65, 0.73, 0.72)
        ? Math.abs(x) < 0.1
          ? [247, 211, 153]
          : y < 0
            ? [215, 147, 70]
            : [164, 100, 47]
        : null,
  },
  {
    character: '🕒',
    name: 'Clock',
    category: 'objects',
    paint: (x, y) =>
      !circle(x, y, 0, 0, 0.86)
        ? null
        : !circle(x, y, 0, 0, 0.7)
          ? blue
          : rect(x, y, -0.06, -0.5, 0.06, 0.06) || rect(x, y, 0, -0.06, 0.44, 0.06)
            ? ink
            : white,
  },
  {
    character: '❤',
    name: 'Heart',
    category: 'symbols',
    paint: (x, y) => (heart(x, y) ? red : null),
  },
  {
    character: '⭐',
    name: 'Star',
    category: 'symbols',
    paint: (x, y) => {
      const a = Math.atan2(x, -y),
        r = Math.hypot(x, y);
      return r < 0.59 + 0.27 * Math.cos(5 * a) ? gold : null;
    },
  },
  {
    character: '⚡',
    name: 'Lightning',
    category: 'symbols',
    paint: (x, y) =>
      (y < 0.08 && x > -0.45 + 0.35 * y && x < 0.23 - 0.6 * y) ||
      (y > -0.08 && x < 0.45 + 0.35 * y && x > -0.23 - 0.6 * y)
        ? gold
        : null,
  },
  {
    character: '✚',
    name: 'Plus',
    category: 'symbols',
    paint: (x, y) =>
      rect(x, y, -0.2, -0.78, 0.2, 0.78) || rect(x, y, -0.78, -0.2, 0.78, 0.2) ? green : null,
  },
  {
    character: '🌿',
    name: 'Leaf',
    category: 'nature',
    paint: (x, y) =>
      (x * x) / 0.42 + (y * y) / 0.76 < 1
        ? Math.abs(x + 0.1 * y) < 0.045
          ? [36, 118, 70]
          : green
        : null,
  },
  {
    character: '🌸',
    name: 'Flower',
    category: 'nature',
    paint: (x, y) =>
      circle(x, y, 0, 0, 0.21)
        ? gold
        : circle(x, y, 0, -0.45, 0.31) ||
            circle(x, y, 0.43, -0.12, 0.31) ||
            circle(x, y, 0.26, 0.37, 0.31) ||
            circle(x, y, -0.26, 0.37, 0.31) ||
            circle(x, y, -0.43, -0.12, 0.31)
          ? [246, 149, 203]
          : null,
  },
  {
    character: '🔥',
    name: 'Fire',
    category: 'nature',
    paint: (x, y) =>
      Math.abs(x) < 0.64 * (0.86 - Math.abs(y - 0.15)) && y > -0.85 && y < 0.82
        ? Math.abs(x) < 0.24 && y > 0
          ? gold
          : [248, 96, 33]
        : null,
  },
  {
    character: '💧',
    name: 'Water drop',
    category: 'nature',
    paint: (x, y) =>
      (y >= 0 && circle(x, y, 0, 0.15, 0.62)) || (y < 0 && Math.abs(x) < 0.62 * (y + 0.95))
        ? x < -0.18 && y > 0
          ? [157, 222, 253]
          : blue
        : null,
  },
  {
    character: '☀',
    name: 'Sun',
    category: 'nature',
    paint: (x, y) =>
      circle(x, y, 0, 0, 0.47) ||
      (Math.hypot(x, y) < 0.91 && Math.hypot(x, y) > 0.57 && Math.cos(8 * Math.atan2(y, x)) > 0.7)
        ? gold
        : null,
  },
  {
    character: '☁',
    name: 'Cloud',
    category: 'nature',
    paint: (x, y) =>
      circle(x, y, -0.43, 0.08, 0.36) ||
      circle(x, y, -0.08, -0.19, 0.46) ||
      circle(x, y, 0.43, 0.08, 0.36) ||
      rect(x, y, -0.46, 0, 0.46, 0.41)
        ? [208, 226, 240]
        : null,
  },
  {
    character: '🔴',
    name: 'Red circle',
    category: 'geometric',
    paint: (x, y) => (circle(x, y, 0, 0, 0.81) ? red : null),
  },
  {
    character: '🔵',
    name: 'Blue circle',
    category: 'geometric',
    paint: (x, y) => (circle(x, y, 0, 0, 0.81) ? blue : null),
  },
  {
    character: '🟩',
    name: 'Green square',
    category: 'geometric',
    paint: (x, y) => (rect(x, y, -0.77, -0.77, 0.77, 0.77) ? green : null),
  },
  {
    character: '🔺',
    name: 'Triangle',
    category: 'geometric',
    paint: (x, y) => (y > -0.85 && y < 0.75 && Math.abs(x) < (y + 0.85) * 0.51 ? red : null),
  },
  {
    character: '🔷',
    name: 'Diamond',
    category: 'geometric',
    paint: (x, y) => (Math.abs(x) + Math.abs(y) < 0.88 ? purple : null),
  },
];
export const GLYPH_EMOJI = defs.map((definition) => {
  const pixels = new Uint8Array(EMOJI_TILE_SIZE * EMOJI_TILE_SIZE * 4),
    average = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < EMOJI_TILE_SIZE; y++)
    for (let x = 0; x < EMOJI_TILE_SIZE; x++) {
      const color = definition.paint(
        ((x + 0.5) / EMOJI_TILE_SIZE) * 2 - 1,
        ((y + 0.5) / EMOJI_TILE_SIZE) * 2 - 1,
      );
      if (!color) continue;
      const i = (y * EMOJI_TILE_SIZE + x) * 4;
      pixels.set([...color, 255], i);
      for (let c = 0; c < 3; c++) average[c] = average[c]! + color[c]!;
      count++;
    }
  for (let c = 0; c < 3; c++) average[c] = average[c]! / Math.max(1, count);
  const luminance =
    (((average[0]! * 0.2126 + average[1]! * 0.7152 + average[2]! * 0.0722) / 255) * count) /
    EMOJI_TILE_SIZE ** 2;
  return {
    character: definition.character,
    name: definition.name,
    category: definition.category,
    pixels,
    average,
    luminance,
  };
});
export function emojiSelection(palette: string, custom: string) {
  const customSet = new Set(Array.from(custom.replaceAll('\ufe0f', '')));
  const selected = GLYPH_EMOJI.filter(
    (g) =>
      palette === 'all' ||
      (palette === 'custom' ? customSet.has(g.character) : g.category === palette),
  );
  return selected.length ? selected : GLYPH_EMOJI;
}
