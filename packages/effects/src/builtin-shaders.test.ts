import { describe, expect, it } from 'vitest';
import {
  createEffect,
  assertEffect,
  createPaintedMask,
  type BuiltinShaderEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import {
  renderEffects,
  renderEffectsAsync,
  RenderCancelledError,
  builtinShaderInvocation,
} from './index';

const fixture = () => ({
  width: 19,
  height: 11,
  pixels: Uint8Array.from({ length: 19 * 11 * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 17) % 256,
  ).buffer,
});
const shader = (
  type: BuiltinShaderEffect['type'],
  params: Partial<BuiltinShaderEffect['params']> = {},
): BuiltinShaderEffect => {
  const effect = createEffect(type, 'shader-test') as BuiltinShaderEffect;
  return { ...effect, params: { ...effect.params, ...params } } as BuiltinShaderEffect;
};
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);

describe('original built-in shaders', () => {
  it.each([
    'shader-ripple',
    'shader-plasma',
    'shader-liquid-glass',
    'shader-iridescence',
    'shader-hologram',
    'shader-flow-field',
    'shader-caustics',
    'shader-liquid-chrome',
    'shader-heat-mirage',
    'shader-nebula',
  ] as const)('%s is a valid, deterministic and exactly looping still-frame recipe', (type) => {
    const image = fixture(),
      effect = shader(type);
    expect(() => assertEffect(effect)).not.toThrow();
    const run = (candidate = effect) =>
      bytes(renderEffects(image, [candidate], { masterSeed: 8172 }).pixels);
    expect(run()).toEqual(run());
    expect(run()).not.toEqual(bytes(image.pixels));
    expect(run(shader(type, { phase: 1 }))).toEqual(run());
    expect(run(shader(type, { phase: 0.25 }))).not.toEqual(run());
    expect(run({ ...effect, seedOffset: 1 })).not.toEqual(run());
    expect(run(shader(type, { amount: 0 }))).toEqual(bytes(image.pixels));
    expect(() => assertEffect(shader(type, { phase: 1.1 }))).toThrow();
  });
  it.each([
    'shader-ripple',
    'shader-liquid-glass',
    'shader-flow-field',
    'shader-liquid-chrome',
    'shader-heat-mirage',
  ] as const)(
    'keeps %s neutral refraction exact, including hidden colors, and supports all edge modes',
    (type) => {
      const image = fixture();
      expect(bytes(renderEffects(image, [shader(type, { strength: 0 })]).pixels)).toEqual(
        bytes(image.pixels),
      );
      const outputs = ['extend', 'wrap', 'mirror'].map((edgeHandling) =>
        bytes(
          renderEffects(image, [
            shader(type, {
              strength: 15,
              scale: 1,
              centerX: 0,
              centerY: 0,
              edgeHandling: edgeHandling as EdgeHandling,
            }),
          ]).pixels,
        ),
      );
      expect(outputs[0]).not.toEqual(outputs[1]);
      expect(outputs[1]).not.toEqual(outputs[2]);
    },
  );
  it.each(['shader-iridescence', 'shader-hologram', 'shader-caustics'] as const)(
    '%s preserves alpha and has an exact neutral intensity',
    (type) => {
      const image = fixture();
      const output = bytes(renderEffects(image, [shader(type)]).pixels);
      for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(bytes(image.pixels)[i]);
      expect(bytes(renderEffects(image, [shader(type, { strength: 0 })]).pixels)).toEqual(
        bytes(image.pixels),
      );
    },
  );
  it.each(['shader-plasma', 'shader-nebula'] as const)(
    '%s preserves source alpha unless Whole canvas is selected',
    (type) => {
      const image = fixture();
      const source = bytes(renderEffects(image, [shader(type)]).pixels);
      const opaque = bytes(renderEffects(image, [shader(type, { alpha: 'opaque' })]).pixels);
      for (let i = 3; i < source.length; i += 4) {
        expect(source[i]).toBe(bytes(image.pixels)[i]);
        expect(opaque[i]).toBe(255);
      }
    },
  );
  it.each([
    ['shader-caustics', { focus: 2, dispersion: 0.8 }],
    ['shader-liquid-chrome', { shine: 0, contrast: 4 }],
    ['shader-heat-mirage', { direction: 0, falloff: 0 }],
    ['shader-nebula', { detail: 1, core: 0 }],
  ] as const)('%s exposes controls that change its rendered structure', (type, params) => {
    const image = fixture();
    expect(bytes(renderEffects(image, [shader(type, params)]).pixels)).not.toEqual(
      bytes(renderEffects(image, [shader(type)]).pixels),
    );
  });
  it('masks the finished shader result rather than clipping its sampled source', () => {
    const image = fixture(),
      effect = shader('shader-ripple', { strength: 15 });
    const complete = bytes(renderEffects(image, [effect]).pixels);
    const limited = bytes(
      renderEffects(image, [
        { ...effect, application: { region: 'left', coverage: 0.5, softness: 0 } },
      ]).pixels,
    );
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        expect(limited.subarray(i, i + 4)).toEqual(
          (x < image.width / 2 ? complete : bytes(image.pixels)).subarray(i, i + 4),
        );
      }
    const paintedMask = createPaintedMask(image.width, image.height);
    expect(bytes(renderEffects(image, [{ ...effect, paintedMask }]).pixels)).toEqual(
      bytes(image.pixels),
    );
  });
  it('shares tint/blend/opacity finishing with the worker GPU hook and applies effects in order', async () => {
    const image = fixture(),
      first = shader('shader-plasma', {
        amount: 0.4,
        blendMode: 'screen',
        tintEnabled: 'on',
        tintStrength: 0.7,
        color: '#2080c0',
      });
    const second = {
      ...shader('shader-ripple', { phase: 0.37, amount: 0.7 }),
      instanceId: 'second',
      application: { region: 'top' as const, coverage: 0.7, softness: 0.3 },
    };
    const seen: ArrayBuffer[] = [];
    const result = await renderEffectsAsync(image, [first, second], {
      masterSeed: 8172,
      yieldControl: async () => {},
      renderShader: async (incoming, effect) => {
        seen.push(incoming.pixels.slice(0));
        await Promise.resolve();
        // Return only the raw program. The asynchronous pipeline owns finishing.
        return renderEffects(
          incoming,
          [
            {
              ...effect,
              params: { ...effect.params, amount: 1, blendMode: 'normal', tintEnabled: 'off' },
              application: { region: 'all', coverage: 1, softness: 0 },
            } as BuiltinShaderEffect,
          ],
          { masterSeed: 8172 },
        ).pixels;
      },
    });
    expect(seen).toHaveLength(2);
    expect(bytes(seen[0]!)).toEqual(bytes(image.pixels));
    expect(bytes(seen[1]!)).toEqual(
      bytes(renderEffects(image, [first], { masterSeed: 8172 }).pixels),
    );
    expect(bytes(result.pixels)).toEqual(
      bytes(renderEffects(image, [first, second], { masterSeed: 8172 }).pixels),
    );
  });
  it('propagates GPU failures, validates raw output length and cancels after pending GPU work', async () => {
    const image = fixture(),
      effect = shader('shader-ripple');
    const run = (
      renderShader: NonNullable<Parameters<typeof renderEffectsAsync>[2]['renderShader']>,
    ) => renderEffectsAsync(image, [effect], { renderShader, yieldControl: async () => {} });
    await expect(
      run(async () => {
        throw new Error('device lost');
      }),
    ).rejects.toThrow('device lost');
    await expect(run(async () => new ArrayBuffer(4))).rejects.toThrow('Invalid shader output');
    let cancelled = false;
    await expect(
      renderEffectsAsync(image, [effect], {
        isCancelled: () => cancelled,
        yieldControl: async () => {},
        renderShader: async () => {
          cancelled = true;
          return image.pixels;
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
  it('uses exact built-in CPU rendering when a mixed-backend executor declines a program', async () => {
    const image = fixture();
    const effects = [shader('shader-caustics', { amount: 0.6 }), shader('shader-heat-mirage')];
    const actual = await renderEffectsAsync(image, effects, {
      masterSeed: 8172,
      renderShader: async () => null,
      yieldControl: async () => {},
    });
    expect(bytes(actual.pixels)).toEqual(
      bytes(renderEffects(image, effects, { masterSeed: 8172 }).pixels),
    );
  });
  it('sends aspect, phase, seed and edge values in the shared finite f32 uniform layout', () => {
    const invocation = builtinShaderInvocation(
      shader('shader-ripple', { phase: 1, strength: 10, edgeHandling: 'wrap' }),
      42,
      { width: 100, height: 50 },
    );
    expect(invocation.program).toBe('ripple');
    expect(invocation.uniforms).toHaveLength(32);
    expect([...invocation.uniforms].every(Number.isFinite)).toBe(true);
    expect([...invocation.uniforms].slice(0, 3)).toEqual([2, 1, 8]);
    expect(invocation.uniforms[4]).toBe(0);
    expect(invocation.uniforms[8]).toBe(1);
  });
});
