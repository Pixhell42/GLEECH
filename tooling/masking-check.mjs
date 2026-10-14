import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/masking-check');
const photo = resolve(root, 'tooling/fixtures/astronaut.png');
const { data: pixels, info } = await sharp(photo)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
await mkdir(output, { recursive: true });
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: resolve(output, `${label}-profile`) };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.GLEECH_SMOKE_USER_DATA, { recursive: true });
console.log('Masking checks started:', label);
const app = await electron.launch({
  args: [
    ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  timeout: 30000,
});
const errors = [];
let exports = 0;
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, photo);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('status').filter({ hasText: 'Opened astronaut.png' }).waitFor();
  const backend = await page.locator('footer').getAttribute('data-render-backend');
  if (cpu) assert.equal(backend, 'cpu');
  if (!cpu && process.env.GLEECH_REQUIRE_WEBGPU === '1') assert.equal(backend, 'webgpu');
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
  const recipe = async () => {
    await settle();
    return page.locator('.image-layer').evaluate((element) => ({
      effects: JSON.parse(element.dataset.renderRecipe),
      masterSeed: Number(element.dataset.renderSeed),
    }));
  };
  async function add(title) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: new RegExp(`^${title}`) })
      .click();
    await settle();
    assert.equal(await page.getByRole('combobox', { name: 'Application', exact: true }).count(), 1);
    assert.equal(
      await page.getByRole('slider', { name: 'Coverage', exact: true }).inputValue(),
      '1',
    );
    assert.equal(
      await page.getByRole('slider', { name: 'Softness', exact: true }).inputValue(),
      '0',
    );
  }
  const cached = await page.evaluate(async () => {
    // Exercise the narrow bridge on the same fixture independently of UI ownership.
    const imported = await window.gleech.openImage();
    if (!imported.ok || !imported.value) throw new Error('Fixture import failed.');
    const id = imported.value.source.id;
    const first = await window.gleech.subjectMask(id);
    if (!first.ok) throw new Error(first.error);
    const expected = Array.from(new Uint8Array(first.value.values));
    new Uint8Array(first.value.values).fill(0);
    const second = await window.gleech.subjectMask(id);
    if (!second.ok) throw new Error(second.error);
    const matches = expected.every(
      (value, index) => value === new Uint8Array(second.value.values)[index],
    );
    const original = await window.gleech.originalPixels(id);
    if (!original.ok || original.value.pixels.byteLength !== 512 * 512 * 4)
      throw new Error('Detection detached the source pixels.');
    await window.gleech.releaseImage(id);
    return { width: second.value.width, height: second.value.height, values: expected, matches };
  });
  assert.ok(cached.matches, 'A renderer mutation altered the cached subject mask');
  const subjectMask = {
    width: cached.width,
    height: cached.height,
    values: new Uint8Array(cached.values).buffer,
  };
  assert.ok(
    cached.values[Math.floor((170 / 512) * 320) * 320 + Math.floor((220 / 512) * 320)] > 180,
  );
  assert.ok(cached.values[10 * 320 + 10] < 80);
  await sharp(Buffer.from(cached.values), { raw: { width: 320, height: 320, channels: 1 } })
    .png()
    .toFile(resolve(output, `${label}-subject-mask.png`));
  async function exportImage(expectedRecipe = null) {
    const snapshot = expectedRecipe ?? (await recipe());
    const path = resolve(output, `${label}-${++exports}.png`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    await page
      .getByRole('status')
      .filter({ hasText: `Exported ${path.split(/[\\/]/).at(-1)}` })
      .waitFor({ timeout: 30000 });
    const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, info.width);
    assert.equal(decoded.info.height, info.height);
    const source = {
      width: info.width,
      height: info.height,
      pixels: pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength),
    };
    const expected = Buffer.from(
      renderEffects(source, snapshot.effects, { masterSeed: snapshot.masterSeed, subjectMask })
        .pixels,
    );
    assert.ok(decoded.data.equals(expected), `Masked export differs from the recipe: ${path}`);
    assert.equal(await page.getByRole('alert').count(), 0);
    return decoded.data;
  }
  await add('RGB split');
  // A focused info tooltip must not steal the slider's mouse gesture or turn
  // its text into a native drag. Exercise both directions across the midpoint.
  for (const name of ['Coverage', 'Softness']) {
    const slider = page.getByRole('slider', { name, exact: true });
    await slider.fill('0.25');
    await settle();
    await page.getByRole('button', { name: `About ${name}`, exact: true }).click();
    const bounds = await slider.boundingBox();
    const x = (fraction) => bounds.x + 8 + fraction * (bounds.width - 16);
    const y = bounds.y + bounds.height / 2;
    assert.equal(
      await slider.evaluate(
        (el) =>
          getComputedStyle(el.closest('.effect-control').querySelector('[role="tooltip"]')).display,
      ),
      'block',
    );
    assert.equal(
      await slider.evaluate((el, point) => document.elementFromPoint(point.x, point.y) === el, {
        x: x(0.25),
        y,
      }),
      true,
      `${name}'s tooltip intercepts the slider`,
    );
    const changes = await slider.evaluate((el) => {
      globalThis.sliderDragChanges = [];
      el.addEventListener('input', () => globalThis.sliderDragChanges.push(Number(el.value)));
      return Number(el.value);
    });
    await page.mouse.move(x(0.25), y);
    await page.mouse.down();
    await page.mouse.move(x(0.9), y, { steps: 8 });
    assert.ok(Number(await slider.inputValue()) > 0.85, `${name} stopped before its upper half`);
    await page.mouse.move(x(0.1), y, { steps: 8 });
    await page.mouse.up();
    const final = Number(await slider.inputValue());
    assert.ok(final < 0.15, `${name} could not return through its lower half`);
    assert.ok(
      (await page.evaluate(() => new Set(globalThis.sliderDragChanges).size)) > 4,
      `${name} did not update continuously while dragging`,
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(Number(await slider.inputValue()), changes, 'Undo split a slider gesture');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(Number(await slider.inputValue()), final);
  }
  await page.getByRole('slider', { name: 'Horizontal shift' }).fill('10');
  for (const region of [
    'top',
    'bottom',
    'left',
    'right',
    'center',
    'edges',
    'all',
    'subject',
    'background',
  ]) {
    await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption(region);
    await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.5');
    await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0');
    const result = await exportImage();
    assert.ok(!result.equals(pixels), `${region} had no visible effect`);
    await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.6');
    assert.ok(!(await exportImage()).equals(result), `${region} did not soften`);
  }
  const beforeSoftnessUndo = await recipe();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await recipe()).effects[0].application.softness, 0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), beforeSoftnessUndo);
  const beforeZero = await recipe();
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0');
  assert.ok((await exportImage()).equals(pixels), 'Zero coverage did not preserve the source');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), beforeZero);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal((await recipe()).effects[0].application.coverage, 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  assert.deepEqual((await recipe()).effects[0].application, {
    region: 'all',
    coverage: 1,
    softness: 0,
  });

  await add('Block corruption');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('subject');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.7');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.35');
  await exportImage();
  await add('Spatial crush');
  await page.getByRole('slider', { name: 'Block size' }).fill('8');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('background');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.8');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.6');
  await exportImage();
  const originalOrder = await recipe();
  const visualOrder = () =>
    page.locator('.effect-row').evaluateAll((rows) => rows.map((row) => row.dataset.effectId));
  assert.deepEqual(
    await visualOrder(),
    originalOrder.effects.map((effect) => effect.instanceId).reverse(),
  );
  const bottomRow = page.locator('.effect-row').last();
  const bottomBounds = await bottomRow.boundingBox();
  await page
    .getByRole('button', { name: 'Reorder Spatial crush 1', exact: true })
    .dragTo(bottomRow, { targetPosition: { x: 25, y: bottomBounds.height - 3 } });
  const reordered = await recipe();
  assert.deepEqual(
    reordered.effects.map((effect) => effect.instanceId),
    [
      originalOrder.effects[2].instanceId,
      originalOrder.effects[0].instanceId,
      originalOrder.effects[1].instanceId,
    ],
  );
  await exportImage();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), originalOrder, 'One undo did not restore the whole drag');
  await page
    .getByRole('button', { name: 'Reorder RGB split 3', exact: true })
    .dragTo(page.locator('.effect-row').first(), { targetPosition: { x: 25, y: 3 } });
  assert.deepEqual(
    (await recipe()).effects.map((effect) => effect.instanceId),
    [
      originalOrder.effects[1].instanceId,
      originalOrder.effects[2].instanceId,
      originalOrder.effects[0].instanceId,
    ],
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Reorder Spatial crush 1', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal((await recipe()).effects[1].instanceId, originalOrder.effects[2].instanceId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.effect-row').nth(1).locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  assert.equal((await recipe()).effects.length, 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), originalOrder);
  assert.equal(await page.getByRole('button', { name: /Move .* (up|down)|^Remove$/ }).count(), 0);
  await page.getByRole('button', { name: 'Spatial crush', exact: true }).click();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  assert.ok(
    (await exportImage()).equals(await exportImage(originalOrder)),
    'Comparison changed masked export',
  );
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  await settle();
  const capture = async () =>
    Buffer.from(
      await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayAwake: true }))
          .toPNG()
          .toString('base64'),
      ),
      'base64',
    );
  await writeFile(resolve(output, `${label}-workspace.png`), await capture());
  const addButton = page.getByRole('button', { name: /Add effect/ });
  async function openCatalog() {
    await addButton.click();
    await page.getByRole('dialog', { name: 'Add an effect' }).waitFor();
    assert.equal(await page.locator('.effect-tile').count(), effectCount);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.effect-tile img')].every(
        (image) => image.complete && image.naturalWidth >= 384,
      ),
    );
    assert.equal(
      await page
        .locator('.effect-grid')
        .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
      3,
    );
  }
  async function catalogClosed() {
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => document.activeElement?.classList.contains('add-effect'),
      undefined,
      { timeout: 5000 },
    );
    assert.ok(
      await addButton.evaluate((button) => document.activeElement === button),
      'Picker did not return focus to Add effect',
    );
    assert.deepEqual(await recipe(), originalOrder, 'Dismissing the picker changed the recipe');
  }
  await openCatalog();
  for (let tab = 0; tab < 5; tab++) await page.keyboard.press('Tab');
  assert.ok(
    await page
      .locator('.effect-picker')
      .evaluate((dialog) => dialog.contains(document.activeElement)),
    'Focus escaped the modal',
  );
  await writeFile(resolve(output, `${label}-picker.png`), await capture());
  await page.keyboard.press('Escape');
  await catalogClosed();
  await openCatalog();
  await page.getByRole('button', { name: 'Close effect picker' }).click();
  await catalogClosed();
  await openCatalog();
  await page.mouse.click(5, 5);
  await catalogClosed();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await settle();
  for (let extra = 0; extra < 5; extra++) await add('RGB split');
  const stackBody = page.locator('.stack-body');
  assert.ok(
    await stackBody.evaluate((body) => body.scrollHeight > body.clientHeight),
    'Fixture did not overflow the stack panel',
  );
  await stackBody.evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
    'Long stack overflowed the app window',
  );
  const addBounds = await addButton.boundingBox();
  const seedBounds = await page.getByRole('button', { name: 'Random seed' }).boundingBox();
  const panelBounds = await page.locator('.stack-panel').boundingBox();
  const toolsBounds = await page.locator('.viewport-tools').boundingBox();
  assert.ok(
    addBounds.y < panelBounds.y + 50 &&
      seedBounds.y < 52 &&
      toolsBounds.x > panelBounds.x + panelBounds.width,
    'Add stays in the stack heading; seed is in the toolbar and zoom over the canvas',
  );
  await writeFile(resolve(output, `${label}-long-stack.png`), await capture());
  await openCatalog();
  await writeFile(resolve(output, `${label}-picker-compact.png`), await capture());
  await page.keyboard.press('Escape');
  for (let extra = 0; extra < 5; extra++) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
  }
  assert.deepEqual(await recipe(), originalOrder);
  await page.getByRole('button', { name: 'Spatial crush', exact: true }).click();
  assert.ok(
    await page
      .locator('.effect-row-main')
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
  );
  await writeFile(resolve(output, `${label}-compact.png`), await capture());
  assert.deepEqual(errors, []);
  console.log(
    'Masking checks passed:',
    JSON.stringify({
      mode: label,
      backend,
      exports,
      photoSubjectDetected: true,
      cacheProtected: true,
    }),
  );
} catch (error) {
  try {
    await writeFile(
      resolve(output, `${label}-failure.json`),
      JSON.stringify(
        { error: String(error), pageErrors: errors, body: await page.locator('body').innerText() },
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
  await closeTestApp(app);
  console.log('Masking test app closed:', label);
}
