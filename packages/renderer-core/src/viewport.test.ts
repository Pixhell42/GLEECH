import { describe, expect, it } from 'vitest';
import { fitImage, zoomAt } from './viewport';

describe('viewport geometry', () => {
  it('centers a large image without cropping at fit', () => {
    const view = fitImage({ width: 4096, height: 3072 }, { width: 900, height: 600 });
    expect(view.x).toBeGreaterThanOrEqual(40);
    expect(view.y).toBeGreaterThanOrEqual(40);
    expect(view.x + 4096 * view.scale).toBeLessThanOrEqual(860);
    expect(view.y + 3072 * view.scale).toBeLessThanOrEqual(560);
  });

  it('preserves the image coordinate under the pointer when zooming', () => {
    const before = { scale: 0.25, x: 100, y: 40 };
    const point = { x: 310, y: 230 };
    const after = zoomAt(before, 0.9, point);
    expect((point.x - after.x) / after.scale).toBeCloseTo((point.x - before.x) / before.scale);
    expect((point.y - after.y) / after.scale).toBeCloseTo((point.y - before.y) / before.scale);
    expect(zoomAt(after, 100, point).scale).toBe(16);
    expect(zoomAt(after, 0, point).scale).toBe(1 / 128);
  });
});
