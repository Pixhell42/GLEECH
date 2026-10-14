import { describe, expect, it } from 'vitest';
import { depthPreviewPixels } from '../renderer/src/depth-preview';
describe('Depth preview presentation', () => {
  const field = {
    width: 3,
    height: 1,
    pixels: new Uint8Array([0, 0, 0, 0, 128, 128, 128, 0, 255, 255, 255, 0]).buffer,
  };
  const source = { width: 1, height: 1, pixels: new Uint8Array([100, 120, 140, 255]).buffer };
  it('shows grayscale and a near/far color legend without modifying height data', () => {
    const before = field.pixels.slice(0);
    expect([...depthPreviewPixels(field, source, 'grayscale')]).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]);
    const colors = depthPreviewPixels(field, source, 'false-color');
    expect([...colors.slice(0, 4)]).toEqual([40, 50, 190, 255]);
    expect([...colors.slice(8)]).toEqual([240, 40, 40, 255]);
    expect(field.pixels).toEqual(before);
  });
  it('overlays on the stage source and ignores hidden source RGB', () => {
    expect([...depthPreviewPixels(field, source, 'overlay').slice(0, 4)]).toEqual([
      70, 85, 165, 255,
    ]);
    const hidden = { ...source, pixels: new Uint8Array([255, 0, 255, 0]).buffer };
    expect([...depthPreviewPixels(field, hidden, 'overlay').slice(0, 4)]).toEqual([
      60, 65, 135, 255,
    ]);
  });
});
