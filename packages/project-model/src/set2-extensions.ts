import { ADVANCED_EXTENSION_SPECS } from './advanced-shaders';
import type { EffectType, ParameterDefinition } from './index';
const n = (
  label: string,
  value: number,
  min: number,
  max: number,
  description: string,
  unit: 'percent' | 'count' | 'degrees' | 'image-percent' = 'percent',
): ParameterDefinition => ({
  kind: 'number',
  label,
  default: value,
  min,
  max,
  step: unit === 'count' || unit === 'degrees' ? 1 : 0.01,
  unit,
  description,
});
const choice = (
  label: string,
  values: readonly string[],
  description: string,
): ParameterDefinition => ({
  kind: 'choice',
  label,
  default: values[0]!,
  options: values.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
  description,
});
export const SET2_EXTENSION_PARAMETERS: Partial<
  Record<EffectType, Readonly<Record<string, ParameterDefinition>>>
> = {
  ...Object.fromEntries(
    Object.entries(ADVANCED_EXTENSION_SPECS).map(([type, spec]) => [type, spec.controls]),
  ),
  'system-crash': {
    windowPlacement: choice(
      'Window placement',
      ['random', 'grid', 'horizontal', 'vertical'],
      'Arrange the diagnostic windows randomly, on a grid, or along one axis.',
    ),
    windowSpreadX: n(
      'Horizontal spread',
      84,
      0,
      200,
      'Spread the window centers across the canvas.',
      'image-percent',
    ),
    windowSpreadY: n(
      'Vertical spread',
      84,
      0,
      200,
      'Spread the window centers vertically.',
      'image-percent',
    ),
    windowCenterX: n(
      'Window position X',
      50,
      -50,
      150,
      'Move the entire window arrangement horizontally.',
      'image-percent',
    ),
    windowCenterY: n(
      'Window position Y',
      50,
      -50,
      150,
      'Move the entire window arrangement vertically.',
      'image-percent',
    ),
    annotations: choice(
      'Graphic overlays',
      ['off', 'on'],
      'Enable independent anchors, connectors, labels and frames without changing the image glitches.',
    ),
    anchorDensity: n('Anchor density', 0.55, 0, 1, 'Fraction of annotation sites with anchors.'),
    connectorStyle: choice(
      'Connectors',
      ['elbow', 'straight', 'off'],
      'Join annotation anchors with elbow paths, straight lines or no connectors.',
    ),
    annotationLabels: choice('Anchor labels', ['on', 'off'], 'Show labels at annotation anchors.'),
    labelText: {
      kind: 'text',
      label: 'Anchor text',
      default: 'SIGNAL / TRACE / NODE / INPUT / GLEECH',
      maxLength: 160,
      description:
        'Slash-separated decorative labels. They do not describe or identify objects in the image.',
    },
    overlayFrames: choice(
      'Graphic frames',
      ['on', 'off'],
      'Draw optional frames and header bars around image panels.',
    ),
    overlayWidth: n(
      'Overlay width',
      0.12,
      0.02,
      0.5,
      'Width of connectors and frames relative to the shorter image side.',
      'image-percent',
    ),
  },
  'terminal-wireframe': {
    traceStyle: choice(
      'Tracing',
      ['glyphs', 'circuit'],
      'Keep the original dashed glyph contours or build orthogonal circuit paths.',
    ),
    rightAngleBias: n(
      'Right-angle bias',
      0.85,
      0,
      1,
      'Prefer elbows and right-angle paths over direct connections.',
    ),
    channelSeparation: n(
      'Trace color separation',
      0,
      0,
      0.2,
      'Separate colored trace channels by a fraction of a cell.',
    ),
  },
  'contour-waves': {
    breakup: n('Line breakup', 0, 0, 1, 'Create seeded gaps along the contour lines.'),
    stepSize: n(
      'Raster step',
      0,
      0,
      12,
      'Snap sampled wave heights to coarse increments. Zero retains smooth curves.',
      'image-percent',
    ),
    tearStrength: n(
      'Contour tears',
      0,
      0,
      20,
      'Shift seeded portions of lines sideways. Zero retains the original layout.',
      'image-percent',
    ),
  },
  'block-corruption': {
    replacement: choice(
      'Replacement',
      ['source', 'checker', 'noise'],
      'Keep displaced source blocks or replace selected blocks with checker/noise patterns.',
    ),
    replacementColor: {
      kind: 'color',
      label: 'Replacement color',
      default: '#ed58c6',
      gradient: 'spatial',
      description: 'Color or gradient used by replacement patterns.',
    },
    patternScale: n(
      'Pattern scale',
      4,
      1,
      16,
      'Number of small pattern cells inside each replacement block.',
      'count',
    ),
    erosion: n('Fragment erosion', 0, 0, 1, 'Erode the edges of selected corruption blocks.'),
    fragmentTravel: n(
      'Fragment travel',
      0,
      0,
      30,
      'Additional independently seeded travel of corruption fragments.',
      'image-percent',
    ),
  },
  'pixel-stretch': {
    edgeBias: n('Edge bias', 0, 0, 1, 'Favor high-contrast source edges over flat regions.'),
    protectedRadius: n(
      'Protected center',
      0,
      0,
      60,
      'Keep a circular region around the stretch origin unchanged.',
      'image-percent',
    ),
  },
  'shader-microculture': {
    lens: n(
      'Lens vignette',
      0,
      0,
      1,
      'Blend a circular microscope-lens vignette over the culture. Zero leaves the full canvas visible.',
    ),
  },
  'led-matrix': {
    brightnessSource: choice(
      'Brightness source',
      ['image', 'pattern'],
      'Drive light cells with source brightness or a frozen procedural signal field.',
    ),
    patternFrequency: n(
      'Pattern frequency',
      5,
      1,
      24,
      'Number of broad signal bands across the canvas.',
      'count',
    ),
  },
};
