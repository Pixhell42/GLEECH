import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/depth-slider');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, 'portrait.png');
await sharp({ create: { width: 256, height: 512, channels: 4, background: '#ac8040' } })
  .png()
  .toFile(imagePath);
const app = await electron.launch({
  args: [
    resolve(root, 'apps/desktop'),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
let page;
const errors = [];
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, imagePath);
  const frame = () =>
    app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Depth Field', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Field source', exact: true }).selectOption('linear');
  const preview = page.locator('.depth-field-preview');
  await preview.locator('img').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.depth-field-preview')?.getAttribute('aria-busy') === 'false',
  );
  const near = page.getByRole('slider', { name: 'Near', exact: true });
  await near.scrollIntoViewIfNeeded();
  await frame();
  const before = await near.boundingBox();
  const previewHeight = await preview.evaluate((node) => node.getBoundingClientRect().height);
  const x = before.x + 12 + (before.width - 24) * 0.7;
  await page.mouse.move(x, before.y + before.height / 2);
  await page.mouse.down();
  const during = await near.boundingBox();
  const duringHeight = await preview.evaluate((node) => node.getBoundingClientRect().height);
  assert.equal(duringHeight, previewHeight, 'Depth preview changed height during a slider drag');
  assert.equal(during.y, before.y, 'Near slider moved under the pointer during its drag');
  for (const fraction of [0.5, 0.2, 0.8, 0.1, 0.9]) {
    await page.mouse.move(
      before.x + 12 + (before.width - 24) * fraction,
      before.y + before.height / 2,
      { steps: 8 },
    );
    const value = await near.inputValue();
    assert.ok(
      Math.abs(Number(value) - fraction) < 0.06,
      `Near slider stuck: expected ${fraction}, got ${value}`,
    );
  }
  await page.mouse.up();
  await frame();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await near.inputValue(), '1', 'One Undo should restore the entire drag');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.ok(Number(await near.inputValue()) > 0.84);
  await page.getByRole('combobox', { name: 'Depth preview', exact: true }).selectOption('hidden');
  assert.ok(await preview.isHidden());
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: cpu ? 'cpu' : 'gpu',
      stablePreview: true,
      continuousNearDrag: true,
      history: true,
      result: 'passed',
    }),
  );
} catch (error) {
  await writeFile(
    resolve(output, 'failure.json'),
    JSON.stringify(
      { error: String(error), errors, body: await page?.locator('body').innerText() },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
