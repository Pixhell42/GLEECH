// End-to-end check of timeline media: open a video clip (its first frame
// becomes the source), add an analyzed audio track, drive a control from audio
// and render a loop from the clip. Needs the ffmpeg GLEECH finds at runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';

const output = resolve('test-results/timeline-media');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const work = await mkdtemp(resolve(output, 'work-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile, GLEECH_TEST_NATIVE_FRAMES: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
// CI also passes a packaged GLEECH.exe to run the same check against the installer build.
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const app = await electron.launch({
  args: [...(exe ? [] : [resolve('apps/desktop')]), '--smoke-test'],
  env,
  ...(exe ? { executablePath: resolve(exe) } : {}),
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(1440, 960);
  });
  const status = await page.evaluate(() => window.gleech.renderStatus(true));
  if (!status.ok || !status.value.available) {
    console.log('ffmpeg not found: timeline media check skipped');
    process.exit(0);
  }
  const ffmpeg = status.value.path;
  const clip = join(work, 'clip.mp4');
  const beat = join(work, 'beat.wav');
  execFileSync(ffmpeg, [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=110:duration=4'],
    ...['-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip],
  ]);
  execFileSync(ffmpeg, [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i'],
    "aevalsrc='0.8*sin(2*PI*60*t)*exp(-12*mod(t,0.5))':d=6:s=44100",
    beat,
  ]);
  const choose = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
  const settle = async () => {
    await page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    });
  };

  // Open video from the File menu over an open image: after the unsaved-work
  // prompt the clip replaces the image, names the project and opens Timeline mode.
  const projectName = () => page.locator('.project-name').textContent();
  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  await page.locator('.image-layer:not([hidden])').waitFor();
  assert.match(await projectName(), /statue/);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await choose(clip);
  await fileAction(page, 'Open video…');
  await page.locator('.timeline-dock').waitFor();
  assert.match(await projectName(), /clip\.mp4/);
  assert.match(await page.locator('.source-row .track-name').textContent(), /clip\.mp4/);
  assert.match(await page.locator('.source-row .track-meta').textContent(), /Video/);
  assert.equal(await page.locator('.timecode').textContent(), '00:00:00');
  assert.match(await page.locator('.duration-button').textContent(), /00:04:00/);
  await page.waitForFunction(() => document.querySelectorAll('.filmstrip img').length > 0);
  await settle();

  // Add the beat track; analysis finds its tempo.
  await page.getByRole('button', { name: 'Add track', exact: true }).click();
  await choose(beat);
  await page.getByRole('menuitem', { name: 'Audio track…', exact: true }).click();
  await page.locator('.audio-row').waitFor();
  await page.waitForFunction(() =>
    /BPM/.test(document.querySelector('.audio-row .track-meta')?.textContent ?? ''),
  );
  const bpm = Number(
    (await page.locator('.audio-row .track-meta').textContent()).match(/[\d.]+/)[0],
  );
  assert.ok(Math.abs(bpm - 120) < 3, `detected ${bpm} BPM`);
  assert.ok((await page.locator('.beat-tick').count()) > 0);

  // Drive an effect's opacity from the low band.
  await page
    .locator('.timeline-dock')
    .getByRole('button', { name: 'Add track', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Effect…', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Motion Mosh', exact: true })
    .click();
  await page.getByRole('button', { name: 'Animate Opacity', exact: true }).click();
  await page.getByRole('button', { name: 'Link to audio', exact: true }).click();
  await page.locator('.modulator-card.audio').waitFor();
  assert.equal(await page.getByRole('slider', { name: 'Opacity', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Back to effect controls', exact: true }).click();
  assert.match(
    await page.locator('[data-settings-key="amount"] .modulator-tag').textContent(),
    /Audio/,
  );
  await page.locator('.live-modulation').waitFor();

  // Play the clip, then render a loop from it.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await captureTestWindow(app, join(output, 'timeline-media.png'));
  const gifPath = join(work, 'clip-loop.gif');
  await choose(gifPath);
  await page.keyboard.press('Control+Shift+G');
  const dialog = page.locator('dialog.render-dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Tiny', exact: false }).click();
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await page.waitForFunction(
    (path) => document.querySelector('.render-save-row output')?.textContent === path,
    gifPath,
  );
  await dialog.getByRole('button', { name: 'Export GIF', exact: true }).click();
  await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
  const gif = await readFile(gifPath);
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(gif.length < 1_000_000, `Tiny GIF stays under 1 MB (${gif.length})`);

  await page
    .locator('.render-job')
    .getByRole('button', { name: /^Dismiss/ })
    .click();

  // Renders read every clip frame: with the effect hidden, a sequence of the
  // moving test pattern must not repeat the first (poster) frame.
  await page.getByRole('button', { name: 'Enable Motion Mosh track', exact: true }).click();
  const frames = await mkdtemp(join(work, 'frames-'));
  await choose(frames);
  await page.keyboard.press('Control+Shift+R');
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: 'Image sequence', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Every 2nd', exact: true }).click();
  await dialog.getByRole('radio', { name: '8-bit', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Put in a subfolder', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await page.waitForFunction(
    (path) => document.querySelector('.render-save-row output')?.textContent === path,
    frames,
  );
  await dialog.getByRole('button', { name: /^Render \d+ Frames$/ }).click();
  await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
  const pngs = (await readdir(frames)).filter((name) => name.endsWith('.png')).sort();
  assert.equal(pngs.length, 60);
  const first = await readFile(join(frames, pngs[0]));
  const last = await readFile(join(frames, pngs.at(-1)));
  assert.notDeepEqual(first, last, 'clip frames change over the render');

  // Image mode makes the clip frame at the playhead the source image. The swap
  // is not an undo step: Undo reverts the last edit (hiding Motion Mosh).
  const layer = page.locator('.image-layer');
  const renderSource = () => layer.getAttribute('data-render-source');
  const recipe = async () => JSON.parse(await layer.getAttribute('data-render-recipe'));
  await page.locator('.ruler-header').click();
  await page.keyboard.press('Home');
  for (let step = 0; step < 6; step++) await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await page.locator('.timecode').textContent(), '00:02:00');
  const poster = await renderSource();
  await page.getByRole('tab', { name: 'Image', exact: true }).click();
  await page.waitForFunction(
    (id) => document.querySelector('.image-layer')?.dataset.renderSource !== id,
    poster,
  );
  await page.locator('.operation-banner').waitFor({ state: 'hidden' });
  await settle();
  assert.match(await page.locator('.mode-chip-time').textContent(), /00:02:00/);
  const still = await renderSource();
  assert.equal((await recipe())[0].enabled, false);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await recipe())[0].enabled, true);
  assert.equal(await renderSource(), still);
  // Back in Timeline the clip plays again.
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  assert.match(await page.locator('.source-row .track-meta').textContent(), /Video/);

  // Opening an image removes the clip, keeps the rest of the timeline and
  // names the project after the image.
  await fileAction(page, 'Open sample image');
  await settle();
  assert.match(await page.locator('.source-row .track-meta').textContent(), /Still/);
  assert.match(await projectName(), /statue/);
  assert.equal(await page.locator('.audio-row').count(), 1);

  assert.deepEqual(errors, []);
  console.log('Timeline media check passed');
} finally {
  await closeTestApp(app);
}
