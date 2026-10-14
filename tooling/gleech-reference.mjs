import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { modelUrl } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function code(path) {
  return ts.transpileModule(await readFile(resolve(root, path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
}
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const engine = url(
  (await code('packages/command-service/src/gleech.ts')).replace('@gleech/project-model', modelUrl),
);
export const { generateVariations } = await import(engine);
