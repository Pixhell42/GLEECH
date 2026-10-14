import type { EffectInstance, ParameterDefinition } from './index';

export const DIRECTION_CONSUMERS = [
  'shader-filament-flow',
  'granular-echo',
  'pigment-drag',
  'pixel-sort',
  'signal-tearing',
  'vector-corruption',
  'motion-transfer',
  'motion-mosh',
  'wave-distortion',
  'glyph',
] as const;
export interface DirectionFieldParams {
  directionSource:
    | 'native'
    | 'linear'
    | 'radial'
    | 'toward'
    | 'circular'
    | 'spiral'
    | 'perspective'
    | 'flow'
    | 'depth-gradient'
    | 'image';
  directionInfluence: number;
  directionX: number;
  directionY: number;
  directionScale: number;
  directionRotation: number;
  directionTwist: number;
  directionSeed: number;
  directionInvert: 'off' | 'on';
  directionDrift: number;
}
export const DIRECTION_DEFAULTS: DirectionFieldParams = {
  directionSource: 'native',
  directionInfluence: 1,
  directionX: 50,
  directionY: 50,
  directionScale: 100,
  directionRotation: 0,
  directionTwist: 0.5,
  directionSeed: 0,
  directionInvert: 'off',
  directionDrift: 0.5,
};
export const DIRECTION_KEYS = Object.keys(DIRECTION_DEFAULTS) as (keyof DirectionFieldParams)[];
export function supportsDirectionField(effect: EffectInstance): boolean {
  return (DIRECTION_CONSUMERS as readonly string[]).includes(effect.type);
}
export function directionFieldParams(params: object): DirectionFieldParams {
  const p = params as Partial<DirectionFieldParams>;
  return Object.fromEntries(
    DIRECTION_KEYS.map((key) => [key, p[key] ?? DIRECTION_DEFAULTS[key]]),
  ) as unknown as DirectionFieldParams;
}
const number = (
  label: string,
  initial: number,
  min: number,
  max: number,
  unit: 'percent' | 'image-percent' | 'degrees' | 'count' | 'coordinate',
  description: string,
): ParameterDefinition => ({
  kind: 'number',
  label,
  default: initial,
  min,
  max,
  step: unit === 'percent' || unit === 'coordinate' ? 0.01 : 1,
  unit,
  description,
});
export const DIRECTION_PARAMETERS: Readonly<
  Record<keyof DirectionFieldParams, ParameterDefinition>
> = {
  directionSource: {
    kind: 'choice',
    label: 'Direction field',
    default: 'native',
    description:
      'Native keeps this filter’s existing direction behavior. Other fields share a saved canvas-space vector pattern across compatible filters. Copying a field creates independent settings, not a live link.',
    options: [
      ['native', 'Native'],
      ['linear', 'Linear'],
      ['radial', 'Away from center'],
      ['toward', 'Toward center'],
      ['circular', 'Circular'],
      ['spiral', 'Spiral'],
      ['perspective', 'Perspective'],
      ['flow', 'Noise / Flow'],
      ['depth-gradient', 'Stage brightness gradient'],
      ['image', 'Imported vector map'],
    ].map(([value, label]) => ({ value: value!, label: label! })),
  },
  directionInfluence: number(
    'Field influence',
    1,
    0,
    1,
    'percent',
    'Blend the native direction with the shared vector field. Zero keeps native behavior. Opposing vectors can cancel at the midpoint.',
  ),
  directionX: number(
    'Field position X',
    50,
    -100,
    200,
    'image-percent',
    'Horizontal field origin on the stage canvas.',
  ),
  directionY: number(
    'Field position Y',
    50,
    -100,
    200,
    'image-percent',
    'Vertical field origin on the stage canvas.',
  ),
  directionScale: number(
    'Field scale',
    100,
    5,
    400,
    'image-percent',
    'Scale field coordinates around its origin. Smaller values make tighter patterns; imported maps outside their bounds contribute zero.',
  ),
  directionRotation: number(
    'Field rotation',
    0,
    -180,
    180,
    'degrees',
    'Rotate field coordinates and vector directions together.',
  ),
  directionTwist: number(
    'Spiral twist',
    0.5,
    -1,
    1,
    'coordinate',
    'Mix outward radial travel with circular flow. Negative values spiral inward; zero is circular.',
  ),
  directionSeed: number(
    'Flow seed',
    0,
    0,
    65535,
    'count',
    'Saved seed for Noise / Flow. Copied fields keep the same seed independently of effect identity.',
  ),
  directionInvert: {
    kind: 'choice',
    label: 'Reverse field',
    default: 'off',
    description: 'Reverse both components of the vector field.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  directionDrift: number(
    'Glyph field drift',
    0.5,
    0,
    2,
    'coordinate',
    'Drift the rendered glyph pattern along the field in units of cell size. Glyph selection stays anchored to the original grid.',
  ),
};
