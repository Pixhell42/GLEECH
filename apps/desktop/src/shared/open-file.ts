export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'gif'] as const;
export const PROJECT_FILE_EXTENSIONS = ['gleech'] as const;
export type OpenFileKind = 'image' | 'video' | 'project';
export interface SelectedFile {
  readonly id: string;
  readonly kind: OpenFileKind;
}
export function fileKindForPath(path: string): OpenFileKind | null {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
  if (!extension) return null;
  if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'image';
  if ((VIDEO_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'video';
  if ((PROJECT_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'project';
  return null;
}
export function openFileFilters() {
  return [
    {
      name: 'All supported files',
      extensions: [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...PROJECT_FILE_EXTENSIONS],
    },
    { name: 'Images', extensions: [...IMAGE_FILE_EXTENSIONS] },
    { name: 'Videos', extensions: [...VIDEO_FILE_EXTENSIONS] },
    { name: 'GLEECH projects', extensions: [...PROJECT_FILE_EXTENSIONS] },
  ];
}
