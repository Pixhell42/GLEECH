import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          '@gleech/project-model',
          '@gleech/effects',
          '@gleech/command-service',
          '@gleech/mcp',
        ],
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'image-worker': resolve('src/main/image-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'cli-gpu': resolve('src/preload/cli-gpu.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'cli-gpu': resolve('src/renderer/cli-gpu.html'),
        },
      },
    },
  },
});
