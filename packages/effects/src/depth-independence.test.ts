import { describe, expect, it } from 'vitest';
import {
  createEffect,
  type DepthParallaxEffect,
  type BlurEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects } from './index';
const image = {
  width: 21,
  height: 21,
  pixels: Uint8Array.from(
    Array.from({ length: 21 * 21 }, (_, i) => [
      (i % 21) * 11,
      Math.floor(i / 21) * 11,
      i % 2 ? 20 : 240,
      255,
    ]).flat(),
  ).buffer,
};
function render(effect: EffectInstance, near: boolean) {
  const fx = {
    ...effect,
    fieldImage: {
      source: {
        id: 'map',
        name: 'map.png',
        width: 1,
        height: 1,
        format: 'png' as const,
        hasAlpha: false,
      },
      png: '',
    },
  } as EffectInstance;
  const value = near ? 255 : 0;
  const map = { width: 1, height: 1, pixels: new Uint8Array([value, value, value, 255]).buffer };
  return new Uint8Array(
    renderEffects(image, [fx], { layerImages: new Map([['map', map]]) }).pixels,
  );
}
describe('Independent depth strengths', () => {
  it.each([true, false])('disables only the selected Push / Pull side (near=%s)', (near) => {
    const base = createEffect('depth-parallax', 'push') as DepthParallaxEffect;
    const effect = {
      ...base,
      params: {
        ...base.params,
        style: 'push-pull' as const,
        strength: 1,
        fieldSource: 'image' as const,
        fieldNormalize: 'off' as const,
      },
    };
    const disabled = {
      ...effect,
      params: { ...effect.params, ...(near ? { nearStrength: 0 } : { farStrength: 0 }) },
    };
    expect(render(disabled, near)).toEqual(new Uint8Array(image.pixels));
    const other = {
      ...effect,
      params: { ...effect.params, ...(near ? { farStrength: 0 } : { nearStrength: 0 }) },
    };
    expect(render(other, near)).toEqual(render(effect, near));
    expect(render(effect, near)).not.toEqual(new Uint8Array(image.pixels));
    expect(
      render({ ...effect, params: { ...effect.params, nearStrength: 2, farStrength: 2 } }, near),
    ).not.toEqual(render(effect, near));
  });
  it.each([true, false])('disables only the selected depth-blur side (near=%s)', (near) => {
    const base = createEffect('blur', 'blur') as BlurEffect;
    const effect = {
      ...base,
      params: {
        ...base.params,
        style: 'depth' as const,
        radius: 10,
        focusRange: 0,
        focusFalloff: 0,
        fieldSource: 'image' as const,
        fieldNormalize: 'off' as const,
      },
    };
    const disabled = {
      ...effect,
      params: { ...effect.params, ...(near ? { nearBlur: 0 } : { farBlur: 0 }) },
    };
    expect(render(disabled, near)).toEqual(new Uint8Array(image.pixels));
    const other = {
      ...effect,
      params: { ...effect.params, ...(near ? { farBlur: 0 } : { nearBlur: 0 }) },
    };
    expect(render(other, near)).toEqual(render(effect, near));
    expect(render(effect, near)).not.toEqual(new Uint8Array(image.pixels));
  });
  it('retains legacy strengths when optional controls are absent', () => {
    const push = createEffect('depth-parallax', 'push') as DepthParallaxEffect;
    const p = { ...push.params, style: 'push-pull' as const, fieldSource: 'image' as const };
    delete p.nearStrength;
    delete p.farStrength;
    expect(render({ ...push, params: p }, true)).toEqual(
      render({ ...push, params: { ...p, nearStrength: 1, farStrength: 1 } }, true),
    );
    const blur = createEffect('blur', 'blur') as BlurEffect;
    const b = { ...blur.params, style: 'depth' as const, fieldSource: 'image' as const };
    delete b.nearBlur;
    delete b.farBlur;
    expect(render({ ...blur, params: b }, false)).toEqual(
      render({ ...blur, params: { ...b, nearBlur: 1, farBlur: 1 } }, false),
    );
  });
});
