export type PreviewBackdrop = {
  mode: 'checkerboard' | 'black' | 'white' | 'overlay' | 'custom';
  color: string;
};
export const DEFAULT_PREVIEW_BACKDROP: PreviewBackdrop = { mode: 'checkerboard', color: '#808080' };
