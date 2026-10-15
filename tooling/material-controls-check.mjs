import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';

const output = resolve('test-results/material-controls');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  args: [
    ...(executablePath ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, resolve('apps/desktop/resources/presets/statue.png'));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('status').filter({ hasText: 'Opened statue.png' }).first().waitFor();
  async function add(name) {
    await page.getByRole('button', { name: 'Add effect', exact: true }).click();
    await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  }
  async function settle() {
    await page.waitForFunction(
      () => {
        const d = document.querySelector('.image-layer')?.dataset;
        return d && d.renderRevision === d.requestedRevision;
      },
      undefined,
      { timeout: 60000 },
    );
  }
  await add('System Crash');
  for (const placement of ['random', 'grid', 'horizontal', 'vertical']) {
    await page
      .getByRole('combobox', { name: 'Window placement', exact: true })
      .selectOption(placement);
    for (const axis of ['Horizontal spread', 'Vertical spread']) {
      const control = page.getByRole('slider', { name: axis, exact: true });
      await control.fill('0');
      await settle();
      const before = await page.locator('.image-layer').screenshot();
      await control.fill('100');
      await settle();
      const after = await page.locator('.image-layer').screenshot();
      assert.ok(
        !before.equals(after),
        `${placement}: ${axis} did not change the displayed preview.`,
      );
    }
  }
  for (const name of ['Contour Melt', 'Filament Flow']) {
    await add(name);
    assert.equal(await page.getByRole('slider', { name: 'Hue', exact: true }).count(), 1);
    assert.equal(
      await page.locator('.inspector-panel').getByText('Accent color', { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.locator('.inspector-panel').getByText('Shadow color', { exact: true }).count(),
      0,
    );
    await page.getByRole('slider', { name: 'Hue', exact: true }).fill('120');
  }
  await add('Mandelbrot Slices');
  await page.getByRole('slider', { name: 'Slice', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Fractal location', exact: true }).selectOption('1');
  const canvas = dialog.getByRole('img', { name: 'Fractal navigator', exact: true });
  await page.waitForFunction(
    () => document.querySelector('.fractal-navigator canvas')?.dataset.ready === 'true',
  );
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(250);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const zoom = Number(
    await page.getByRole('slider', { name: 'Fractal zoom', exact: true }).inputValue(),
  );
  assert.ok(zoom > 30 && zoom <= 128, `Explorer zoom ${zoom}`);
  const x = Number(
    await page.getByRole('slider', { name: 'Fractal real', exact: true }).inputValue(),
  );
  assert.ok(x !== -0.77, 'Explorer pan did not update the fractal coordinate.');
  assert.equal(await page.getByRole('slider', { name: 'Slice', exact: true }).inputValue(), '3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.screenshot({ path: resolve(output, `${cpu ? 'cpu' : 'gpu'}.png`) });
  assert.deepEqual(errors, []);
  console.log(`Material controls and Mandelbrot explorer passed (${cpu ? 'cpu' : 'gpu'}).`);
} finally {
  await closeTestApp(app);
}
