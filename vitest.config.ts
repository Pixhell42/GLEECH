import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

export default defineConfig({
  test: {
    // Render suites are CPU-heavy. Avoid starving cancellation checks or
    // allocating large image fixtures in one worker per logical processor.
    maxWorkers: process.env['CI'] ? 1 : Math.min(4, availableParallelism()),
    // Shared CI CPUs need room for functional tests with several exact renders.
    // Explicit performance assertions retain their own measured budgets.
    testTimeout: process.env['CI'] ? 15000 : 5000,
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/main/**/*.test.ts',
      'apps/desktop/src/cli/**/*.test.ts',
      'apps/desktop/src/renderer/**/*.test.ts',
    ],
    environment: 'node',
  },
});
