// End-to-end check of Timeline mode: keyframes, playback, seeds, ranges,
// renders (GIF, PNG sequence, MP4 when ffmpeg is available) and project reload.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';

const output = resolve('test-results/timeline');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const renders = await mkdtemp(resolve(output, 'renders-'));
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
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(1440, 960);
  });
  const layer = page.locator('.image-layer');
  const settle = async () => {
    await page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  };
  const recipe = async () => JSON.parse(await layer.getAttribute('data-render-recipe'));
  const timecode = () => page.locator('.timecode').textContent();
  const stubSave = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
  const stubFolder = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, path);
  // The Render dialog's Save to box: the file it writes, or the frames folder.
  const savesTo = (path) =>
    page.waitForFunction(
      (path) => document.querySelector('.render-save-name')?.title === path,
      path,
    );
  const framesGoTo = (path) =>
    page.waitForFunction(
      (path) => document.querySelector('.render-save-folder')?.title === path,
      path,
    );

  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  await page.locator('.image-layer:not([hidden])').waitFor();
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Motion Mosh', exact: true })
    .click();
  await settle();

  // Image mode looks like today's app: no timeline, no time chip.
  assert.equal(await page.locator('.timeline-dock').count(), 0);
  assert.equal(await page.locator('.mode-chip').count(), 0);
  assert.equal(
    await page.locator('.stack-comparison').getByRole('button', { name: 'Edited' }).count(),
    1,
  );
  const renderMenu = async () => {
    await page.getByRole('button', { name: 'File menu', exact: true }).click();
    await page.locator('.file-menu-items').getByRole('button', { name: 'Export' }).click();
    const button = page
      .locator('.file-menu-items')
      .getByRole('button', { name: 'Render Video… Ctrl+Shift+R', exact: true });
    const disabled = await button.isDisabled();
    await page.keyboard.press('Escape');
    return disabled;
  };
  assert.equal(await renderMenu(), true, 'Render Video waits for a timeline');

  // Timeline mode
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.locator('.timeline-dock').waitFor();
  assert.equal(await page.locator('.stack-panel').count(), 0);
  assert.equal(
    await page.locator('.canvas-comparison').getByRole('button', { name: 'Edited' }).count(),
    1,
  );
  // The Original badge shows below the canvas toggle, not under it.
  const comparison = page.locator('.canvas-comparison');
  await comparison.getByRole('button', { name: 'Original', exact: true }).click();
  const toggleBox = await comparison.boundingBox();
  const badgeBox = await page.locator('.comparison-badge').boundingBox();
  assert.ok(badgeBox.y >= toggleBox.y + toggleBox.height, 'Original badge clears the toggle');
  await comparison.getByRole('button', { name: 'Edited', exact: true }).click();
  assert.match(await page.locator('.mode-chip').textContent(), /preview/);
  assert.equal(await timecode(), '00:00:00');
  assert.equal(await renderMenu(), false);

  // Key Opacity at 0 and 1 s.
  await page.getByRole('button', { name: 'Animate Opacity', exact: true }).click();
  assert.equal(await page.locator('.lane-key').count(), 1);
  for (let step = 0; step < 3; step++) await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await timecode(), '00:01:00');
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.2');
  await settle();
  assert.equal(await page.locator('.lane-key').count(), 2);
  assert.equal((await recipe())[0].params.amount, 0.2);
  // Halfway between the keys the eased value sits between them. Leave the
  // slider first: focused sliders keep their own arrow and Home keys.
  const blur = () => page.locator('.ruler-header').click();
  await blur();
  await page.keyboard.press('Home');
  for (let step = 0; step < 15; step++) await page.keyboard.press('ArrowRight');
  await settle();
  const halfway = (await recipe())[0].params.amount;
  assert.ok(halfway > 0.25 && halfway < 0.95, `eased opacity ${halfway}`);
  assert.equal(
    await page.getByRole('slider', { name: 'Opacity', exact: true }).inputValue(),
    String(halfway),
  );

  // Undo and redo keyframes.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.locator('.lane-key').count(), 1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await page.locator('.lane-key').count(), 2);

  // Dragging a key follows the pointer across many frames as one Undo step.
  // Key labels read "… keyframe at MM:SS:FF …"; convert to a 30 fps frame number.
  const keyFrame = async (index) => {
    const label = await page.locator('.lane-key').nth(index).getAttribute('aria-label');
    const [, minutes, seconds, frames] = label.match(/at (\d+):(\d+):(\d+)/).map(Number);
    return (minutes * 60 + seconds) * 30 + frames;
  };
  assert.equal(await keyFrame(1), 30);
  const box = await page.locator('.lane-key').nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++)
    await page.mouse.move(box.x + box.width / 2 + step * 8, box.y + box.height / 2);
  await page.mouse.up();
  const dragged = await keyFrame(1);
  assert.ok(dragged >= 50, `key followed the drag to frame ${dragged}`);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await keyFrame(1), 30, 'one Undo restores the dragged key');
  assert.equal(await page.locator('.key-drag-hint').count(), 0);

  // Curves view shows the same keys on one graph.
  await page.getByRole('button', { name: 'Curves', exact: true }).click();
  assert.equal(await page.locator('.curve-key').count(), 2);
  await page.getByRole('button', { name: 'Keys', exact: true }).click();

  // Seed track: every 2 frames changes the seed away from frame 0.
  await page.getByRole('button', { name: 'Seed mode', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Every 2 frames', exact: true }).click();
  await settle();
  assert.notEqual(await layer.getAttribute('data-render-seed'), '8172');
  await blur();
  await page.keyboard.press('Home');
  await settle();
  assert.equal(await layer.getAttribute('data-render-seed'), '8172');

  // Playback advances the playhead and fills the frame cache; seeking while
  // playing restarts from the new frame.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Go to start', exact: true }).click();
  await page.waitForTimeout(150);
  assert.match(await timecode(), /^00:00:/, 'Go to start while playing');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.notEqual(await timecode(), '00:00:00');
  assert.ok((await page.locator('.cache-run').count()) > 0, 'cached frames are marked');
  await captureTestWindow(app, join(output, 'timeline.png'));

  // In / Out points for the render range.
  await blur();
  await page.keyboard.press('Home');
  for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('i');
  for (let step = 0; step < 2; step++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('o');
  assert.equal(await page.locator('.in-out-range').count(), 1);

  // Image mode shows the frame at the playhead and a time chip.
  await page.getByRole('tab', { name: 'Image', exact: true }).click();
  assert.match(await page.locator('.mode-chip-time').textContent(), /00:00:26/);
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();

  // GIF over In / Out.
  const gifPath = join(renders, 'loop.gif');
  await stubSave(gifPath);
  await page.keyboard.press('Control+Shift+G');
  const dialog = page.locator('dialog.render-dialog');
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: 'In / Out', exact: true }).click();
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await savesTo(gifPath);
  const status = await page.evaluate(() => window.gleech.renderStatus(true));
  const ffmpeg = status.ok && status.value.available;
  if (ffmpeg) {
    await dialog.getByRole('button', { name: 'Export GIF', exact: true }).click();
    await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
    const gif = await readFile(gifPath);
    assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
    await page
      .locator('.render-job')
      .getByRole('button', { name: /^Dismiss/ })
      .click();
  } else {
    console.log('ffmpeg not found: skipping GIF and MP4 renders');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  // PNG sequence of the In / Out range (no ffmpeg needed).
  const sequence = await mkdtemp(join(renders, 'frames-'));
  await stubFolder(sequence);
  await page.keyboard.press('Control+Shift+R');
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: 'In / Out', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Image sequence', exact: true }).click();
  await dialog.getByRole('radio', { name: '8-bit', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Put in a subfolder', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await framesGoTo(sequence);
  await dialog.getByRole('button', { name: /^Render \d+ Frames$/ }).click();
  await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
  const pngs = (await readdir(sequence)).filter((name) => name.endsWith('.png'));
  // In at frame 6, Out at frame 26 (inclusive): 21 frames.
  assert.equal(pngs.length, 21, `sequence frames ${pngs.join(', ')}`);
  await page
    .locator('.render-job')
    .getByRole('button', { name: /^Dismiss/ })
    .click();

  if (ffmpeg) {
    const moviePath = join(renders, 'movie.mp4');
    await stubSave(moviePath);
    await page.keyboard.press('Control+Shift+R');
    await dialog.waitFor();
    await dialog.getByRole('radio', { name: 'In / Out', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Movie file', exact: true }).click();
    await dialog.getByRole('button', { name: 'Half-res Draft', exact: false }).click();
    await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
    await savesTo(moviePath);
    await dialog.getByRole('button', { name: 'Render Video', exact: true }).click();
    await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
    const movie = await readFile(moviePath);
    assert.equal(movie.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.ok((await stat(moviePath)).size > 1000);
  }

  // Save and reopen: the timeline and keys persist.
  const projectPath = join(renders, 'timeline.gleech');
  await stubSave(projectPath);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await stubFolder(projectPath);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  await page.keyboard.press('Control+o');
  await page.locator('.operation-banner').waitFor({ state: 'hidden', timeout: 120000 });
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.locator('.timeline-dock').waitFor();
  assert.equal(await page.locator('.lane-key').count(), 2);
  assert.match(await page.getByRole('button', { name: 'Seed mode' }).textContent(), /Every 2/);

  // Renders are named after the saved project, and the name can be typed.
  await page.keyboard.press('Control+Shift+G');
  await dialog.waitFor();
  const fileName = dialog.getByRole('textbox', { name: 'File name', exact: true });
  assert.equal(await fileName.inputValue(), 'timeline');
  await stubSave(join(renders, 'picked.gif'));
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await savesTo(join(renders, 'picked.gif'));
  assert.equal(await fileName.inputValue(), 'picked');
  const replaceNote = dialog.locator('.render-save-note');
  await writeFile(join(renders, 'taken.gif'), 'not a render');
  await fileName.fill('taken');
  await savesTo(join(renders, 'taken.gif'));
  await replaceNote.waitFor();
  await fileName.fill('fresh / name');
  assert.equal(await fileName.inputValue(), 'fresh  name');
  await savesTo(join(renders, 'fresh  name.gif'));
  await replaceNote.waitFor({ state: 'detached' });
  // An emptied name goes back to the project's.
  await fileName.fill('');
  await fileName.press('Tab');
  assert.equal(await fileName.inputValue(), 'timeline');
  await savesTo(join(renders, 'timeline.gif'));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // A typed name also names image-sequence frames and their subfolder.
  while (await page.locator('.render-job').count())
    await page
      .locator('.render-job')
      .first()
      .getByRole('button', { name: /^Dismiss/ })
      .click();
  const named = await mkdtemp(join(renders, 'named-'));
  await stubFolder(named);
  await page.keyboard.press('Control+Shift+R');
  await dialog.waitFor();
  await dialog.getByRole('radio', { name: 'In / Out', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Image sequence', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Put in a subfolder', exact: true }).check();
  await dialog.getByRole('button', { name: 'Change…', exact: true }).click();
  await fileName.fill('shot 4');
  await framesGoTo(join(named, 'shot 4_frames'));
  await dialog.getByRole('button', { name: /^Render \d+ Frames$/ }).click();
  await page.locator('.render-job[data-status="done"]').waitFor({ timeout: 240000 });
  const shots = (await readdir(join(named, 'shot 4_frames'))).filter((name) =>
    name.endsWith('.png'),
  );
  assert.equal(shots.length, 21, `named frames ${shots.join(', ')}`);
  assert.ok(shots.includes('shot 4_0001.png'), `named frames ${shots.join(', ')}`);

  assert.deepEqual(errors, []);
  console.log('Timeline check passed');
} finally {
  await closeTestApp(app);
}
