import { isAbsolute, resolve, sep } from 'node:path';

/** A direct child of a directory selected by local configuration, never by release metadata. */
export function updateChildPath(folder: string, name: string): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    isAbsolute(name) ||
    (process.platform === 'win32' && name.includes(':'))
  )
    throw new Error('Invalid update filename.');
  const root = resolve(folder);
  const path = resolve(root, name);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!path.startsWith(prefix)) throw new Error('The update file is outside its directory.');
  return path;
}
