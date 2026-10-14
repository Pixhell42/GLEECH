import { PaintedMaskRasterizer, renderPaintedMaskAsync } from '@gleech/effects';
import type { PaintedMask } from '@gleech/project-model';

interface OverlayRequest {
  mask: PaintedMask;
  width: number;
  height: number;
}
const rasterizer = new PaintedMaskRasterizer();
let pending: OverlayRequest | null = null;
let running = false;
const channel = new MessageChannel();
const yields: (() => void)[] = [];
channel.port1.onmessage = () => yields.shift()?.();
const yieldControl = () =>
  new Promise<void>((resolve) => {
    yields.push(resolve);
    channel.port2.postMessage(null);
  });
self.onmessage = (event: MessageEvent<OverlayRequest>) => {
  // Finish a frame while retaining only the latest pointer sample. Continuous
  // painting must not repeatedly cancel rasterization before it can display.
  pending = event.data;
  if (running) return;
  running = true;
  void (async () => {
    try {
      while (pending) {
        const { mask, width, height } = pending;
        pending = null;
        const values = await renderPaintedMaskAsync(mask, width, height, {
          rasterizer,
          yieldControl,
          isCancelled: () => false,
        });
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < values!.length; i++) {
          pixels[i * 4] = 240;
          pixels[i * 4 + 1] = pixels[i * 4 + 2] = 75;
          pixels[i * 4 + 3] = Math.round((1 - values![i]!) * 85);
        }
        self.postMessage({ width, height, pixels: pixels.buffer }, { transfer: [pixels.buffer] });
      }
    } finally {
      running = false;
    }
  })();
};
