import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyPrepared } from './prepare-ffmpeg.mjs';
import { assertNoFfmpegStaging } from './ffmpeg-package-layout.mjs';

const [resourceDirectory, ...extra] = process.argv.slice(2);
assert.ok(
  resourceDirectory && !extra.length,
  'Usage: ffmpeg-package-check.mjs <app-resources-directory>',
);
const directory = resolve(resourceDirectory, 'ffmpeg');
assertNoFfmpegStaging(resolve(resourceDirectory));
const target = `${process.platform}-${process.arch}`;
await verifyPrepared(directory, target);
const exe = join(directory, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const run = promisify(execFile);
const options = { windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
const { stdout: version } = await run(exe, ['-version'], options);
assert.match(version, /ffmpeg version 9\.0\.2-tas/);
assert.match(version, /--enable-gpl/);
assert.ok(!version.includes('--enable-nonfree'));
const { stdout: encoders } = await run(exe, ['-hide_banner', '-encoders'], options);
for (const name of ['libx264', 'libx265', 'libwebp_anim', 'prores_ks', 'ffv1', 'aac'])
  assert.ok(
    encoders.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[1] === name),
    `Missing encoder ${name}`,
  );
console.log(
  `Packaged FFmpeg ${target}: version, encoders, runtime hashes, notices and complete source verified.`,
);
