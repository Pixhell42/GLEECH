import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const root = process.cwd();
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/library-recents');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const imagePath = resolve(profile, 'image.png');
const firstPath = resolve(profile, 'Alpha.gleech');
const secondPath = resolve(profile, 'Beta.gleech');
const brokenPath = resolve(profile, 'Broken.gleech');
const presetPath = resolve(profile, 'starter.gleechpreset');
const historyPath = resolve(profile, 'recent-projects.json');
await sharp({ create: { width: 65, height: 49, channels: 4, background: '#d79637' } })
  .png()
  .toFile(imagePath);
await writeFile(brokenPath, 'broken project');
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
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
let app = await launch();
let page;
const errors = [];
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    globalThis.__recentOpenCount = 0;
    globalThis.__recentConfirmCount = 0;
    dialog.showMessageBox = async () => {
      globalThis.__recentConfirmCount++;
      return { response: 1, checkboxChecked: false };
    };
  });
}
async function selectOpen(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showOpenDialog = async () => {
        globalThis.__recentOpenCount++;
        return { filePaths: [selection.path], canceled: selection.canceled };
      };
    },
    { path, canceled },
  );
}
async function selectSave(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showSaveDialog = async () => ({
        filePath: selection.path,
        canceled: selection.canceled,
      });
    },
    { path, canceled },
  );
}
const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor();
const recentList = () =>
  page.evaluate(async () => {
    const result = await window.gleech.listRecentProjects();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
const settle = () =>
  page.waitForFunction(() => {
    const node = document.querySelector('.image-layer');
    return (
      node?.dataset.renderRevision === node?.dataset.requestedRevision &&
      !document.querySelector('.operation-banner')
    );
  });
const recipe = () =>
  page.locator('.image-layer').evaluate((node) => JSON.parse(node.dataset.renderRecipe));
async function recents() {
  await fileAction(page, 'Recents');
  await page.getByRole('menu', { name: 'Recent projects', exact: true }).waitFor();
  await page
    .getByRole('status')
    .filter({ hasText: 'Loading Recents' })
    .waitFor({ state: 'hidden' });
  return page.getByRole('menu', { name: 'Recent projects', exact: true });
}
async function openRecent(name) {
  const menu = await recents();
  await menu.getByRole('menuitem', { name, exact: true }).click();
}
try {
  await configure();
  let menu = await recents();
  await menu.getByText('No recent projects yet.', { exact: true }).waitFor();
  assert.equal(
    await menu.getByRole('menuitem', { name: 'Clear Recents', exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('button', { name: 'Recents', exact: true }).getAttribute('aria-expanded'),
    'false',
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'File menu', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  );
  await fileAction(page, 'Filters and Presets');
  const picker = page.locator('.effect-picker');
  await picker.getByRole('heading', { name: 'Filters and presets', exact: true }).waitFor();
  assert.equal(await picker.getByRole('button', { name: 'Blur', exact: true }).isDisabled(), true);
  assert.equal(
    await picker.getByRole('button', { name: 'Add Blur to favorites', exact: true }).isEnabled(),
    true,
  );
  await picker.getByRole('button', { name: 'Add Blur to favorites', exact: true }).click();
  await picker.getByRole('button', { name: /^Favorites/ }).click();
  assert.equal(await picker.locator('.effect-tile').count(), 1);
  await picker.getByRole('tab', { name: 'Presets', exact: true }).click();
  await picker
    .getByRole('status')
    .filter({ hasText: 'Loading presets' })
    .waitFor({ state: 'hidden' });
  assert.ok((await picker.locator('.preset-tile').count()) > 0);
  assert.equal(await picker.locator('.preset-tile').first().isDisabled(), true);
  assert.equal(
    await picker.getByRole('button', { name: 'Save current stack', exact: true }).isDisabled(),
    true,
  );
  const presetName = (await picker.locator('.preset-tile strong').first().innerText()).trim();
  await selectSave(presetPath);
  await picker.getByRole('button', { name: `Export preset ${presetName}`, exact: true }).click();
  await status('Exported preset');
  await selectOpen(presetPath);
  await picker.getByRole('button', { name: 'Import preset', exact: true }).click();
  await status('Imported preset');
  const edit = picker.getByRole('button', { name: /^Edit preset / }).first();
  await edit.waitFor();
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit preset', exact: true });
  await dialog.waitFor();
  await dialog
    .getByRole('textbox', { name: 'Preset name', exact: true })
    .fill('Empty workspace preset');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await status('Updated preset');
  await picker
    .getByRole('button', { name: 'Edit preset Empty workspace preset', exact: true })
    .waitFor();
  await picker.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'File menu', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.deepEqual(
    await recentList(),
    [],
    'Preset import/export and browsing do not add project history',
  );
  console.log(`${label}: empty-workspace browsing and preset management passed`);

  await selectOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened image.png');
  await fileAction(page, 'Filters and Presets');
  assert.equal(await picker.getByRole('button', { name: 'Blur', exact: true }).isEnabled(), true);
  await picker.getByRole('button', { name: 'Blur', exact: true }).click();
  await settle();
  await selectSave(firstPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved Alpha.gleech');
  const firstRecipe = await recipe();
  await page.getByRole('button', { name: /Add effect/ }).click();
  await picker.getByRole('button', { name: 'Bit crush', exact: true }).click();
  await settle();
  await selectSave(secondPath);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await status('Saved Beta.gleech');
  const secondRecipe = await recipe();
  assert.deepEqual(
    (await recentList()).map((item) => item.path),
    [secondPath, firstPath],
  );
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved Beta.gleech');
  assert.equal((await recentList()).length, 2, 'Repeated saves deduplicate');
  await selectSave(resolve(profile, 'Canceled.gleech'), true);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await status('Save canceled');
  await selectOpen(firstPath, true);
  await fileAction(page, 'Open project Ctrl+O');
  await status('Open canceled');
  await selectOpen(brokenPath);
  await fileAction(page, 'Open project Ctrl+O');
  await page.getByRole('alert').waitFor();
  assert.equal((await recentList()).length, 2, 'Failed and canceled actions do not enter Recents');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await selectOpen(firstPath);
  await fileAction(page, 'Open project Ctrl+O');
  await status('Opened Alpha.gleech');
  await settle();
  assert.deepEqual(await recipe(), firstRecipe);
  assert.deepEqual(
    (await recentList()).map((item) => item.path),
    [firstPath, secondPath],
  );

  // A new renderer starts empty while the profile still retains project history.
  await closeTestApp(app);
  app = await launch();
  await configure();
  menu = await recents();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
    'Alpha.gleech',
    'Beta.gleech',
    'Clear Recents',
  ]);
  assert.equal(
    await menu.getByRole('menuitem', { name: 'Alpha.gleech', exact: true }).getAttribute('title'),
    firstPath,
  );
  await page.keyboard.press('End');
  assert.equal(
    await menu
      .getByRole('menuitem', { name: 'Clear Recents', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await menu
      .getByRole('menuitem', { name: 'Beta.gleech', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page
      .getByRole('button', { name: 'Recents', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await status('Opened Alpha.gleech');
  await settle();
  assert.deepEqual(await recipe(), firstRecipe);
  assert.equal(
    await app.evaluate(() => globalThis.__recentOpenCount),
    0,
    'Recents opens without a native file picker',
  );
  await openRecent('Beta.gleech');
  await status('Opened Beta.gleech');
  await settle();
  assert.deepEqual(await recipe(), secondRecipe);
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('5');
  await settle();
  const unsavedRecipe = await recipe();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.__recentConfirmCount++;
      return { response: 2, checkboxChecked: false };
    };
  });
  await openRecent('Alpha.gleech');
  await status('Canceled');
  assert.deepEqual(await recipe(), unsavedRecipe, 'Cancel preserves unsaved edits');
  assert.equal(
    (await recentList())[0].path,
    secondPath,
    'Canceled selection does not promote history',
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.__recentConfirmCount++;
      return { response: 0, checkboxChecked: false };
    };
  });
  await openRecent('Alpha.gleech');
  await status('Opened Alpha.gleech');
  await settle();
  await openRecent('Beta.gleech');
  await status('Opened Beta.gleech');
  await settle();
  assert.deepEqual(await recipe(), unsavedRecipe, 'Save-before-open writes the existing project');
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('4');
  await settle();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.__recentConfirmCount++;
      return { response: 1, checkboxChecked: false };
    };
  });
  await openRecent('Alpha.gleech');
  await status('Opened Alpha.gleech');
  await settle();
  assert.deepEqual(await recipe(), firstRecipe, 'Discard opens the selected recent project');
  assert.equal(await app.evaluate(() => globalThis.__recentConfirmCount), 3);
  console.log(`${label}: restart, keyboard navigation and unsaved guards passed`);

  await rename(secondPath, resolve(profile, 'Moved.gleech'));
  await openRecent('Beta.gleech');
  await page.getByRole('alert').filter({ hasText: 'moved or deleted' }).waitFor();
  assert.deepEqual(await recipe(), firstRecipe, 'Missing files leave current project intact');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await writeFile(secondPath, 'broken project');
  await openRecent('Beta.gleech');
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await recipe(), firstRecipe, 'Invalid projects leave current project intact');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  const unknown = await page.evaluate(() => window.gleech.openRecentProject('not-a-stored-id'));
  assert.equal(unknown.ok, false);

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  menu = await recents();
  await menu.getByRole('menuitem', { name: 'Alpha.gleech', exact: true }).focus();
  const layout = await page.evaluate(() =>
    ['.file-menu-items', '.recent-projects-flyout'].map((selector) => {
      const node = document.querySelector(selector);
      const rect = node.getBoundingClientRect();
      return {
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight,
        overflow: node.scrollWidth > node.clientWidth + 1,
      };
    }),
  );
  assert.ok(
    layout.every((item) => item.visible && !item.overflow),
    'Menu and flyout fit the minimum window width/height',
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  assert.equal(await menu.isVisible(), true);
  await captureTestWindow(app, resolve(output, `${label}-recents.png`));
  await menu.getByRole('menuitem', { name: 'Clear Recents', exact: true }).click();
  await status('Cleared Recents');
  assert.deepEqual(await recentList(), []);
  assert.ok((await readFile(firstPath)).length > 0, 'Clear Recents retains project files');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await writeFile(historyPath, '{corrupt');
  menu = await recents();
  await menu.getByRole('alert').filter({ hasText: 'Clear Recents' }).waitFor();
  await menu.getByRole('menuitem', { name: 'Clear Recents', exact: true }).click();
  await status('Cleared Recents');
  await menu.getByText('No recent projects yet.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await writeFile(historyPath, '{corrupt');
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved Alpha.gleech · Could not update Recents.');
  assert.ok(
    (await readFile(firstPath)).length > 0,
    'History failures do not prevent successful project saves',
  );
  assert.equal(await readFile(historyPath, 'utf8'), '{corrupt');
  menu = await recents();
  await menu.getByRole('menuitem', { name: 'Clear Recents', exact: true }).click();
  await status('Cleared Recents');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved Alpha.gleech');
  assert.equal((await recentList()).length, 1);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      label,
      profile,
      browsingWithoutImage: true,
      presetTransferAndEdit: true,
      persistedRecents: true,
      unsavedGuards: true,
      missingAndCorruptFiles: true,
      boundedMenuLayout: true,
      errors,
    }),
  );
} finally {
  await closeTestApp(app);
}
