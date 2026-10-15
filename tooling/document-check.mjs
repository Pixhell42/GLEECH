import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/document-check');
await mkdir(output, { recursive: true });
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const image = resolve(output, `${label}.png`);
const project = resolve(output, `${label}.gleech`);
await sharp({
  create: { width: 17, height: 11, channels: 4, background: { r: 120, g: 80, b: 30, alpha: 0.5 } },
})
  .png()
  .toFile(image);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: resolve(output, `${label}-profile`) };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.GLEECH_SMOKE_USER_DATA, { recursive: true });
const launch = () =>
  electron.launch({
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    timeout: 30000,
  });
let app, page;
const errors = [];
const status = (text) =>
  page
    .locator('.status-bar')
    .getByRole('status')
    .filter({ hasText: text })
    .waitFor({ timeout: 15000 });
async function start() {
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
}
async function open(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
}
async function save(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, args) => {
      dialog.showSaveDialog = async () => ({ canceled: args.canceled, filePath: args.path });
    },
    { path, canceled },
  );
}
async function close() {
  const closed = page.waitForEvent('close', { timeout: 15000 });
  await fileAction(page, 'Exit GLEECH Alt+F4');
  await closed;
  await app.close();
}
async function settle() {
  await page.waitForFunction(() => {
    const d = document.querySelector('.image-layer').dataset;
    return (
      d.renderRevision === d.requestedRevision &&
      !document.querySelector('.detail-loading') &&
      !document.querySelector('.operation-banner')
    );
  });
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((el) => JSON.parse(el.dataset.renderRecipe));
}
try {
  await start();
  await open(image);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status(`Opened ${label}.png`);
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'RGB split', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Horizontal shift', exact: true }).fill('2');
  const first = await recipe();
  await save(project);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  await close();
  assert.ok((await readFile(project)).subarray(0, 8).equals(Buffer.from('GLEECH02')));
  await start();
  await open(project);
  await page.keyboard.press('Control+o');
  await status(`Opened ${label}.gleech`);
  assert.deepEqual(await recipe(), first);
  assert.ok(!(await page.title()).startsWith('•'));
  await page.getByRole('slider', { name: 'Horizontal shift', exact: true }).fill('3');
  const second = await recipe();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showSaveDialog = async () => {
      throw new Error('Close Save must reuse the current document handle.');
    };
  });
  await close();
  await start();
  await open(project);
  await page.keyboard.press('Control+o');
  await status(`Opened ${label}.gleech`);
  assert.deepEqual(await recipe(), second);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      throw new Error('A clean close must not prompt.');
    };
  });
  await close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        mode: label,
        saveOnCloseNewProject: true,
        saveOnCloseExistingProject: true,
        cleanClose: true,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await app?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    );
  } catch {
    /* The last verified close has already exited. */
  }
  await app?.close();
}
