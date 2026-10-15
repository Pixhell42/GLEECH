import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { modelUrl, renderEffects } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';

const { EFFECT_DEFINITIONS, BLEND_MODES, createEffect, supportsSeedVariation } = await import(
  modelUrl
);
const output = resolve('test-results/pattern-controls');
await mkdir(output, { recursive: true });
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const width = 96,
  height = 72;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 384) * 11) % 256,
);
const imagePath = resolve(output, 'pattern.png');
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const app = await electron.launch({ args: [resolve('apps/desktop'), '--smoke-test'], env });
let page;
const errors = [];
let patterns = 0,
  sliders = 0;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('status').filter({ hasText: 'Opened pattern.png' }).first().waitFor();
  const add = async (type) => {
    await page.getByRole('button', { name: /Add effect/ }).evaluate((n) => n.click());
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: EFFECT_DEFINITIONS[type].title, exact: true })
      .evaluate((n) => n.click());
  };
  const remove = () =>
    page
      .getByRole('button', { name: 'Delete selected effect', exact: true })
      .evaluate((n) => n.click());
  async function drag(label) {
    const slider = page.getByRole('slider', { name: label, exact: true });
    await slider.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await slider.boundingBox();
    const limits = await slider.evaluate((n) => ({ min: +n.min, max: +n.max, step: +n.step }));
    const original = await slider.inputValue();
    const at = (f) => box.x + 6 + (box.width - 12) * f;
    await page.mouse.move(at(0.5), box.y + box.height / 2);
    await page.mouse.down();
    try {
      for (const fraction of [
        0.77,
        0.13,
        0.99,
        0.01,
        0.65,
        ...Array.from({ length: 41 }, (_, i) => i / 40),
      ]) {
        await page.mouse.move(at(fraction), box.y + box.height / 2);
        const next = await slider.boundingBox();
        const actual = +(await slider.inputValue());
        const expected = limits.min + (limits.max - limits.min) * fraction;
        assert.ok(
          Math.abs(next.y - box.y) <= 1 && Math.abs(next.height - box.height) <= 1,
          `${label} moved during drag: ${JSON.stringify({ box, next, actual })}`,
        );
        assert.ok(
          Math.abs(actual - expected) <= (limits.max - limits.min) * 0.04 + limits.step,
          `${label} stuck: ${actual}, expected ${expected}`,
        );
      }
      sliders++;
    } finally {
      await page.mouse.up();
      await slider.fill(original);
    }
  }
  await add('shader-particle-burst');
  await drag('Pattern rotation');
  await drag('Phase');
  console.log(JSON.stringify({ particleDrag: 'passed' }));
  await remove();
  for (const type of Object.keys(EFFECT_DEFINITIONS)) {
    if (type === 'shader-import') continue; // A user package can intentionally omit a seed input.
    await add(type);
    const button = page.getByRole('button', { name: 'New pattern', exact: true });
    const expected = supportsSeedVariation(createEffect(type, 'test'));
    assert.equal(await button.count(), expected ? 1 : 0, `${type} pattern availability`);
    if (expected) {
      await button.evaluate((n) => n.click());
      assert.match(await button.getAttribute('title'), /Current pattern: 1\./, type);
      await page.getByRole('button', { name: 'Undo', exact: true }).evaluate((n) => n.click());
      assert.match(await button.getAttribute('title'), /Current pattern: 0\./, `${type} undo`);
      await page.getByRole('button', { name: 'Redo', exact: true }).evaluate((n) => n.click());
      assert.match(await button.getAttribute('title'), /Current pattern: 1\./, `${type} redo`);
      patterns++;
    }
    if (type === 'data-weave') await drag('Phase');
    await remove();
  }
  assert.deepEqual(errors, []);
  // Compare our shared compositor with Chromium's independent standard blend
  // implementation. Opaque vectors isolate blending from alpha compositing.
  const colors = [
    [64, 128, 192],
    [0, 0, 0],
    [255, 255, 255],
    [16, 32, 48],
  ];
  const sources = ['#bf8040', '#ffffff', '#000000', '#a0e0c0'];
  let blends = 0;
  for (const { value: mode } of BLEND_MODES) {
    if (['normal', 'add', 'linear-burn', 'subtract'].includes(mode)) continue;
    for (let at = 0; at < colors.length; at++) {
      const backdrop = colors[at],
        fill = sources[at];
      const canvas = await page.evaluate(
        ({ backdrop, fill, mode }) => {
          const context = document.createElement('canvas').getContext('2d');
          context.canvas.width = context.canvas.height = 1;
          context.fillStyle = `rgb(${backdrop.join(',')})`;
          context.fillRect(0, 0, 1, 1);
          context.globalCompositeOperation = mode;
          context.fillStyle = fill;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        },
        { backdrop, fill, mode },
      );
      const e = createEffect('solid', 'blend');
      const result = new Uint8Array(
        renderEffects({ width: 1, height: 1, pixels: Uint8Array.from([...backdrop, 255]).buffer }, [
          { ...e, params: { ...e.params, fillColor: fill, blendMode: mode } },
        ]).pixels,
      );
      assert.ok(
        result.every((v, i) => Math.abs(v - canvas[i]) <= 1),
        `${mode}: ${[...result]} vs canvas ${canvas}`,
      );
      blends++;
    }
  }
  console.log(JSON.stringify({ patterns, sliders, blends, result: 'passed' }));
} catch (error) {
  await writeFile(
    resolve(output, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
