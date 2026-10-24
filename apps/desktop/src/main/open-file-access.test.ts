import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { OpenFileAccess } from './open-file-access';
import { fileKindForPath, openFileFilters } from '../shared/open-file';

it.each([
  ['photo.PNG', 'image'],
  ['photo.JPEG', 'image'],
  ['clip.MP4', 'video'],
  ['clip.GIF', 'video'],
  ['save.GLEECH', 'project'],
] as const)('routes %s to the %s opener without reading it as an image', (name, kind) => {
  const access = new OpenFileAccess();
  const path = resolve('test-results', 'files ü #', name);
  const selected = access.select(path);
  expect(selected.kind).toBe(kind);
  expect(access.take(selected.id, kind)).toBe(path);
  expect(() => access.take(selected.id, kind)).toThrow('again');
});
it('rejects unsupported files, relative paths, NULs and forged selections', () => {
  const access = new OpenFileAccess();
  expect(fileKindForPath('clip.mp4.exe')).toBeNull();
  for (const path of ['clip.mp4', resolve('notes.txt'), resolve('clip.mp4') + '\0'])
    expect(() => access.select(path)).toThrow();
  expect(() => access.take('forged', 'project')).toThrow();
  const selected = access.select(resolve('photo.png'));
  expect(() => access.take(selected.id, 'project')).toThrow();
  expect(access.take(selected.id, 'image')).toBe(resolve('photo.png'));
  const old = access.select(resolve('photo.png'));
  access.clear();
  expect(() => access.take(old.id, 'image')).toThrow();
});
it('advertises exactly the supported image, video and project formats', () => {
  const [all, ...groups] = openFileFilters();
  expect(new Set(all!.extensions)).toEqual(new Set(groups.flatMap((group) => group.extensions)));
  for (const extension of all!.extensions)
    expect(fileKindForPath(`file.${extension}`)).not.toBeNull();
  expect(all!.extensions).toContain('gleech');
  expect(all!.extensions).toContain('mp4');
  expect(all!.extensions).toContain('webp');
});
