import { deleteFirstEffect } from './stack-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects, effectsNeedSubject } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/eight-filters');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 129,
  height = 97;
let pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
const presetPath = resolve(output, `${label}.gleechpreset`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
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
let app = await launch(),
  page,
  exports = 0;
const errors = [];
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog, clipboard }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    let text = '';
    clipboard.readText = async () => text;
    clipboard.writeText = async (value) => {
      text = value;
    };
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(
    () => {
      const n = document.querySelector('.image-layer');
      return n && n.dataset.renderRevision === n.dataset.requestedRevision;
    },
    undefined,
    { timeout: 60000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((n) => ({
    effects: JSON.parse(n.dataset.renderRecipe),
    masterSeed: Number(n.dataset.renderSeed),
  }));
}
async function open(path, action) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, action);
  await settle();
}
async function savePath(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
async function exportExact() {
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  let subjectMask;
  if (effectsNeedSubject(state.effects, pixels.buffer)) {
    const mask = await page.evaluate(async () => {
      const id = document.querySelector('.image-layer').dataset.renderSource;
      const r = await window.gleech.subjectMask(id);
      if (!r.ok) throw new Error(r.error);
      return {
        width: r.value.width,
        height: r.value.height,
        values: Array.from(new Uint8Array(r.value.values)),
      };
    });
    subjectMask = { ...mask, values: Uint8Array.from(mask.values).buffer };
  }
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: pixels.buffer }, state.effects, {
          masterSeed: state.masterSeed,
          layerImages: decodedLayers,
          subjectMask,
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}
const choose = (label, value) =>
  page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).fill(value);
async function add(title) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  const tile = page.locator('.effect-picker').getByRole('button', {
    name: title,
    exact: true,
  });
  await tile.locator('img').evaluate((i) => i.decode());
  assert.equal(await tile.locator('img').evaluate((i) => i.naturalWidth), 384);
  await tile.click();
  await settle();
}
async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), after);
}

async function reset(control) {
  await control.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  await status('Reset ');
  await settle();
}
async function paint() {
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
async function gradient(label, start, end) {
  await page
    .getByRole('group', { name: label + ' mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await page.getByRole('textbox', { name: label + ' hex', exact: true }).fill(start);
  await page.getByRole('textbox', { name: label + ' end hex', exact: true }).fill(end);
  await slider(label + ' direction', '90');
  await page
    .locator('.gradient-color-control')
    .filter({ has: page.getByRole('group', { name: label + ' mode', exact: true }) })
    .getByRole('button', { name: 'Add stop', exact: true })
    .click();
  await page.getByRole('textbox', { name: label + ' stop color hex', exact: true }).fill('#40ff80');
}
async function drag(control, values) {
  const before = await recipe();
  const frames = await page
    .locator('.image-layer')
    .evaluate((n) => Number(n.dataset.interactiveFrames ?? 0));
  await page
    .getByRole('slider', { name: control, exact: true })
    .evaluate(async (slider, values) => {
      slider.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
      );
      for (const v of values) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          slider,
          String(v),
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    }, values);
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
    },
    undefined,
    { timeout: 60000 },
  );
  const data = await page.locator('.image-layer').evaluate((n) => ({ ...n.dataset }));
  assert.ok(Number(data.interactiveFrames) > frames + 1, 'Continuous draft previews');
  assert.equal(Number(data.previewWidth), width);
  await undoRedo(before, await recipe());
  await exportExact();
  return {
    frames: Number(data.interactiveFrames) - frames,
    draftMs: Number(data.interactiveRenderMs),
  };
}
const decodedLayers = new Map();
const mapPath = resolve(output, `${label}-map.png`);
const mapPixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3
    ? 255
    : i % 4 === 0
      ? ((Math.floor(i / 4) % width) * 255) / (width - 1)
      : i % 4 === 1
        ? 128
        : 0,
);
await sharp(mapPixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(mapPath);
async function inputImage(kind) {
  const instanceId = (await recipe()).effects.at(-1).instanceId;
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, mapPath);
  await page
    .getByRole('button', {
      name:
        kind === 'field'
          ? 'Import map...'
          : kind === 'vector'
            ? 'Choose vector map…'
            : 'Choose image…',
      exact: true,
    })
    .click();
  // Depth-map imports have their own busy state, so the global operation banner
  // can already be hidden while the effect still has its previous recipe.
  await page.waitForFunction(
    ({ kind, name, instanceId }) => {
      const effects = JSON.parse(
        document.querySelector('.image-layer')?.dataset.renderRecipe ?? '[]',
      );
      const effect = effects.find((effect) => effect.instanceId === instanceId);
      return effect?.[kind === 'field' ? 'fieldImage' : 'image']?.source.name === name;
    },
    { kind, name: basename(mapPath), instanceId },
    { timeout: 180000 },
  );
  await page.locator('.operation-banner').waitFor({ state: 'hidden', timeout: 180000 });
  await settle();
  const e = (await recipe()).effects.at(-1);
  const image = kind === 'field' ? e.fieldImage : e.image;
  decodedLayers.set(image.source.id, { width: 129, height: 97, pixels: mapPixels.buffer });
}
async function rememberCopiedStage() {
  const e = (await recipe()).effects.at(-1);
  const png = await page.locator('.solid-image-control img').getAttribute('src');
  const raw = await sharp(Buffer.from(png.split(',')[1], 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  decodedLayers.set(e.image.source.id, {
    width: raw.info.width,
    height: raw.info.height,
    pixels: Uint8Array.from(raw.data).buffer,
  });
}
const specs = [
  ['vector-corruption', 'Vector Corruption', 'Travel'],
  ['reference-mosh', 'Reference / Cross-image Mosh', 'Progression'],
  ['motion-transfer', 'Motion Transfer', 'Travel'],
  ['depth-parallax', 'Depth Parallax / Push-Pull', 'Camera X'],
  ['depth-haze', 'Depth Haze', 'Fog density'],
  ['depth-color-map', 'Depth Color Mapping', 'Preserve shading'],
  ['cutout', 'Subject / Depth / Hybrid Cutout', 'Far limit'],
  ['lens-distortion', 'Lens Distortion', 'Barrel / Pincushion'],
];
try {
  await configure();
  if (process.argv.includes('--resume-roundtrip')) {
    await open(projectPath, 'Open project Ctrl+O');
    for (const e of (await recipe()).effects) {
      if (e.image)
        decodedLayers.set(e.image.source.id, {
          width,
          height,
          pixels: e.type === 'reference-mosh' ? pixels.buffer : mapPixels.buffer,
        });
      if (e.fieldImage)
        decodedLayers.set(e.fieldImage.source.id, { width, height, pixels: mapPixels.buffer });
    }
    await exportExact();
  } else {
    await open(imagePath, 'Open image Ctrl+Shift+O');
    // An explicitly captured rendered stage becomes an independent embedded reference.
    await page.getByRole('button', { name: 'Capture snapshot', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Snapshot name', exact: true })
      .fill('Frozen reference');
    await page.getByRole('button', { name: 'Capture stage', exact: true }).click();
    await status('Captured Frozen reference');
    await settle();
    for (const [type, title] of specs) {
      await add(title);
      console.log(`${label}: checking ${title}`);
      if (type === 'vector-corruption') {
        await slider('Travel', '20');
        await slider('Corruption density', '1');
        for (const operation of ['scramble', 'reverse', 'rotate', 'quantize']) {
          await choose('Operation', operation);
          if (operation === 'quantize') await slider('Directions', '5');
          await exportExact();
        }
        await choose('Operation', 'scramble');
        const before = await recipe();
        await page.getByRole('button', { name: 'New pattern', exact: true }).click();
        assert.equal(
          (await recipe()).effects.at(-1).seedOffset,
          before.effects.at(-1).seedOffset + 1,
        );
        const beforeReset = await recipe();
        await reset(page.getByRole('slider', { name: 'Travel', exact: true }));
        assert.equal((await recipe()).effects.at(-1).params.strength, 8);
        await undoRedo(beforeReset, await recipe());
      } else if (type === 'reference-mosh') {
        await inputImage('reference');
        for (const style of ['patches', 'dissolve', 'drag']) {
          await choose('Style', style);
          await slider('Progression', '0.65');
          await exportExact();
        }
        for (const placement of ['fit', 'fill', 'stretch']) {
          await choose('Reference placement', placement);
          await exportExact();
        }
        await page
          .getByRole('combobox', { name: 'Reference saved stage', exact: true })
          .selectOption({ label: 'Frozen reference' });
        await status('Copied Frozen reference');
        await settle();
        await rememberCopiedStage();
        await exportExact();
      } else if (type === 'motion-transfer') {
        await inputImage('vector');
        for (const encoding of ['rg', 'luma', 'gradient']) {
          await choose('Map encoding', encoding);
          await slider('Travel', '15');
          await slider('Map rotation', '25');
          await exportExact();
        }
        await choose('Map encoding', 'rg');
        await choose('Invert horizontal', 'on');
        await exportExact();
      } else if (type === 'depth-parallax') {
        await inputImage('field');
        for (const style of ['parallax', 'push-pull', 'tearing']) {
          await choose('Style', style);
          if (style === 'push-pull') await slider('Push / Pull', '0.9');
          else await slider('Camera X', '18');
          await exportExact();
        }
        for (const edges of ['transparent', 'extend', 'wrap', 'mirror']) {
          await choose('Edges', edges);
          await exportExact();
        }
        await choose('Style', 'parallax');
      } else if (type === 'depth-haze') {
        await inputImage('field');
        await gradient('Fog color', '#ffe0b0', '#5070cc');
        await slider('Fog density', '0.85');
        await slider('Fog falloff', '2');
        await exportExact();
      } else if (type === 'depth-color-map') {
        await inputImage('field');
        await page.getByRole('textbox', { name: 'Depth palette hex', exact: true }).fill('#330066');
        await page
          .getByRole('textbox', { name: 'Depth palette end hex', exact: true })
          .fill('#ffe0a0');
        await page
          .locator('.gradient-color-control')
          .filter({ has: page.getByRole('group', { name: 'Depth palette mode', exact: true }) })
          .getByRole('button', { name: 'Add stop', exact: true })
          .click();
        await page
          .getByRole('textbox', { name: 'Depth palette stop color hex', exact: true })
          .fill('#40aaff');
        await exportExact();
        await choose('Reverse palette', 'on');
        await exportExact();
      } else if (type === 'cutout') {
        await inputImage('field');
        for (const mode of ['depth', 'subject', 'hybrid']) {
          await choose('Cutout source', mode);
          await slider('Edge softness', '0.08');
          await exportExact();
        }
        await choose('Combine masks', 'union');
        await choose('Keep', 'outside');
        await exportExact();
        await choose('Cutout source', 'depth');
        await choose('Keep', 'inside');
      } else if (type === 'lens-distortion') {
        for (const distortion of ['-0.3', '0.5']) {
          await slider('Barrel / Pincushion', distortion);
          await slider('Outer curvature', '0.05');
          await slider('Zoom', '110');
          await exportExact();
        }
        for (const edges of ['transparent', 'extend', 'wrap', 'mirror']) {
          await choose('Edges', edges);
          await exportExact();
        }
      }
      await choose('Blend mode', 'screen');
      await page.getByRole('switch', { name: 'Tint', exact: true }).check();
      await slider('Tint strength', '0.15');
      await gradient('Tint color', '#ffeecc', '#aaddff');
      await choose('Application', 'left');
      await slider('Coverage', '0.75');
      await slider('Softness', '0.25');
      await paint();
      await exportExact();
      const before = await recipe();
      await page.locator('.effect-lock').first().click();
      await page.locator('.effect-select').first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
      await status('Duplicated filter');
      const duplicated = await recipe();
      assert.deepEqual(duplicated.effects.at(-1).params, before.effects.at(-1).params);
      assert.deepEqual(duplicated.effects.at(-1).image, before.effects.at(-1).image);
      assert.deepEqual(duplicated.effects.at(-1).fieldImage, before.effects.at(-1).fieldImage);
      assert.deepEqual(duplicated.effects.at(-1).paintedMask, before.effects.at(-1).paintedMask);
      assert.equal(duplicated.effects.at(-1).locked, true);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      await page.locator('.effect-lock').first().click();
      console.log(`${label}: ${title} rendering, inputs, masks, locks and duplication passed`);
    }
    await page.locator('.effect-lock').last().click();
    const beforeGleech = await recipe();
    await page.getByRole('button', { name: 'GLEECH', exact: true }).click();
    await page
      .locator('.gleech-dialog')
      .getByRole('button', { name: /^Simple/ })
      .click();
    await page
      .locator('.gleech-dialog')
      .getByRole('button', { name: /^Use Existing Only/ })
      .click();
    const generated = await recipe();
    assert.deepEqual(generated.effects[0], beforeGleech.effects[0]);
    await undoRedo(beforeGleech, generated);
    await exportExact();
    await page.getByRole('button', { name: 'Var', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.variation-tile img').length === 9,
      undefined,
      { timeout: 120000 },
    );
    await page.locator('.variation-tile img').evaluateAll(async (imgs) => {
      await Promise.all(imgs.map((i) => i.decode()));
      if (imgs.some((i) => !i.naturalWidth)) throw new Error('Invalid variation preview');
    });
    await page.getByRole('button', { name: 'Close variations', exact: true }).click();
    assert.deepEqual(await recipe(), generated);
    // Save the procedural cutout, while Subject/Hybrid was checked separately above.
    await page
      .locator('.effect-select')
      .filter({ hasText: 'Subject / Depth / Hybrid Cutout' })
      .click();
    await choose('Cutout source', 'depth');
    await settle();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
    );
    for (const [type, title, control] of specs) {
      await page.locator('.effect-select').filter({ hasText: title }).click();
      await settle();
      const region = page.getByRole('region', { name: title + ' controls', exact: true });
      assert.ok(await region.evaluate((n) => n.scrollWidth <= n.clientWidth));
      const custom = page.getByRole('slider', { name: control, exact: true });
      if (await custom.count()) {
        await custom.evaluate((n) =>
          n.closest('.effect-control').scrollIntoView({ block: 'start' }),
        );
        await settle();
      }
      await captureTestWindow(app, resolve(output, `${label}-${type}-controls.png`));
    }
  }
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Eight Filters');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  // Including masks regenerates both thumbnails before Save can be enabled.
  await page
    .getByRole('img', { name: 'Current image preset preview', exact: true })
    .waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Eight Filters');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Portable Eight Filters', exact: true })
    .click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  const final = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await closeTestApp(app);
  await unlink(imagePath);
  await unlink(mapPath);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  assert.deepEqual(await recipe(), final);
  await exportExact();
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  const destination = resolve(output, `${label}-destination.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(destination);
  await open(destination, 'Open image Ctrl+Shift+O');
  await open(presetPath, 'Import Preset');
  await status('Imported preset Portable Eight Filters');
  await page.getByRole('button', { name: 'Apply Portable Eight Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const imported = await recipe();
  assert.deepEqual(
    imported.effects.map((e) => e.params),
    final.effects.map((e) => e.params),
  );
  assert.deepEqual(
    imported.effects.map((e) => e.image),
    final.effects.map((e) => e.image),
  );
  assert.deepEqual(
    imported.effects.map((e) => e.fieldImage),
    final.effects.map((e) => e.fieldImage),
  );
  assert.deepEqual(
    imported.effects.map((e) => e.paintedMask),
    final.effects.map((e) => e.paintedMask),
  );
  await exportExact();
  while (await page.locator('.effect-row').count()) {
    await deleteFirstEffect(page);
    await settle();
  }
  width = 1024;
  height = 768;
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 4) * 19) % 256,
  );
  const largePath = resolve(output, `${label}-large.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(largePath);
  await open(largePath, 'Open image Ctrl+Shift+O');
  // Recreate the map file after source-file deletion, solely for large-image gestures.
  await sharp(mapPixels, { raw: { width: 129, height: 97, channels: 4 } })
    .png()
    .toFile(mapPath);
  const drags = {};
  for (const [type, title, control] of specs) {
    await add(title);
    if (type === 'reference-mosh') await inputImage('reference');
    if (type === 'motion-transfer') await inputImage('vector');
    if (['depth-parallax', 'depth-haze', 'depth-color-map', 'cutout'].includes(type))
      await inputImage('field');
    const values = Array.from({ length: 40 }, (_, i) =>
      ['vector-corruption', 'motion-transfer', 'depth-parallax'].includes(type)
        ? 2 + i / 3
        : type === 'lens-distortion'
          ? -0.2 + i / 100
          : 0.1 + i / 50,
    );
    drags[type] = await drag(control, values);
    await deleteFirstEffect(page);
    await settle();
  }
  // Solid uses the same generalized input plumbing and must retain its old behavior.
  await add('Solid');
  await choose('Content', 'image');
  await inputImage('reference');
  await exportExact();
  assert.deepEqual(errors, []);
  const result = {
    result: 'passed',
    exactExports: exports,
    drags,
    subjectAndHybrid: true,
    frozenReference: true,
    sourceFilesDeleted: true,
    undoRedo: true,
    masksLocks: true,
    gleechVar: true,
    projectRestart: true,
    presetTransfer: true,
    solidRegression: true,
  };
  await writeFile(resolve(output, `${label}-result.json`), JSON.stringify(result));
  console.log(
    `${label}: all eight filters passed; ${exports} exact exports. ${JSON.stringify(drags)}`,
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await closeTestApp(app);
}
