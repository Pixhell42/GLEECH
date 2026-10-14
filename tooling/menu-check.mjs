import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = process.cwd();
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/menu');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 33,
  height = 23;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const path = resolve(output, `${label}.png`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(path);
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve(root, 'apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(exe ? { executablePath: resolve(exe) } : {}),
});
let closed = false;
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, clipboard, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    // Exercise the real clipboard encoding/decoding without touching the user's clipboard.
    globalThis.__menuClipboard = [];
    clipboard.write = async (items) => {
      globalThis.__menuClipboard = items;
    };
    clipboard.read = async () => globalThis.__menuClipboard;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, path);
  const status = (text) =>
    page.locator('.status-bar').getByRole('status').filter({ hasText: text }).waitFor();
  const settle = () =>
    page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return (
        node?.dataset.renderRevision === node?.dataset.requestedRevision &&
        !document.querySelector('.operation-banner')
      );
    });
  const toggle = page.getByRole('button', { name: 'File menu', exact: true });
  const menu = page.locator('.file-menu-items');
  await toggle.click();
  await menu.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(
    await menu.getByRole('button', { name: 'Copy Ctrl+C', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await menu.locator(':scope > hr').count(), 4);
  const version = await app.evaluate(({ app, clipboard }) => {
    globalThis.__copiedVersion = '';
    clipboard.writeText = (text) => {
      globalThis.__copiedVersion = text;
    };
    return app.getVersion();
  });
  const versionFooter = menu.getByRole('button', { name: 'Copy GLEECH version', exact: true });
  const versionLabel = await versionFooter.textContent();
  assert.ok(versionLabel.startsWith('GLEECH'));
  assert.ok(versionLabel.endsWith(` · v${version}`));
  await versionFooter.click();
  await page.getByText('Copied GLEECH version', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.__copiedVersion), versionLabel);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Bit crush', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('3');
  await settle();
  const recipe = await page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
  const expected = Buffer.from(
    renderEffects({ width, height, pixels: pixels.buffer }, recipe.effects, {
      masterSeed: recipe.masterSeed,
    }).pixels,
  );
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await fileAction(page, 'Copy Ctrl+C');
  await status('Copied edited image');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const png = await app.evaluate(async () =>
    Buffer.from(
      await (await globalThis.__menuClipboard[0].getType('image/png')).arrayBuffer(),
    ).toString('base64'),
  );
  assert.ok(
    (await sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer()).equals(expected),
    'Copy retains full-resolution edited RGBA, even while viewing Original',
  );
  await fileAction(page, 'Paste Ctrl+V');
  await status('Opened Pasted image.png');
  await settle();
  const pastedPath = resolve(output, `${label}-pasted.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, pastedPath);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ');
  assert.ok(
    (await sharp(pastedPath).ensureAlpha().raw().toBuffer()).equals(expected),
    'Paste opens the copied edited image exactly',
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await toggle.click();
  assert.ok(
    await menu.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return (
        node.scrollWidth <= node.clientWidth &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
    }),
    'The grouped menu fits the minimum window',
  );
  await captureTestWindow(app, resolve(output, `${label}-menu.png`));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${label}-menu.png`));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
  });
  await fileAction(page, 'Exit GLEECH Alt+F4');
  await status('Canceled');
  await settle();
  assert.equal(page.isClosed(), false);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await fileAction(page, 'Exit GLEECH Alt+F4');
  await status('Save canceled');
  await settle();
  assert.equal(page.isClosed(), false);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const closing = page.waitForEvent('close');
  await fileAction(page, 'Exit GLEECH Alt+F4');
  await closing;
  assert.deepEqual(errors, []);
  await app.close();
  closed = true;
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactClipboardRoundTrip: true,
      groupedMenu: true,
      guardedExit: true,
    }),
  );
  console.log(`${label}: menu clipboard round-trip, layout and guarded Exit passed.`);
} finally {
  if (!closed) await closeTestApp(app);
}
