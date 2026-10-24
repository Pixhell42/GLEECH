import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { fileKindForPath, type OpenFileKind, type SelectedFile } from '../shared/open-file';

/** One-use selections keep renderer routing separate from access to filesystem paths. */
export class OpenFileAccess {
  private readonly selections = new Map<string, { path: string; kind: OpenFileKind }>();
  select(path: unknown): SelectedFile {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.length > 4096)
      throw new Error('Choose or drop an image, video, or GLEECH project from your computer.');
    const kind = fileKindForPath(path);
    if (!kind) throw new Error('Choose a supported image, video, or .gleech project file.');
    const id = randomUUID();
    this.selections.set(id, { path, kind });
    while (this.selections.size > 128) this.selections.delete(this.selections.keys().next().value!);
    return { id, kind };
  }
  take(id: unknown, kind: OpenFileKind): string {
    const selection = typeof id === 'string' ? this.selections.get(id) : undefined;
    if (!selection || selection.kind !== kind) throw new Error('Choose or drop that file again.');
    this.selections.delete(id as string);
    return selection.path;
  }
  clear(): void {
    this.selections.clear();
  }
}
