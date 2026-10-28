import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { candidate, targets } from './installed-acceptance-plan.mjs';

const key = `${process.platform}-${process.arch}`;
const target = targets[key];
assert.ok(target?.artifactId, 'Run on a supported native macOS/Linux runner.');
const run = promisify(execFile);
for (const [path, expected] of [
  ['apps', candidate.appsTree],
  ['packages', candidate.packagesTree],
  ['pnpm-lock.yaml', candidate.lockBlob],
]) {
  assert.equal(
    (await run('git', ['rev-parse', `HEAD:${path}`])).stdout.trim(),
    expected,
    'Application inputs changed since candidate approval.',
  );
}
const output = resolve('test-results/installed-acceptance', key, 'download');
await mkdir(output, { recursive: true });
const wrapper = resolve(output, 'artifact.zip');
const response = await fetch(
  `https://api.github.com/repos/Pixhell42/GLEECH/actions/artifacts/${target.artifactId}/zip`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  },
);
assert.equal(response.status, 302, 'The approved Actions artifact is unavailable.');
const location = new URL(response.headers.get('location'));
assert.equal(location.protocol, 'https:');
// Never forward the GitHub token to the signed artifact URL.
const download = await fetch(location, { signal: AbortSignal.timeout(300000) });
assert.equal(download.status, 200);
await pipeline(Readable.fromWeb(download.body), createWriteStream(wrapper, { flags: 'wx' }));
async function hash(file) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
assert.equal(await hash(wrapper), target.artifactSHA256, 'Actions wrapper digest changed.');
const entries = (await run('unzip', ['-Z1', wrapper])).stdout.trim().split(/\r?\n/);
assert.ok(entries.every((entry) => !entry.startsWith('/') && !entry.split('/').includes('..')));
const matches = entries.filter((entry) => entry.split('/').at(-1) === target.archive);
assert.equal(matches.length, 1, 'Expected one approved application archive.');
await run('unzip', ['-j', wrapper, matches[0], '-d', output], { timeout: 120000 });
assert.equal(
  await hash(resolve(output, target.archive)),
  target.sha256,
  'Candidate package digest changed.',
);
console.log(`Verified exact ${key} candidate ${target.archive}: ${target.sha256}`);
