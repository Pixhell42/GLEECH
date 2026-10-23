import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { updateChildPath } from './update-path';

/** Keep the original AppImage path so installed CLI/TUI launchers remain valid. */
export function replaceAppImage(current: string, downloaded: string): void {
  if (!isAbsolute(current) || !isAbsolute(downloaded) || current === downloaded)
    throw new Error('Invalid AppImage update paths.');
  // APPIMAGE and the updater's cache select the directories locally. Only
  // direct child files in those canonical directories may be replaced/copied.
  const installation = realpathSync(dirname(current));
  const target = updateChildPath(installation, basename(current));
  const source = updateChildPath(realpathSync(dirname(downloaded)), basename(downloaded));
  if (target === source) throw new Error('Invalid AppImage update paths.');
  const original = lstatSync(target);
  if (!original.isFile() || original.isSymbolicLink())
    throw new Error('Update the original AppImage file, rather than a symlink.');
  const incoming = lstatSync(source);
  if (!incoming.isFile() || incoming.isSymbolicLink())
    throw new Error('The downloaded AppImage must be a regular file, not a link.');
  const temporary = updateChildPath(installation, `.gleech-update-${randomUUID()}.AppImage`);
  try {
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    const file = openSync(temporary, 'r+');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    chmodSync(temporary, (original.mode & 0o777) | 0o100);
    // Same-directory atomic replacement: the running image survives any copy failure.
    renameSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Preserve the original install error if staging cleanup also fails. */
    }
  }
}
