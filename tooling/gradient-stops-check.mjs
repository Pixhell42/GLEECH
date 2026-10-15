import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/gradient-stops');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 129,
  height = 97;
const pixels = Buffer.from(
  Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
  ),
);
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const launch = () =>
  electron.launch({
    args: [
      ...(exe ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(exe ? { executablePath: resolve(exe) } : {}),
  });
let app = await launch(),
  page,
  exports = 0;
const errors = [];
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(
    () => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    },
    undefined,
    { timeout: 60000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
}
async function open(path, action) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, action);
  await settle();
}
async function savePath(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function exportExact() {
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(path) })
    .waitFor({ timeout: 60000 });
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: Uint8Array.from(pixels).buffer }, state.effects, {
          masterSeed: state.masterSeed,
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Gradient Map', exact: true })
    .click();
  const editor = page.locator('.gradient-stop-editor');
  const add = editor.getByRole('button', { name: 'Add stop', exact: true });
  await add.click();
  assert.equal(await editor.locator('.gradient-stop').count(), 3);
  const color = editor.getByRole('textbox', {
    name: 'Gradient Map tonal ramp stop color hex',
    exact: true,
  });
  await color.fill('#00ff00');
  await color.press('Enter');
  await settle();
  const before = await recipe();
  const handle = editor.getByRole('button', {
    name: 'Gradient Map tonal ramp stop 2',
    exact: true,
  });
  const bounds = await handle.boundingBox();
  const track = await editor.locator('.gradient-stop-track').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.25, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  const moved = await recipe();
  const stops = JSON.parse(moved.effects[0].params.shadowsStops);
  assert.ok(Math.abs(stops[1].position - 0.25) < 0.015);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), moved);
  await editor
    .locator('.gradient-stop-track')
    .click({ position: { x: track.width * 0.75, y: 10 } });
  assert.equal(await editor.locator('.gradient-stop').count(), 4);
  await editor.getByRole('button', { name: 'Remove stop', exact: true }).click();
  assert.equal(await editor.locator('.gradient-stop').count(), 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await editor.locator('.gradient-stop').count(), 4);
  await exportExact();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await editor.scrollIntoViewIfNeeded();
  assert.ok(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth));
  await captureTestWindow(app, resolve(output, `${label}-editor.png`));
  const saved = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await page.getByRole('status').filter({ hasText: 'Saved ' }).waitFor();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  assert.deepEqual(await recipe(), saved);
  assert.equal(await page.locator('.gradient-stop').count(), 4);
  await exportExact();
  for (let i = 4; i < 16; i++)
    await page.getByRole('button', { name: 'Add stop', exact: true }).click();
  assert.equal(await page.locator('.gradient-stop').count(), 16);
  assert.equal(
    await page.getByRole('button', { name: 'Add stop', exact: true }).isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      dragUndo: true,
      addRemove: true,
      projectRestart: true,
      maxStops: 16,
    }),
  );
  console.log(
    `${label}: multi-stop gradient controls passed, ${exports} exact exports and restart.`,
  );
} finally {
  await closeTestApp(app);
}
