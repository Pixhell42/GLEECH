import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Native-codec integration oracle, also used to render the library thumbnail.
// Codec unit tests independently compare this implementation with direct Sharp.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const source = await readFile(
  new URL('../apps/desktop/src/main/jpeg-codec.ts', import.meta.url),
  'utf8',
);
const code = ts
  .transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  .outputText.replace("'sharp'", JSON.stringify(pathToFileURL(require.resolve('sharp')).href));
export const { recompressJpeg } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
