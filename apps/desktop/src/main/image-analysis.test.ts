import { expect, it } from 'vitest';
import { analyzePixels } from './image-analysis';
it('counts alpha and excludes hidden RGB while retaining full source bounds/statistics', () => {
  const pixels = Uint8Array.from([
    255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 99, 99, 99, 0,
  ]).buffer;
  const result = analyzePixels({ width: 2, height: 2, pixels });
  expect(result).toMatchObject({
    visiblePixels: 2,
    opaquePixels: 1,
    transparentPixels: 2,
    partialAlphaPixels: 1,
    visibleBounds: { x: 0, y: 0, width: 1, height: 2 },
  });
  expect(result.meanAlpha).toBeCloseTo((1 + 128 / 255) / 4);
  expect(result.meanColor[1]).toBe(0);
  expect(result.histograms.green.reduce((sum, count) => sum + count, 0)).toBe(2);
  expect(result.histograms.alpha[0]).toBe(2);
  expect(analyzePixels({ width: 1, height: 1, pixels: new Uint8Array(4).buffer })).toMatchObject({
    visibleBounds: null,
    meanColor: [0, 0, 0],
    meanAlpha: 0,
  });
  expect(() => analyzePixels({ width: 2, height: 2, pixels: new Uint8Array(3).buffer })).toThrow();
});
