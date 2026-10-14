import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

export default defineConfig({
  test: {
    // Render suites are CPU-heavy. Avoid starving cancellation checks or
    // allocating large image fixtures in one worker per logical processor.
    maxWorkers: process.env['CI'] ? 1 : Math.min(4, availableParallelism()),
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/main/**/*.test.ts',
      'apps/desktop/src/renderer/**/*.test.ts',
    ],
    environment: 'node',
  },
});
