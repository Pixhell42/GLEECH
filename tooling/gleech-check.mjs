import { captureTestWindow } from './capture-test-window.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';
import { generateVariations } from './gleech-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/gleech');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, label + '-profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 129,
  height = 97;
const pixels = Buffer.from(
  Uint8Array.from({ length: width * height * 4 }, (_, index) =>
    index % 4 === 3 ? [0, 1, 128, 255][Math.floor(index / 4) % 4] : (index * 13) % 256,
  ),
);
const path = resolve(output, label + '-source.png');
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
  timeout: 30000,
});
let page,
  exports = 0,
  thumbnails = 0;
const errors = [];
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return d.renderRevision === d.requestedRevision;
    },
    undefined,
    { timeout: 60000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
}
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  await settle();
}
const row = (id) => page.locator(`.effect-row[data-effect-id="${id}"]`);
async function gleech(level, policy) {
  await page.getByRole('button', { name: 'GLEECH', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GLEECH', exact: true });
  await dialog.getByRole('button', { name: level, exact: false }).click();
  if (policy === 'Preserve All and Add' || policy === 'Randomize and Add') {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
    );
    assert.equal(await dialog.locator('.gleech-mode-options > button').count(), 5);
    assert.ok(
      await dialog.evaluate(
        (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
      ),
    );
    await captureTestWindow(app, resolve(output, label + '-policies.png'));
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await captureTestWindow(app, resolve(output, label + '-policies.png'));
  }
  if (policy) await dialog.getByRole('button', { name: policy, exact: false }).click();
  await dialog.waitFor({ state: 'hidden' });
  await settle();
}
async function exportExact() {
  const recipe = await state(),
    target = resolve(output, `${label}-${++exports}.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, target);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(target) })
    .waitFor({ timeout: 60000 });
  const actual = await sharp(target).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: Uint8Array.from(pixels).buffer }, recipe.effects, {
          masterSeed: recipe.masterSeed,
        }).pixels,
      ),
    ),
  );
}
async function readyPreviews() {
  await page.locator('.variation-grid[aria-busy="false"]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.variation-tile img').count(), 9);
  assert.equal(await page.locator('.variation-tile:disabled').count(), 0);
}
async function verifyPreviews(base) {
  await readyPreviews();
  const seed = Number(await page.locator('.variation-grid').getAttribute('data-set-seed'));
  const intensity = Number(
    await page.getByRole('slider', { name: 'GLEECH intensity' }).inputValue(),
  );
  const candidates = generateVariations(base.effects, seed, intensity);
  const tiles = await page
    .locator('.variation-tile')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.dataset.candidateId, src: node.querySelector('img').src })),
    );
  for (let index = 0; index < 9; index++) {
    assert.equal(tiles[index].id, candidates[index].id);
    const expected = new Uint8Array(
      renderEffects(
        { width, height, pixels: Uint8Array.from(pixels).buffer },
        candidates[index].effects,
        { masterSeed: base.masterSeed },
      ).pixels,
    );
    const { data, info } = await sharp(Buffer.from(tiles[index].src.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    // Canvas PNGs discard invisible RGB and round premultiplied colors. Compare
    // displayed colors, while full exports below retain exact original RGBA.
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      assert.equal(data[pixel + 3], expected[pixel + 3]);
      for (let channel = 0; channel < 3; channel++)
        assert.ok(
          Math.abs(
            Math.round((data[pixel + channel] * data[pixel + 3]) / 255) -
              Math.round((expected[pixel + channel] * expected[pixel + 3]) / 255),
          ) <= 1,
        );
    }
    thumbnails++;
  }
  return candidates;
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'GLEECH', exact: true }).isDisabled(), true);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await settle();
  assert.equal(await page.getByRole('button', { name: 'Var', exact: true }).isDisabled(), true);
  for (const [level, min, max] of [
    ['Simple', 2, 3],
    ['Complex', 5, 7],
    ['GLEECHED', 9, 12],
  ]) {
    await gleech(level);
    const generated = await state();
    assert.ok(generated.effects.length >= min && generated.effects.length <= max);
    assert.equal(generated.masterSeed, 8172);
    assert.ok(generated.effects.every((effect) => !effect.locked));
    if (level === 'GLEECHED') await exportExact();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await state()).effects.length, 0);
  }
  console.log(label + ': empty-stack complexity and export passed');
  await add('Wave distortion');
  const wave = (await state()).effects[0].instanceId;
  await page.getByRole('slider', { name: 'Frequency', exact: true }).fill('7');
  await add('Noise / Grain');
  const noise = (await state()).effects[1].instanceId;
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('perlin');
  await row(noise).locator('.paint-mask-button').click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true }),
    bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await row(noise).locator('.effect-lock').click();
  const baseline = await state(),
    lockedNoise = baseline.effects[1];
  assert.equal(lockedNoise.locked, true);
  assert.equal(lockedNoise.paintedMask.strokes.length, 1);
  await page.getByRole('slider', { name: 'Intensity', exact: true }).fill('0.4');
  assert.equal((await state()).effects[1].params.intensity, 0.4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), baseline);
  for (const [level, policy] of [
    ['Simple', 'Use Existing Only'],
    ['Simple', 'Preserve All and Add'],
    ['Complex', 'Randomize and Add'],
    ['Complex', 'Keep Locked Only'],
    ['GLEECHED', 'Replace All'],
  ]) {
    await gleech(level, policy);
    const changed = await state();
    assert.equal(changed.masterSeed, baseline.masterSeed);
    if (policy === 'Replace All')
      assert.ok(changed.effects.every((effect) => !effect.locked && effect.instanceId !== noise));
    else
      assert.deepEqual(
        changed.effects.find((effect) => effect.instanceId === noise),
        lockedNoise,
      );
    if (policy === 'Use Existing Only')
      assert.deepEqual(
        changed.effects.map((effect) => effect.instanceId),
        baseline.effects.map((effect) => effect.instanceId),
      );
    if (policy === 'Preserve All and Add') {
      assert.deepEqual(changed.effects.slice(0, baseline.effects.length), baseline.effects);
      const added = changed.effects.slice(baseline.effects.length);
      assert.ok(added.length >= 2 && added.length <= 3);
      assert.ok(added.every((effect) => effect.enabled && !effect.locked));
      await exportExact();
    }
    if (policy === 'Randomize and Add') {
      assert.deepEqual(
        changed.effects
          .slice(0, baseline.effects.length)
          .map((effect) => [effect.instanceId, effect.type, effect.enabled, effect.paintedMask]),
        baseline.effects.map((effect) => [
          effect.instanceId,
          effect.type,
          effect.enabled,
          effect.paintedMask,
        ]),
      );
      assert.notDeepEqual(changed.effects[0].params, baseline.effects[0].params);
      assert.ok(
        changed.effects.length >= baseline.effects.length + 5 &&
          changed.effects.length <= baseline.effects.length + 7,
      );
      assert.ok(
        changed.effects
          .slice(baseline.effects.length)
          .every((effect) => effect.enabled && !effect.locked),
      );
      await exportExact();
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), baseline);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), changed);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
  }
  console.log(label + ': lock protection, manual edits and all stack policies passed');
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    window.__gleechWorkers = [];
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        window.__gleechWorkers.push(this);
      }
    };
  });
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await verifyPreviews(baseline);
  await page.evaluate(() =>
    window.__gleechWorkers.at(-1).dispatchEvent(
      new ErrorEvent('error', {
        message: 'Simulated preview worker failure',
        cancelable: true,
      }),
    ),
  );
  await page.getByRole('button', { name: 'New Set', exact: true }).click();
  await page.getByRole('button', { name: 'Retry previews', exact: true }).waitFor();
  await page.locator('.variation-grid[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.variation-tile:disabled').count(), 9);
  await page.getByRole('button', { name: 'Retry previews', exact: true }).click();
  await verifyPreviews(baseline);
  assert.deepEqual(await state(), baseline);
  const firstIds = await page
    .locator('.variation-tile')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.candidateId));
  await page.getByRole('slider', { name: 'GLEECH intensity' }).fill('0');
  const stable = await verifyPreviews(baseline);
  assert.ok(
    stable.every(
      (candidate) => JSON.stringify(candidate.effects) === JSON.stringify(baseline.effects),
    ),
  );
  await page.getByRole('slider', { name: 'GLEECH intensity' }).fill('0.85');
  await readyPreviews();
  assert.deepEqual(
    await page
      .locator('.variation-tile')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.candidateId)),
    firstIds,
  );
  await page.getByRole('button', { name: 'New Set', exact: true }).click();
  await page.getByRole('button', { name: 'New Set', exact: true }).click();
  const refreshed = await verifyPreviews(baseline);
  assert.equal(await page.getByRole('slider', { name: 'GLEECH intensity' }).inputValue(), '0.85');
  assert.ok(refreshed.every((candidate) => !firstIds.includes(candidate.id)));
  assert.deepEqual(await state(), baseline);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.locator('.variation-dialog').evaluate((dialog) => {
    dialog.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
        stayAwake: true,
        stayHidden: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, label + '-var.png'), Buffer.from(screenshot, 'base64'));
  const size = await page.locator('.variation-dialog').boundingBox();
  assert.ok(
    size.x >= 0 && size.y >= 0 && size.x + size.width <= 960 && size.y + size.height <= 640,
  );
  const tiles = await page.locator('.variation-tile').evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
    }),
  );
  assert.ok(
    tiles.every(
      (tile) => tile.top >= 0 && tile.bottom <= 640 && tile.left >= 0 && tile.right <= 960,
    ),
    'All nine previews must fit in the compact window',
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.variation-dialog').count(), 0);
  assert.deepEqual(await state(), baseline);
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  const selected = (await verifyPreviews(baseline))[8];
  await page.getByRole('button', { name: 'Apply distant variation 3', exact: true }).click();
  await page.locator('.variation-dialog').waitFor({ state: 'hidden' });
  const applied = await state();
  assert.deepEqual(applied.effects, selected.effects);
  assert.equal(applied.masterSeed, baseline.masterSeed);
  assert.deepEqual(applied.effects[1], lockedNoise);
  await exportExact();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), baseline);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), applied);
  const project = resolve(output, label + '.gleech');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, project);
  await fileAction(page, 'Save project Ctrl+S');
  await page
    .getByRole('status')
    .filter({ hasText: 'Saved ' + basename(project) })
    .waitFor();
  await row(noise).locator('.effect-lock').click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, project);
  await page.keyboard.press('Control+o');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(project) })
    .waitFor();
  assert.deepEqual(await state(), applied);
  assert.equal(await row(noise).locator('.effect-lock').getAttribute('aria-pressed'), 'true');
  await exportExact();
  await row(wave).locator('.effect-lock').click();
  assert.equal(await page.getByRole('button', { name: 'Var', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  const report = {
    mode: label,
    complexity: true,
    policies: true,
    locks: true,
    masks: true,
    stableSlider: true,
    newSet: true,
    cancel: true,
    singleUndo: true,
    projectPersistence: true,
    workerRecovery: true,
    exactExports: exports,
    verifiedThumbnails: thumbnails,
    result: 'passed',
  };
  await writeFile(resolve(output, label + '-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await writeFile(
    resolve(output, label + '-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
        state: await state().catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
