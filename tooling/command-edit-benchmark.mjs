import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { modelUrl } from './effects-reference.mjs';

async function moduleUrl(file, replacements = {}) {
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const settings = await moduleUrl('packages/command-service/src/settings-clipboard.ts', {
  '@gleech/project-model': modelUrl,
});
const gleech = await moduleUrl('packages/command-service/src/gleech.ts', {
  '@gleech/project-model': modelUrl,
});
const serviceUrl = await moduleUrl('packages/command-service/src/index.ts', {
  '@gleech/project-model': modelUrl,
  './settings-clipboard': settings,
  './gleech': gleech,
});
const { createCommandService } = await import(serviceUrl);
const { createProject, createEffect, createPaintedMask, DEFAULT_MASK_BRUSH } = await import(
  modelUrl
);
const effects = Array.from({ length: 40 }, (_, i) => ({
  ...createEffect('rgb-split', `effect-${i}`),
  paintedMask: {
    ...createPaintedMask(4000, 3000),
    strokes: Array.from({ length: 10 }, () => ({
      ...DEFAULT_MASK_BRUSH,
      points: Array.from({ length: 100 }, (_, j) => ({ x: j / 100, y: 0.5 })),
    })),
  },
}));
const project = {
  ...createProject('Benchmark'),
  source: {
    id: 'source',
    name: 'fixture.png',
    width: 4000,
    height: 3000,
    format: 'png',
    hasAlpha: true,
  },
  effects,
};
const service = createCommandService(project);
const original = service.getState();
service.beginHistoryGroup();
const measurements = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  service.updateEffect('effect-39', { application: { coverage: (i + 1) / 101 } });
  measurements.push(performance.now() - start);
}
service.endHistoryGroup();
service.undo();
assert.equal(service.getState(), original);
service.redo();
assert.equal(service.getState().effects[39].application.coverage, 100 / 101);
measurements.sort((a, b) => a - b);
const report = {
  layers: 40,
  maskPoints: 40000,
  edits: 100,
  medianMs: measurements[50],
  p95Ms: measurements[95],
  undoRedo: true,
};
const phase = process.argv.includes('--before') ? 'before' : 'after';
await mkdir('test-results/command-edit', { recursive: true });
await writeFile(`test-results/command-edit/${phase}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
