import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'test-results/direction-context');
await mkdir(output, { recursive: true });
const imagePath = resolve(output, 'input.png');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
await sharp({ create: { width: 83, height: 61, channels: 4, background: '#b78b59' } })
  .png()
  .toFile(imagePath);
const executablePath = process.argv.slice(2).find((argument) => argument.endsWith('.exe'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  args: [...(executablePath ? [] : [resolve(root, 'apps/desktop')]), '--smoke-test'],
  env,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog, clipboard }, path) => {
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    globalThis.__fieldClipboard = '';
    clipboard.writeText = (text) => {
      globalThis.__fieldClipboard = text;
    };
    clipboard.readText = () => globalThis.__fieldClipboard;
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  async function add(name) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('tab', { name: 'Effects', exact: true }).click();
    await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  }
  async function menu(target, action) {
    await target.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Copy and paste settings', exact: true });
    await menu.waitFor();
    for (const name of ['Copy', 'Paste', 'Reset'])
      assert.equal(await menu.getByRole('menuitem', { name, exact: true }).count(), 1);
    assert.equal(await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).count(), 0);
    if (action) await menu.getByRole('menuitem', { name: action, exact: true }).click();
    else await menu.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  }
  async function waitField(source) {
    await page.waitForFunction((source) => {
      const n = document.querySelector('.image-layer');
      return (
        n?.dataset.requestedRevision === n?.dataset.renderRevision &&
        JSON.parse(n?.dataset.renderRecipe ?? '[]').at(-1)?.params.directionSource === source
      );
    }, source);
    return page.locator('.image-layer').evaluate((n) => JSON.parse(n.dataset.renderRecipe).at(-1));
  }
  await add('Pixel Sorting');
  const field = page.locator('.direction-field-controls');
  await menu(field.locator('.direction-field-heading'));
  await menu(field.getByRole('button', { name: 'Import', exact: true }));
  await menu(field.getByRole('button', { name: 'Starter Maps', exact: true }));
  await field.getByRole('button', { name: 'Starter Maps', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Starter vector maps', exact: true })
    .getByRole('button', { name: /Pinwheel Sectors/ })
    .click();
  const original = await waitField('image');
  await menu(field.locator('canvas'), 'Copy');
  await page.waitForFunction(
    () => document.querySelector('[data-feedback-id]')?.textContent === 'Copied direction field',
  );
  const copied = await app.evaluate(() => JSON.parse(globalThis.__fieldClipboard));
  assert.equal(copied.kind, 'direction-field');
  assert.equal(copied.image.source.id, original.directionImage.source.id);
  await add('Wave distortion');
  await menu(field.locator('.direction-field-heading'), 'Paste');
  const pasted = await waitField('image');
  assert.deepEqual(pasted.directionImage, original.directionImage);
  await menu(field.getByRole('button', { name: 'Starter Maps', exact: true }), 'Reset');
  assert.equal((await waitField('native')).directionImage, undefined);
  await page.getByRole('button', { name: /Undo/ }).click();
  assert.deepEqual((await waitField('image')).directionImage, original.directionImage);
  const influence = page.getByRole('slider', { name: 'Field influence', exact: true });
  await influence.fill('0.42');
  await menu(influence, 'Copy');
  await page.waitForFunction(
    () => document.querySelector('[data-feedback-id]')?.textContent === 'Copied Field influence',
  );
  const parameter = await app.evaluate(() => JSON.parse(globalThis.__fieldClipboard));
  assert.equal(parameter.kind, 'parameter');
  assert.equal(parameter.key, 'directionInfluence');
  await menu(influence, 'Reset');
  assert.equal(await influence.inputValue(), '1');
  console.log(
    JSON.stringify({
      header: true,
      buttons: true,
      preview: true,
      copyMap: true,
      pasteMap: true,
      reset: true,
      undo: true,
      individualSlider: true,
      result: 'passed',
    }),
  );
} finally {
  await closeTestApp(app);
}
