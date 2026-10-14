import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  type ChannelTransformEffect,
  type TemporalEchoEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const channel = (
  params: Partial<ChannelTransformEffect['params']> = {},
): ChannelTransformEffect => {
  const e = createEffect('channel-transform', 'channels') as ChannelTransformEffect;
  return { ...e, params: { ...e.params, redX: 0, blueX: 0, ...params } };
};
const echo = (params: Partial<TemporalEchoEffect['params']> = {}): TemporalEchoEffect => {
  const e = createEffect('temporal-echo', 'echo') as TemporalEchoEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const image = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
) => ({
  width,
  height,
  pixels: Uint8Array.from(
    { length: width * height * 4 },
    (_, i) => pixel(Math.floor(i / 4) % width, Math.floor(i / 4 / width))[i % 4]!,
  ).buffer,
});
const render = (source: ReturnType<typeof image>, e: ChannelTransformEffect | TemporalEchoEffect) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 17 }).pixels);
const at = (out: Uint8Array, x: number, y: number, width: number) => [
  ...out.slice((y * width + x) * 4, (y * width + x + 1) * 4),
];
const point = image(7, 5, (x, y) =>
  x === 2 && y === 2 ? [200, 100, 50, 255] : [250, 250, 250, 0],
);

describe('Channel Transform / Crossfeed', () => {
  it('bypasses exact neutral recipes but retains shared finishing', () => {
    const source = image(5, 5, () => [100, 50, 150, 128]);
    expect(render(source, channel())).toEqual(new Uint8Array(source.pixels));
    expect(render(source, channel({ redSource: 'blue', crossfeed: 0 }))).toEqual(
      new Uint8Array(source.pixels),
    );
    expect(
      at(
        render(source, channel({ tintEnabled: 'on', color: '#ff0000', tintStrength: 1 })),
        0,
        0,
        5,
      ),
    ).toEqual([100, 0, 0, 128]);
  });
  it('routes, duplicates and partially mixes channels without darkening partial alpha', () => {
    const source = image(5, 5, () => [100, 50, 150, 128]);
    expect(
      at(
        render(source, channel({ redSource: 'green', greenSource: 'blue', blueSource: 'red' })),
        0,
        0,
        5,
      ),
    ).toEqual([50, 150, 100, 128]);
    expect(
      at(render(source, channel({ redSource: 'green', blueSource: 'green' })), 0, 0, 5),
    ).toEqual([50, 50, 50, 128]);
    expect(at(render(source, channel({ redSource: 'blue', crossfeed: 0.5 })), 0, 0, 5)).toEqual([
      125, 50, 150, 128,
    ]);
    expect(at(render(source, channel({ redSource: 'luma' })), 0, 0, 5)).toEqual([76, 50, 150, 128]);
  });
  it('independently translates, scales, rotates and mirrors channels around the pivot', () => {
    const source = image(5, 5, (x, y) => [30 * x + 5 * y, 40 * y, 100, 255]);
    expect(at(render(source, channel({ redX: 20 })), 2, 2, 5)).toEqual([40, 80, 100, 255]);
    expect(at(render(source, channel({ redY: 20 })), 2, 2, 5)).toEqual([65, 80, 100, 255]);
    expect(at(render(source, channel({ redScale: 200 })), 4, 2, 5)).toEqual([100, 80, 100, 255]);
    expect(at(render(source, channel({ redRotation: 90 })), 3, 2, 5)).toEqual([65, 80, 100, 255]);
    expect(at(render(source, channel({ redMirror: 'horizontal' })), 1, 2, 5)).toEqual([
      100, 80, 100, 255,
    ]);
    expect(at(render(source, channel({ redMirror: 'vertical' })), 1, 1, 5)).toEqual([
      45, 40, 100, 255,
    ]);
    expect(at(render(source, channel({ redMirror: 'horizontal', centerX: 0 })), 1, 2, 5)).toEqual([
      10, 80, 100, 255,
    ]);
  });
  it('samples each edge mode and excludes transparent hidden colors', () => {
    const source = image(5, 5, (x) => [x * 40, 50, 100, 255]);
    expect(at(render(source, channel({ redX: 20, edgeHandling: 'extend' })), 0, 0, 5)[0]).toBe(0);
    expect(at(render(source, channel({ redX: 20, edgeHandling: 'wrap' })), 0, 0, 5)[0]).toBe(160);
    expect(at(render(source, channel({ redX: 40, edgeHandling: 'mirror' })), 0, 0, 5)[0]).toBe(40);
    const alpha = image(5, 5, (x) => (x % 2 ? [255, 255, 255, 0] : [100, 30, 10, 255]));
    const out = render(alpha, channel({ redX: 10 }));
    expect(at(out, 2, 0, 5)).toEqual([50, 30, 10, 255]);
    expect(at(out, 1, 0, 5)).toEqual([255, 255, 255, 0]);
  });
  it('respects Opacity and application masks', () => {
    const source = image(5, 5, () => [100, 50, 150, 255]);
    expect(at(render(source, channel({ redSource: 'green', amount: 0.5 })), 0, 0, 5)[0]).toBe(75);
    const e = {
      ...channel({ redSource: 'green' }),
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    const out = render(source, e);
    expect(at(out, 0, 0, 5)[0]).toBe(50);
    expect(at(out, 4, 0, 5)[0]).toBe(100);
  });
});

describe('Temporal Echo for stills', () => {
  it('has exact neutral bypasses and retains active finishing', () => {
    for (const e of [
      echo({ strength: 0 }),
      echo({ amount: 0 }),
      echo({ spacing: 0, scaleStep: 1, rotationStep: 0 }),
      { ...echo(), enabled: false },
    ])
      expect(render(point, e)).toEqual(new Uint8Array(point.pixels));
    expect(
      at(
        render(point, echo({ strength: 0, tintEnabled: 'on', color: '#ff0000', tintStrength: 1 })),
        2,
        2,
        7,
      ),
    ).toEqual([200, 0, 0, 255]);
  });
  it('places independent copies with geometric opacity falloff and preserves the original', () => {
    const out = render(
      point,
      echo({ copies: 3, spacing: 20, direction: 0, strength: 0.5, falloff: 0.5 }),
    );
    expect(at(out, 2, 2, 7)).toEqual([200, 100, 50, 255]);
    expect(at(out, 3, 2, 7)).toEqual([200, 100, 50, 128]);
    expect(at(out, 4, 2, 7)).toEqual([200, 100, 50, 64]);
    expect(at(out, 5, 2, 7)).toEqual([200, 100, 50, 32]);
    expect(at(out, 0, 0, 7)).toEqual([250, 250, 250, 0]);
  });
  it('composites far copies first using premultiplied source-over rather than feedback', () => {
    const source = image(7, 5, (x) => [40 * x, 50, 100, 255]);
    expect(
      at(
        render(source, echo({ copies: 2, spacing: 20, direction: 0, strength: 0.5, falloff: 0.5 })),
        4,
        2,
        7,
      ),
    ).toEqual([130, 50, 100, 255]);
  });
  it('cycles color-separated echoes from the selected first channel', () => {
    const p = {
      style: 'color-separated' as const,
      copies: 2,
      spacing: 20,
      direction: 0,
      strength: 1,
      falloff: 1,
    };
    const out = render(point, echo(p));
    expect(at(out, 3, 2, 7)).toEqual([200, 0, 0, 255]);
    expect(at(out, 4, 2, 7)).toEqual([0, 100, 0, 255]);
    expect(at(render(point, echo({ ...p, channelStart: 'blue' })), 3, 2, 7)).toEqual([
      0, 0, 50, 255,
    ]);
  });
  it('colors silhouettes with solid or multi-stop gradients fixed to the output canvas', () => {
    const p = {
      style: 'silhouette' as const,
      copies: 1,
      spacing: 20,
      direction: 0,
      strength: 1,
      echoColor: '#ff0000',
    };
    expect(at(render(point, echo(p)), 3, 2, 7)).toEqual([255, 0, 0, 255]);
    const gradient = echo({
      ...p,
      echoColorMode: 'gradient',
      echoColorEnd: '#0000ff',
      echoColorStops:
        '[{"position":0,"color":"#ff0000"},{"position":0.5,"color":"#00ff00"},{"position":1,"color":"#0000ff"}]',
    });
    expect(at(render(point, gradient), 3, 2, 7)).toEqual([0, 255, 0, 255]);
  });
  it('clips copies with transparent edges or deliberately wraps them when unclipped', () => {
    const edge = image(7, 5, (x, y) => (x === 6 && y === 2 ? [100, 50, 30, 255] : [0, 0, 0, 0]));
    const p = { copies: 1, spacing: 20, direction: 0, strength: 1, edgeHandling: 'wrap' as const };
    expect(at(render(edge, echo(p)), 0, 2, 7)).toEqual([0, 0, 0, 0]);
    expect(at(render(edge, echo({ ...p, clipCopies: 'off' })), 0, 2, 7)).toEqual([
      100, 50, 30, 255,
    ]);
  });
  it('does not introduce hidden-color fringes along translucent ghost edges', () => {
    const out = render(point, echo({ spacing: 15, direction: 0, strength: 0.7, copies: 1 }));
    for (let i = 0; i < out.length; i += 4)
      if (out[i + 3]! > 0) expect([...out.slice(i, i + 3)]).toEqual([200, 100, 50]);
  });
  it('replays seeded jitter deterministically and responds to New pattern', () => {
    const e = echo({ jitter: 0.7, copies: 5, spacing: 20 });
    expect(render(point, e)).toEqual(render(point, e));
    expect(render(point, { ...e, seedOffset: 1 })).not.toEqual(render(point, e));
    expect(render(point, echo({ jitter: 0 }))).toEqual(
      render(point, { ...echo({ jitter: 0 }), seedOffset: 1 }),
    );
  });
});

describe('channel/echo integration', () => {
  it('keeps proportional transforms across full/reduced reference dimensions and handles narrow images', () => {
    const source = image(7, 5, (x, y) => [x * 30, y * 40, 100, 128]);
    for (const e of [
      channel({ redX: 12, blueRotation: 30, greenMirror: 'both' }),
      echo({ copies: 8, scaleStep: 0.94, rotationStep: 7, jitter: 0.4 }),
    ]) {
      const ref = renderEffects(source, [e], {
        masterSeed: 17,
        reference: { width: 70, height: 50 },
      });
      const native = render(source, e);
      expect([...new Uint8Array(ref.pixels)].every((v, i) => Math.abs(v - native[i]!) <= 1)).toBe(
        true,
      );
      for (const [w, h] of [
        [1, 1],
        [1, 100],
        [100, 1],
      ])
        expect(
          render(
            image(w!, h!, () => [50, 100, 150, 255]),
            e,
          ),
        ).toHaveLength(w! * h! * 4);
    }
  });
  it('rejects invalid controls and agrees in synchronous/asynchronous rendering', async () => {
    expect(() => assertEffect(channel({ redScale: 0 }))).toThrow();
    expect(() => assertEffect(echo({ copies: 25 }))).toThrow();
    expect(() => assertEffect(echo({ scaleStep: 0 }))).toThrow();
    const source = image(80, 60, (x, y) => [x * 3, y * 4, 150, 128]);
    const effects = [
      channel({ redRotation: 25 }),
      echo({ copies: 8, scaleStep: 0.96, rotationStep: 4, jitter: 0.4 }),
    ];
    const sync = renderEffects(source, effects, { masterSeed: 17 });
    const async = await renderEffectsAsync(source, effects, {
      masterSeed: 17,
      yieldControl: async () => {},
    });
    expect(new Uint8Array(async.pixels)).toEqual(new Uint8Array(sync.pixels));
  });
  it('cooperatively cancels large channel transforms and maximum-count echoes', async () => {
    const source = image(1024, 1024, () => [100, 50, 150, 255]);
    for (const e of [
      channel({ redRotation: 30, greenScale: 110 }),
      echo({ copies: 24, falloff: 1, rotationStep: 4 }),
    ]) {
      let cancelled = false;
      await expect(
        renderEffectsAsync(source, [e], {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
