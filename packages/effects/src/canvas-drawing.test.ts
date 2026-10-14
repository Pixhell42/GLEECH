import { describe, it, expect } from 'vitest';
import {
  createEffect,
  createCanvasDrawing,
  DEFAULT_MASK_BRUSH,
  type SolidEffect,
} from '@gleech/project-model';
import { renderEffects } from './index';
const image = {
  width: 5,
  height: 5,
  pixels: Uint8Array.from({ length: 100 }, (_, i) => (i % 4 === 3 ? 0 : [20, 30, 40][i % 4]!))
    .buffer,
};
const layer = (): SolidEffect =>
  ({
    ...createEffect('solid', 'drawing'),
    type: 'solid',
    params: { ...createEffect('solid', 'drawing').params, content: 'drawing' },
    drawing: createCanvasDrawing(5, 5),
  }) as SolidEffect;
const center = (pixels: ArrayBuffer) => [...new Uint8Array(pixels).slice(48, 52)];
describe('color drawing layers', () => {
  it('preserves incoming pixels with an empty transparent drawing', () => {
    expect(renderEffects(image, [layer()]).pixels).toEqual(image.pixels);
  });
  it('paints color and opacity, erases to the incoming image and fills the canvas', () => {
    const effect = layer();
    const paint = {
      ...DEFAULT_MASK_BRUSH,
      size: 40,
      hardness: 1,
      opacity: 0.5,
      color: '#ff0000',
      points: [{ x: 0.5, y: 0.5 }],
    };
    expect(
      center(
        renderEffects(image, [{ ...effect, drawing: { ...effect.drawing!, strokes: [paint] } }])
          .pixels,
      ),
    ).toEqual([255, 0, 0, 128]);
    const erase = { ...paint, mode: 'erase' as const, opacity: 1 };
    const erased = renderEffects(image, [
      { ...effect, drawing: { ...effect.drawing!, baseColor: '#ff0000', strokes: [erase] } },
    ]);
    expect(center(erased.pixels)).toEqual([20, 30, 40, 0]);
    const filled = renderEffects(image, [
      { ...effect, drawing: { ...effect.drawing!, baseColor: '#102030' } },
    ]);
    expect(center(filled.pixels)).toEqual([16, 32, 48, 255]);
  });
  it('combines colored paths, feathering and per-effect masks after drawing', () => {
    const effect = layer();
    const drawing = {
      ...effect.drawing!,
      paths: [
        {
          id: 'rectangle',
          kind: 'polygon' as const,
          mode: 'paint' as const,
          opacity: 1,
          feather: 0,
          color: '#00ff00',
          nodes: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
      ],
    };
    const result = new Uint8Array(
      renderEffects(image, [
        { ...effect, drawing, application: { region: 'left', coverage: 0.4, softness: 0 } },
      ]).pixels,
    );
    expect([...result.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...result.slice(16, 20)]).toEqual([20, 30, 40, 0]);
  });
});
