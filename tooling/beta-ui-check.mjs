import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';

const root = process.cwd();
const output = resolve(root, 'test-results/beta-ui');
await mkdir(output, { recursive: true });
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, `${label}-source.png`);
const projectPath = resolve(output, `${label}.gleech`);
await sharp({ create: { width: 64, height: 48, channels: 4, background: '#b8875c' } })
  .png()
  .toFile(imagePath);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const launch = () =>
  electron.launch({
    args: [
      ...(exe ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(exe ? { executablePath: resolve(exe) } : {}),
  });
let app = await launch();
const errors = [];
let page;
async function setup() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(
    ({ BrowserWindow, dialog, shell }, selection) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setBackgroundThrottling(false);
      win.setContentSize(1440, 900);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selection.image] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selection.project });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      globalThis.__betaExternalLinks = [];
      shell.openExternal = async (url) => {
        globalThis.__betaExternalLinks.push(url);
      };
    },
    { image: imagePath, project: projectPath },
  );
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await page.waitForFunction(() => innerWidth === 1440);
}
const settle = () =>
  page.waitForFunction(() => {
    const image = document.querySelector('.image-layer');
    return Boolean(image && image.dataset.renderRevision === image.dataset.requestedRevision);
  });
const widths = () =>
  page.evaluate(() =>
    ['.stack-panel', '.detail-panel'].map(
      (selector) => document.querySelector(selector).getBoundingClientRect().width,
    ),
  );
const frame = () =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const section = (id) => page.locator(`[data-section-id="${id}"]`);
const expanded = (id) => section(id).locator(':scope > h3 > button').getAttribute('aria-expanded');
async function add(name) {
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  await settle();
}
try {
  await setup();
  let toggle = page.getByRole('button', { name: 'File menu', exact: true });
  let menu = page.locator('.file-menu-items');
  await toggle.click();
  assert.ok(await menu.evaluate((node) => node.scrollHeight <= node.clientHeight));
  await menu.getByRole('button', { name: 'Library', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await menu.getByRole('button', { name: 'Filters and Presets', exact: true }).waitFor();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open sample image');
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(
    await menu.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-expanded'),
    'false',
  );
  await menu.getByRole('button', { name: 'Library', exact: true }).click();
  await menu.getByRole('button', { name: 'Export', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(
    await menu.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(await page.locator('.file-menu-popup:popover-open').count(), 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await toggle.click();
  // The version-copy button now follows Exit and is the final focusable item.
  await menu.getByRole('button', { name: 'Copy GLEECH version', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="File menu"]')?.getAttribute('aria-expanded') === 'false',
  );
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Tab out dismisses the menu');
  await fileAction(page, 'Discord Community');
  assert.deepEqual(await app.evaluate(() => globalThis.__betaExternalLinks), [
    'https://discord.gg/b7Mq8fjvk',
  ]);
  await fileAction(page, 'Filters and Presets');
  await page.locator('.effect-picker').waitFor();
  await page.keyboard.press('Escape');
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await settle();
  await add('Motion Mosh');
  const recipe = await page.locator('.image-layer').getAttribute('data-render-recipe');
  await section('blending').getByRole('button', { name: 'Blending', exact: true }).click();
  assert.equal(await expanded('blending'), 'false');
  await page.getByRole('button', { name: 'Collapse All', exact: true }).click();
  assert.equal(await expanded('application'), 'false');
  assert.equal(await expanded('effect:motion-mosh:settings'), 'false');
  await page.getByRole('button', { name: 'Open All', exact: true }).click();
  await section('effect:motion-mosh:settings')
    .getByRole('button', { name: 'Blocks & motion', exact: true })
    .click();
  assert.equal(await expanded('application'), 'true');
  assert.equal(await expanded('effect:motion-mosh:settings'), 'false');
  assert.equal(await page.locator('.image-layer').getAttribute('data-render-recipe'), recipe);
  assert.deepEqual(await widths(), [256, 300]);
  let left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  let right = page.getByRole('separator', { name: 'Resize right panel', exact: true });
  const rail = await left.boundingBox();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 120);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2 + 110, rail.y + 120, { steps: 8 });
  await page.mouse.up();
  assert.ok((await widths())[0] >= 360, 'Left panel grows through native mouse dragging');
  await left.press('Home');
  await right.press('ArrowLeft');
  assert.deepEqual(await widths(), [256, 310]);
  await left.press('ArrowRight');
  assert.deepEqual(await widths(), [266, 310]);
  await fileAction(page, 'Save project Ctrl+S');
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  await closeTestApp(app);
  app = await launch();
  await setup();
  toggle = page.getByRole('button', { name: 'File menu', exact: true });
  menu = page.locator('.file-menu-items');
  left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  right = page.getByRole('separator', { name: 'Resize right panel', exact: true });
  assert.deepEqual(await widths(), [266, 310], 'Widths persist across a complete app restart');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await settle();
  assert.equal(
    await expanded('effect:motion-mosh:settings'),
    'false',
    'Collapsed settings persist after reopening',
  );
  assert.equal(await expanded('application'), 'true');
  await page.getByRole('button', { name: 'Open All', exact: true }).click();
  await add('Depth Field');
  await section('height-field').getByRole('button', { name: 'Height field', exact: true }).click();
  assert.equal(
    await page.getByRole('combobox', { name: 'Depth preview', exact: true }).isVisible(),
    false,
  );
  await page.getByRole('button', { name: 'Open All', exact: true }).click();
  assert.equal(
    await page.getByRole('combobox', { name: 'Depth preview', exact: true }).isVisible(),
    true,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await left.press('Home');
  await right.press('Home');
  assert.deepEqual(await widths(), [196, 260]);
  await left.press('End');
  await right.press('End');
  assert.ok(await page.locator('.image-workspace').evaluate((node) => node.clientWidth >= 280));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await toggle.click();
  await menu.getByRole('button', { name: 'Library', exact: true }).click();
  for (const panel of [menu, page.getByRole('group', { name: 'Library', exact: true })]) {
    assert.ok(
      await panel.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight &&
          rect.left >= 0 &&
          node.scrollWidth <= node.clientWidth
        );
      }),
      'Menus fit the minimum window without horizontal scrolling',
    );
  }
  await frame();
  await captureTestWindow(app, resolve(output, `${label}-minimum-menu.png`));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await page.waitForFunction(() => innerWidth === 1440);
  await left.press('Home');
  await right.press('Home');
  await fileAction(page, 'Open sample image');
  await settle();
  await add('Motion Mosh');
  await page.getByRole('button', { name: 'Open All', exact: true }).click();
  await right.press('ArrowLeft');
  await frame();
  await captureTestWindow(app, resolve(output, `${label}-panels.png`));
  assert.deepEqual(errors, []);
  const result = {
    menu: true,
    discord: true,
    mouseResize: true,
    keyboardResize: true,
    restartPersistence: true,
    collapsedSections: true,
    minimumLayout: true,
    errors,
  };
  await writeFile(resolve(output, `${label}-result.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await closeTestApp(app);
}
