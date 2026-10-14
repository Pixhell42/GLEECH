import { expect, it } from 'vitest';
import {
  assertPresetRecipe,
  BLEND_MODES,
  createEffect,
  type BlendMode,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects } from './index';

const image = { width: 1, height: 1, pixels: Uint8Array.from([64, 128, 192, 255]).buffer };
const solid = (mode: BlendMode, extra: Record<string, number | string> = {}) => {
  const e = createEffect('solid', 'blend');
  return {
    ...e,
    params: { ...e.params, fillColor: '#bf8040', blendMode: mode, ...extra },
  } as EffectInstance;
};
const bytes = (e: EffectInstance, input = image) => [
  ...new Uint8Array(renderEffects(input, [e]).pixels),
];
it.each([
  ['darken', [64, 128, 64]],
  ['lighten', [191, 128, 192]],
  ['color-dodge', [255, 255, 255]],
  ['color-burn', [0, 2, 4]],
  ['linear-burn', [0, 1, 1]],
  ['hard-light', [159, 128, 96]],
  ['soft-light', [96, 128, 168]],
  ['exclusion', [159, 127, 160]],
  ['subtract', [0, 0, 128]],
] as const)('%s matches independent reference vectors', (mode, expected) => {
  expect(bytes(solid(mode))).toEqual([...expected, 255]);
});
it.each(BLEND_MODES)(
  '$label retains zero opacity, transparency and portable recipes',
  ({ value }) => {
    const effect = solid(value);
    expect(bytes(solid(value, { amount: 0 }))).toEqual([64, 128, 192, 255]);
    expect(bytes(effect, { ...image, pixels: Uint8Array.from([64, 128, 192, 0]).buffer })).toEqual([
      191, 128, 64, 255,
    ]);
    const recipe = JSON.parse(
      JSON.stringify({ schemaVersion: 1, masterSeed: 0, effects: [effect] }),
    );
    assertPresetRecipe(recipe);
    expect(bytes(recipe.effects[0]!)).toEqual(bytes(effect));
  },
);
it('handles singular dodge/burn endpoints without invalid pixels', () => {
  const black = { ...image, pixels: Uint8Array.from([0, 0, 0, 255]).buffer };
  const white = { ...image, pixels: Uint8Array.from([255, 255, 255, 255]).buffer };
  expect(bytes(solid('color-dodge', { fillColor: '#ffffff' }), black)).toEqual([0, 0, 0, 255]);
  expect(bytes(solid('color-dodge', { fillColor: '#ffffff' }))).toEqual([255, 255, 255, 255]);
  expect(bytes(solid('color-burn', { fillColor: '#000000' }), white)).toEqual([255, 255, 255, 255]);
  expect(bytes(solid('color-burn', { fillColor: '#000000' }))).toEqual([0, 0, 0, 255]);
});
