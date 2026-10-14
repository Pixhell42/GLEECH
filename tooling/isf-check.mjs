import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import { createImportedShader, createEffect, renderEffects } from './effects-reference.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const cpu = process.argv.includes('--cpu'),
  mode = cpu ? 'cpu' : 'gpu';
const output = resolve(root, 'test-results/isf-check');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, mode + '-profile-')),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const width = 129,
  height = 65,
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
  );
const imagePath = resolve(output, 'source.png');
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const source =
  '/*' +
  JSON.stringify({
    ISFVSN: '2',
    CREDIT: 'GLEECH',
    LICENSE: 'GPL-3.0-or-later',
    INPUTS: [
      { NAME: 'inputImage', TYPE: 'image' },
      { NAME: 'strength', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1 },
      { NAME: 'enabled', TYPE: 'bool', DEFAULT: true },
      { NAME: 'mode', TYPE: 'long', VALUES: [0, 1], LABELS: ['Invert', 'Color'], DEFAULT: 0 },
      { NAME: 'center', TYPE: 'point2D', DEFAULT: [0.5, 0.5] },
      { NAME: 'ink', TYPE: 'color', DEFAULT: [0.2, 0.8, 0.4, 1] },
    ],
  }) +
  '*/\nvoid main(){vec4 pixel=IMG_THIS_PIXEL(inputImage);vec3 target=mode==0?1.0-pixel.rgb:ink.rgb;gl_FragColor=vec4(mix(pixel.rgb,target,enabled?strength:0.0),pixel.a);}';
const shaderPath = resolve(output, 'ISF Test.fs');
await writeFile(shaderPath, source);
const workerFile = (await readdir(resolve(root, 'apps/desktop/out/renderer/assets'))).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
assert.ok(workerFile);
let app,
  page,
  checks = 0;
const errors = [];
async function launch() {
  app = await electron.launch({
    ...(executable ? { executablePath: resolve(executable) } : {}),
    args: [
      ...(executable ? [] : [resolve(root, 'apps/desktop')]),
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
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
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
const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor();
async function worker(effects) {
  return page.evaluate(
    async ({ file, effects, pixels, width, height }) => {
      const worker = new Worker(new URL(file, location.href), { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          worker.onerror = (e) => reject(new Error(e.message));
          worker.onmessage = (e) => {
            const reply = e.data;
            resolve(
              reply.kind === 'success'
                ? {
                    pixels: [...new Uint8Array(reply.image.pixels)],
                    backend: reply.image.shaderBackend,
                  }
                : { error: reply.error },
            );
          };
          worker.postMessage({
            kind: 'render',
            id: 1,
            image: { width, height, pixels: Uint8Array.from(pixels).buffer },
            effects,
            masterSeed: 8172,
            reference: { width, height },
            purpose: 'export',
          });
        });
      } finally {
        worker.terminate();
      }
    },
    { file: 'assets/' + workerFile, effects, pixels: [...pixels], width, height },
  );
}
const projectPath = resolve(output, 'ISF.gleech');
try {
  await launch();
  await open(shaderPath);
  await fileAction(page, 'Add Shader');
  await page.getByRole('button', { name: 'Choose Local File…' }).click();
  if (cpu) {
    await status('Shader was not imported');
    assert.match(await page.locator('body').innerText(), /WebGL2/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await status('Added shader ISF Test');
    const library = await page.evaluate(async () => {
      const result = await window.gleech.listShaders();
      if (!result.ok) throw new Error(result.error);
      return result.value;
    });
    assert.equal(library.length, 1);
    const pkg = library[0].package;
    assert.equal(pkg.source, source);
    assert.equal(pkg.language, 'isf');
    const identity = createImportedShader(pkg, 'identity');
    const raw = await worker([identity]);
    assert.equal(raw.backend, 'webgl2');
    assert.ok(
      Buffer.from(raw.pixels).equals(Buffer.from(pixels)),
      'Identity ISF must preserve exact RGBA.',
    );
    checks++;
    const inverted = { ...identity, params: { ...identity.params, shader_isf1: 1 } };
    const result = await worker([inverted]);
    assert.equal(result.backend, 'webgl2');
    assert.deepEqual(
      result.pixels,
      [...pixels].map((value, i) => (i % 4 === 3 ? value : 255 - value)),
    );
    checks++;
    const disabled = await worker([
      { ...inverted, params: { ...inverted.params, shader_isf2: 'off' } },
    ]);
    assert.ok(
      Buffer.from(disabled.pixels).equals(Buffer.from(pixels)),
      'Toggle must restore identity.',
    );
    checks++;
    const colored = await worker([
      { ...inverted, params: { ...inverted.params, shader_isf3: 'v1' } },
    ]);
    assert.deepEqual(
      colored.pixels,
      [...pixels].map((value, i) => (i % 4 === 3 ? value : [51, 204, 102][i % 4])),
    );
    checks++;
    const rawWgsl = {
      ...pkg,
      id: 'raw.identity',
      language: 'wgsl',
      entryPoint: 'gleechShade',
      controls: [],
      source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
    };
    delete rawWgsl.isfInputs;
    const mixed = await worker([identity, createImportedShader(rawWgsl, 'wgsl')]);
    assert.equal(mixed.backend, 'mixed-gpu');
    assert.ok(
      Buffer.from(mixed.pixels).equals(Buffer.from(pixels)),
      'Mixed WGSL/ISF must preserve identity.',
    );
    checks++;
    const bad = await worker([
      { ...identity, shader: { ...pkg, source: source.replace('pixel.rgb', 'missingValue') } },
    ]);
    assert.match(bad.error, /ISF compilation/);
    checks++;
    const recovered = await worker([identity]);
    assert.ok(
      Buffer.from(recovered.pixels).equals(Buffer.from(pixels)),
      'ISF must recover after compile failure.',
    );
    checks++;
    const generator = {
      ...pkg,
      id: 'generator.test',
      kind: 'generator',
      controls: [],
      isfInputs: [],
      source: 'void main(){gl_FragColor=vec4(isf_FragNormCoord,0.5,1.0);}',
    };
    const generated = await worker([createImportedShader(generator, 'generator')]);
    assert.equal(generated.backend, 'webgl2');
    assert.ok(
      generated.pixels[0] < 4 &&
        generated.pixels[1] > 250 &&
        Math.abs(generated.pixels[2] - 128) <= 1,
    );
    checks++;
    // Check every original compute program after the shared mask-frame uniform change.
    for (const type of [
      'shader-ripple',
      'shader-plasma',
      'shader-liquid-glass',
      'shader-iridescence',
      'shader-hologram',
      'shader-flow-field',
      'shader-caustics',
      'shader-liquid-chrome',
      'shader-heat-mirage',
      'shader-nebula',
    ]) {
      const effect = createEffect(type, 'kernel-' + type);
      const actual = await worker([effect]);
      assert.equal(actual.backend, 'webgpu');
      const expected = new Uint8Array(
        renderEffects({ width, height, pixels: pixels.buffer }, [effect], { masterSeed: 8172 })
          .pixels,
      );
      for (let i = 0; i < expected.length; i++) {
        if (i % 4 !== 3 && expected[Math.floor(i / 4) * 4 + 3] === 0) continue;
        assert.ok(
          Math.abs(actual.pixels[i] - expected[i]) <= (i % 4 === 3 ? 1 : 3),
          `${type} byte ${i} differs from CPU reference.`,
        );
      }
      checks++;
    }
    const wgslPath = resolve(output, 'Raw Identity.wgsl');
    await writeFile(wgslPath, rawWgsl.source);
    await page.getByRole('button', { name: 'Close effect picker' }).click();
    await open(wgslPath);
    await fileAction(page, 'Add Shader');
    await page.getByRole('button', { name: 'Choose Local File…' }).click();
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await status('Added shader Raw Identity');
    await page.getByRole('button', { name: 'Close effect picker' }).click();
    await open(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened source.png');
    await page.getByRole('button', { name: 'Add Effect' }).click();
    await page.getByRole('button', { name: 'ISF Test', exact: true }).click();
    await page.waitForFunction(() => {
      const data = document.querySelector('.image-layer')?.dataset;
      return data?.renderRevision === data?.requestedRevision && data?.shaderBackend === 'webgl2';
    });
    await captureTestWindow(app, resolve(output, mode + '-controls.png'));
    await save(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ISF');
    const thumb = library[0].thumbnail;
    const saved = await page.evaluate(
      async ({ effect, thumb }) => {
        const recipe = { masterSeed: 8172, effects: [effect] };
        const result = await window.gleech.storePreset(recipe, 'ISF portable', thumb, 'statue');
        if (!result.ok) throw new Error(result.error);
        return result.value;
      },
      { effect: inverted, thumb },
    );
    assert.equal(saved.effects[0].shader.source, source);
    const url = 'https://example.com/URL%20ISF.fs';
    // Mock only transport in the isolated test main process. Exercise real IPC,
    // public DNS checks, decoding, thumbnail compilation and library storage.
    await app.evaluate((_electron, source) => {
      const dns = process.getBuiltinModule('dns/promises'),
        https = process.getBuiltinModule('https');
      const { EventEmitter } = process.getBuiltinModule('events');
      dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
      https.get = (options, callback) => {
        globalThis.__shaderRequest = options;
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          resume() {},
          destroy() {},
        });
        setImmediate(() => {
          callback(response);
          response.emit('data', Buffer.from(source));
          response.emit('end');
        });
        return new EventEmitter();
      };
      process.getBuiltinModule('module').syncBuiltinESMExports();
    }, source);
    await fileAction(page, 'Add Shader');
    await page.getByRole('tab', { name: 'URL', exact: true }).click();
    await page.getByRole('textbox', { name: 'Shader URL' }).fill(url);
    await page.getByRole('button', { name: 'Preview Shader', exact: true }).click();
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await status('Added shader URL ISF');
    assert.equal(await app.evaluate(() => globalThis.__shaderRequest.path), '/URL%20ISF.fs');
    await closeTestApp(app);
    await launch();
    await open(projectPath);
    await fileAction(page, 'Open project Ctrl+O');
    await status('Opened ISF.gleech');
    await page.waitForFunction(
      () => document.querySelector('.image-layer')?.dataset.shaderBackend === 'webgl2',
    );
    const lists = await page.evaluate(async () => {
      const shaders = await window.gleech.listShaders(),
        presets = await window.gleech.listPresets();
      if (!shaders.ok || !presets.ok) throw new Error('library failure');
      return { shaders: shaders.value, presets: presets.value };
    });
    assert.ok(
      lists.shaders.some(
        (entry) => entry.package.name === 'URL ISF' && entry.package.sourceUrl === url,
      ),
    );
    assert.ok(
      lists.presets.some(
        (entry) => entry.name === 'ISF portable' && entry.effects[0].shader.source === source,
      ),
    );
    checks++;
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode,
      checks,
      localImport: true,
      urlDialog: !cpu,
      persistence: !cpu,
      result: 'passed',
    }),
  );
} catch (error) {
  await captureTestWindow(app, resolve(output, mode + '-failure.png')).catch(() => {});
  throw error;
} finally {
  if (app) await closeTestApp(app);
}
