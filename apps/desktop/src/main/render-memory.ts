import { freemem, totalmem } from 'node:os';
import type { RenderMemoryBudget } from '../shared/render-safety';

export function renderMemoryBudget(): RenderMemoryBudget {
  return { totalRAMBytes: totalmem(), availableRAMBytes: freemem(), availableGPUBytes: null };
}
