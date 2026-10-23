import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** Keep the original AppImage path so installed CLI/TUI launchers remain valid. */
export function replaceAppImage(current: string, downloaded: string): void {
  if (!isAbsolute(current) || !isAbsolute(downloaded) || current === downloaded)
    throw new Error('Invalid AppImage update paths.');
  const original = lstatSync(current);
  if (!original.isFile() || original.isSymbolicLink())
    throw new Error('Update the original AppImage file, rather than a symlink.');
  const temporary = join(dirname(current), `.gleech-update-${randomUUID()}.AppImage`);
  try {
    copyFileSync(downloaded, temporary, constants.COPYFILE_EXCL);
    const file = openSync(temporary, 'r+');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    chmodSync(temporary, (original.mode & 0o777) | 0o100);
    // Same-directory atomic replacement: the running image survives any copy failure.
    renameSync(temporary, current);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Preserve the original install error if staging cleanup also fails. */
    }
  }
}
