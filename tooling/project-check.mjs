import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { recordDesktopFailure } from './record-desktop-failure.mjs';
import { installTestIOTracing } from './test-io-tracing.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/project-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const imagePath = resolve(output, 'original.png');
const pixels = Buffer.alloc(257 * 129 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = (i * 13) % 256;
  pixels[i + 1] = (i * 17 + 41) % 256;
  pixels[i + 2] = (i * 23 + 87) % 256;
  pixels[i + 3] = [0, 1, 64, 128, 254, 255][(i / 4) % 6];
}
await sharp(pixels, { raw: { width: 257, height: 129, channels: 4 } })
  .png()
  .toFile(imagePath);
const projectPath = resolve(output, `${label}.gleech`);
const copyPath = resolve(output, `${label}-copy.gleech`);
const brokenPath = resolve(output, 'broken.gleech');
await writeFile(brokenPath, 'broken project');
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
let app = await launch();
console.log('Project acceptance: launched native process');
let page;
const errors = [];
let exports = 0;
try {
  page = await app.firstWindow();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  async function configure() {
    await installTestIOTracing(app);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
    );
    await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('tab', { name: 'Controls', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    assert.equal(
      await page.getByRole('tabpanel', { name: 'Image details', exact: true }).count(),
      0,
    );
  }
  async function chooseOpen(path, canceled = false) {
    await app.evaluate(
      ({ dialog }, s) => {
        dialog.showOpenDialog = async () => ({ canceled: s.canceled, filePaths: [s.path] });
      },
      { path, canceled },
    );
  }
  async function chooseSave(path, canceled = false) {
    await app.evaluate(
      ({ dialog }, s) => {
        dialog.showSaveDialog = async () => ({ canceled: s.canceled, filePath: s.path });
      },
      { path, canceled },
    );
  }
  async function settle() {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForFunction(
      () => {
        const data = document.querySelector('.image-layer').dataset;
        return (
          data.renderRevision === data.requestedRevision &&
          !document.querySelector('.detail-loading')
        );
      },
      undefined,
      { timeout: 30000 },
    );
  }
  async function recipe() {
    await settle();
    return page.locator('.image-layer').evaluate((element) => ({
      effects: JSON.parse(element.dataset.renderRecipe),
      seed: Number(element.dataset.renderSeed),
    }));
  }
  const status = (text) =>
    page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
  async function exportPixels(name) {
    const path = resolve(output, `${label}-${name}.png`);
    await chooseSave(path);
    await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    await status(`Exported ${basename(path)}`);
    exports++;
    return sharp(await readFile(path))
      .ensureAlpha()
      .raw()
      .toBuffer();
  }
  async function openProject(path, canceled = false) {
    await chooseOpen(path, canceled);
    await fileAction(page, 'Open project Ctrl+O');
  }
  await configure();
  console.log('Project acceptance: renderer ready');
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.locator('.file-menu-items').getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: /^Save project (Ctrl|Cmd)\+S$/ }).isDisabled(),
    true,
  );
  await page.keyboard.press('Escape');
  await chooseOpen(imagePath);
  console.log('Project acceptance: invoking Open File');
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened original.png');
  console.log('Project acceptance: imported image');
  await page.getByRole('tab', { name: 'Image details', exact: true }).click();
  assert.ok(await page.getByRole('tabpanel', { name: 'Image details', exact: true }).isVisible());
  assert.ok((await page.locator('.image-info').innerText()).includes('257 × 129'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page.getByRole('tab', { name: 'Controls', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  for (const title of ['RGB split', 'Block corruption', 'Spatial crush']) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
    await settle();
    for (const slider of await page.getByRole('slider').all()) {
      const name = await slider.getAttribute('aria-label');
      const info = page.getByRole('button', { name: `About ${name}`, exact: true });
      await info.hover();
      const tip = info.locator('..').getByRole('tooltip');
      assert.ok(await tip.isVisible(), `${name} tooltip did not open on hover`);
      const bounds = await tip.boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= (await page.evaluate(() => innerWidth)),
        `${name} tooltip is clipped`,
      );
      await page.mouse.move(1, 1);
      await info.focus();
      assert.ok(await tip.isVisible(), `${name} tooltip did not open on focus`);
      await slider.focus();
    }
    assert.equal(await page.locator('.effect-detail p').count(), 0);
  }
  await page.getByRole('tab', { name: 'Image details', exact: true }).click();
  await page.getByRole('button', { name: 'Spatial crush', exact: true }).click();
  assert.equal(
    await page.getByRole('tab', { name: 'Controls', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.getByRole('combobox', { name: 'Sampling', exact: true }).selectOption('random');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('background');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.63');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.41');
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  await page.getByRole('button', { name: 'Enable RGB split 3' }).click();
  await page.getByRole('spinbutton', { name: 'Master seed' }).fill('4294967295');
  const savedRecipe = await recipe();
  const expected = await exportPixels('before-save');
  await chooseSave(projectPath, true);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Save canceled');
  assert.deepEqual(await recipe(), savedRecipe);
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status(`Saved ${basename(projectPath)}`);
  assert.ok((await readFile(projectPath)).subarray(0, 8).equals(Buffer.from('GLEECH02')));
  console.log('Project acceptance: saved project and exported rendered pixels');
  assert.ok(!(await page.title()).startsWith('•'));
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.25');
  await settle();
  assert.ok((await page.title()).startsWith('•'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.ok(!(await page.title()).startsWith('•'));
  await chooseSave(copyPath);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await status(`Saved ${basename(copyPath)}`);
  assert.ok((await readFile(copyPath)).equals(await readFile(projectPath)));
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.33');
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error('Ordinary Save should use its existing path');
    };
  });
  await fileAction(page, 'Save project Ctrl+S');
  await status(`Saved ${basename(copyPath)}`);
  assert.ok(!(await readFile(copyPath)).equals(await readFile(projectPath)));
  const modified = await recipe();
  await openProject(projectPath, true);
  await status('Open canceled');
  assert.deepEqual(await recipe(), modified);
  await openProject(brokenPath);
  await page.getByRole('alert').filter({ hasText: 'valid GLEECH project' }).waitFor();
  assert.deepEqual(await recipe(), modified);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  // The previous document's handle must survive a failed open.
  await fileAction(page, 'Save project Ctrl+S');
  await status(`Saved ${basename(copyPath)}`);
  await chooseSave(resolve(output, 'missing-directory', 'cannot-save.gleech'));
  const beforeFailure = Buffer.from(await readFile(copyPath));
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await page.getByRole('alert').waitFor();
  assert.ok((await readFile(copyPath)).equals(beforeFailure));
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  assert.equal((await readdir(output)).filter((name) => name.endsWith('.tmp')).length, 0);
  console.log('Project acceptance: restarting installed application');
  await closeTestApp(app);
  app = await launch();
  page = await app.firstWindow();
  await configure();
  await openProject(projectPath);
  await status(`Opened ${basename(projectPath)}`);
  assert.deepEqual(await recipe(), savedRecipe);
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
  assert.ok(
    (await exportPixels('after-reopen')).equals(expected),
    'Reopening changed the rendered RGBA pixels',
  );
  for (const title of ['Spatial crush 1', 'Block corruption 2'])
    await page.getByRole('button', { name: `Enable ${title}` }).click();
  assert.ok(
    (await exportPixels('original-after-reopen')).equals(pixels),
    'Project did not preserve the exact original RGBA pixels',
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await settle();
  const add = await page.getByRole('button', { name: /Add effect/ }).boundingBox();
  const seed = await page.getByRole('button', { name: 'Random seed' }).boundingBox();
  const panel = await page.locator('.stack-panel').boundingBox();
  const tools = await page.locator('.viewport-tools').boundingBox();
  // Add effect stays in the panel header, below the Edited / Original toggle.
  assert.ok(add.y < panel.y + 90 && seed.y < 52 && tools.x > panel.x + panel.width);
  assert.ok(await page.getByRole('button', { name: 'Random seed' }).getAttribute('title'));
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  );
  await page.getByRole('button', { name: 'About Softness', exact: true }).hover();
  await captureTestWindow(app, resolve(output, `${label}-compact.png`));
  console.log('Project acceptance: restart, original pixels and compact window verified');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        mode: label,
        backend: await page.locator('footer').getAttribute('data-render-backend'),
        exports,
        restartRoundTrip: true,
      },
      null,
      2,
    ),
  );
} catch (failure) {
  await recordDesktopFailure({ app, page, output, label, failure, errors }).catch((error) => {
    console.error('Could not capture desktop failure diagnostics:', error.message);
  });
  throw failure;
} finally {
  await closeTestApp(app);
}
