import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
const output = resolve('test-results/slider-edge');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const label = cpu ? 'cpu' : 'gpu';
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${label}-profile-`)),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, `${label}-statue.png`);
await sharp('apps/desktop/resources/presets/statue.png').resize(1024, 1024).png().toFile(imagePath);
const app = await electron.launch({
  args: [
    resolve('apps/desktop'),
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
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: `Opened ${label}-statue.png` })
    .first()
    .waitFor();
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Liquid Marbling', exact: true })
    .click();
  const slider = page.getByRole('slider', { name: 'Phase', exact: true });
  for (const edge of ['center', 'bottom', 'top']) {
    await slider.fill('0.5');
    await slider.evaluate((node, edge) => {
      document.activeElement?.blur();
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const panel = node.closest('.inspector-panel');
      const range = node.getBoundingClientRect(),
        bounds = panel.getBoundingClientRect();
      if (edge === 'bottom') panel.scrollTop += range.y + range.height / 2 - (bounds.bottom - 5);
      if (edge === 'top') panel.scrollTop += range.y + range.height / 2 - (bounds.top + 5);
    }, edge);
    const before = await slider.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    const after = await slider.boundingBox();
    console.log(JSON.stringify({ edge, before, after, value: await slider.inputValue() }));
    try {
      assert.ok(Math.abs(after.y - before.y) <= 1, `Phase moved when focused at ${edge}`);
      for (const fraction of [0.2, 0.8, 0.05, 0.95, 0.65]) {
        await page.mouse.move(
          before.x + 9 + (before.width - 18) * fraction,
          before.y + before.height / 2,
          { steps: 4 },
        );
        const value = Number(await slider.inputValue());
        assert.ok(
          Math.abs(value - fraction) < 0.04,
          `Phase stuck at ${edge}: ${value}, expected ${fraction}`,
        );
      }
    } finally {
      await page.mouse.up();
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Phase"]').value === '0.5',
    );
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Phase"]').value === '0.65',
    );
  }
  assert.deepEqual(errors, []);
  console.log(`Slider edge checks passed (${label}).`);
} finally {
  await closeTestApp(app);
}
