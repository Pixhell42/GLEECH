// Exercise memory warnings with a fake budget; never allocate an oversized frame.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const output = resolve('test-results/render-memory');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const work = await mkdtemp(join(output, 'exports-'));
const executable = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile, GLEECH_TEST_NATIVE_FRAMES: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [...(executable ? [] : [resolve('apps/desktop')]), '--smoke-test'],
  env,
  ...(executable ? { executablePath: resolve(executable) } : {}),
});
const setBudget = async (available) =>
  app.evaluate(({ ipcMain }, available) => {
    ipcMain.removeHandler('render:memory-budget');
    ipcMain.handle('render:memory-budget', () => ({
      ok: true,
      value: {
        totalRAMBytes: 16 * 1024 ** 3,
        availableRAMBytes: available,
        availableGPUBytes: null,
      },
    }));
  }, available);
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1440, 960);
  });
  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  await page.locator('.image-layer:not([hidden])').waitFor();
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.locator('.timeline-dock').waitFor();
  await page.keyboard.press('Home');
  await page.keyboard.press('i');
  for (let index = 0; index < 4; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('o');
  await setBudget(128 * 1024 ** 2);
  const shortcut = process.platform === 'darwin' ? 'Meta+Shift+R' : 'Control+Shift+R';
  await page.keyboard.press(shortcut);
  const dialog = page.locator('.render-dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Render Video', exact: true }).click();
  const warning = page.getByRole('alertdialog');
  await warning.waitFor();
  assert.match(await warning.textContent(), /exceed available memory/);
  assert.equal(await page.locator('.render-job').count(), 0);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, join(output, 'memory-warning.png'));
  await warning.getByRole('button', { name: 'Use one frame at a time', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Export memory mode', { exact: true }).inputValue(),
    'one-frame',
  );
  await dialog.getByRole('button', { name: 'Render Video', exact: true }).click();
  await warning.waitFor();
  await warning.getByRole('button', { name: 'Export in parts', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Keep completed parts for recovery', { exact: true }).isChecked(),
    true,
  );
  await dialog.getByRole('button', { name: 'Render Video', exact: true }).click();
  await warning.waitFor();
  await warning.getByRole('button', { name: 'Reduce resolution', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Effect processing size', { exact: true }).inputValue(),
    'output',
  );
  await setBudget(16 * 1024 ** 3);
  await dialog.getByRole('radio', { name: 'In / Out', exact: true }).click();
  await dialog.getByRole('button', { name: 'Half-res Draft', exact: false }).click();
  await dialog.getByLabel('Resolution', { exact: true }).selectOption('custom');
  const width = dialog.getByRole('spinbutton', { name: 'Width', exact: true });
  await width.fill('64');
  await width.press('Tab');
  await dialog.getByLabel('Seconds per render part', { exact: true }).fill('1');
  const destination = join(work, 'memory.mp4');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, destination);
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await dialog.getByLabel('Resume completed parts', { exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, join(output, 'memory-controls.png'));
  await dialog.getByRole('button', { name: 'Render Video', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.render-job[data-status="done"], .render-job[data-status="failed"]'),
    null,
    { timeout: 120000 },
  );
  const job = page.locator('.render-job');
  assert.equal(await job.getAttribute('data-status'), 'done', await job.textContent());
  assert.equal((await readFile(destination)).subarray(4, 8).toString(), 'ftyp');
  const checkpoints = (await readdir(work)).filter((name) => name.endsWith('.gleech-parts'));
  assert.equal(checkpoints.length, 1);
  const manifest = JSON.parse(
    await readFile(join(work, checkpoints[0], 'gleech-parts.json'), 'utf8'),
  );
  assert.ok(
    manifest.parts.length >= 2,
    'The UI must encode multiple parts, not just a single clip.',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        memoryWarning: true,
        selectableModes: true,
        smallerProcessingSize: true,
        movie: destination,
        parts: manifest.parts.length,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Memory dialog and segmented desktop export passed (${manifest.parts.length} parts).`,
  );
} finally {
  await closeTestApp(app);
}
