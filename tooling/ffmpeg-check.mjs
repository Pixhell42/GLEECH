// Exercise the real bridge and locator with PATH disabled and an isolated profile.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { prepareFfmpeg } from './prepare-ffmpeg.mjs';

const [executablePath, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: node tooling/ffmpeg-check.mjs [packaged-executable]');
if (!executablePath) await prepareFfmpeg();
const output = resolve('test-results/ffmpeg-check');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const alternate = await mkdtemp(join(output, 'selected ffmpeg-'));
const env = { ...process.env, PATH: '', GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app;
async function open() {
  app = await electron.launch({
    args: [...(executablePath ? [] : [resolve('apps/desktop')]), '--smoke-test'],
    env,
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  return page;
}
try {
  let page = await open();
  const bundled = await page.evaluate(() => window.gleech.renderStatus(true));
  assert.ok(bundled.ok && bundled.value.available);
  assert.equal(bundled.value.source, 'bundled');
  assert.equal(bundled.value.version, '9.0.2-tas');
  assert.ok(bundled.value.encoders.includes('libx264'));
  assert.ok(bundled.value.encoders.includes('libx265'));
  // Development bundles include a target directory between ffmpeg/ and bin/.
  assert.equal(basename(dirname(bundled.value.path)), 'bin');
  // On Windows the DLLs stay beside the selected executable; on Unix preserve
  // the complete bin/lib relative layout for the executable's runtime paths.
  await cp(dirname(dirname(bundled.value.path)), alternate, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const selected = join(alternate, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selected);
  const located = await page.evaluate(() => window.gleech.locateFfmpeg());
  assert.ok(located.ok);
  assert.equal(located.value.source, 'configured');
  assert.equal(located.value.path, selected);
  await closeTestApp(app);
  app = null;
  page = await open();
  const restored = await page.evaluate(() => window.gleech.renderStatus(true));
  assert.ok(restored.ok);
  assert.equal(restored.value.source, 'configured');
  assert.equal(restored.value.path, selected);
  await unlink(selected);
  const fallback = await page.evaluate(() => window.gleech.renderStatus(true));
  assert.ok(fallback.ok);
  assert.equal(fallback.value.source, 'bundled');
  assert.equal(fallback.value.path, bundled.value.path);
  console.log(
    'FFmpeg bridge check passed: bundled without PATH, Locate override, persistence and missing-file fallback.',
  );
} finally {
  if (app) await closeTestApp(app);
}
