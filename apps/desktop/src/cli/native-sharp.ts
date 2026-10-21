// CLI-only build alias: encoder modules use the same native module lookup as
// still exports, including resources/app.asar in packaged installations.
import type sharpModule from 'sharp';
import { loadSharp } from './runtime';

const sharp = ((...args: unknown[]) => {
  const native = loadSharp();
  if (!native) throw new Error('Timeline exports need Sharp. Run pnpm install.');
  return Reflect.apply(native, undefined, args);
}) as typeof sharpModule;

export default sharp;
