import { open, readdir } from 'node:fs/promises';
import { decodeShaderImport, type ShaderPackage } from '@gleech/project-model/shader-package';
import { createShaderLibrary } from '../main/shader-library';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EffectPreset } from '@gleech/project-model';
import { createBuiltinPresetLibrary } from '../main/builtin-presets';
import { createPresetLibrary } from '../main/preset-library';
import { decodePreset } from '../main/preset-file';
import { resourcesDir } from './runtime';

export interface CliPreset extends EffectPreset {
  readonly description?: string;
  readonly origin: 'built-in' | 'library' | 'file';
}

/** GLEECH's per-user data folder, read-only from the CLI. */
export function userDataCandidates(): string[] {
  const override = process.env['GLEECH_USER_DATA'];
  if (override) return [override];
  const home = homedir();
  const base =
    process.platform === 'win32'
      ? (process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : (process.env['XDG_CONFIG_HOME'] ?? join(home, '.config'));
  // Packaged builds use the product name; development builds use the package name.
  return [join(base, 'GLEECH'), join(base, '@gleech', 'desktop')];
}

let cache: Promise<CliPreset[]> | undefined;
export function listPresets(): Promise<CliPreset[]> {
  return (cache ??= (async () => {
    const builtIn = await createBuiltinPresetLibrary(join(resourcesDir(), 'presets')).list();
    const user: CliPreset[] = [];
    for (const dir of userDataCandidates()) {
      const path = join(dir, 'presets.json');
      if (!existsSync(path)) continue;
      try {
        for (const preset of await createPresetLibrary(path).list())
          user.push({ ...preset, origin: 'library' });
      } catch {
        // An unreadable personal library should not block built-in presets.
      }
    }
    return [...builtIn.map((preset) => ({ ...preset, origin: 'built-in' as const })), ...user];
  })());
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/^builtin-v1:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function presetSlug(preset: EffectPreset): string {
  return slug(preset.name);
}

/** Resolve a preset by file path, exact/slug name, ID, or unique prefix. */
export async function findPreset(query: string): Promise<CliPreset> {
  if (/\.gleechpreset$/i.test(query) || existsSync(query)) {
    const preset = decodePreset(await readFile(resolve(query)));
    return { ...preset, origin: 'file' };
  }
  const presets = await listPresets();
  const wanted = slug(query);
  const exact = presets.find(
    (preset) => preset.id === query || slug(preset.name) === wanted || slug(preset.id) === wanted,
  );
  if (exact) return exact;
  const partial = presets.filter((preset) => slug(preset.name).includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1)
    throw new Error(
      `“${query}” matches ${partial.length} presets: ${partial.map((p) => p.name).join(', ')}.`,
    );
  throw new Error(`No preset named “${query}”. Run gleech presets to list them.`);
}

/** Shader browsing never changes the desktop app's saved library. */
export async function listShaders(): Promise<ShaderPackage[]> {
  const result: ShaderPackage[] = [];
  const bundled = join(resourcesDir(), 'shaders');
  for (const name of await readdir(bundled).catch(() => [] as string[]))
    if (name.endsWith('.gleech-shader')) result.push(await readShader(join(bundled, name)));
  for (const directory of userDataCandidates()) {
    const items = await createShaderLibrary(join(directory, 'shaders.json'))
      .list()
      .catch(() => []);
    result.push(...items.map((item) => item.package));
  }
  return [...new Map(result.map((pkg) => [pkg.id + '@' + pkg.version, pkg])).values()];
}
export async function readShader(path: string): Promise<ShaderPackage> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > 256 * 1024) throw new Error('Shader file exceeds 256 KiB.');
    const bytes = await file.readFile();
    if (bytes.length > 256 * 1024) throw new Error('Shader file exceeds 256 KiB.');
    return decodeShaderImport(bytes.toString('utf8'), path.split(/[\\/]/).pop()!);
  } finally {
    await file.close();
  }
}
export async function findShader(query: string): Promise<ShaderPackage> {
  if (existsSync(query)) return readShader(resolve(query));
  const wanted = query.toLowerCase();
  const matches = (await listShaders()).filter(
    (pkg) => pkg.id.toLowerCase() === wanted || pkg.name.toLowerCase() === wanted,
  );
  if (matches.length !== 1)
    throw new Error(
      'Choose an exact shader name/ID from gleech shaders, or a local .gleech-shader, .wgsl or .isf file.',
    );
  return matches[0]!;
}
