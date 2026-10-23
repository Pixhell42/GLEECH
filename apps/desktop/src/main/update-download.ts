import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateProgress, UpdateRelease } from '../shared/updates';

export async function verifyUpdateDownload(path: string, release: UpdateRelease): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  if (size !== release.bytes || hash.digest('hex') !== release.sha256)
    throw new Error('The update failed its integrity check. Please download it again.');
}

export async function downloadVerifiedUpdate(
  release: UpdateRelease,
  folder: string,
  progress: (value: UpdateProgress) => void,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<string> {
  if (!/^GLEECH-\d+\.\d+\.\d+-mac-(arm64|x64)\.zip$/.test(release.asset))
    throw new Error('Invalid Mac update package.');
  await mkdir(folder, { recursive: true });
  const path = join(folder, release.asset);
  const temporary = join(folder, `${release.asset}.${randomUUID()}.part`);
  const started = Date.now();
  let transferred = 0,
    lastProgress = 0;
  try {
    signal.throwIfAborted();
    const response = await request(release.downloadUrl, { signal });
    if (!response.ok || !response.body)
      throw new Error(`Could not download the update (${response.status}).`);
    const file = await open(temporary, 'wx', 0o600);
    const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        transferred += value.length;
        if (transferred > release.bytes)
          throw new Error('The update download exceeds its expected size.');
        await file.writeFile(value);
        if (Date.now() - lastProgress >= 100 || transferred === release.bytes) {
          progress({
            percent: (transferred * 100) / release.bytes,
            transferred,
            total: release.bytes,
            bytesPerSecond: (transferred * 1000) / Math.max(1, Date.now() - started),
          });
          lastProgress = Date.now();
        }
      }
      await file.sync();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
    }
    await verifyUpdateDownload(temporary, release);
    await rename(temporary, path);
    return path;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
