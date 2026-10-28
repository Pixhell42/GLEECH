import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { targets } from './upgrade-acceptance-plan.mjs';

const key = `${process.platform}-${process.arch}`;
assert.ok(targets[key], 'Run on a supported native target.');
const output = resolve('test-results/upgrade-acceptance', key, 'download');
await mkdir(output, { recursive: true });
for (const release of Object.values(targets[key])) {
  const path = join(output, release.archive);
  const response = await fetch(
    `https://github.com/Pixhell42/GLEECH/releases/download/${release.tag}/${release.archive}`,
    { signal: AbortSignal.timeout(600000) },
  );
  assert.equal(response.status, 200, 'The published package must remain available.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  assert.equal(hash.digest('hex'), release.sha256, release.archive);
  console.log(`Verified published ${release.version} ${key}: ${release.sha256}`);
}
