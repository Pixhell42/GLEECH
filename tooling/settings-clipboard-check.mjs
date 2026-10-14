import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const colorsOnly = process.argv.includes('--colors-only');
const label = `${colorsOnly ? 'colors-' : ''}${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/settings-clipboard');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, label + '-profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 127,
  height = 83;
const rgba = Buffer.from(
  Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 13) % 256,
  ),
);
const imagePath = resolve(output, label + '-input.png');
await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
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
  exports = 0;
const errors = [];
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
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
  return page.locator('.image-layer').evaluate((e) => ({
    effects: JSON.parse(e.dataset.renderRecipe),
    masterSeed: Number(e.dataset.renderSeed),
  }));
}
const slider = (name) => page.getByRole('slider', { name, exact: true });
const toast = (text) => page.locator('.detail-loading').getByText(text, { exact: true }).waitFor();
async function rememberClipboard() {
  return app.evaluate(async ({ clipboard }) => {
    globalThis.__settingsTestLast = await clipboard.readText();
    return globalThis.__settingsTestLast;
  });
}
async function menu(target, action) {
  const previous = await page
    .locator('[data-feedback-id]')
    .evaluateAll((elements) => elements[0]?.getAttribute('data-feedback-id') ?? null);
  await target.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Copy and paste settings', exact: true });
  await menu.waitFor();
  await menu.getByRole('menuitem', { name: action, exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  if (action === 'Copy') {
    await page.waitForFunction((previous) => {
      const feedback = document.querySelector('[data-feedback-id]');
      return (
        feedback &&
        feedback.getAttribute('data-feedback-id') !== previous &&
        feedback.textContent.startsWith('Copied')
      );
    }, previous);
    await rememberClipboard();
  }
}
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  await settle();
}
const row = (id) => page.locator(`.effect-row[data-effect-id="${id}"]`);
async function select(id) {
  await row(id).locator('.effect-select').click();
  await settle();
}
async function exportExact() {
  const recipe = await state(),
    path = resolve(output, `${label}-${++exports}.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(path) })
    .waitFor({ timeout: 60000 });
  const pixels = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    pixels.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: Uint8Array.from(rgba).buffer }, recipe.effects, {
          masterSeed: recipe.masterSeed,
        }).pixels,
      ),
    ),
  );
}
async function colorChecks() {
  const field = (name) => page.getByRole('textbox', { name: name + ' hex', exact: true });
  const effect = async (id) => (await state()).effects.find((e) => e.instanceId === id);
  async function color(name, value) {
    await field(name).fill(value);
    await field(name).press('Tab');
    await settle();
  }
  await add('Halftone');
  const print = (await state()).effects.at(-1).instanceId;
  await color('Ink color', '#123456');
  await menu(field('Ink color'), 'Copy');
  await toast('Copied Ink color');
  assert.equal(JSON.parse(await rememberClipboard()).kind, 'color');
  await add('Gradient Map');
  const map = (await state()).effects.at(-1).instanceId;
  await menu(field('Highlights'), 'Paste');
  await toast('Pasted Shadows');
  assert.equal((await effect(map)).params.shadows, '#123456');
  assert.equal((await effect(map)).params.highlights, '#f6c65b');
  await app.evaluate(async ({ clipboard }) => {
    await clipboard.writeText(' #8CF ');
    globalThis.__settingsTestLast = await clipboard.readText();
  });
  await menu(field('Highlights'), 'Paste');
  await toast('Pasted Highlights');
  assert.equal((await effect(map)).params.highlights, '#88ccff');
  await select(print);
  await page
    .getByRole('group', { name: 'Paper color mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await color('Paper color', '#654321');
  await color('Paper color end', '#abcdef');
  await slider('Paper color direction').fill('77');
  await slider('Paper color position X').fill('26');
  await slider('Paper color position Y').fill('71');
  await slider('Paper color span').fill('140');
  await menu(
    page.getByRole('img', { name: 'Paper color gradient preview', exact: true }).locator('..'),
    'Copy',
  );
  await toast('Copied Paper color gradient');
  const packet = JSON.parse(await rememberClipboard());
  assert.deepEqual(packet.gradient, {
    mode: 'gradient',
    end: '#abcdef',
    stops: '[]',
    angle: 77,
    centerX: 26,
    centerY: 71,
    span: 140,
  });
  await add('Glow');
  const glow = (await state()).effects.at(-1).instanceId;
  const before = await effect(glow);
  await menu(row(glow).locator('.effect-select'), 'Paste');
  await toast('Pasted Halo color gradient');
  const applied = await effect(glow);
  for (const [key, value] of Object.entries({
    glowColor: '#654321',
    glowColorEnd: '#abcdef',
    glowColorMode: 'gradient',
    glowColorAngle: 77,
    glowColorCenterX: 26,
    glowColorCenterY: 71,
    glowColorSpan: 140,
    glowColorStops: '[]',
  }))
    assert.equal(applied.params[key], value);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await effect(glow), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await effect(glow), applied);
  await select(map);
  await menu(
    page.getByRole('img', { name: 'Gradient Map tonal ramp', exact: true }).locator('..'),
    'Copy',
  );
  await toast('Copied Shadows gradient');
  assert.deepEqual(JSON.parse(await rememberClipboard()).gradient, {
    mode: 'gradient',
    end: '#88ccff',
    stops: '[]',
  });
  await select(print);
  await menu(row(print).locator('.effect-select'), 'Paste');
  await toast('Pasted Ink color gradient');
  assert.equal((await effect(print)).params.foregroundColor, '#123456');
  assert.equal((await effect(print)).params.foregroundColorEnd, '#88ccff');
  await exportExact();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(100);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, label + '-colors.png'), Buffer.from(png, 'base64'));
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(async ({ BrowserWindow, dialog, clipboard, ClipboardItem }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    globalThis.__settingsTestBackup = [];
    for (const item of await clipboard.read()) {
      if (!item.types.length) continue;
      const formats = {};
      for (const type of item.types) formats[type] = await item.getType(type);
      globalThis.__settingsTestBackup.push(new ClipboardItem(formats));
    }
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await settle();
  if (!colorsOnly) {
    await add('Blur');
    const blur = (await state()).effects[0].instanceId;
    await slider('Radius').fill('4');
    await menu(slider('Radius'), 'Copy');
    await toast('Copied Radius');
    const notification = await page.locator('.detail-loading').boundingBox();
    const viewport = await page.locator('.viewport').boundingBox();
    assert.ok(Math.abs(notification.x - viewport.x - 18) < 2);
    assert.ok(
      notification.y + notification.height < viewport.y + viewport.height - 52,
      'Clipboard notification stays above floating canvas controls',
    );
    await page.waitForTimeout(100);
    const notificationPng = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(
      resolve(output, label + '-notification.png'),
      Buffer.from(notificationPng, 'base64'),
    );
    const radius = JSON.parse(await rememberClipboard());
    assert.equal(radius.key, 'radius');
    assert.equal(radius.value, 4);
    await add('Hue / Saturation');
    const tone = (await state()).effects[1].instanceId;
    const before = await state();
    await menu(row(tone).locator('.effect-select'), 'Paste');
    await toast('Nothing pasted');
    assert.deepEqual(await state(), before);
    await select(blur);
    await slider('Opacity').fill('0.4');
    await menu(slider('Opacity'), 'Copy');
    await toast('Copied Opacity');
    await select(tone);
    await slider('Lightness').fill('0.7');
    await menu(slider('Lightness'), 'Paste');
    await toast('Pasted Opacity');
    assert.equal((await state()).effects[1].params.amount, 0.4);
    assert.equal((await state()).effects[1].params.lightness, 0.7);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await state()).effects[1].params.amount, 1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal((await state()).effects[1].params.amount, 0.4);
    await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('left');
    await slider('Coverage').fill('0.7');
    await menu(slider('Coverage'), 'Copy');
    await toast('Copied Coverage');
    await select(blur);
    await menu(row(blur).locator('.effect-select'), 'Paste');
    await toast('Pasted Coverage');
    assert.equal((await state()).effects[0].application.coverage, 0.7);
    await select(tone);
    await row(tone).locator('.paint-mask-button').click();
    await slider('Brush size').fill('30');
    const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
    const box = await surface.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle();
    const mask = (await state()).effects[1].paintedMask;
    assert.equal(mask.strokes.length, 1);
    await menu(surface, 'Copy');
    await toast('Copied mask');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await menu(row(blur).locator('.paint-mask-button'), 'Paste');
    await toast('Pasted mask');
    assert.deepEqual((await state()).effects[0].paintedMask, mask);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await state()).effects[0].paintedMask, undefined);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual((await state()).effects[0].paintedMask, mask);
    await menu(row(tone).locator('.effect-select'), 'Copy');
    await toast('Copied Hue / Saturation settings');
    const whole = JSON.parse(await rememberClipboard());
    assert.deepEqual(whole.effect.paintedMask, mask);
    await menu(row(blur).locator('.effect-select'), 'Paste');
    await toast('Pasted Blur settings');
    const applied = (await state()).effects[0];
    assert.equal(applied.type, 'blur');
    assert.equal(applied.params.amount, 0.4);
    assert.deepEqual(applied.application, (await state()).effects[1].application);
    assert.equal(applied.params.radius, 4);
    await exportExact();
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText('GLEECH clipboard test: ordinary text');
      globalThis.__settingsTestLast = await clipboard.readText();
    });
    const beforeText = await state();
    await menu(row(blur).locator('.effect-select'), 'Paste');
    await toast('Nothing pasted');
    assert.deepEqual(await state(), beforeText);
    await row(blur).locator('.effect-select').click({ button: 'right' });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await add('Noise / Grain');
    const noise = (await state()).effects.at(-1).instanceId;
    await menu(row(noise).locator('.effect-select'), 'Duplicate');
    await toast('Duplicated filter');
    const duplicated = await state(),
      copy = duplicated.effects.at(-1),
      original = duplicated.effects.at(-2);
    assert.notEqual(copy.instanceId, noise);
    assert.equal(copy.patternId, noise);
    assert.deepEqual(copy.params, original.params);
    assert.equal(copy.seedOffset, original.seedOffset);
    assert.equal(
      await page.locator('.effect-row').first().getAttribute('data-effect-id'),
      copy.instanceId,
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await state()).effects.length, 3);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), duplicated);
    await exportExact();
    const projectPath = resolve(output, label + '.gleech');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await page
      .getByRole('status')
      .filter({ hasText: 'Saved ' + basename(projectPath) })
      .waitFor();
    await slider('Intensity').fill('0.2');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, projectPath);
    await page.keyboard.press('Control+o');
    await page
      .getByRole('status')
      .filter({ hasText: 'Opened ' + basename(projectPath) })
      .waitFor();
    assert.deepEqual(await state(), duplicated);
    await exportExact();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
    );
    await row(copy.instanceId).locator('.effect-select').click({ button: 'right' });
    const popup = await page.getByRole('menu').boundingBox();
    assert.ok(
      popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= 960 && popup.y + popup.height <= 640,
    );
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await toast('Duplicated filter');
    await settle();
    await page.mouse.move(1, 1);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(resolve(output, label + '-compact.png'), Buffer.from(png, 'base64'));
  }
  await colorChecks();
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  const report = {
    mode: label,
    exports,
    ...(colorsOnly
      ? {}
      : {
          parameterRouting: true,
          maskCreation: true,
          wholeFilterPaste: true,
          duplicatePattern: true,
          undo: true,
          notifications: true,
          ordinaryTextNoOp: true,
          projectPersistence: true,
          keyboardMenu: true,
        }),
    colorRouting: true,
    rawHexPaste: true,
    gradientTransfer: true,
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
  await app
    .evaluate(async ({ clipboard }) => {
      if (
        globalThis.__settingsTestLast !== undefined &&
        (await clipboard.readText()) === globalThis.__settingsTestLast
      ) {
        if (globalThis.__settingsTestBackup?.length)
          await clipboard.write(globalThis.__settingsTestBackup);
        else clipboard.clear();
      }
    })
    .catch(() => {});
  await closeTestApp(app);
}
