import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const output = resolve('test-results/ui-color');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app;
const errors = [];
async function start() {
  app = await electron.launch({ args: [resolve('apps/desktop'), '--smoke-test'], env });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  return page;
}
async function openColors(page) {
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  const item = page.getByRole('button', { name: 'UI Color', exact: true });
  const swatch = item.locator('.ui-color-menu-swatch');
  const box = await swatch.boundingBox();
  assert.equal(box.width, box.height);
  assert.equal(await swatch.evaluate((node) => getComputedStyle(node).borderRadius), '50%');
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'UI Color', exact: true });
  await dialog.waitFor();
  return dialog;
}
function luminance(hex) {
  const components = hex.match(/[a-f\d]{2}/gi).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}
try {
  let page = await start();
  let dialog = await openColors(page);
  const choices = dialog.getByRole('group', { name: 'UI accent colors' }).getByRole('button');
  assert.equal(await choices.count(), 16);
  await dialog
    .getByRole('button', { name: 'GLEECH Yellow', exact: true })
    .and(page.locator('[aria-pressed="true"]'))
    .waitFor();
  const colors = await choices.evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: node.getAttribute('aria-label'),
      color: node.querySelector('.ui-color-swatch').style.backgroundColor,
    })),
  );
  for (let index = 0; index < 16; index++) {
    const choice = choices.nth(index);
    const name = await choice.getAttribute('aria-label');
    await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    const actual = await page.evaluate(() => ({
      saved: localStorage.getItem('gleech.ui.color'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
      gleech: getComputedStyle(document.querySelector('.gleech-button')).backgroundColor,
      dot: getComputedStyle(document.querySelector('.brand-dot')).color,
    }));
    assert.equal(actual.accent, actual.saved);
    assert.equal(actual.gleech, colors[index].color);
    assert.equal(actual.dot, colors[index].color);
    const light = luminance(actual.saved);
    // Both accent text on elevated panels and dark text on accent buttons stay readable.
    assert.ok((light + 0.05) / (luminance('#1e1e20') + 0.05) >= 4.5, name);
    assert.ok((light + 0.05) / (luminance('#111114') + 0.05) >= 4.5, name);
  }
  await dialog.getByRole('button', { name: 'Teal', exact: true }).click();
  await captureTestWindow(app, resolve(output, 'teal-picker.png'));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page
    .getByRole('button', { name: 'UI Color', exact: true })
    .and(page.locator('[title="Current UI color: Teal"]'))
    .waitFor();
  await closeTestApp(app);
  app = null;
  page = await start();
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
    ),
    '#62d5bd',
  );
  dialog = await openColors(page);
  await dialog
    .getByRole('button', { name: 'Teal', exact: true })
    .and(page.locator('[aria-pressed="true"]'))
    .waitFor();
  await page.evaluate(() => localStorage.setItem('gleech.ui.color', 'invalid-color'));
  await page.reload();
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
    ),
    '#e9c46a',
  );
  dialog = await openColors(page);
  await captureTestWindow(app, resolve(output, 'default-picker.png'));
  assert.deepEqual(errors, []);
  const result = {
    colors: 16,
    contrast: true,
    emptyProject: true,
    restartPersistence: true,
    invalidSettingFallback: true,
    errors,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (app) await closeTestApp(app);
}
