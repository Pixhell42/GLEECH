import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  assertEffectPreset,
  assertPresetName,
  assertPresetRecipe,
  type EffectPreset,
  type PresetRecipe,
} from '@gleech/project-model';

// Store recipes separately from projects; never include source images or snapshot branches.
export function createPresetLibrary(path: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function read(): Promise<EffectPreset[]> {
    let file;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      if ((await file.stat()).size > 50 * 1024 * 1024)
        throw new Error('The preset library is too large.');
      const value = JSON.parse(await file.readFile('utf8'));
      if (value.schemaVersion !== 1 || !Array.isArray(value.presets) || value.presets.length > 1000)
        throw new Error('Unsupported preset library.');
      const ids = new Set<string>();
      for (const preset of value.presets) {
        assertEffectPreset(preset);
        if (ids.has(preset.id)) throw new Error('Duplicate preset ID.');
        ids.add(preset.id);
      }
      return value.presets;
    } catch (error) {
      throw new Error('Could not read the preset library. Its saved contents were preserved.', {
        cause: error,
      });
    } finally {
      await file.close();
    }
  }
  function mutate<T>(operation: (presets: EffectPreset[]) => T, guard?: () => void): Promise<T> {
    const result = queue.then(async () => {
      const presets = await read();
      guard?.();
      const value = operation(presets);
      if (presets.length > 1000) throw new Error('The preset library is full.');
      const contents = JSON.stringify({ schemaVersion: 1, presets });
      if (Buffer.byteLength(contents) > 50 * 1024 * 1024)
        throw new Error('The preset library is full.');
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { flag: 'wx' });
        guard?.();
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return value;
    });
    queue = result.catch(() => {});
    return result;
  }
  return {
    async list() {
      await queue;
      return read();
    },
    save(
      name: string,
      recipe: PresetRecipe,
      thumbnail: string,
      thumbnailSource?: 'image' | 'statue',
      guard?: () => void,
    ) {
      assertPresetName(name);
      assertPresetRecipe(recipe);
      const preset: EffectPreset = JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          id: randomUUID(),
          name: name.trim(),
          createdAt: new Date().toISOString(),
          masterSeed: recipe.masterSeed,
          effects: recipe.effects,
          thumbnail,
          ...(thumbnailSource ? { thumbnailSource } : {}),
        }),
      );
      assertEffectPreset(preset);
      return mutate((presets) => {
        presets.unshift(preset);
        return preset;
      }, guard);
    },
    importPreset(value: EffectPreset, guard?: () => void) {
      assertEffectPreset(value);
      const preset: EffectPreset = JSON.parse(JSON.stringify(value));
      return mutate((presets) => {
        const names = new Set(presets.map((entry) => entry.name.toLocaleLowerCase()));
        const original = preset.name.trim();
        let name = original;
        for (let number = 2; names.has(name.toLocaleLowerCase()); number++) {
          const suffix = ` (${number})`;
          name = original.slice(0, 120 - suffix.length).trimEnd() + suffix;
        }
        const imported = { ...preset, id: randomUUID(), name };
        presets.unshift(imported);
        return imported;
      }, guard);
    },
    edit(id: string, name: string, thumbnail: string, thumbnailSource: 'image' | 'statue') {
      assertPresetName(name);
      return mutate((presets) => {
        const index = presets.findIndex((preset) => preset.id === id);
        if (index < 0) throw new Error('This preset no longer exists.');
        const updated = { ...presets[index]!, name: name.trim(), thumbnail, thumbnailSource };
        assertEffectPreset(updated);
        return (presets[index] = updated);
      });
    },
    rename(id: string, name: string) {
      assertPresetName(name);
      return mutate((presets) => {
        const index = presets.findIndex((preset) => preset.id === id);
        if (index < 0) throw new Error('This preset no longer exists.');
        return (presets[index] = { ...presets[index]!, name: name.trim() });
      });
    },
    delete(id: string) {
      return mutate((presets) => {
        const index = presets.findIndex((preset) => preset.id === id);
        if (index < 0) throw new Error('This preset no longer exists.');
        presets.splice(index, 1);
      });
    },
  };
}
