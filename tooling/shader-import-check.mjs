import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import {
  createEffect,
  createImportedShader,
  renderEffects,
  modelUrl,
} from './effects-reference.mjs';
const { EFFECT_DEFINITIONS } = await import(modelUrl);
const builtinShaderCount = Object.keys(EFFECT_DEFINITIONS).filter(
  (type) => type.startsWith('shader-') && type !== 'shader-import',
).length;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const output = resolve(root, 'test-results/shader-import-check');
await mkdir(output, { recursive: true });
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const cpu = process.argv.includes('--cpu'),
  label = cpu ? 'cpu' : 'gpu';
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${label}-profile-`)),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const pkg = JSON.parse(
  await readFile(
    executablePath
      ? resolve(dirname(resolve(executablePath)), 'resources/shaders/prism-weave.gleech-shader')
      : resolve(root, 'apps/desktop/resources/shaders/prism-weave.gleech-shader'),
    'utf8',
  ),
);
const samplePath = resolve(output, 'sample.gleech-shader');
await writeFile(samplePath, JSON.stringify(pkg));
const projectPath = resolve(output, 'embedded.gleech'),
  presetPath = resolve(output, 'embedded.gleechpreset');
const width = 129,
  height = 65;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const imagePath = resolve(output, 'source.png');
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const workerFile = (await readdir(resolve(root, 'apps/desktop/out/renderer/assets'))).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
assert.ok(workerFile);
let app,
  page,
  exports = 0;
const errors = [];
async function launch() {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
      ...(!cpu && process.env.GITHUB_ACTIONS
        ? ['--use-webgpu-adapter=swiftshader', '--enable-unsafe-webgpu']
        : []),
    ],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog, shell }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    globalThis.__creditUrls = [];
    shell.openExternal = async (url) => {
      globalThis.__creditUrls.push(url);
    };
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
const open = (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
const save = (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
async function library() {
  return page.evaluate(async () => {
    const result = await window.gleech.listShaders();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
}
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () => {
      const data = document.querySelector('.image-layer')?.dataset;
      return (
        data?.renderRevision === data?.requestedRevision &&
        !document.querySelector('.detail-loading')
      );
    },
    undefined,
    { timeout: 30000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((el) => ({
    effects: JSON.parse(el.dataset.renderRecipe),
    seed: Number(el.dataset.renderSeed),
    backend: el.dataset.shaderBackend,
  }));
}
async function renderWorker(effects, seed = 8172) {
  return page.evaluate(
    async ({ path, effects, seed, width, height, pixels }) => {
      const harness = (window.__importWorker ??= {
        worker: new Worker(new URL(path, location.href), { type: 'module' }),
        id: 0,
      });
      const worker = harness.worker;
      const reply = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({
          kind: 'render',
          id: ++harness.id,
          image: { width, height, pixels: Uint8Array.from(pixels).buffer },
          effects,
          masterSeed: seed,
          reference: { width, height },
          purpose: 'export',
        });
      });
      if (reply.kind !== 'success') return { error: reply.error };
      return {
        pixels: [...new Uint8Array(reply.image.pixels)],
        backend: reply.image.shaderBackend,
      };
    },
    { path: `assets/${workerFile}`, effects, seed, width, height, pixels: [...pixels] },
  );
}
async function exportChecked(expected) {
  const path = resolve(output, `${label}-${++exports}.png`);
  await save(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status(`Exported ${basename(path)}`);
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  if (expected)
    assert.ok(
      data.equals(Buffer.from(expected)),
      'PNG must match independently rendered embedded shader stack.',
    );
  return data;
}
try {
  await launch();
  if (cpu) {
    await open(samplePath);
    await fileAction(page, 'Add Shader');
    await page.getByRole('button', { name: 'Choose Local File…' }).click();
    await status('Shader was not imported');
    assert.deepEqual(await library(), []);
    assert.match(await page.locator('body').innerText(), /requires WebGPU/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await open(projectPath);
    await fileAction(page, 'Open project Ctrl+O');
    await status('Opened embedded.gleech');
    await page.getByRole('alert').filter({ hasText: 'requires WebGPU' }).waitFor();
    await page.getByRole('button', { name: /Enable Prism Weave/ }).click();
    const recipe = await state();
    const expected = renderEffects({ width, height, pixels: pixels.buffer }, recipe.effects, {
      masterSeed: recipe.seed,
    }).pixels;
    await exportChecked(new Uint8Array(expected));
    const raw = await renderWorker([createImportedShader(pkg, 'unsupported')]);
    assert.match(raw.error, /requires WebGPU/);
  } else {
    // Bad metadata and bad WGSL must never create persistent tiles.
    for (const [name, contents] of [
      ['bad-json', 'bad json'],
      [
        'bad-loop',
        JSON.stringify({
          ...pkg,
          source:
            'fn gleechShade(context: GleechShaderContext) -> vec4f { loop {} return context.source; }',
        }),
      ],
      [
        'bad-compile',
        JSON.stringify({
          ...pkg,
          source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return missingValue; }',
        }),
      ],
    ]) {
      const path = resolve(output, `${name}.gleech-shader`);
      await writeFile(path, contents);
      await open(path);
      await fileAction(page, 'Add Shader');
      await page.getByRole('button', { name: 'Choose Local File…' }).click();
      await status('Shader was not imported');
      assert.deepEqual(await library(), []);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    // Import and favorite before an image has been opened.
    await open(samplePath);
    await fileAction(page, 'Add Shader');
    await page.getByRole('button', { name: 'Choose Local File…' }).click();
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await status('Added shader Prism Weave');
    const entry = (await library())[0];
    assert.equal(entry.package.source, pkg.source);
    await page.getByRole('button', { name: /^Shaders/ }).click();
    assert.equal(await page.locator('.effect-tile').count(), builtinShaderCount + 1);
    const tile = page.getByRole('button', { name: 'Prism Weave', exact: true });
    assert.equal(await tile.isDisabled(), true);
    await tile.locator('img').evaluate((img) => {
      if (!img.complete || img.naturalWidth !== 384) throw new Error('Missing shader thumbnail');
    });
    await page
      .locator('.shader-credits')
      .getByRole('button', { name: 'GLEECH', exact: true })
      .click();
    assert.equal((await page.locator('.shader-credits').innerText()).trim(), 'By GLEECH');
    const creatorTooltip = await page
      .locator('.shader-credits')
      .getByRole('button', { name: 'GLEECH', exact: true })
      .getAttribute('title');
    assert.ok(creatorTooltip.includes(pkg.license.expression));
    assert.ok(creatorTooltip.includes(pkg.version));
    const removeButton = page.getByRole('button', {
      name: 'Remove Prism Weave from library',
      exact: true,
    });
    assert.equal((await removeButton.innerText()).trim(), '');
    assert.equal(await removeButton.locator('svg').count(), 1);
    assert.deepEqual(await app.evaluate(() => globalThis.__creditUrls), [pkg.authors[0].url]);
    await page.getByRole('button', { name: 'Add Prism Weave to favorites', exact: true }).click();
    await page.getByRole('button', { name: /^Favorites/ }).click();
    assert.equal(await page.locator('.effect-tile').count(), 1);
    await page.locator('.effect-card').evaluate((card) => {
      const tile = card.querySelector('.effect-tile').getBoundingClientRect();
      const credits = card.querySelector('.shader-credits').getBoundingClientRect();
      const grid = card.closest('.effect-grid').getBoundingClientRect();
      const add = document.querySelector('.shader-add').getBoundingClientRect();
      const tabs = document.querySelector('.catalog-tabs').getBoundingClientRect();
      if (
        credits.top < tile.bottom - 1 ||
        add.bottom > grid.top ||
        add.left < tabs.right ||
        Math.abs((add.top + add.bottom - tabs.top - tabs.bottom) / 2) > 1
      )
        throw new Error(
          `Shader layout overlaps: tile ${tile.bottom}, credits ${credits.top}, grid ${grid.bottom}, add ${add.top}`,
        );
    });
    await captureTestWindow(app, resolve(output, 'gpu-library.png'));
    await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
    await open(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened source.png');
    await settle();
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('button', { name: 'Prism Weave', exact: true }).click();
    await page.getByRole('combobox', { name: 'Light style', exact: true }).selectOption('prism');
    await page.getByRole('slider', { name: 'Weave density', exact: true }).fill('9.2');
    await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.72');
    await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('left');
    await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.6');
    await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.3');
    const recipe = await state();
    assert.equal(recipe.backend, 'webgpu');
    assert.equal(recipe.effects[0].params.shader_density, 9.2);
    assert.equal(recipe.effects[0].params.shader_style, 'prism');
    const independent = await renderWorker(recipe.effects, recipe.seed);
    assert.equal(independent.backend, 'webgpu', independent.error);
    const rendered = await exportChecked(independent.pixels);
    await captureTestWindow(app, resolve(output, 'gpu-controls.png'));
    await save(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved embedded');
    assert.ok((await readFile(projectPath)).byteLength);
    // Both preset thumbnail choices use the actual imported GPU shader.
    await fileAction(page, 'Save Stack as Preset');
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Embedded Prism');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('img', { name: 'Current image preset preview', exact: true }).waitFor();
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Embedded Prism');
    const preset = await page.evaluate(async () => {
      const r = await window.gleech.listPresets();
      if (!r.ok) throw new Error(r.error);
      return r.value.find((p) => p.name === 'Embedded Prism');
    });
    assert.equal(preset.effects[0].shader.source, pkg.source);
    await save(presetPath);
    const exported = await page.evaluate(async (id) => window.gleech.exportPreset(id), preset.id);
    assert.equal(exported.ok, true);
    // Delete the tile and original file independently of saved embedded copies.
    await page.getByRole('tab', { name: 'Effects', exact: true }).click();
    await page
      .getByRole('button', { name: 'Remove Prism Weave from library', exact: true })
      .click();
    await status('Removed Prism Weave from library');
    assert.deepEqual(await library(), []);
    await writeFile(samplePath, 'Original file removed for persistence test');
    await closeTestApp(app);
    await launch();
    assert.deepEqual(await library(), []);
    await open(projectPath);
    await fileAction(page, 'Open project Ctrl+O');
    await status('Opened embedded.gleech');
    const reopened = await state();
    assert.deepEqual(reopened.effects, recipe.effects);
    assert.ok((await exportChecked(independent.pixels)).equals(rendered));
    await open(presetPath);
    const imported = await page.evaluate(async () => window.gleech.importPreset());
    assert.equal(imported.ok, true);
    assert.equal(imported.value.effects[0].shader.source, pkg.source);
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('tab', { name: 'Presets', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Embedded Prism', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    await exportChecked(independent.pixels);
    // A zero-control package has the explicit layout even if bindings are unused.
    const pass = createImportedShader(
      {
        ...pkg,
        id: 'gleech.pass',
        controls: [],
        source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
      },
      'pass',
    );
    const neutral = await renderWorker([pass]);
    assert.equal(neutral.backend, 'webgpu', neutral.error);
    assert.deepEqual(neutral.pixels, [...pixels]);
    if (!executablePath) {
      // Destroy the first worker device on submission, using the real WebGPU
      // implementation. The same request must recover once and remain exact.
      const probePath = resolve(root, 'apps/desktop/out/renderer/assets/shader-loss-probe.mjs');
      await writeFile(
        probePath,
        `let devices = 0;
const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
navigator.gpu.requestAdapter = async (...args) => {
  const adapter = await requestAdapter(...args);
  const requestDevice = adapter.requestDevice.bind(adapter);
  adapter.requestDevice = async (...args) => {
    const device = await requestDevice(...args);
    self.postMessage({ kind: 'probe-device', count: ++devices });
    if (devices === 1) {
      const submit = device.queue.submit.bind(device.queue);
      device.queue.submit = (...args) => { device.destroy(); return submit(...args); };
    }
    return device;
  };
  return adapter;
};
await import('./${workerFile}');
self.postMessage({ kind: 'probe-ready' });`,
      );
      try {
        const recovered = await page.evaluate(
          ({ effect, width, height, pixels }) =>
            new Promise((resolve, reject) => {
              const worker = new Worker(new URL('assets/shader-loss-probe.mjs', location.href), {
                type: 'module',
              });
              let devices = 0;
              const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error('GPU recovery probe timed out.'));
              }, 30000);
              worker.onerror = (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.onmessage = ({ data }) => {
                if (data.kind === 'probe-device') devices = data.count;
                else if (data.kind === 'probe-ready')
                  worker.postMessage({
                    kind: 'render',
                    id: 1,
                    image: { width, height, pixels: Uint8Array.from(pixels).buffer },
                    effects: [effect],
                    masterSeed: 8172,
                    reference: { width, height },
                    purpose: 'export',
                  });
                else {
                  clearTimeout(timer);
                  worker.terminate();
                  resolve({
                    devices,
                    error: data.error,
                    backend: data.image?.shaderBackend,
                    pixels: data.image ? [...new Uint8Array(data.image.pixels)] : [],
                  });
                }
              };
            }),
          { effect: pass, width, height, pixels: [...pixels] },
        );
        assert.equal(recovered.backend, 'webgpu', recovered.error);
        assert.equal(recovered.devices, 2);
        assert.deepEqual(recovered.pixels, [...pixels]);
        console.log('Lost GPU device recovered once with exact output.');
      } finally {
        await unlink(probePath);
      }
    }
    const bad = createImportedShader(
      {
        ...pkg,
        id: 'gleech.bad',
        controls: [],
        source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return missingValue; }',
      },
      'bad',
    );
    const invalid = await renderWorker([bad]);
    assert.match(invalid.error, /Shader|shader/);
    const mixed = await renderWorker([
      createEffect('shader-liquid-glass', 'glass'),
      ...recipe.effects,
    ]);
    assert.equal(mixed.backend, 'webgpu', mixed.error);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      importControls: true,
      persistence: !cpu,
      unsupportedGPU: cpu,
      result: 'passed',
    }),
  );
} catch (error) {
  if (app) await captureTestWindow(app, resolve(output, `${label}-failure.png`)).catch(() => {});
  await writeFile(
    resolve(output, `${label}-failure.json`),
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
  if (app) await closeTestApp(app);
}
