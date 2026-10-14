import { describe, expect, it, vi } from 'vitest';
import { createEffect, type RecursiveSpaceEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const space = (params: Partial<RecursiveSpaceEffect['params']> = {}) => {
  const effect = createEffect('recursive-space', 'space') as RecursiveSpaceEffect;
  return { ...effect, params: { ...effect.params, ...params } };
};
function fixture(width = 41, height = 31) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 11) % 256, [0, 64, 128, 255][x % 4]!],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
const render = (image: ReturnType<typeof fixture>, effect: RecursiveSpaceEffect) =>
  new Uint8Array(renderEffects(image, [effect]).pixels);
const pixel = (pixels: Uint8Array, width: number, x: number, y: number) => [
  ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe('Recursive Space', () => {
  it('maps a corridor wall to known source coordinates with premultiplied alpha and caps its center', () => {
    const image = fixture(5, 5);
    const source = new Uint8Array(image.pixels);
    source.set([40, 30, 10, 64], (1 * 5 + 2) * 4);
    source.set([100, 90, 50, 192], (2 * 5 + 2) * 4);
    const out = render(image, space({ repetitionScale: 0.5, perspective: 0 }));
    // Top-center radius .8 lands 40% down the first wall: source (2,1.5).
    // Equal sample weights give alpha 128 and alpha-weighted RGB [85,75,40].
    expect(pixel(out, 5, 2, 0)).toEqual([85, 75, 40, 128]);
    expect(pixel(out, 5, 2, 2)).toEqual([100, 90, 50, 192]);
  });
  it('uses independent lattice coordinates and reflects alternating tiles', () => {
    const image = fixture(5, 5);
    const source = new Uint8Array(image.pixels);
    // At (3,0), u=.4,v=-.8. With two repeats, local UV=(.9,-.3).
    // Its fractional UV is (.9,.7), giving exact source pixel (4,3).
    const plain = space({
      style: 'lattice',
      symmetry: 2,
      twist: 0,
      perspective: 0,
      repetitionScale: 0.5,
      mirrorCopies: 'off',
    });
    expect(pixel(render(image, plain), 5, 3, 0)).toEqual(pixel(source, 5, 4, 3));
    // The odd negative vertical tile mirrors .7 to .3, yielding (4,1).
    expect(pixel(render(image, space({ ...plain.params, mirrorCopies: 'on' })), 5, 3, 0)).toEqual(
      pixel(source, 5, 4, 1),
    );
    // The second plane rotates by one 90-degree step, mapping (2,1) to (3,2).
    // Rotation stays constant across that plane rather than bending each tile.
    expect(pixel(render(image, space({ ...plain.params, twist: 90 })), 5, 2, 1)).toEqual(
      pixel(source, 5, 3, 2),
    );
  });
  it('renders distinct styles and responds to depth, spacing, placement, twist and image controls', () => {
    const image = fixture();
    const tunnel = render(image, space());
    const spiral = render(image, space({ style: 'spiral' }));
    const lattice = render(image, space({ style: 'lattice' }));
    expect(new Set([tunnel.join(','), spiral.join(','), lattice.join(',')]).size).toBe(3);
    for (const params of [
      { depth: 1 },
      { repetitionScale: 0.4 },
      { perspective: 0.9 },
      { centerX: 30 },
      { centerY: 70 },
      { rotation: 35 },
      { imageScale: 1.7 },
      { mirrorCopies: 'off' as const },
    ])
      expect(render(image, space(params))).not.toEqual(tunnel);
    for (const style of ['spiral', 'lattice'] as const) {
      const original = render(image, space({ style }));
      expect(render(image, space({ style, twist: -90 }))).not.toEqual(original);
      expect(render(image, space({ style, symmetry: 9 }))).not.toEqual(original);
    }
    expect(render(image, space({ twist: -90, symmetry: 9 }))).toEqual(tunnel);
  });
  it('applies all edge modes, bypasses zero Amount, and preserves untouched application regions', () => {
    const image = fixture();
    const outputs = ['extend', 'wrap', 'mirror'].map((edgeHandling) =>
      render(
        image,
        space({
          centerX: 0,
          centerY: 0,
          imageScale: 0.25,
          edgeHandling: edgeHandling as RecursiveSpaceEffect['params']['edgeHandling'],
        }),
      ),
    );
    expect(new Set(outputs.map((out) => out.join(','))).size).toBe(3);
    expect(renderEffects(image, [space({ amount: 0 })]).pixels).toBe(image.pixels);
    const masked = render(image, {
      ...space(),
      application: { region: 'top', coverage: 0.4, softness: 0 },
    });
    for (let y = 20; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        expect(pixel(masked, image.width, x, y)).toEqual(
          pixel(new Uint8Array(image.pixels), image.width, x, y),
        );
  });
  it('reproduces synchronous and cooperative renders independently of preview reference size', async () => {
    const image = fixture();
    for (const style of ['tunnel', 'spiral', 'lattice'] as const) {
      const effect = space({ style, depth: 24, repetitionScale: 0.3, perspective: 1, twist: 180 });
      const out = render(image, effect);
      expect(out).toEqual(render(image, effect));
      expect(
        new Uint8Array(
          (await renderEffectsAsync(image, [effect], { yieldControl: async () => {} })).pixels,
        ),
      ).toEqual(out);
      expect(
        new Uint8Array(
          renderEffects(image, [effect], {
            reference: { width: image.width * 10, height: image.height * 10 },
          }).pixels,
        ),
      ).toEqual(out);
    }
    let cancelled = false;
    let time = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (time += 9));
    try {
      await expect(
        renderEffectsAsync(image, [space()], {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    } finally {
      clock.mockRestore();
    }
  });
});
