import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { createEffect } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';

const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'current';
const cpu = process.argv.includes('--cpu');
const output = resolve('test-results/mask-latency');
await mkdir(output, { recursive: true });
// Reuse the native mask workflow's valid embedded source and snapshots.
const saved = await readFile('test-results/painted-mask/auto.gleech');
assert.equal(saved.subarray(0, 8).toString(), 'GLEECH02');
const length = saved.readUInt32LE(8),
  envelope = JSON.parse(saved.subarray(12, 12 + length));
const masked = envelope.project.effects.at(-1);
const count = masked.paintedMask.strokes.length;
const types = ['shader-ripple', 'shader-hologram', 'channel-transform', 'scanlines', 'noise-grain'];
envelope.project.effects = [
  ...Array.from({ length: 24 }, (_, i) => createEffect(types[i % types.length], 'latency-' + i)),
  masked,
];
const json = Buffer.from(JSON.stringify(envelope)),
  header = saved.subarray(0, 12);
header.writeUInt32LE(json.length, 8);
const path = resolve(output, 'fixture.gleech');
await writeFile(path, Buffer.concat([header, json, saved.subarray(12 + length)]));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    resolve('apps/desktop'),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, path);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await page.keyboard.press('Control+o');
  async function settle() {
    await page.waitForFunction(
      () => {
        const d = document.querySelector('.image-layer')?.dataset;
        return d && d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
      },
      undefined,
      { timeout: 60000 },
    );
  }
  await settle();
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  await surface.waitFor();
  await settle();
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = (await cdp.send('Performance.getMetrics')).metrics;
  await page.evaluate(() => {
    window.__brushTiming = { last: performance.now(), frames: [], active: true };
    const tick = (now) => {
      const s = window.__brushTiming;
      if (!s.active) return;
      s.frames.push(now - s.last);
      s.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const bounds = await surface.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.12, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 90; i++) {
    await page.mouse.move(
      bounds.x + bounds.width * (0.12 + i / 120),
      bounds.y + bounds.height * (0.5 + Math.sin(i / 10) * 0.15),
    );
    await page.waitForTimeout(8);
  }
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('.image-layer').getAttribute('data-preview-quality'),
    'interactive',
  );
  const frames = await page.evaluate(() => {
    window.__brushTiming.active = false;
    return window.__brushTiming.frames;
  });
  const after = (await cdp.send('Performance.getMetrics')).metrics;
  await page.mouse.up();
  await settle();
  const recipe = await page
    .locator('.image-layer')
    .evaluate((el) => JSON.parse(el.dataset.renderRecipe));
  assert.equal(recipe.at(-1).paintedMask.strokes.length, count + 1);
  assert.ok(recipe.at(-1).paintedMask.strokes.at(-1).points.length > 70);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.equal(
    await page
      .locator('.image-layer')
      .evaluate((el) => JSON.parse(el.dataset.renderRecipe).at(-1).paintedMask.strokes.length),
    count,
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settle();
  assert.deepEqual(errors, []);
  const delta = (name) =>
    (after.find((m) => m.name === name).value - before.find((m) => m.name === name).value) * 1000;
  const sorted = frames.filter((ms) => ms >= 0).sort((a, b) => a - b);
  // Hidden smoke windows can throttle compositor RAF. Script/task totals measure
  // UI work; the frame intervals are diagnostics, not a desktop FPS claim.
  const report = {
    layers: 25,
    moves: 90,
    completedStrokes: count,
    frames: frames.length,
    scriptMs: delta('ScriptDuration'),
    mainTaskMs: delta('TaskDuration'),
    frameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxFrameMs: Math.max(...sorted),
    groupedUndo: true,
    retainedPath: true,
    errors,
  };
  await writeFile(
    resolve(output, `${label}-${cpu ? 'cpu' : 'gpu'}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await closeTestApp(app);
}
