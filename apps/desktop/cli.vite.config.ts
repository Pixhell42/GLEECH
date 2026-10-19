import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// The terminal CLI/TUI bundles the shared packages like the MCP server. Native
// codecs (Sharp, ONNX Runtime) are resolved at runtime from the workspace or
// the packaged app, so the bundle itself has no npm dependencies.
export default defineConfig({
  build: {
    ssr: 'src/cli/index.ts',
    outDir: 'out/cli',
    target: 'node22',
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'gleech.cjs',
        inlineDynamicImports: true,
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: { noExternal: true },
});
