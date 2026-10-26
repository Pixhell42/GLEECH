import { totalmem } from 'node:os';
import type { RenderMemoryBudget } from '../shared/render-safety';

export function renderMemoryBudget(): RenderMemoryBudget {
  const totalRAMBytes = totalmem();
  return {
    totalRAMBytes,
    // Unlike freemem(), libuv's availability estimate includes reclaimable
    // inactive/purgeable pages on macOS and honors Linux memory constraints.
    availableRAMBytes: Math.min(totalRAMBytes, process.availableMemory()),
    availableGPUBytes: null,
  };
}
