import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertEffectPreset } from '@gleech/project-model';
import type { LibraryPreset } from '../shared/image-api';

export function createBuiltinPresetLibrary(directory: string) {
  let cached: Promise<readonly LibraryPreset[]> | undefined;
  return {
    list() {
      return (cached ??= (async () => {
        const data = JSON.parse(await readFile(join(directory, 'built-in.json'), 'utf8')) as {
          version: number;
          presets: LibraryPreset[];
        };
        if (data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 64)
          throw new Error('Invalid built-in preset catalog.');
        const ids = new Set<string>();
        for (const preset of data.presets) {
          assertEffectPreset(preset);
          if (
            !preset.id.startsWith('builtin-v1:') ||
            ids.has(preset.id) ||
            typeof preset.description !== 'string'
          )
            throw new Error('Invalid built-in preset entry.');
          ids.add(preset.id);
        }
        return data.presets.map((preset) => ({ ...preset, builtIn: true }));
      })());
    },
  };
}
