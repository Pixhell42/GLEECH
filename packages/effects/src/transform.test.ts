import { describe, expect, it } from 'vitest';
import { createEffect, type TransformEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const effect = (params: Partial<TransformEffect['params']> = {}): TransformEffect => {
  const e = createEffect('transform', 'move') as TransformEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const row = {
  width: 4,
  height: 1,
  pixels: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    .buffer,
};
const bytes = (image: { pixels: ArrayBuffer }) => Array.from(new Uint8Array(image.pixels));
describe('Transform', () => {
  it('keeps identity pixels exact, including hidden RGB', () => {
    const image = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([21, 89, 7, 0, 170, 20, 5, 1]).buffer,
    };
    expect(renderEffects(image, [effect()]).pixels).toBe(image.pixels);
  });
  it('translates to transparent canvas without dragging edge pixels', () => {
    expect(bytes(renderEffects(row, [effect({ positionX: 25 })]))).toEqual([
      0,
      0,
      0,
      0,
      ...bytes(row).slice(0, 12),
    ]);
  });
  it('offers distinct Extend, Tile and Mirror borders', () => {
    const first = (edges: TransformEffect['params']['edges']) =>
      bytes(renderEffects(row, [effect({ positionX: 50, edges })])).slice(0, 8);
    expect(first('extend')).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    expect(first('wrap')).toEqual([0, 0, 255, 255, 255, 255, 255, 255]);
    expect(first('mirror')).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  });
  it('aligns a half-size canvas to left or right', () => {
    const source = { width: 4, height: 4, pixels: new Uint8Array(64).fill(255).buffer };
    const alpha = (anchor: TransformEffect['params']['anchor']) =>
      bytes(renderEffects(source, [effect({ scale: 50, anchor })])).filter((_, i) => i % 4 === 3);
    expect(alpha('top-left')).toEqual([255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(alpha('bottom-right')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255]);
  });
  it('rotates clockwise around the center', () => {
    const source = { width: 2, height: 2, pixels: row.pixels };
    expect(bytes(renderEffects(source, [effect({ rotation: 90 })]))).toEqual([
      0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 255, 0, 255,
    ]);
  });
  it('interpolates transparent boundaries without dark halos', () => {
    const source = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]).buffer,
    };
    expect(bytes(renderEffects(source, [effect({ positionX: 25 })]))).toEqual([
      255, 0, 0, 128, 255, 0, 0, 128,
    ]);
  });
  it('uses static Application masks and opacity', () => {
    const e = {
      ...effect({ positionX: 25, amount: 0.5 }),
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    expect(bytes(renderEffects(row, [e]))).toEqual([
      255, 0, 0, 128, 128, 128, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
  });
  it('scales offsets using the original canvas reference', () => {
    expect(
      bytes(
        renderEffects(row, [effect({ positionX: 25 })], { reference: { width: 400, height: 100 } }),
      ),
    ).toEqual(bytes(renderEffects(row, [effect({ positionX: 25 })])));
  });
  it('renders identically asynchronously and cancels cooperatively', async () => {
    const e = effect({ rotation: 17, scale: 121, edges: 'wrap' });
    expect(await renderEffectsAsync(row, [e], { yieldControl: async () => {} })).toEqual(
      renderEffects(row, [e]),
    );
    await expect(
      renderEffectsAsync(row, [e], { isCancelled: () => true, yieldControl: async () => {} }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
