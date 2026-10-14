import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    ssr: 'src/main/mcp-stdio.ts',
    outDir: 'out/mcp',
    target: 'node22',
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { format: 'cjs', entryFileNames: 'server.cjs', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
