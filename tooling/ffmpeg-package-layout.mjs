import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const asar = createRequire(import.meta.url)('@electron/asar');

export function assertNoFfmpegStaging(resources) {
  const staged = asar
    .listPackage(join(resources, 'app.asar'))
    .map((path) => path.replaceAll('\\', '/').replace(/^\//, ''))
    .filter((path) => /^out\/ffmpeg(?:\/|$)/.test(path));
  assert.equal(
    staged.length,
    0,
    'FFmpeg staging files must stay outside app.asar; ship only the verified resources/ffmpeg bundle.',
  );
}
