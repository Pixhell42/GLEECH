import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { captureTestWindow } from './capture-test-window.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/window-controls');
await mkdir(output, { recursive: true });
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const image = resolve(output, 'source.png');
await sharp({ create: { width: 17, height: 11, channels: 4, background: '#987654' } })
  .png()
  .toFile(image);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: resolve(output, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const app = await electron.launch({
  args: [...(executablePath ? [] : [resolve(root, 'apps/desktop')]), '--smoke-test'],
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  env,
  timeout: 30000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  const dimensions = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { outer: window.getBounds(), content: window.getContentBounds() };
  });
  assert.equal(dimensions.outer.height, dimensions.content.height, 'No native title bar');
  console.log('Frameless dimensions verified');

  await page.getByRole('button', { name: 'Maximize window', exact: true }).click();
  await page.getByRole('button', { name: 'Restore window', exact: true }).waitFor();
  console.log('Maximize verified');
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
    true,
  );
  await page.getByRole('button', { name: 'Restore window', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize window', exact: true }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
    false,
  );

  // OS actions (including a title-bar double-click or snapping) must update the icon too.
  console.log('Restore verified');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.getByRole('button', { name: 'Restore window', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.getByRole('button', { name: 'Maximize window', exact: true }).waitFor();
  console.log('Native state synchronization verified');
  for (const [width, height] of [
    [1440, 940],
    [960, 640],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(...size);
      },
      [width, height],
    );
    await page.waitForFunction((width) => innerWidth === width, width, { polling: 100 });
    const layout = await page.locator('.toolbar').evaluate((toolbar) => {
      const bounds = toolbar.getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll('button, input')].filter(
        (element) => element.getClientRects().length > 0,
      );
      return {
        region: getComputedStyle(toolbar).webkitAppRegion,
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: controls.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label') ?? element.textContent,
            region: getComputedStyle(element).webkitAppRegion,
            fits:
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= bounds.top &&
              box.bottom <= bounds.bottom,
          };
        }),
      };
    });
    assert.equal(layout.region, 'drag');
    assert.equal(layout.overflow, false, `Overflow at ${width}px`);
    for (const button of layout.buttons) {
      assert.equal(button.region, 'no-drag', button.name);
      assert.equal(button.fits, true, `${button.name} outside toolbar at ${width}px`);
    }
    await captureTestWindow(app, resolve(output, `window-${width}.png`));
    console.log(`Layout ${width} verified`);
  }

  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.locator('.file-menu-items').waitFor();
  assert.equal(
    await page
      .locator('.file-menu-items')
      .evaluate((element) => getComputedStyle(element).webkitAppRegion),
    'no-drag',
  );
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'Rename project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Custom window test');
  await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
  await page.waitForFunction(() => document.title.includes('Custom window test'));
  await page.getByRole('spinbutton', { name: 'Master seed', exact: true }).fill('12345');
  await app.evaluate(({ dialog }, image) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] });
  }, image);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .locator('.status-bar')
    .getByRole('status')
    .filter({ hasText: 'Opened source.png' })
    .waitFor();

  // The new close button must enter the existing guarded document-close flow.
  await app.evaluate(({ dialog }) => {
    globalThis.windowClosePrompts = 0;
    dialog.showMessageBox = async () => {
      globalThis.windowClosePrompts++;
      return { response: 2, checkboxChecked: false };
    };
  });
  await page.getByRole('button', { name: 'Close window', exact: true }).click();
  await page
    .locator('.status-bar')
    .getByRole('status')
    .filter({ hasText: /^Canceled$/ })
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.windowClosePrompts), 1);
  assert.equal(page.isClosed(), false, 'Cancel must keep the window open');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await page.getByRole('button', { name: 'Close window', exact: true }).click();
  await page
    .locator('.status-bar')
    .getByRole('status')
    .filter({ hasText: 'Save canceled' })
    .waitFor();
  assert.equal(page.isClosed(), false, 'Canceling Save As must keep the window open');
  await page.getByRole('button', { name: 'Minimize window', exact: true }).click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    true,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.restore();
    window.hide();
  });
  console.log('Minimize verified');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const closed = page.waitForEvent('close');
  // A minimized hidden smoke window may suspend animation frames used by Playwright's click.
  await page.evaluate(() => document.querySelector('button[aria-label="Close window"]').click());
  await closed;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        frameless: true,
        minimize: true,
        maximizeRestore: true,
        nativeStateSync: true,
        layouts: [1440, 960],
        guardedClose: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await closeTestApp(app);
}
