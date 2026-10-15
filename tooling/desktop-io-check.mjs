import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { installTestIOTracing } from './test-io-tracing.mjs';
import { recordDesktopFailure } from './record-desktop-failure.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/desktop-io');
await mkdir(output, { recursive: true });
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const input = resolve(output, 'source.png');
await sharp({ create: { width: 32, height: 16, channels: 4, background: '#e6c45d' } })
  .png()
  .toFile(input);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    resolve(root, 'apps/desktop'),
    '--smoke-test',
    '--disable-gpu',
    '--disable-software-rasterizer',
  ],
  env,
  timeout: 30000,
});
let page,
  checkpoint = 'startup';
const errors = [];
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('File operation timed out at ' + checkpoint)),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const unwrap = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.value;
};
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await installTestIOTracing(app);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, input);
  checkpoint = 'read image';
  const imported = unwrap(await bounded(page.evaluate(() => window.gleech.openImage())));
  const project = {
    schemaVersion: 2,
    name: 'File IO check',
    masterSeed: 8172,
    source: imported.source,
    origin: null,
    sourceSnapshotId: null,
    effects: [],
    snapshots: [],
  };
  for (let index = 0; index < 20; index++) {
    const path = resolve(output, `round-${index % 2}.gleech`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, path);
    checkpoint = `save ${index}`;
    const saved = unwrap(
      (
        await bounded(
          Promise.all([
            page.evaluate((value) => window.gleech.saveProject(value, null, true), project),
            page.evaluate(() => window.gleech.listRecentProjects()),
            page.evaluate(() => window.gleech.listRecentProjects()),
          ]),
        )
      )[0],
    );
    assert.ok((await readFile(path)).subarray(0, 8).equals(Buffer.from('GLEECH02')));
    checkpoint = `recents ${index}`;
    const recents = unwrap(await bounded(page.evaluate(() => window.gleech.listRecentProjects())));
    assert.equal(recents[0].name, saved.name);
    checkpoint = `reopen ${index}`;
    const opened = unwrap(await bounded(page.evaluate(() => window.gleech.openProject())));
    assert.equal(opened.project.masterSeed, 8172);
    console.log('File IO round', index + 1, 'passed');
  }
  assert.deepEqual(errors, []);
  console.log('Desktop file IO: 20 save/Recents/reopen rounds passed.');
} catch (failure) {
  await recordDesktopFailure({ app, page, output, label: 'io', failure, errors }).catch((error) =>
    console.error(error.message),
  );
  throw failure;
} finally {
  await closeTestApp(app);
}
