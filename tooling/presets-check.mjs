import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/presets-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
// Each run starts with a fresh library, then restarts with that same profile.
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const imagePath = resolve(output, `${label}-image.png`);
const secondPath = resolve(output, `${label}-second.png`);
const rgba = Buffer.alloc(257 * 129 * 4);
for (let y = 0; y < 129; y++)
  for (let x = 0; x < 257; x++) {
    const index = (y * 257 + x) * 4;
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      index,
    );
  }
await sharp(rgba, { raw: { width: 257, height: 129, channels: 4 } })
  .png()
  .toFile(imagePath);
const second = Buffer.from(rgba.map((value, index) => (index % 4 === 3 ? value : 255 - value)));
await sharp(second, { raw: { width: 257, height: 129, channels: 4 } })
  .png()
  .toFile(secondPath);
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
let page;
const errors = [];
let exports = 0;
async function configure() {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () => {
      const data = document.querySelector('.image-layer').dataset;
      return (
        data.renderRevision === data.requestedRevision && !document.querySelector('.detail-loading')
      );
    },
    undefined,
    { timeout: 30000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    seed: Number(element.dataset.renderSeed),
  }));
}
async function open(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(path));
  await settle();
}
async function picker(tab = 'Presets') {
  await page.getByRole('button', { name: /Add effect/ }).click();
  assert.equal(
    await page.getByRole('tab', { name: 'Effects', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.getByText('Loading presets…', { exact: true }).waitFor({ state: 'hidden' });
}
async function add(title) {
  await picker('Effects');
  await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
  await settle();
}
async function exportExact(input) {
  const recipe = await state();
  const path = resolve(output, `${label}-${++exports}.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const image = { width: 257, height: 129, pixels: Uint8Array.from(input).buffer };
  const expected = Buffer.from(
    renderEffects(image, recipe.effects, { masterSeed: recipe.seed, reference: image }).pixels,
  );
  assert.ok(
    (await sharp(path).ensureAlpha().raw().toBuffer()).equals(expected),
    'Preset export changed the rendered recipe',
  );
  return expected;
}
async function flyout(name) {
  await page.getByRole('button', { name: `Apply ${name}`, exact: true }).click();
  await page.locator('.preset-flyout').waitFor();
  assert.equal(await page.locator('.preset-flyout button').count(), 4);
  for (const label of ['Replace All', 'Add Above', 'Add Below', 'Merge']) {
    const button = page.locator('.preset-flyout').getByRole('button', { name: label, exact: true });
    await button.hover();
    const tip = button.locator('..').getByRole('tooltip');
    assert.ok(await tip.isVisible());
    assert.equal(await tip.evaluate((element) => getComputedStyle(element).pointerEvents), 'none');
    const bounds = await tip.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= (await page.evaluate(() => innerWidth)),
      `${label} tooltip is clipped`,
    );
  }
}

try {
  await configure();
  const menu = page.getByRole('button', { name: 'File menu', exact: true });
  const menuBounds = await menu.boundingBox();
  const logoBounds = await page
    .getByRole('heading', { name: 'GLEECH.', exact: true })
    .boundingBox();
  assert.ok(menuBounds.x + menuBounds.width <= logoBounds.x, 'Hamburger must precede the logo');
  assert.ok(await menu.locator('svg').isVisible());
  await menu.click();
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: 'Library', exact: true })
    .click();
  assert.ok(
    await page.getByRole('button', { name: 'Save Stack as Preset', exact: true }).isDisabled(),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await open(imagePath);
  await menu.click();
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: 'Library', exact: true })
    .click();
  assert.ok(
    await page.getByRole('button', { name: 'Save Stack as Preset', exact: true }).isDisabled(),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await picker();
  await page.getByRole('combobox', { name: 'Preset collection', exact: true }).selectOption('mine');
  assert.ok(await page.getByText('Your preset library is empty.', { exact: true }).isVisible());
  assert.ok(
    await page.getByRole('button', { name: 'Save current stack', exact: true }).isDisabled(),
  );
  await page.keyboard.press('Escape');
  await add('Block corruption');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('bottom');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.6');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.8');
  await add('RGB split');
  await page.getByRole('spinbutton', { name: 'Master seed' }).fill('901');
  await page.getByRole('spinbutton', { name: 'Master seed' }).blur();
  const savedRecipe = await state();
  const savedPixels = await exportExact(rgba);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).waitFor();
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'File menu',
  );
  assert.deepEqual(await state(), savedRecipe);
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Warm glitch');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Warm glitch');
  await page.getByRole('button', { name: 'Apply Warm glitch', exact: true }).waitFor();
  const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.equal(stored.masterSeed, savedRecipe.seed);
  assert.deepEqual(stored.effects, savedRecipe.effects);
  assert.ok(!('source' in stored) && !('snapshots' in stored));
  const expectedThumbnail = await sharp(savedPixels, {
    raw: { width: 257, height: 129, channels: 4 },
  })
    .png()
    .toBuffer();
  assert.ok(
    Buffer.from(stored.thumbnail.split(',')[1], 'base64').equals(expectedThumbnail),
    'Saving in Original mode lost the edited thumbnail',
  );
  await page.getByRole('searchbox', { name: 'Search presets', exact: true }).fill('no match');
  assert.ok(await page.getByText('No presets match your search.', { exact: true }).isVisible());
  await page.getByRole('searchbox', { name: 'Search presets', exact: true }).fill('warm');
  await flyout('Warm glitch');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.preset-flyout').count(), 0);
  assert.ok(await page.locator('.effect-picker').isVisible());
  assert.equal(
    await page
      .getByRole('button', { name: 'Apply Warm glitch', exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  await page.locator('.effect-row').nth(0).locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  await page.locator('.effect-row').nth(0).locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  await add('Spatial crush');
  await add('RGB split');
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.47');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('left');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.35');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.23');
  await page.getByRole('spinbutton', { name: 'Master seed' }).fill('42');
  await page.getByRole('spinbutton', { name: 'Master seed' }).blur();
  const before = await state();
  for (const [action, placement] of [
    ['Replace All', 'replace'],
    ['Add Above', 'above'],
    ['Add Below', 'below'],
    ['Merge', 'merge'],
  ]) {
    await picker();
    await flyout('Warm glitch');
    await page.locator('.preset-flyout').getByRole('button', { name: action, exact: true }).click();
    const after = await state();
    assert.equal(after.seed, placement === 'replace' ? 901 : 42);
    const expected =
      placement === 'replace'
        ? savedRecipe.effects
        : placement === 'merge'
          ? savedRecipe.effects.map(
              (effect) => before.effects.find((current) => current.type === effect.type) ?? effect,
            )
          : placement === 'above'
            ? [...before.effects, ...savedRecipe.effects]
            : [...savedRecipe.effects, ...before.effects];
    assert.deepEqual(after.effects, expected);
    const visible = await page
      .locator('.effect-row')
      .evaluateAll((rows) => rows.map((row) => row.dataset.effectId));
    assert.deepEqual(visible, expected.map((effect) => effect.instanceId).reverse());
    await exportExact(rgba);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), after);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
  }
  // Duplicate insertions receive fresh IDs while preserving the current stack and seed.
  await picker();
  await page.getByRole('button', { name: 'Apply Warm glitch', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Add Above', exact: true })
    .click();
  const once = await state();
  await picker();
  await page.getByRole('button', { name: 'Apply Warm glitch', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Add Below', exact: true })
    .click();
  const twice = await state();
  assert.equal(
    new Set(twice.effects.map((effect) => effect.instanceId)).size,
    twice.effects.length,
  );
  assert.deepEqual(twice.effects.slice(2), once.effects);
  assert.equal(twice.seed, 42);
  await exportExact(rgba);
  await picker();
  await page.getByRole('button', { name: 'Edit preset Warm glitch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Gold glitch');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await status('Updated preset Gold glitch');
  await page.getByRole('button', { name: 'Apply Gold glitch', exact: true }).waitFor();
  const contentWidth = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(960, 640);
    return window.getContentSize()[0];
  });
  await page.waitForFunction((width) => innerWidth === width, contentWidth);
  await page.keyboard.press('Escape');
  await menu.click();
  const menuItems = await page.locator('.file-menu-items').boundingBox();
  assert.ok(
    menuItems.x >= 0 && menuItems.x + menuItems.width <= (await page.evaluate(() => innerWidth)),
    'File menu is clipped at minimum window size',
  );
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: 'Library', exact: true })
    .click();
  assert.ok(
    await page.getByRole('button', { name: 'Save Stack as Preset', exact: true }).isEnabled(),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await picker();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await flyout('Gold glitch');
  await page.mouse.move(1, 1);
  await page.locator('.preset-flyout-title').click();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, `${label}-flyout.png`), Buffer.from(screenshot, 'base64'));
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(secondPath);
  await picker();
  await page.getByRole('button', { name: 'Apply Gold glitch', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply Gold glitch', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  await exportExact(second);
  await picker();
  await page.getByRole('button', { name: 'Delete preset Gold glitch', exact: true }).click();
  await status('Deleted preset Gold glitch');
  await page.getByRole('combobox', { name: 'Preset collection', exact: true }).selectOption('mine');
  await page.getByText('Your preset library is empty.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(await state(), savedRecipe, 'Deleting a library item changed the applied stack');
  assert.deepEqual(
    JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets,
    [],
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      restart: true,
      placements: 4,
      library: 'save/search/rename/delete',
      result: 'passed',
    }),
  );
} catch (error) {
  await writeFile(
    resolve(output, `${label}-failure.json`),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
