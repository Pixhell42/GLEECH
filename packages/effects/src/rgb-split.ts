import type { EdgeHandling, RgbSplitEffect } from '@gleech/project-model';

/** Keep this hot loop small so the runtime can optimize it independently of the stack dispatcher. */
export function* rgbSplitPixels(
  pixels: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  params: RgbSplitEffect['params'],
  edgeIndex: (value: number, size: number, mode: EdgeHandling) => number,
): Generator<void> {
  const dx = Math.round((width * params.horizontal) / 100);
  const dy = Math.round((height * params.vertical) / 100);
  const amount = params.amount;
  const edgeHandling = params.edgeHandling ?? 'extend';
  for (let y = 0; y < height; y++) {
    const redRow = edgeIndex(y - dy, height, edgeHandling) * width;
    const blueRow = edgeIndex(y + dy, height, edgeHandling) * width;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const red = (redRow + edgeIndex(x - dx, width, edgeHandling)) * 4;
      const blue = (blueRow + edgeIndex(x + dx, width, edgeHandling)) * 4;
      output[index] = Math.round(pixels[index]! * (1 - amount) + pixels[red]! * amount);
      output[index + 1] = pixels[index + 1]!;
      output[index + 2] = Math.round(
        pixels[index + 2]! * (1 - amount) + pixels[blue + 2]! * amount,
      );
      output[index + 3] = pixels[index + 3]!;
    }
    yield;
  }
}
