import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/stack-drag');
await mkdir(output, { recursive: true });
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, 'source.png');
await sharp({ create: { width: 32, height: 24, channels: 4, background: '#bc7840' } })
  .png()
  .toFile(imagePath);
const app = await electron.launch({
  ...(exe ? { executablePath: resolve(exe) } : {}),
  args: [...(exe ? [] : [resolve(root, 'apps/desktop')]), '--smoke-test'],
  env,
});
let page;
const errors = [];
let moves = 0;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 900);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  async function settle() {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    });
  }
  const recipe = async () => {
    await settle();
    return page.locator('.image-layer').evaluate((n) => JSON.parse(n.dataset.renderRecipe));
  };
  const order = () =>
    page.locator('.effect-row').evaluateAll((rows) => rows.map((n) => n.dataset.effectId));
  async function add(name) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
    await settle();
  }
  for (const name of ['RGB split', 'Pixel Sorting', 'Halftone']) await add(name);
  await page.locator('.effect-lock').first().click();
  const original = await recipe();
  const originalRows = await order();
  async function drag(id, hover, drop, expectedInsertion) {
    const before = await recipe();
    const beforeRows = await order();
    const from = beforeRows.indexOf(id);
    const grip = page.locator(`[data-effect-id="${id}"] .effect-grip`);
    await grip.scrollIntoViewIfNeeded();
    const b = await grip.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 12, { steps: 4 });
    if (typeof hover === 'function') ({ hover, drop } = await hover());
    await page.mouse.move(hover.x, hover.y, { steps: 6 });
    await page.mouse.move(drop.x, drop.y, { steps: 4 });
    // Chromium emits dragover on subsequent movement at the same location.
    await page.mouse.move(drop.x, drop.y);
    const marker = page.locator('.drop-before, .drop-after');
    await marker.waitFor();
    const markerIndex = await marker.evaluate((n) => {
      const rows = [...n.parentElement.querySelectorAll('.effect-row')];
      return rows.indexOf(n) + (n.classList.contains('drop-after') ? 1 : 0);
    });
    assert.equal(markerIndex, expectedInsertion, 'Insertion line represents the expected slot');
    await page.mouse.up();
    await settle();
    const expected = [...beforeRows];
    expected.splice(from, 1);
    expected.splice(expectedInsertion - (from < expectedInsertion ? 1 : 0), 0, id);
    assert.deepEqual(await order(), expected, 'Drop must use the visible insertion line');
    const after = await recipe();
    for (const effect of before)
      assert.deepEqual(
        after.find((e) => e.instanceId === effect.instanceId),
        effect,
        'Reordering preserves settings and locks',
      );
    assert.equal(await marker.count(), 0, 'Drop clears the insertion marker');
    if (expected.join() !== beforeRows.join()) {
      moves++;
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await recipe(), before, 'One Undo restores the drag');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.deepEqual(await recipe(), after, 'Redo restores the drag');
    }
  }
  const top = await page.locator('.effect-row').first().boundingBox();
  await drag(originalRows[2], { x: top.x + 30, y: top.y + 3 }, { x: top.x + 30, y: top.y - 5 }, 0);
  console.log('Top insertion-line gap passed.');
  const bottom = await page.locator('.effect-row').last().boundingBox();
  await drag(
    (await order())[0],
    { x: bottom.x + 30, y: bottom.y + bottom.height - 3 },
    { x: bottom.x + 30, y: bottom.y + bottom.height + 5 },
    3,
  );
  console.log('Bottom insertion-line gap passed.');
  const body = await page.locator('.stack-body').boundingBox();
  await drag(
    (await order())[0],
    { x: bottom.x + 30, y: bottom.y + bottom.height - 3 },
    { x: body.x + 40, y: body.y + body.height - 25 },
    3,
  );
  console.log('Blank space below the stack passed.');
  const rows = await page.locator('.effect-row').evaluateAll((nodes) =>
    nodes.map((n) => {
      const b = n.getBoundingClientRect();
      return { x: b.x, y: b.y, height: b.height };
    }),
  );
  await drag(
    (await order())[2],
    { x: rows[0].x + 30, y: rows[0].y + rows[0].height - 3 },
    { x: rows[0].x + 30, y: rows[0].y + rows[0].height + 5 },
    1,
  );
  console.log('Interior gap passed.');
  assert.deepEqual(
    (await recipe()).map((e) => e.instanceId).sort(),
    original.map((e) => e.instanceId).sort(),
  );
  // An adjacent slot is a no-op, and abandoning a drag clears its marker.
  const currentRows = await order();
  const first = await page.locator('.effect-row').first().boundingBox();
  await drag(
    currentRows[0],
    { x: first.x + 40, y: first.y + 4 },
    { x: first.x + 40, y: first.y + 4 },
    0,
  );
  const beforeCancel = await recipe();
  const grip = await page.locator('.effect-grip').first().boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 20, grip.y + 20, { steps: 4 });
  await page.mouse.move(bottom.x + 30, bottom.y + bottom.height - 3, { steps: 6 });
  await page.mouse.move(bottom.x + 30, bottom.y + bottom.height - 3);
  await page.locator('.drop-before, .drop-after').waitFor();
  await page.mouse.move(body.x + body.width + 60, body.y + 40, { steps: 5 });
  await page.waitForFunction(() => !document.querySelector('.drop-before, .drop-after'));
  await page.mouse.up();
  assert.deepEqual(await recipe(), beforeCancel, 'Dropping outside the stack leaves it unchanged');
  assert.equal(await page.locator('.effect-row.dragging').count(), 0);
  const keyboardBefore = await recipe();
  const keyboardRows = await order();
  await page.locator('.effect-grip').first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await settle();
  assert.deepEqual(await order(), [keyboardRows[1], keyboardRows[0], keyboardRows[2]]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), keyboardBefore);
  // Check the companion mask panel still fits the scrollable stack layout.
  await page.locator('.paint-mask-button').first().click();
  await page.getByRole('region', { name: 'Mask painting controls', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  for (let i = 0; i < 5; i++) await add('RGB split');
  const longRows = await order();
  await page.locator('.stack-body').evaluate((n) => {
    n.scrollTop = 0;
  });
  await drag(
    longRows[0],
    async () => {
      await page.locator('.stack-body').evaluate((n) => {
        n.scrollTop = n.scrollHeight;
      });
      const last = await page.locator('.effect-row').last().boundingBox();
      return {
        hover: { x: last.x + 30, y: last.y + last.height - 3 },
        drop: { x: last.x + 30, y: last.y + last.height + 5 },
      };
    },
    null,
    longRows.length,
  );
  assert.ok(await page.locator('.stack-body').evaluate((n) => n.scrollWidth <= n.clientWidth));
  console.log('No-op, cancellation, keyboard, mask controls and scrolled-stack checks passed.');
  assert.deepEqual(errors, []);
  await captureTestWindow(app, resolve(output, 'controls.png'));
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({
      result: 'passed',
      moves,
      gaps: true,
      undoRedo: true,
      settingsPreserved: true,
      cancelledDrag: true,
      keyboard: true,
      maskControls: true,
      scrolledStack: true,
    }),
  );
  console.log('Stack drag checks passed.');
} catch (error) {
  await captureTestWindow(app, resolve(output, 'failure.png')).catch(() => {});
  throw error;
} finally {
  await closeTestApp(app);
}
