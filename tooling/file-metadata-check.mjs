import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';

const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const mode = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve('test-results/file-metadata');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${mode}-profile-`));
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const width = 32,
  height = 16;
const pixels = Buffer.from(
  Array.from({ length: width * height * 4 }, (_, index) =>
    index % 4 === 3 ? [0, 1, 128, 255][Math.floor(index / 4) % 4] : (index * 13) % 256,
  ),
);
const input = resolve(output, `${mode}-source.png`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  ...(exe ? { executablePath: resolve(exe) } : {}),
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const version = await app.evaluate(({ app }) => app.getVersion());
  const metadata = {
    name: 'GLEECH',
    version,
    developerUrl: 'https://x.com/pixhell',
    repositoryUrl: 'https://github.com/Pixhell42/GLEECH',
  };
  const status = (text) =>
    page.locator('.status-bar').getByRole('status').filter({ hasText: text }).waitFor();
  const settle = () =>
    page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return (
        node &&
        node.dataset.renderRevision === node.dataset.requestedRevision &&
        !document.querySelector('.operation-banner')
      );
    });
  const chooseSave = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
  const chooseOpen = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, path);
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await chooseOpen(input);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ');
  await settle();
  const paths = [];
  for (const format of ['png', 'jpeg', 'webp', 'tiff', 'quick-png']) {
    const path = resolve(
      output,
      `${mode}-${format}.${format === 'quick-png' ? 'png' : format === 'jpeg' ? 'jpg' : format}`,
    );
    await chooseSave(path);
    if (format === 'quick-png') await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    else {
      await fileAction(page, 'Export image…');
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('combobox', { name: 'File format', exact: true }).selectOption(format);
      await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    }
    await status(`Exported ${mode}-${format}`);
    const image = sharp(await readFile(path));
    const info = await image.metadata();
    const xmp = info.xmp?.toString('utf8');
    assert.ok(xmp?.includes(`<xmp:CreatorTool>GLEECH ${version}</xmp:CreatorTool>`));
    assert.ok(xmp.includes(`<gleech:Version>${version}</gleech:Version>`));
    assert.ok(xmp.includes('<gleech:DeveloperURL>https://x.com/pixhell</gleech:DeveloperURL>'));
    assert.ok(
      xmp.includes(
        '<gleech:RepositoryURL>https://github.com/Pixhell42/GLEECH</gleech:RepositoryURL>',
      ),
    );
    assert.deepEqual([info.width, info.height, info.hasAlpha], [width, height, format !== 'jpeg']);
    const raw = await image.ensureAlpha().raw().toBuffer();
    if (['png', 'tiff', 'quick-png'].includes(format)) assert.deepEqual(raw, pixels);
    if (format === 'webp') for (let i = 3; i < raw.length; i += 4) assert.equal(raw[i], pixels[i]);
    paths.push(path);
  }
  const projectPath = resolve(output, `${mode}.gleech`);
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status(`Saved ${mode}.gleech`);
  const project = await readFile(projectPath);
  const recipeLength = project.readUInt32LE(8);
  const recipe = JSON.parse(project.subarray(12, 12 + recipeLength).toString('utf8'));
  assert.deepEqual(recipe.application, metadata);
  assert.equal(project.subarray(0, 8).toString(), 'GLEECH02');
  await chooseOpen(projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await status(`Opened ${mode}.gleech`);
  await settle();
  delete recipe.application;
  const oldRecipe = Buffer.from(JSON.stringify(recipe));
  const header = Buffer.from(project.subarray(0, 12));
  header.writeUInt32LE(oldRecipe.length, 8);
  const oldPath = resolve(output, `${mode}-without-metadata.gleech`);
  await writeFile(oldPath, Buffer.concat([header, oldRecipe, project.subarray(12 + recipeLength)]));
  await chooseOpen(oldPath);
  await fileAction(page, 'Open project Ctrl+O');
  await status(`Opened ${mode}-without-metadata.gleech`);
  await settle();
  const saveAs = resolve(output, `${mode}-resaved.gleech`);
  await chooseSave(saveAs);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await status(`Saved ${mode}-resaved.gleech`);
  const resaved = await readFile(saveAs);
  assert.deepEqual(
    JSON.parse(resaved.subarray(12, 12 + resaved.readUInt32LE(8)).toString('utf8')).application,
    metadata,
  );
  assert.deepEqual(errors, []);
  const result = { mode, metadata, exports: paths.length, legacyProjectRoundTrip: true, errors };
  await writeFile(resolve(output, `${mode}-result.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await closeTestApp(app);
}
