import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/image-check');
await mkdir(output, { recursive: true });
const smallPath = resolve(output, 'alpha.png');
const largePath = resolve(output, 'large.png');
const invalidPath = resolve(output, 'invalid.png');
const rgba = Buffer.alloc(257 * 129 * 4);
for (let y = 0; y < 129; y++)
  for (let x = 0; x < 257; x++) {
    const index = (y * 257 + x) * 4;
    rgba[index] = (x * 17) % 256;
    rgba[index + 1] = (y * 23) % 256;
    rgba[index + 2] = ((x ^ y) * 13) % 256;
    rgba[index + 3] = [0, 1, 64, 128, 254, 255][x % 6];
  }
await sharp(rgba, { raw: { width: 257, height: 129, channels: 4 } })
  .png()
  .toFile(smallPath);
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="3072">
  <defs><linearGradient id="a"><stop stop-color="#231a24"/><stop offset="1" stop-color="#ce9449"/></linearGradient>
  <radialGradient id="b"><stop stop-color="#f1cc6b"/><stop offset="1" stop-color="#614360"/></radialGradient></defs>
  <rect x="160" y="160" width="3776" height="2752" rx="48" fill="url(#a)"/>
  <circle cx="2048" cy="1536" r="940" fill="url(#b)"/><circle cx="2048" cy="1536" r="710" fill="#211d28"/>
  <g stroke="#f1cc6b" stroke-width="36"><path d="M850 1150H3250M850 1536H3250M850 1920H3250"/></g>
  <rect x="2640" y="630" width="480" height="1800" fill="#b87755" fill-opacity=".65"/>
</svg>`);
await sharp(svg).png().toFile(largePath);
await writeFile(invalidPath, 'This is not an image.');
const executablePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const forceCpu = process.argv.includes('--cpu');
const args = [
  ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
  '--smoke-test',
  ...(forceCpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
];
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: resolve(output, forceCpu ? 'cpu-profile' : 'profile'),
};
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.GLEECH_SMOKE_USER_DATA, { recursive: true });
const app = await electron.launch({
  args,
  env,
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  timeout: 30000,
});
const errors = [];
const metrics = { mode: forceCpu ? 'forced CPU' : 'auto', packaged: Boolean(executablePath) };

async function chooseImage(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showOpenDialog = async () => ({
        canceled: selection.canceled,
        filePaths: [selection.path],
      });
    },
    { path, canceled },
  );
}

async function chooseOutput(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showSaveDialog = async () => ({
        canceled: selection.canceled,
        filePath: selection.path,
      });
    },
    { path, canceled },
  );
}

async function assertExport(page, path, expected) {
  await chooseOutput(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: `Exported ${path.split(/[\\/]/).at(-1)}` })
    .waitFor({ timeout: 30000 });
  const exported = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(exported.info.width, expected.width);
  assert.equal(exported.info.height, expected.height);
  assert.ok(exported.data.equals(expected.pixels), `Export changed decoded RGBA pixels: ${path}`);
}

try {
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await chooseImage(smallPath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened alpha.png' })
    .waitFor({ timeout: 15000 });
  const footer = page.locator('footer');
  metrics.backend = await footer.getAttribute('data-render-backend');
  metrics.adapter = await footer.getAttribute('title');
  metrics.maxTextureSize = await footer.getAttribute('data-max-texture-size');
  if (forceCpu) assert.equal(metrics.backend, 'cpu');
  if (process.env.GLEECH_REQUIRE_WEBGPU === '1' && !forceCpu)
    assert.equal(metrics.backend, 'webgpu');
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-alpha-export.png' : 'alpha-export.png'),
    { width: 257, height: 129, pixels: rgba },
  );
  metrics.exportBackend = await footer.getAttribute('data-export-backend');
  assert.equal(metrics.exportBackend, metrics.backend);
  // Add a real effect, edit it, toggle back to original, and remove it.
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'RGB split', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Horizontal shift' }).fill('5');
  await page.waitForFunction(() => {
    const recipe = JSON.parse(document.querySelector('.image-layer').dataset.renderRecipe ?? '[]');
    return recipe.length === 1 && recipe[0].params.horizontal === 5;
  });
  const splitPixels = Buffer.from(rgba);
  const shift = Math.round(257 * 0.05);
  for (let y = 0; y < 129; y++)
    for (let x = 0; x < 257; x++) {
      const index = (y * 257 + x) * 4;
      splitPixels[index] = rgba[(y * 257 + Math.max(0, x - shift)) * 4];
      splitPixels[index + 2] = rgba[(y * 257 + Math.min(256, x + shift)) * 4 + 2];
    }
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-effect-export.png' : 'effect-export.png'),
    { width: 257, height: 129, pixels: splitPixels },
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.getByRole('slider', { name: 'Horizontal shift' }).inputValue(), '1');
  await page.keyboard.press('Control+y');
  assert.equal(await page.getByRole('slider', { name: 'Horizontal shift' }).inputValue(), '5');
  const shiftSlider = page.getByRole('slider', { name: 'Horizontal shift' });
  const sliderBounds = await shiftSlider.boundingBox();
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.75,
    sliderBounds.y + sliderBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.25,
    sliderBounds.y + sliderBounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  assert.ok(Number(await shiftSlider.inputValue()) < 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    await shiftSlider.inputValue(),
    '5',
    'One undo should restore the entire slider gesture',
  );
  await page.getByRole('button', { name: 'Enable RGB split 1', exact: true }).click();
  await page.waitForFunction(() => {
    const recipe = JSON.parse(document.querySelector('.image-layer').dataset.renderRecipe ?? '[]');
    return recipe.length === 1 && !recipe[0].enabled;
  });
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-disabled-export.png' : 'disabled-export.png'),
    { width: 257, height: 129, pixels: rgba },
  );
  await page.locator('.effect-row').nth(0).locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.image-layer').dataset.renderRecipe === '[]',
  );
  await page.getByRole('button', { name: 'Actual pixels', exact: true }).click();
  assert.equal(await page.getByLabel('Current zoom').textContent(), '100%');
  const layer = page.getByTestId('image-layer');
  const before = await layer.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  );
  const bounds = await page.getByLabel('Pan and zoom image').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40);
  await page.mouse.up();
  await page.waitForFunction(
    ({ before }) =>
      Math.abs(
        new DOMMatrix(getComputedStyle(document.querySelector('.image-layer')).transform).e -
          before -
          80,
      ) < 2,
    { before },
  );
  const after = await layer.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  );
  assert.ok(Math.abs(after - before - 80) < 2, `Pan did not move the image: ${after - before}`);
  await page.mouse.wheel(0, -250);
  await page.waitForFunction(() => document.querySelector('output').textContent !== '100%');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();

  // Failed import and canceled dialogs retain the previous usable image.
  await chooseImage(invalidPath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('alert').waitFor();
  assert.equal((await page.locator('.project-name').textContent()).replace(/^• /, ''), 'alpha.png');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await chooseImage(smallPath, true);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.waitForFunction(
    () => document.querySelector('.workspace').getAttribute('aria-busy') === 'false',
  );
  assert.equal((await page.locator('.project-name').textContent()).replace(/^• /, ''), 'alpha.png');
  await chooseOutput(resolve(output, 'canceled.png'), true);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page.getByRole('status').filter({ hasText: 'Export canceled' }).waitFor();

  // Use a disk-backed browser File to exercise the real webUtils/preload drop path.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'smoke-file';
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('#smoke-file').setInputFiles(largePath);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(document.querySelector('#smoke-file').files[0]);
    return data;
  });
  const importStart = Date.now();
  await page
    .getByRole('main', { name: 'Image viewport' })
    .dispatchEvent('drop', { dataTransfer: transfer });
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened large.png' })
    .waitFor({ timeout: 30000 });
  metrics.largeImportMs = Date.now() - importStart;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Undid edit' }).waitFor();
  assert.equal((await page.locator('.project-name').textContent()).replace(/^• /, ''), 'alpha.png');
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-undo-image-export.png' : 'undo-image-export.png'),
    { width: 257, height: 129, pixels: rgba },
  );
  await page.keyboard.press('Control+Shift+z');
  await page.getByRole('status').filter({ hasText: 'Redid edit' }).waitFor();
  assert.equal((await page.locator('.project-name').textContent()).replace(/^• /, ''), 'large.png');
  assert.equal(
    await page.locator('.image-surface canvas').evaluate((canvas) => canvas.width),
    2048,
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  // Native capture lets Chromium render a frame while the window stays hidden.
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayAwake: true,
    });
    return image.toPNG().toString('base64');
  });
  await writeFile(
    resolve(output, forceCpu ? 'cpu-viewport.png' : 'viewport.png'),
    Buffer.from(screenshot, 'base64'),
  );
  await page.getByRole('button', { name: 'Actual pixels', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.image-surface canvas').width === 4096, {
    timeout: 15000,
  });
  await page.locator('.detail-loading').waitFor({ state: 'hidden' });
  // A full-resolution drag must track the pointer without re-uploading the image.
  const panStart = await layer.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  );
  const previewTime = await footer.getAttribute('data-preview-ms');
  const canvas = await page.locator('.image-surface canvas').elementHandle();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 160, bounds.y + bounds.height / 2 + 80, {
    steps: 40,
  });
  await page.mouse.up();
  await page.waitForFunction(
    ({ panStart }) =>
      Math.abs(
        new DOMMatrix(getComputedStyle(document.querySelector('.image-layer')).transform).e -
          panStart -
          160,
      ) < 2,
    { panStart },
  );
  assert.equal(await footer.getAttribute('data-preview-ms'), previewTime);
  assert.ok(
    await canvas.evaluate((element) => element === document.querySelector('.image-surface canvas')),
  );
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const largeExpected = await sharp(largePath).ensureAlpha().raw().toBuffer();
  const exportStart = Date.now();
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-large-export.png' : 'large-export.png'),
    { width: 4096, height: 3072, pixels: largeExpected },
  );
  metrics.largeExportMs = Date.now() - exportStart;

  // Exercise native clipboard image I/O, retaining every available original format in memory.
  await app.evaluate(
    async ({ clipboard, ClipboardItem }, png) => {
      const captureClipboard = async () => {
        const backup = [];
        for (const item of await clipboard.read()) {
          // An empty Windows clipboard can be represented by an item with no types.
          // ClipboardItem requires at least one MIME type; there is nothing to retain.
          if (item.types.length === 0) continue;
          const formats = {};
          for (const type of item.types) formats[type] = await item.getType(type);
          backup.push(new ClipboardItem(formats));
        }
        return backup;
      };
      globalThis.__gleechClipboardBackup = await captureClipboard();
      // Exercise the hosted-runner failure case locally too, preserving the real
      // clipboard above and restoring it in finally.
      clipboard.clear();
      // macOS also exposes its separate Find pasteboard through read(). Clearing
      // the general clipboard leaves that unrelated search text intact.
      const cleared = await captureClipboard();
      if (
        cleared.some((item) =>
          item.types.some(
            (type) => process.platform !== 'darwin' || type !== 'electron application/findtext',
          ),
        )
      )
        throw new Error('The empty clipboard backup should contain no formats.');
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }),
        }),
      ]);
    },
    (await readFile(smallPath)).toString('base64'),
  );
  await page.keyboard.press('Control+v');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened Pasted image.png' })
    .waitFor({ timeout: 15000 });
  assert.equal(
    (await page.locator('.project-name').textContent()).replace(/^• /, ''),
    'Pasted image.png',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Undid edit' }).waitFor();
  assert.equal((await page.locator('.project-name').textContent()).replace(/^• /, ''), 'large.png');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Redid edit' }).waitFor();
  assert.equal(
    (await page.locator('.project-name').textContent()).replace(/^• /, ''),
    'Pasted image.png',
  );
  // Windows may premultiply/unpremultiply image colors while placing them on the
  // native clipboard. Compare export to what the OS actually supplied, not to
  // hidden RGB values from before that conversion. Alpha must still match.
  const clipboardPng = await app.evaluate(async ({ clipboard }) => {
    const item = (await clipboard.read()).find((entry) => entry.types.includes('image/png'));
    return Buffer.from(await (await item.getType('image/png')).arrayBuffer()).toString('base64');
  });
  const clipboardPixels = await sharp(Buffer.from(clipboardPng, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let index = 3; index < rgba.length; index += 4)
    assert.equal(clipboardPixels[index], rgba[index], 'Clipboard changed alpha');
  await assertExport(
    page,
    resolve(output, forceCpu ? 'cpu-paste-export.png' : 'paste-export.png'),
    { width: 257, height: 129, pixels: clipboardPixels },
  );
  await app.evaluate(async ({ clipboard }) => {
    await clipboard.writeText('No image here');
  });
  await page.keyboard.press('Control+v');
  await page.getByRole('alert').filter({ hasText: 'does not contain an image' }).waitFor();
  assert.equal(
    (await page.locator('.project-name').textContent()).replace(/^• /, ''),
    'Pasted image.png',
  );
  assert.deepEqual(errors, []);
  if (metrics.backend === 'webgpu') {
    await page
      .locator('.image-surface canvas')
      .evaluate((canvas) => canvas.getContext('webgpu').getConfiguration().device.destroy());
    await page.waitForFunction(
      () => document.querySelector('footer').dataset.renderBackend === 'cpu',
    );
    await assertExport(page, resolve(output, 'device-loss-export.png'), {
      width: 257,
      height: 129,
      pixels: clipboardPixels,
    });
    metrics.deviceLossRecovery = true;
  }
  await writeFile(
    resolve(output, forceCpu ? 'cpu-metrics.json' : 'metrics.json'),
    JSON.stringify(metrics, null, 2),
  );
  console.log('Image checkpoint passed:', JSON.stringify(metrics));
} finally {
  try {
    await app.evaluate(async ({ clipboard }) => {
      const backup = globalThis.__gleechClipboardBackup;
      if (!backup) return;
      if (backup.length) await clipboard.write(backup);
      else clipboard.clear();
    });
  } finally {
    await closeTestApp(app);
  }
}
