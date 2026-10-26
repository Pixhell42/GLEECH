import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMemoryBudget } from './render-memory';

const GiB = 1024 ** 3;
vi.mock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3, freemem: () => 64 * 1024 ** 2 }));
afterEach(() => vi.restoreAllMocks());

describe('render memory budget', () => {
  it('uses available memory including reclaimable pages instead of only unused pages', () => {
    vi.spyOn(process, 'availableMemory').mockReturnValue(4 * GiB);
    expect(renderMemoryBudget()).toEqual({
      totalRAMBytes: 8 * GiB,
      availableRAMBytes: 4 * GiB,
      availableGPUBytes: null,
    });
  });
  it('keeps a real zero-memory result and caps availability at physical RAM', () => {
    const available = vi.spyOn(process, 'availableMemory').mockReturnValue(0);
    expect(renderMemoryBudget().availableRAMBytes).toBe(0);
    available.mockReturnValue(10 * GiB);
    expect(renderMemoryBudget().availableRAMBytes).toBe(8 * GiB);
  });
});
