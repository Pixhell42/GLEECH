import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const output = resolve('test-results/open-file');
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(output, 'work-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(join(output, 'profile-')) };
env.GLEECH_TEST_NATIVE_FRAMES = '1';
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const targets = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
assert.ok(targets.length <= 1, 'Supply at most one packaged executable.');
const cpu = process.argv.includes('--cpu');
for (const flag of process.argv.slice(2).filter((argument) => argument.startsWith('--')))
  assert.equal(flag, '--cpu', `Unknown file-opening test option: ${flag}`);
const knownExecutables = new Map(
  [
    'win-unpacked/GLEECH.exe',
    'mac-arm64/GLEECH.app/Contents/MacOS/GLEECH',
    'mac/GLEECH.app/Contents/MacOS/GLEECH',
    'linux-unpacked/gleech',
    'linux-unpacked/gleech-bin',
  ].map((path) => {
    const executable = resolve('apps/desktop/release', path);
    return [executable, executable];
  }),
);
const exe =
  targets[0] &&
  knownExecutables.get(
    resolve(targets[0], ...(targets[0].endsWith('.app') ? ['Contents/MacOS/GLEECH'] : [])),
  );
if (targets[0]) assert.ok(exe, 'Use a known packaged executable under apps/desktop/release.');
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(exe ? { executablePath: resolve(exe) } : {}),
});
try {
  const page = await app.firstWindow();
  const command = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
  page.setDefaultTimeout(60000);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const choose = async (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_window, options) => {
        globalThis.__openFileOptions = options;
        return { canceled: false, filePaths: [path] };
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
  const settle = () =>
    page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return (
        node &&
        node.dataset.renderRevision === node.dataset.requestedRevision &&
        !document.querySelector('.operation-banner')
      );
    });
  const drop = async (path) => {
    await page.evaluate(() => {
      document.querySelector('#drop-fixture')?.remove();
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'drop-fixture';
      input.hidden = true;
      document.body.append(input);
    });
    await page.locator('#drop-fixture').setInputFiles(path);
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(document.querySelector('#drop-fixture').files[0]);
      document
        .querySelector('.viewport')
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
    });
    await page.waitForFunction(() => !document.querySelector('.operation-banner'));
  };
  const image = resolve('apps/desktop/resources/presets/statue.png');
  // A DOM-ready welcome screen may precede the first native compositor frame,
  // especially on hosted Intel Macs. Capture only after fonts and paint settle.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  await captureTestWindow(app, join(output, 'empty-open.png'));
  await choose(image);
  await page.getByRole('button', { name: 'Open Image or Video or Project', exact: true }).click();
  await page.waitForFunction(() =>
    /statue/.test(document.querySelector('.project-name')?.textContent ?? ''),
  );
  await settle();
  if (cpu) assert.equal(await page.locator('footer').getAttribute('data-render-backend'), 'cpu');
  const options = await app.evaluate(() => globalThis.__openFileOptions);
  assert.equal(options.title, 'Open File');
  for (const extension of [
    'png',
    'jpg',
    'jpeg',
    'webp',
    'mp4',
    'mov',
    'm4v',
    'webm',
    'mkv',
    'avi',
    'gif',
    'gleech',
  ])
    assert.ok(options.filters[0].extensions.includes(extension), extension);
  assert.match(await page.locator('.project-name').textContent(), /statue/);
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  assert.equal(
    await page
      .locator('.file-menu-items')
      .getByRole('button', { name: `Open File… ${command}+O`, exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('.file-menu-items')
      .getByRole('button', { name: /^Open (image|video|project)/ })
      .count(),
    0,
  );
  await captureTestWindow(app, join(output, 'open-file-menu.png'));
  await page.keyboard.press('Escape');
  const saved = join(work, 'image ü #.gleech');
  await choose(saved);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await settle();
  const status = await page.evaluate(() => window.gleech.renderStatus(true));
  assert.ok(status.ok && status.value.available);
  const video = join(work, 'drop video ü #.mp4');
  execFileSync(status.value.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    video,
  ]);
  await drop(video);
  await page.locator('.timeline-dock').waitFor();
  await page.waitForFunction(() =>
    /drop video/.test(document.querySelector('.source-row .track-name')?.textContent ?? ''),
  );
  await page.waitForFunction(() => document.querySelectorAll('.filmstrip img').length > 0);
  assert.equal(await page.locator('.error-banner').count(), 0);
  await drop(saved);
  await page.waitForFunction(() =>
    /image ü #/.test(document.querySelector('.project-name')?.textContent ?? ''),
  );
  await settle();
  await drop(image);
  await page.waitForFunction(() =>
    /statue/.test(document.querySelector('.project-name')?.textContent ?? ''),
  );
  const bad = join(work, 'unsupported.txt');
  await writeFile(bad, 'not an image');
  await drop(bad);
  await page
    .getByText('Choose a supported image, video, or .gleech project file.', { exact: true })
    .waitFor();
  assert.match(await page.locator('.project-name').textContent(), /statue/);
  await choose(saved);
  await page.keyboard.press(`${primary}+o`);
  await page.waitForFunction(() =>
    /image ü #/.test(document.querySelector('.project-name')?.textContent ?? ''),
  );
  await captureTestWindow(app, join(output, 'unified-open.png'));
  assert.deepEqual(errors, []);
  console.log(
    `Unified picker, image/video/project drops, unsupported-file recovery and ${command}+O passed.`,
  );
} finally {
  await closeTestApp(app);
}
