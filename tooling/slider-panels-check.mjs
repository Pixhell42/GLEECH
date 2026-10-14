import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/slider-panels');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, 'portrait.png');
await sharp({ create: { width: 256, height: 512, channels: 4, background: '#ac8040' } })
  .png()
  .toFile(imagePath);
const app = await electron.launch({
  args: [
    resolve(root, 'apps/desktop'),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
let page;
const errors = [];
const failures = [];
let drags = 0;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  async function drag(slider, id) {
    assert.equal(await slider.count(), 1, `Missing slider: ${id}`);
    assert.ok(await slider.isVisible(), `Hidden slider: ${id}`);
    assert.ok(await slider.isEnabled(), `Disabled slider: ${id}`);
    const original = await slider.inputValue();
    const limits = await slider.evaluate((n) => ({
      min: Number(n.min || 0),
      max: Number(n.max || 100),
      step: Number(n.step || 1),
    }));
    await slider.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    const at = (fraction) => box.x + 12 + (box.width - 24) * fraction;
    await page.mouse.move(at(0.5), y);
    await page.mouse.down();
    try {
      for (const fraction of [0.75, 0, 1, 0.25]) {
        await page.mouse.move(at(fraction), y);
        const bounds = await slider.boundingBox();
        const actual = Number(await slider.inputValue());
        const expected = limits.min + (limits.max - limits.min) * fraction;
        const tolerance = (limits.max - limits.min) * 0.08 + limits.step;
        if (
          Math.abs(bounds.y - box.y) > 1 ||
          Math.abs(bounds.height - box.height) > 1 ||
          Math.abs(actual - expected) > tolerance
        )
          throw new Error(
            JSON.stringify({
              expected,
              actual,
              initialY: box.y,
              y: bounds.y,
              initialHeight: box.height,
              height: bounds.height,
            }),
          );
      }
      drags++;
      if (drags % 25 === 0) console.log(JSON.stringify({ drags, failures: failures.length }));
    } catch (error) {
      failures.push({ id, error: String(error) });
    } finally {
      await page.mouse.up();
      if (await slider.count()) await slider.fill(original);
    }
  }

  await page.getByRole('status').filter({ hasText: 'Opened portrait.png' }).first().waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  async function add(name) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  }
  const choose = (label, value) =>
    page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
  const slider = (label) => page.getByRole('slider', { name: label, exact: true });
  const remove = () =>
    page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  for (const [name, mode, label] of [
    ['Lens Distortion', null, 'Barrel / Pincushion'],
    ['CRT', null, 'Bloom'],
    ['Glyph Renderer', ['Style', 'braille'], 'Dot / block threshold'],
    ['Blur', ['Style', 'radial'], 'Spin / Zoom balance'],
    ['Spatial crush', ['Sampling', 'dirty-nearest'], 'Grid jitter'],
  ]) {
    await add(name);
    if (mode) await choose(...mode);
    await drag(slider(label), name + ':' + label);
    if (name === 'CRT') {
      const bloom = slider('Bloom');
      const radius = slider('Bloom radius');
      const original = await bloom.inputValue();
      await bloom.focus();
      await page.keyboard.down('Home');
      assert.equal(await bloom.inputValue(), '0');
      assert.equal(await radius.count(), 1, 'Keep dependent controls during keyboard input');
      await page.keyboard.up('Home');
      assert.equal(await radius.count(), 0, 'Refresh dependent controls after key release');
      await bloom.fill(original);
      await bloom.dispatchEvent('pointerdown', { pointerId: 1, button: 0 });
      await bloom.fill('0');
      assert.equal(await radius.count(), 1);
      await bloom.dispatchEvent('pointercancel', { pointerId: 1 });
      assert.equal(await radius.count(), 0, 'Cancel must release the frozen layout');
      await bloom.fill(original);
      await bloom.focus();
      await page.keyboard.down('Home');
      assert.equal(await radius.count(), 1);
      await bloom.evaluate((node) => node.blur());
      assert.equal(await radius.count(), 0, 'Blur must release the frozen layout');
      await page.keyboard.up('Home');
      await bloom.fill(original);
    }
    await remove();
  }
  await add('Solid');
  await choose('Content', 'gradient');
  await page.locator('.gradient-placement input[type="range"]').first().fill('45');
  for (const node of await page.locator('.gradient-placement input[type="range"]').all())
    await drag(node, 'Gradient:' + (await node.getAttribute('aria-label')));
  await page.getByRole('button', { name: 'Add stop', exact: true }).click();
  const track = page.locator('.gradient-stop-track');
  await track.scrollIntoViewIfNeeded();
  const bounds = await track.boundingBox();
  const handle = page.locator('.gradient-stop').nth(1);
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2);
  await page.mouse.up();
  assert.match(await handle.getAttribute('title'), /^80%/);
  await page.locator('.effect-row').getByRole('button', { name: 'Mask', exact: true }).click();
  await page.locator('.mask-transform-controls summary').click();
  for (const node of await page.locator('.mask-controls input[type="range"]').all())
    await drag(node, 'Mask:' + (await node.getAttribute('aria-label')));
  await page.locator('.mask-controls').getByRole('button', { name: 'Done', exact: true }).click();
  await remove();
  await add('Levels / Curves');
  await choose('Mode', 'curves');
  const curve = page.locator('.tone-curve svg');
  const curveHandle = curve.getByRole('slider').nth(2);
  await curve.scrollIntoViewIfNeeded();
  const curveBox = await curve.boundingBox();
  await curveHandle.hover();
  await page.mouse.down();
  await page.mouse.move(curveBox.x + curveBox.width / 2, curveBox.y + curveBox.height * 0.25);
  await page.mouse.up();
  assert.ok(Number(await curveHandle.getAttribute('aria-valuenow')) > 65);
  assert.equal((await curve.boundingBox()).height, curveBox.height);
  await remove();
  await add('Blur');
  await choose('Style', 'field');
  for (const node of await page.locator('.blur-field input[type="range"]').all())
    await drag(node, 'Field blur:' + (await node.getAttribute('aria-label')));
  const graph = page.locator('.blur-field svg');
  await graph.scrollIntoViewIfNeeded();
  const graphBox = await graph.boundingBox();
  const point = graph.getByRole('slider').first();
  await point.hover();
  await page.mouse.down();
  await page.mouse.move(graphBox.x + graphBox.width * 0.8, graphBox.y + graphBox.height * 0.5);
  await page.mouse.up();
  assert.ok(Number(await point.getAttribute('aria-valuenow')) > 70);
  assert.equal((await graph.boundingBox()).height, graphBox.height);
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await drag(slider('GLEECH intensity'), 'Variations intensity');
  await page.getByRole('button', { name: 'Close variations', exact: true }).click();
  await fileAction(page, 'Export image…');
  await choose('File format', 'jpeg');
  await drag(slider('Export quality'), 'Export JPEG quality');
  await choose('File format', 'webp');
  await drag(slider('Export quality'), 'Export WebP quality');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await remove();
  await add('Mandelbrot');
  await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
  await drag(slider('Explore zoom'), 'Fractal explorer zoom');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      mode: cpu ? 'cpu' : 'gpu',
      sliders: drags,
      graphHandles: 3,
      result: 'passed',
    }),
  );
} finally {
  await closeTestApp(app);
}
