import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/shader-paste');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const source =
  '/*' +
  JSON.stringify({
    ISFVSN: '2',
    CREDIT: 'by Paste Tester',
    CREDIT_URL: 'https://example.com/creator',
    LICENSE: 'MIT',
    DESCRIPTION: 'Color inversion test',
    INPUTS: [
      { NAME: 'inputImage', TYPE: 'image' },
      { NAME: 'strength', TYPE: 'float', DEFAULT: 1, MIN: 0, MAX: 1 },
    ],
  }) +
  '*/\nvoid main(){ vec4 pixel=IMG_THIS_PIXEL(inputImage); gl_FragColor=vec4(mix(pixel.rgb,1.0-pixel.rgb,strength),pixel.a); }';
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
};
const library = () =>
  page.evaluate(async () => {
    const result = await window.gleech.listShaders();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
const openPaste = async () => {
  await fileAction(page, 'Add Shader');
  await page.getByRole('tab', { name: 'Paste Code', exact: true }).click();
};
const preview = async (code) => {
  await page.getByRole('textbox', { name: 'Shader source', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Preview Shader', exact: true }).click();
};
try {
  await launch();
  await openPaste();
  // Exercise actual clipboard paste without triggering the application's image-paste shortcut.
  await app.evaluate(({ clipboard }, source) => clipboard.writeText(source), source);
  await page.getByRole('textbox', { name: 'Shader source', exact: true }).focus();
  await page.keyboard.press('Control+v');
  assert.equal(
    await page.getByRole('textbox', { name: 'Shader source', exact: true }).inputValue(),
    source,
  );
  await page.getByRole('button', { name: 'Preview Shader', exact: true }).click();
  if (cpu) {
    await page
      .getByRole('alert')
      .filter({ hasText: /WebGL2/ })
      .waitFor();
    assert.deepEqual(await library(), []);
    await preview(
      'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
    );
    await page
      .getByRole('alert')
      .filter({ hasText: /WebGPU/ })
      .waitFor();
    assert.deepEqual(await library(), []);
  } else {
    await page.getByRole('heading', { name: 'Preview Shader', exact: true }).waitFor();
    assert.deepEqual(await library(), [], 'Preview must not persist');
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader creator 1', exact: true }).inputValue(),
      'Paste Tester',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader creator link 1', exact: true }).inputValue(),
      'https://example.com/creator',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader license', exact: true }).inputValue(),
      'MIT',
    );
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader source', exact: true }).inputValue(),
      source,
    );
    await preview(source);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await library(), [], 'Cancel must not persist');
    await openPaste();
    for (const [code, message] of [
      ['void mainImage(out vec4 color, in vec2 point) { color=vec4(1.0); }', /ISF|WGSL/],
      [source.replace('pixel.rgb', 'missingValue'), /compilation/],
      [source.replace('void main(){', 'void main(){ for(int i=0;i<1;i++){}'), /import policy/],
      ['x'.repeat(256 * 1024 + 1), /256 KiB/],
    ]) {
      await preview(code);
      await page.getByRole('alert').filter({ hasText: message }).waitFor();
      assert.deepEqual(await library(), []);
    }
    await preview(source);
    await page.getByRole('textbox', { name: 'Shader name', exact: true }).fill('Pasted Invert');
    await page
      .getByRole('textbox', { name: 'Shader source URL', exact: true })
      .fill('http://example.com/shader');
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /HTTPS/ }).waitFor();
    assert.deepEqual(await library(), [], 'Invalid credit metadata must not be stored');
    await page
      .getByRole('textbox', { name: 'Shader source URL', exact: true })
      .fill('https://example.com/shader');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await page.waitForFunction(() => innerWidth === 960, null, { polling: 100 });
    const layout = await page.locator('.shader-import-dialog').evaluate((dialog) => ({
      fits: dialog.getBoundingClientRect().right <= innerWidth,
      overflow: dialog.scrollWidth > dialog.clientWidth,
    }));
    assert.equal(layout.fits, true);
    assert.equal(layout.overflow, false);
    await captureTestWindow(app, resolve(output, 'preview-small.png'));
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Added shader Pasted Invert' }).waitFor();
    const [entry] = await library();
    assert.equal(entry.package.source, source);
    assert.equal(entry.package.sourceUrl, 'https://example.com/shader');
    assert.equal(entry.package.name, 'Pasted Invert');
    assert.equal(entry.package.authors[0].name, 'Paste Tester');
    assert.equal(entry.package.controls[0].label, 'strength');
    await page.getByRole('button', { name: 'Close effect picker' }).click();
    await openPaste();
    await preview(
      'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
    );
    await page.getByRole('heading', { name: 'Preview Shader', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader creator 1', exact: true }).inputValue(),
      '',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader license', exact: true }).inputValue(),
      '',
    );
    await page.getByRole('textbox', { name: 'Shader name', exact: true }).fill('Manual WGSL');
    await page
      .getByRole('textbox', { name: 'Shader creator 1', exact: true })
      .fill('Manual Creator');
    await page
      .getByRole('textbox', { name: 'Shader creator link 1', exact: true })
      .fill('https://example.com/manual');
    await page.getByRole('textbox', { name: 'Shader license', exact: true }).fill('MIT');
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Added shader Manual WGSL' }).waitFor();
    const manual = (await library()).find((entry) => entry.package.name === 'Manual WGSL').package;
    assert.equal(manual.authors[0].name, 'Manual Creator');
    assert.equal(manual.authors[0].url, 'https://example.com/manual');
    assert.equal(manual.license.expression, 'MIT');
    await page.getByRole('button', { name: 'Close effect picker' }).click();
    await openPaste();
    const native = JSON.parse(
      await readFile(
        resolve(root, 'apps/desktop/resources/shaders/prism-weave.gleech-shader'),
        'utf8',
      ),
    );
    native.authors.push({ name: 'Port author', url: 'https://example.com/port' });
    native.license.text = 'Original license text retained';
    await preview(JSON.stringify(native));
    await page.getByRole('heading', { name: 'Preview Shader', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: 'Shader creator 2', exact: true }).inputValue(),
      'Port author',
    );
    await page.getByRole('button', { name: 'Add to Library', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Added shader Prism Weave' }).waitFor();
    const expected = await library();
    assert.equal(
      expected.find((entry) => entry.package.name === 'Prism Weave').package.license.text,
      native.license.text,
    );
    await closeTestApp(app);
    await launch();
    assert.deepEqual(await library(), expected, 'Pasted shaders and credits survive restart');
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        mode: cpu ? 'cpu' : 'gpu',
        clipboardPaste: true,
        ...(cpu
          ? { missingBackendErrors: true, noLibraryWrites: true }
          : {
              previewBeforeStorage: true,
              metadata: true,
              validation: true,
              restartPersistence: true,
            }),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (app) await closeTestApp(app);
}
