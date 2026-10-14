import { createStarterMapLibrary } from './starter-maps';

export function createDepthMapLibrary(directory: string) {
  return createStarterMapLibrary(directory, 'depth');
}
