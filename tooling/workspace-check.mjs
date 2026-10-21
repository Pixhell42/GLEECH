import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/workspace-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const imagePath = resolve(output, `${label}-input.png`);
const rgba = Buffer.alloc(64 * 32 * 4);
for (let i = 0; i < rgba.length; i += 4)
  rgba.set([i % 251, (i * 7) % 251, (i * 13) % 251, i < rgba.length / 2 ? 0 : 128], i);
await sharp(rgba, { raw: { width: 64, height: 32, channels: 4 } })
  .png()
  .toFile(imagePath);
let app;
let page;
const errors = [];
async function start() {
  app = await electron.launch({
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  // This scenario exercises the expanded stage browser and its saved preference.
  if (await page.evaluate(() => localStorage.getItem('gleech.stages.collapsed') === null)) {
    await page.evaluate(() => localStorage.setItem('gleech.stages.collapsed', 'false'));
    await page.reload();
    await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  }
  await frame();
}
const frame = () =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
async function settle() {
  await frame();
  await page.waitForFunction(() => {
    const layer = document.querySelector('.image-layer');
    return (
      layer.dataset.renderRevision === layer.dataset.requestedRevision &&
      !document.querySelector('.detail-loading')
    );
  });
}
async function menu(label) {
  await fileAction(page, label);
}
async function chooseSave(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function openImage() {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  await menu('Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await settle();
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    masterSeed: Number(element.dataset.renderSeed),
  }));
}
async function rename(name) {
  await page.getByRole('button', { name: 'Rename project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await page.keyboard.press('Enter');
}
async function screenshot(name) {
  await frame();
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, `${label}-${name}.png`), Buffer.from(png, 'base64'));
}
try {
  await start();
  assert.equal(
    await page.locator('.toolbar').getByRole('button', { name: 'Paste', exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator('.toolbar')
      .getByRole('button', { name: 'Save project', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator('.stack-panel .stack-comparison')
      .getByRole('button', { name: 'Edited', exact: true })
      .count(),
    1,
  );
  assert.ok(
    await page
      .locator('.canvas-zoom')
      .getByRole('button', { name: 'Fit', exact: true })
      .isVisible(),
  );
  const redo = await page.getByRole('button', { name: 'Redo', exact: true }).boundingBox();
  const seed = await page.locator('.seed-control').boundingBox();
  assert.ok(seed.x > redo.x + redo.width);
  // Opening an image names the project after it, even over a typed name.
  await rename('First project');
  await openImage();
  assert.ok((await page.locator('.project-name').textContent()).includes(basename(imagePath)));
  await rename('First project');
  assert.ok((await page.locator('.project-name').textContent()).includes('First project'));
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Bit crush', exact: true })
    .click();
  await settle();
  const current = await recipe();
  const expected = Buffer.from(
    renderEffects(
      { width: 64, height: 32, pixels: Uint8Array.from(rgba).buffer },
      current.effects,
      { masterSeed: current.masterSeed },
    ).pixels,
  );
  const firstProject = resolve(output, `${label}-first.gleech`);
  await chooseSave(firstProject);
  await menu('Save project Ctrl+S');
  await status('Saved ' + basename(firstProject));
  const originalProject = await readFile(firstProject);
  await page.getByRole('button', { name: 'Rename project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Canceled name');
  await page.keyboard.press('Escape');
  assert.ok(!(await page.title()).startsWith('•'));
  await rename('Second project');
  assert.ok((await page.title()).includes('Second project'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.ok((await page.locator('.project-name').textContent()).includes(basename(firstProject)));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const secondProject = resolve(output, `${label}-second.gleech`);
  await chooseSave(secondProject);
  await page.keyboard.press('Control+s');
  await status('Saved ' + basename(secondProject));
  assert.ok(
    (await readFile(firstProject)).equals(originalProject),
    'Renaming overwrote the old project file',
  );
  console.log(`${label}: menu, layout and undoable naming passed`);

  await page.getByRole('button', { name: 'Original', exact: true }).click();
  for (const format of ['png', 'jpeg', 'webp', 'tiff']) {
    await menu('Export image…');
    assert.equal(await page.getByRole('combobox', { name: 'File format' }).inputValue(), 'png');
    await page.getByRole('combobox', { name: 'File format' }).selectOption(format);
    const path = resolve(output, `${label}-export.${format === 'jpeg' ? 'jpg' : format}`);
    await chooseSave(path);
    await page
      .getByRole('dialog', { name: 'Export image', exact: true })
      .getByRole('button', { name: 'Export', exact: true })
      .click();
    await status('Exported ' + basename(path));
    const encoded = await readFile(path);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 64);
    assert.equal(metadata.height, 32);
    assert.equal(metadata.hasAlpha, format !== 'jpeg');
    const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer();
    if (format === 'png' || format === 'tiff') assert.ok(decoded.equals(expected));
    else if (format === 'webp')
      for (let i = 3; i < decoded.length; i += 4) assert.equal(decoded[i], expected[i]);
    else assert.deepEqual(Array.from(decoded.subarray(0, 4)), [255, 255, 255, 255]);
  }
  const quick = resolve(output, `${label}-quick.png`);
  await chooseSave(quick);
  await menu('Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(quick));
  assert.ok(
    (
      await sharp(await readFile(quick))
        .raw()
        .toBuffer()
    ).equals(expected),
  );
  await menu('Export image…');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await recipe(), current);
  console.log(`${label}: all four exports and Quick PNG passed`);

  await menu('Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Statue preset');
  await page.getByRole('img', { name: 'Statue preset preview' }).waitFor({ timeout: 30000 });
  const currentThumbnail = await page
    .getByRole('img', { name: 'Current image preset preview' })
    .getAttribute('src');
  assert.ok(
    (
      await sharp(Buffer.from(currentThumbnail.split(',')[1], 'base64'))
        .raw()
        .toBuffer()
    ).equals(expected),
  );
  const statueThumbnail = await page
    .getByRole('img', { name: 'Statue preset preview' })
    .getAttribute('src');
  const basePath = executablePath
    ? resolve(dirname(executablePath), 'resources/presets/statue.png')
    : resolve(root, 'apps/desktop/resources/presets/statue.png');
  const base = await sharp(basePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const renderedStatue = renderEffects(
    { width: base.info.width, height: base.info.height, pixels: Uint8Array.from(base.data).buffer },
    current.effects,
    { masterSeed: current.masterSeed },
  );
  const expectedStatue = await sharp(Buffer.from(renderedStatue.pixels), {
    raw: { width: base.info.width, height: base.info.height, channels: 4 },
  })
    .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer();
  assert.ok(
    (
      await sharp(Buffer.from(statueThumbnail.split(',')[1], 'base64'))
        .raw()
        .toBuffer()
    ).equals(expectedStatue),
    'Statue preview differs from the saved recipe',
  );
  assert.notEqual(statueThumbnail, currentThumbnail);
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await screenshot('thumbnail-choice');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Statue preset');
  await page.getByRole('button', { name: 'Apply Statue preset', exact: true }).waitFor();
  let stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.equal(stored.thumbnailSource, 'statue');
  assert.equal(stored.thumbnail, statueThumbnail);
  assert.deepEqual(stored.effects, current.effects);
  await page.getByRole('button', { name: 'Edit preset Statue preset', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Statue', exact: true }).isChecked());
  await page.getByRole('img', { name: 'Current image preset preview' }).waitFor();
  await page.getByRole('radio', { name: 'Current image', exact: true }).check();
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Image preset');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await status('Updated preset Image preset');
  await page.getByRole('button', { name: 'Apply Image preset', exact: true }).waitFor();
  stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.equal(stored.thumbnailSource, 'image');
  assert.equal(stored.thumbnail, currentThumbnail);
  assert.deepEqual(stored.effects, current.effects);
  const presetPath = resolve(output, `${label}.gleechpreset`);
  await chooseSave(presetPath);
  await page.getByRole('button', { name: 'Export preset Image preset', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  await page.keyboard.press('Escape');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, presetPath);
  await menu('Import Preset');
  await status('Imported preset Image preset (2)');
  await page.getByRole('button', { name: 'Apply Image preset (2)', exact: true }).waitFor();
  assert.equal(
    JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0].thumbnailSource,
    'image',
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(await recipe(), current);
  console.log(`${label}: thumbnail previews, edit and portable choice passed`);

  const contentWidth = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(960, 640);
    return window.getContentSize()[0];
  });
  await page.waitForFunction((width) => innerWidth === width, contentWidth);
  assert.ok(await page.getByRole('button', { name: 'Rename project', exact: true }).isVisible());
  await screenshot('minimum');
  await page.getByRole('button', { name: 'Collapse stages', exact: true }).click();
  await closeTestApp(app);
  await start();
  await openImage();
  assert.ok(await page.getByRole('button', { name: 'Expand stages', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Expand stages', exact: true }).click();
  await closeTestApp(app);
  await start();
  await openImage();
  assert.ok(await page.getByRole('button', { name: 'Collapse stages', exact: true }).isVisible());
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Edit preset Image preset', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Current image', exact: true }).isChecked());
  assert.equal(
    await page.getByRole('img', { name: 'Current image preset preview' }).getAttribute('src'),
    currentThumbnail,
  );
  assert.deepEqual(errors, []);
  console.log(`${label}: Stages and preset preferences survive restarts; no renderer errors`);
} finally {
  if (app) await closeTestApp(app);
}
