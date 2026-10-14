import { createStarterMapLibrary } from './starter-maps';

export function createVectorMapLibrary(directory: string) {
  return createStarterMapLibrary(directory, 'vector');
}
