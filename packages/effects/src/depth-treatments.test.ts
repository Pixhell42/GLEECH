import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  DEPTH_TREATMENT_DEFAULTS,
  type DepthFieldEffect,
} from '@gleech/project-model';
import { renderEffects } from './index';
const effect = (params: Partial<DepthFieldEffect['params']> = {}): DepthFieldEffect => {
  const e = createEffect('depth-field', 'depth') as DepthFieldEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const source = {
  width: 97,
  height: 73,
  pixels: Uint8Array.from({ length: 97 * 73 * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : 128,
  ).buffer,
};
const render = (e: DepthFieldEffect) => new Uint8Array(renderEffects(source, [e]).pixels);
describe('Expanded contour and relief treatments', () => {
  it('retains the original version-one relief formula for recipes omitting new controls', () => {
    const base = effect({
      operation: 'relief',
      fieldSource: 'linear',
      fieldScale: 100,
      lightAngle: 0,
      relief: 1,
    });
    const params = { ...base.params };
    for (const key of Object.keys(DEPTH_TREATMENT_DEFAULTS))
      delete params[key as keyof typeof DEPTH_TREATMENT_DEFAULTS];
    const legacy = { ...base, params };
    expect(() => assertEffect(legacy)).not.toThrow();
    const square = { width: 33, height: 33, pixels: new Uint8Array(33 * 33 * 4).fill(128).buffer };
    const bytes = new Uint8Array(renderEffects(square, [legacy]).pixels);
    const expected = Math.round((128 * (0.8 - 0.7)) / Math.sqrt(2) / 0.8);
    expect(Math.abs(bytes[(16 * 33 + 16) * 4]! - expected)).toBeLessThanOrEqual(1);
    expect(Object.hasOwn(legacy.params, 'ambient')).toBe(false);
    expect(() =>
      assertEffect({
        ...legacy,
        params: { ...params, ambient: undefined },
      } as unknown as DepthFieldEffect),
    ).toThrow();
  });
  it('moves and feathers contour bands without changing field generation or alpha', () => {
    const base = effect({
      operation: 'contours',
      fieldSource: 'radial',
      strength: 0,
      contourWidth: 0.3,
    });
    const out = render(base);
    for (const changes of [{ contourOffset: 0.4 }, { contourSoftness: 1 }]) {
      const changed = render(effect({ ...base.params, ...changes }));
      expect(changed).not.toEqual(out);
      for (let i = 3; i < out.length; i += 4)
        expect(changed[i]).toBe(new Uint8Array(source.pixels)[i]);
    }
    const field = effect({ ...base.params, operation: 'field' });
    expect(render(effect({ ...field.params, contourOffset: 0.4, contourSoftness: 1 }))).toEqual(
      render(field),
    );
  });
  it('creates lit terraces with independently adjustable bevel, lighting and highlights', () => {
    const base = effect({
      operation: 'terraces',
      fieldSource: 'radial',
      contourCount: 7,
      terraceBevel: 0.2,
      relief: 2,
    });
    const out = render(base),
      input = new Uint8Array(source.pixels);
    expect(out).not.toEqual(render(effect({ ...base.params, operation: 'relief' })));
    for (const changes of [
      { terraceBevel: 1 },
      { contourOffset: 0.5 },
      { lightElevation: 10 },
      { lightAngle: 90 },
      { ambient: 1 },
      { highlights: 0.7 },
    ])
      expect(render(effect({ ...base.params, ...changes }))).not.toEqual(out);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(input[i]);
    expect(render(effect({ ...base.params, amount: 0 }))).toEqual(input);
    const flat = effect({ ...base.params, relief: 0 });
    expect(render(flat)).toEqual(input);
  });
});
