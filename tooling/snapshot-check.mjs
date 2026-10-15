import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/snapshot-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const width = 2051,
  height = 1025;
const pixels = Buffer.alloc(width * height * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = (i * 13) % 256;
  pixels[i + 1] = (i * 17 + 41) % 256;
  pixels[i + 2] = (i * 23 + 87) % 256;
  pixels[i + 3] = [0, 1, 64, 128, 254, 255][(i / 4) % 6];
}
const imagePath = resolve(output, 'original.png');
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const projectPath = resolve(output, `${label}.gleech`);
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
let page;
const errors = [];
let exports = 0;
async function configure() {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    globalThis.guardCalls = 0;
    dialog.showMessageBox = async () => {
      globalThis.guardCalls++;
      return { response: 1, checkboxChecked: false };
    };
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  // This scenario exercises the expanded stage browser and its saved preference.
  if (await page.evaluate(() => localStorage.getItem('gleech.stages.collapsed') === null)) {
    await page.evaluate(() => localStorage.setItem('gleech.stages.collapsed', 'false'));
    await page.reload();
    await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  }
  // Let the mounted viewport's effects finish before invoking the first import.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function chooseOpen(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, args) => {
      dialog.showOpenDialog = async () => ({ canceled: args.canceled, filePaths: [args.path] });
    },
    { path, canceled },
  );
}
async function chooseSave(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, args) => {
      dialog.showSaveDialog = async () => ({ canceled: args.canceled, filePath: args.path });
    },
    { path, canceled },
  );
}
async function decision(response) {
  await app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async () => {
      globalThis.guardCalls++;
      return { response, checkboxChecked: false };
    };
  }, response);
}
const status = (text) =>
  page
    .locator('.status-bar')
    .getByRole('status')
    .filter({ hasText: text })
    .waitFor({ timeout: 30000 });
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () => {
      const element = document.querySelector('.image-layer');
      return (
        element.dataset.renderRevision === element.dataset.requestedRevision &&
        !document.querySelector('.detail-loading') &&
        !document.querySelector('.operation-banner')
      );
    },
    undefined,
    { timeout: 30000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((el) => ({
    effects: JSON.parse(el.dataset.renderRecipe),
    seed: Number(el.dataset.renderSeed),
  }));
}
async function exportPixels(name) {
  const path = resolve(output, `${label}-${name}.png`);
  await chooseSave(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  exports++;
  const { data, info } = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  return data;
}
async function add(title) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
  await settle();
}
async function capture(name, bake = false) {
  await page
    .getByRole('button', { name: bake ? 'Bake and continue' : 'Capture snapshot', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill(name);
  await page
    .locator('.stage-dialog')
    .getByRole('button', { name: bake ? 'Bake stage' : 'Capture stage', exact: true })
    .click();
  await status((bake ? 'Baked ' : 'Captured ') + name);
  await settle();
  await assertStageSelection(name, bake);
}
async function assertStageSelection(name, source = false) {
  const button = page.getByRole('button', {
    name: source ? `Use ${name} as source` : `Restore recipe ${name}`,
    exact: true,
  });
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await button.evaluate((el) => el.closest('.snapshot-card').dataset.selected),
    'true',
    'The stage highlight disagrees with the restored workspace: ' + name,
  );
  assert.equal(await page.locator('.snapshot-card[data-selected="true"]').count(), 1);
}
async function restore(name, source = false) {
  await page
    .getByRole('button', {
      name: source ? `Use ${name} as source` : `Restore recipe ${name}`,
      exact: true,
    })
    .click();
  await status((source ? 'Using ' : 'Restored ') + name);
  await settle();
  await assertStageSelection(name, source);
}
async function graph() {
  return page.locator('.snapshot-card[data-snapshot-id]').evaluateAll((cards) =>
    cards.map((el) => ({
      id: el.dataset.snapshotId,
      parent: el.dataset.parentId,
      source: el.dataset.sourceId,
      rendered: el.dataset.renderedId,
    })),
  );
}
async function saved() {
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  assert.ok(!(await page.title()).startsWith('•'));
}
async function nativeClose() {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
}
async function forceCleanup() {
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((window) => window.destroy());
    });
  } catch {
    /* The tested close may already have exited the process. */
  }
  await app.close();
}
try {
  await configure();
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened original.png');
  await add('Block corruption');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('subject');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.73');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.62');
  await page.getByRole('spinbutton', { name: 'Master seed' }).fill('123456');
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const firstRecipe = await recipe();
  const firstPixels = await exportPixels('first');
  assert.ok(!firstPixels.equals(pixels));
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await settle();
  await capture('First');
  assert.deepEqual(await recipe(), firstRecipe);
  const stageHeight = (await page.getByLabel('Pan and zoom image').boundingBox()).height;
  await page.getByRole('button', { name: 'Collapse stages', exact: true }).click();
  assert.equal(await page.locator('.snapshot-strip').isVisible(), false);
  assert.equal(
    await page
      .getByRole('button', { name: 'Expand stages', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(
    (await page.getByLabel('Pan and zoom image').boundingBox()).height,
    stageHeight,
    'Stage browser overlays the canvas without resizing or moving the image',
  );
  assert.ok(await page.getByRole('button', { name: 'Capture snapshot', exact: true }).isVisible());
  const stageInfo = page.getByRole('button', { name: 'About Stages', exact: true });
  await stageInfo.hover();
  const stageTip = stageInfo.locator('..').getByRole('tooltip');
  assert.ok(await stageTip.isVisible());
  assert.ok((await stageTip.innerText()).includes('Bake and continue'));
  const tipBounds = await stageTip.boundingBox();
  const screen = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(
    tipBounds.x >= 0 &&
      tipBounds.y >= 0 &&
      tipBounds.x + tipBounds.width <= screen.width &&
      tipBounds.y + tipBounds.height <= screen.height,
  );
  await page.getByRole('button', { name: 'Expand stages', exact: true }).click();
  assert.equal(await page.locator('.snapshot-strip').isVisible(), true);
  assert.deepEqual(await recipe(), firstRecipe, 'Collapsing Stages changed the working recipe');
  await assertStageSelection('First');
  await restore('First', true);
  assert.equal((await recipe()).effects.length, 0);
  assert.ok(
    (await exportPixels('first-baked')).equals(firstPixels),
    'Original comparison leaked into snapshot',
  );
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  await add('Spatial crush');
  await page.getByRole('combobox', { name: 'Sampling', exact: true }).selectOption('random');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('right');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.54');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.46');
  const secondRecipe = await recipe();
  const secondPixels = await exportPixels('second');
  assert.ok(!secondPixels.equals(firstPixels));
  await capture('Second', true);
  assert.equal((await recipe()).effects.length, 0);
  const descendants = await graph();
  assert.equal(descendants[1].parent, descendants[0].id);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.deepEqual(await recipe(), secondRecipe);
  assert.equal((await graph()).length, 1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settle();
  assert.deepEqual(await graph(), descendants);
  assert.ok((await exportPixels('second-baked')).equals(secondPixels));
  await restore('First');
  assert.deepEqual(await recipe(), firstRecipe);
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const variationRecipe = await recipe();
  const variationPixels = await exportPixels('variation');
  await capture('First variation');
  await page.getByRole('button', { name: 'Rename First variation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill('Alternative start');
  await page.locator('.stage-dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await restore('First', true);
  await add('RGB split');
  const branchRecipe = await recipe();
  const branchPixels = await exportPixels('branch');
  await capture('Second variation');
  // A saved child recipe is selected while its baked parent remains the source.
  assert.equal(
    await page
      .getByRole('button', { name: 'Use First as source', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Restore recipe First', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  );
  await restore('Second');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  await assertStageSelection('Second variation');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settle();
  await assertStageSelection('Second');
  await restore('Second variation');
  const branches = await graph();
  assert.deepEqual(branches.slice(0, 2), descendants);
  assert.equal(branches[2].parent, '');
  assert.equal(branches[3].parent, branches[0].id);
  // Close cancellation/failure and an in-flight save leave the entire graph and working recipe intact.
  const beforeClose = await recipe();
  await decision(0);
  await chooseSave(projectPath, true);
  await nativeClose();
  await status('Save canceled');
  assert.equal(page.isClosed(), false);
  assert.deepEqual(await recipe(), beforeClose);
  await chooseSave(resolve(output, 'missing-directory', 'close-failure.gleech'));
  await nativeClose();
  await page.getByRole('alert').waitFor();
  assert.equal(page.isClosed(), false);
  assert.deepEqual(await recipe(), beforeClose);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () =>
      new Promise((resolve) => {
        globalThis.finishPendingSave = resolve;
      });
  });
  await fileAction(page, 'Save project Ctrl+S');
  await app.evaluate(async () => {
    while (!globalThis.finishPendingSave) await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await nativeClose();
  await status('Please wait for the current operation before closing.');
  assert.equal(page.isClosed(), false);
  await app.evaluate(() => globalThis.finishPendingSave({ canceled: true }));
  await status('Save canceled');
  // Repeated native close requests share one pending prompt.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.guardCalls++;
      return new Promise((resolve) => {
        globalThis.finishPendingGuard = resolve;
      });
    };
  });
  const countBefore = await app.evaluate(() => globalThis.guardCalls);
  await nativeClose();
  await nativeClose();
  await app.evaluate(async () => {
    while (!globalThis.finishPendingGuard) await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(await app.evaluate(() => globalThis.guardCalls), countBefore + 1);
  await app.evaluate(() => globalThis.finishPendingGuard({ response: 2, checkboxChecked: false }));
  await status('Canceled');
  // Save/Discard/Cancel must protect both opening another project and native window closing.
  const beforeGuard = await recipe();
  await decision(2);
  await chooseOpen(projectPath, true);
  await page.keyboard.press('Control+o');
  await status('Canceled');
  assert.deepEqual(await recipe(), beforeGuard);
  await decision(0);
  await chooseSave(projectPath, true);
  await page.keyboard.press('Control+o');
  await status('Save canceled');
  assert.deepEqual(await recipe(), beforeGuard);
  await chooseSave(resolve(output, 'missing-directory', 'failure.gleech'));
  await page.keyboard.press('Control+o');
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await recipe(), beforeGuard);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await saved();
  const calls = await app.evaluate(() => globalThis.guardCalls);
  await chooseOpen(projectPath, true);
  await page.keyboard.press('Control+o');
  await status('Open canceled');
  assert.equal(await app.evaluate(() => globalThis.guardCalls), calls);
  await page.getByRole('slider', { name: 'Horizontal shift', exact: true }).fill('2');
  await settle();
  await decision(2);
  await nativeClose();
  await status('Canceled');
  assert.equal(page.isClosed(), false);
  assert.ok((await page.title()).startsWith('•'));
  // A dirty project's normal Save uses the existing handle; failed Save must keep the window alive.
  await decision(0);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.keyboard.press('Control+o');
  await status('Open canceled');
  assert.ok(!(await page.title()).startsWith('•'));
  await restore('Second variation');
  await saved();
  await app.close();
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  await assertStageSelection('Second variation');
  const reopened = await graph();
  assert.deepEqual(
    reopened.map((x) => [x.id, x.parent]),
    branches.map((x) => [x.id, x.parent]),
  );
  assert.equal(reopened[1].source, reopened[0].rendered);
  assert.equal(reopened[3].source, reopened[0].rendered);
  assert.equal(
    await page
      .locator('.snapshot-preview img')
      .evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)),
    true,
  );
  for (const [name, expectedRecipe, expectedPixels] of [
    ['First', firstRecipe, firstPixels],
    ['Second', secondRecipe, secondPixels],
    ['Alternative start', variationRecipe, variationPixels],
    ['Second variation', branchRecipe, branchPixels],
  ]) {
    await restore(name);
    assert.deepEqual(await recipe(), expectedRecipe);
    assert.ok(
      (await exportPixels(`reopened-${name}`)).equals(expectedPixels),
      'Recipe changed after restart: ' + name,
    );
    await restore(name, true);
    assert.equal((await recipe()).effects.length, 0);
    assert.ok(
      (await exportPixels(`source-${name}`)).equals(expectedPixels),
      'Rendered stage changed after restart: ' + name,
    );
  }
  await page.getByRole('button', { name: 'Restore origin', exact: true }).click();
  await status('Restored origin');
  assert.ok(
    (await exportPixels('reopened-origin')).equals(pixels),
    'Hidden RGB or alpha changed in origin',
  );
  const longName = 'W'.repeat(120);
  await page.getByRole('button', { name: 'Rename Second variation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill(longName);
  await page.locator('.stage-dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await restore(longName, true);
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
    true,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await settle();
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
    true,
  );
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  await writeFile(resolve(output, `${label}-compact.png`), Buffer.from(screenshot, 'base64'));
  assert.deepEqual(errors, []);
  await decision(1);
  const closed = page.waitForEvent('close');
  await nativeClose();
  await closed;
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        mode: label,
        stages: 4,
        exports,
        restartRoundTrip: true,
        saveDiscardCancel: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Keep the actual renderer state when a hosted Windows runner fails, before cleanup.
  try {
    await writeFile(
      resolve(output, `${label}-failure.json`),
      JSON.stringify(
        {
          error: String(error),
          pageErrors: errors,
          title: await page.title(),
          body: await page.locator('body').innerText(),
        },
        null,
        2,
      ),
    );
    const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayAwake: true }))
        .toPNG()
        .toString('base64'),
    );
    await writeFile(resolve(output, `${label}-failure.png`), Buffer.from(screenshot, 'base64'));
  } catch {
    /* Preserve the original failure if the app already closed. */
  }
  throw error;
} finally {
  await forceCleanup();
}
