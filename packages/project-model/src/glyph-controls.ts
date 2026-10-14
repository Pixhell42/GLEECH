import type { ParameterDefinition } from './index';

export const GLYPH_STYLES = [
  'ascii',
  'extended-ascii',
  'unicode',
  'emoji',
  'binary',
  'hexadecimal',
  'numbers',
  'terminal',
  'custom-set',
  'custom-text',
  'braille',
  'blocks',
] as const;
export type GlyphStyle = (typeof GLYPH_STYLES)[number];
export type GlyphDirection = 'horizontal' | 'vertical' | 'radial' | 'square';
export type GlyphControls = {
  readonly fontSource?: 'builtin' | 'installed';
  readonly glyphSet?: string;
  readonly text?: string;
  readonly rotation?: number;
  readonly rotationJitter?: number;
  readonly positionJitter?: number;
  readonly missing?: number;
  readonly duplicate?: number;
  readonly glitch?: number;
  readonly emojiMapping?: 'luminance' | 'color' | 'combined' | 'random';
  readonly emojiPalette?:
    'all' | 'faces' | 'objects' | 'symbols' | 'nature' | 'geometric' | 'custom';
  readonly emojiSet?: string;
  readonly emojiColors?: 'native' | 'source' | 'monochrome' | 'palette';
  readonly emojiRed?: number;
  readonly emojiGreen?: number;
  readonly emojiBlue?: number;
  readonly sizeFalloff?: 'off' | 'on';
  readonly sizeDirection?: GlyphDirection;
  readonly sizeStart?: number;
  readonly sizeEnd?: number;
  readonly sizeCenterX?: number;
  readonly sizeCenterY?: number;
  readonly sizeInvert?: 'off' | 'on';
  readonly sizeFrom?: number;
  readonly sizeTo?: number;
  readonly colorFalloff?: 'off' | 'on';
  readonly colorDirection?: GlyphDirection;
  readonly colorFalloffStart?: number;
  readonly colorFalloffEnd?: number;
  readonly colorFalloffCenterX?: number;
  readonly colorFalloffCenterY?: number;
  readonly colorInvert?: 'off' | 'on';
  readonly colorSource?: 'source' | 'chosen';
  readonly colorFrom?: number;
  readonly colorTo?: number;
  readonly falloffColor?: string;
};
// Optional additions to version-one recipes. Neutral defaults preserve old pixels.
export const GLYPH_DEFAULTS: Required<GlyphControls> = {
  fontSource: 'builtin',
  glyphSet: ' .:-=+*%#@',
  text: 'GLEECH',
  rotation: 0,
  rotationJitter: 0,
  positionJitter: 0,
  missing: 0,
  duplicate: 0,
  glitch: 0,
  emojiMapping: 'combined',
  emojiPalette: 'all',
  emojiSet: '😀😎❤️⭐🔥🌿',
  emojiColors: 'native',
  emojiRed: 0,
  emojiGreen: 0,
  emojiBlue: 0,
  sizeFalloff: 'off',
  sizeDirection: 'horizontal',
  sizeStart: 0,
  sizeEnd: 1,
  sizeCenterX: 0.5,
  sizeCenterY: 0.5,
  sizeInvert: 'off',
  sizeFrom: 0.2,
  sizeTo: 1,
  colorFalloff: 'off',
  colorDirection: 'horizontal',
  colorFalloffStart: 0,
  colorFalloffEnd: 1,
  colorFalloffCenterX: 0.5,
  colorFalloffCenterY: 0.5,
  colorInvert: 'off',
  colorSource: 'source',
  colorFrom: 0,
  colorTo: 1,
  falloffColor: '#4080e0',
};
const number = (
  key: keyof GlyphControls,
  label: string,
  min: number,
  max: number,
  unit: 'percent' | 'degrees' | 'multiplier' | 'count',
  description: string,
): ParameterDefinition => ({
  kind: 'number',
  label,
  default: GLYPH_DEFAULTS[key] as number,
  min,
  max,
  step: unit === 'count' ? 1 : 0.01,
  unit,
  description,
});
const choice = (
  key: keyof GlyphControls,
  label: string,
  options: readonly (readonly [string, string])[],
  description: string,
): ParameterDefinition => ({
  kind: 'choice',
  label,
  default: GLYPH_DEFAULTS[key] as string,
  options: options.map(([value, label]) => ({ value, label })),
  description,
});
const toggle = (key: keyof GlyphControls, label: string, description: string) =>
  choice(
    key,
    label,
    [
      ['off', 'Off'],
      ['on', 'On'],
    ],
    description,
  );
const falloff = (prefix: 'size' | 'color', label: string): Record<string, ParameterDefinition> => ({
  [`${prefix}Falloff`]: toggle(
    `${prefix}Falloff`,
    `${label} falloff`,
    prefix === 'size'
      ? 'Vary the drawn glyph size across the image. Sampling cells remain fixed.'
      : 'Vary glyph colors across the image, using sampled source colors or two chosen colors.',
  ),
  [`${prefix}Direction`]: choice(
    `${prefix}Direction`,
    `${label} direction`,
    [
      ['horizontal', 'Horizontal'],
      ['vertical', 'Vertical'],
      ['radial', 'Radial'],
      ['square', 'Square'],
    ],
    'Choose a left-to-right, top-to-bottom, circular or square transition. Invert reverses its progression.',
  ),
  [prefix === 'size' ? 'sizeStart' : 'colorFalloffStart']: number(
    prefix === 'size' ? 'sizeStart' : 'colorFalloffStart',
    `${label} start position`,
    0,
    1,
    'percent',
    'Position where the transition starts. The starting value holds before this position. Equal start/end positions make a hard edge.',
  ),
  [prefix === 'size' ? 'sizeEnd' : 'colorFalloffEnd']: number(
    prefix === 'size' ? 'sizeEnd' : 'colorFalloffEnd',
    `${label} end position`,
    0,
    1,
    'percent',
    'Position where the transition finishes. The ending value holds after this position. Start may be above End to reverse the ramp.',
  ),
  [prefix === 'size' ? 'sizeCenterX' : 'colorFalloffCenterX']: number(
    prefix === 'size' ? 'sizeCenterX' : 'colorFalloffCenterX',
    `${label} center X`,
    0,
    1,
    'percent',
    'Horizontal center of the radial or square falloff.',
  ),
  [prefix === 'size' ? 'sizeCenterY' : 'colorFalloffCenterY']: number(
    prefix === 'size' ? 'sizeCenterY' : 'colorFalloffCenterY',
    `${label} center Y`,
    0,
    1,
    'percent',
    'Vertical center of the radial or square falloff.',
  ),
  [`${prefix}Invert`]: toggle(
    `${prefix}Invert`,
    `${label} invert`,
    'Reverse the transition while keeping the same positions and center.',
  ),
});
export const GLYPH_PARAMETERS: Readonly<Record<string, ParameterDefinition>> = {
  fontSource: choice(
    'fontSource',
    'Font source',
    [
      ['builtin', 'Built-in'],
      ['installed', 'Installed font'],
    ],
    'Use the original bitmap characters or a locally installed typeface. Saved character images preserve the installed font appearance in projects and presets.',
  ),
  glyphSet: {
    kind: 'text',
    label: 'Custom glyph set',
    default: GLYPH_DEFAULTS.glyphSet,
    maxLength: 128,
    description:
      'Symbols ordered from least to most dense. Repeated characters add weight. Uses the selected font source; unsupported symbols become an outlined diamond.',
  },
  text: {
    kind: 'text',
    label: 'Custom text',
    default: GLYPH_DEFAULTS.text,
    maxLength: 512,
    description:
      'Repeat this text in reading order across the cell grid. Spaces remain spaces; line breaks act as spaces. Uses the selected font source.',
  },
  rotation: number(
    'rotation',
    'Glyph rotation',
    -180,
    180,
    'degrees',
    'Rotate each glyph about its own cell center, without rotating the grid or image.',
  ),
  rotationJitter: number(
    'rotationJitter',
    'Rotation jitter',
    0,
    180,
    'degrees',
    'Seeded variation above and below Glyph rotation for each cell.',
  ),
  positionJitter: number(
    'positionJitter',
    'Position jitter',
    0,
    0.5,
    'percent',
    'Seeded offsets up to this fraction of a cell in each axis. Marks remain clipped to their original cell.',
  ),
  missing: number(
    'missing',
    'Missing glyphs',
    0,
    1,
    'percent',
    'Seeded probability that a cell contains only Background.',
  ),
  duplicate: number(
    'duplicate',
    'Duplicate glyphs',
    0,
    1,
    'percent',
    'Seeded probability of a second, offset copy inside the same cell.',
  ),
  glitch: number(
    'glitch',
    'Glyph glitches',
    0,
    1,
    'percent',
    'Seeded probability of replacing a glyph or flipping a Braille/block bit. Custom Text gets a corrupted symbol in that cell.',
  ),
  emojiMapping: choice(
    'emojiMapping',
    'Emoji mapping',
    [
      ['luminance', 'Luminance'],
      ['color', 'Color'],
      ['combined', 'Luminance + color'],
      ['random', 'Seeded random'],
    ],
    'Choose emoji by painted brightness, average native color, a combined match or a repeatable random selection.',
  ),
  emojiPalette: choice(
    'emojiPalette',
    'Emoji palette',
    [
      ['all', 'All'],
      ['faces', 'Faces'],
      ['objects', 'Objects'],
      ['symbols', 'Symbols'],
      ['nature', 'Nature'],
      ['geometric', 'Geometric'],
      ['custom', 'Custom set'],
    ],
    'Choose from the original GLEECH pixel-emoji atlas. This fixed set renders identically without installed emoji fonts.',
  ),
  emojiSet: {
    kind: 'text',
    label: 'Custom emoji set',
    default: GLYPH_DEFAULTS.emojiSet,
    maxLength: 128,
    description:
      'Enter characters from the built-in atlas. Unsupported emoji are ignored; an empty usable set falls back to All. Open Atlas to see available characters.',
  },
  emojiColors: choice(
    'emojiColors',
    'Emoji colors',
    [
      ['native', 'Native'],
      ['source', 'Source tint'],
      ['monochrome', 'Monochrome'],
      ['palette', 'Palette tint'],
    ],
    'Native preserves original emoji colors; Source tint uses sampled cell RGB; Monochrome uses Foreground; Palette tint shades Foreground through native brightness.',
  ),
  emojiRed: number(
    'emojiRed',
    'Emoji red offset',
    -255,
    255,
    'count',
    'Add or subtract red after the emoji color treatment, before color falloff and blending.',
  ),
  emojiGreen: number(
    'emojiGreen',
    'Emoji green offset',
    -255,
    255,
    'count',
    'Add or subtract green after the emoji color treatment, before color falloff and blending.',
  ),
  emojiBlue: number(
    'emojiBlue',
    'Emoji blue offset',
    -255,
    255,
    'count',
    'Add or subtract blue after the emoji color treatment, before color falloff and blending.',
  ),
  ...falloff('size', 'Size'),
  sizeFrom: number(
    'sizeFrom',
    'Starting size',
    0,
    2,
    'multiplier',
    'Starting size multiplied by Glyph scale. Zero hides the glyph; values above one enlarge it within the cell.',
  ),
  sizeTo: number(
    'sizeTo',
    'Ending size',
    0,
    2,
    'multiplier',
    'Ending size multiplied by Glyph scale. The grid and sampled source remain fixed.',
  ),
  ...falloff('color', 'Color'),
  colorSource: choice(
    'colorSource',
    'Falloff colors',
    [
      ['source', 'Source image'],
      ['chosen', 'Chosen colors'],
    ],
    'Source image fades from Background to each cell’s sampled image color. Chosen colors interpolates Foreground and Ending color.',
  ),
  colorFrom: number(
    'colorFrom',
    'Starting color strength',
    0,
    1,
    'percent',
    'Starting strength of sampled source color against Background. Zero uses Background; one uses the full sampled color.',
  ),
  colorTo: number(
    'colorTo',
    'Ending color strength',
    0,
    1,
    'percent',
    'Ending strength of sampled source color against Background.',
  ),
  falloffColor: {
    kind: 'color',
    label: 'Ending color',
    default: GLYPH_DEFAULTS.falloffColor,
    description: 'Ending color for Chosen colors falloff. Foreground supplies the starting color.',
  },
};
