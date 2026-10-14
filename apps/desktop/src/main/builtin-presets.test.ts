import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  assertEffectPreset,
  layerImages,
  createProject,
  isShaderEffect,
  supportsDirectionField,
  directionFieldParams,
} from '@gleech/project-model';
import { createCommandService } from '@gleech/command-service';
import { createBuiltinPresetLibrary } from './builtin-presets';
import { encodePreset, decodePreset } from './preset-file';
import { decodeLayerImages } from './image-worker';
import { renderEffects } from '@gleech/effects';

const directory = 'apps/desktop/resources/presets';
const library = createBuiltinPresetLibrary(directory);
const cases = (
  JSON.parse(readFileSync(`${directory}/built-in.json`, 'utf8')) as {
    presets: { id: string; name: string }[];
  }
).presets.map((preset) => [preset.name, preset.id] as const);
let source: ArrayBuffer;
beforeAll(async () => {
  source = Uint8Array.from(
    await sharp(await readFile(`${directory}/statue.png`))
      .resize(384, 384)
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ).buffer;
}, 30000);
describe('built-in starter presets', () => {
  it('ships twenty-nine distinctive rendered looks with portable shader and field recipes', async () => {
    const presets = await library.list();
    expect(presets).toHaveLength(29);
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(29);
    expect(presets.filter((preset) => preset.effects.some(isShaderEffect))).toHaveLength(9);
    expect(
      presets.filter((preset) => preset.effects.filter(isShaderEffect).length > 1),
    ).toHaveLength(3);
    expect(
      presets.filter((preset) =>
        preset.effects.some(
          (effect) =>
            supportsDirectionField(effect) &&
            directionFieldParams(effect.params).directionSource !== 'native',
        ),
      ),
    ).toHaveLength(4);
    const hashes = new Set<string>(),
      maps = new Set<string>();
    for (const preset of presets) {
      assertEffectPreset(preset);
      expect(preset.builtIn).toBe(true);
      expect(preset.description!.length).toBeGreaterThan(20);
      expect(preset.effects.length).toBeGreaterThanOrEqual(2);
      expect(preset.effects.every((effect) => effect.enabled && !effect.locked)).toBe(true);
      const png = Buffer.from(preset.thumbnail.slice(22), 'base64');
      const metadata = await sharp(png).metadata();
      expect([metadata.width, metadata.height]).toEqual([384, 384]);
      hashes.add(createHash('sha256').update(png).digest('hex'));
      for (const image of layerImages(preset.effects)) {
        maps.add(image.source.id);
      }
    }
    expect(hashes.size).toBe(29);
    expect([...maps].filter((id) => id.startsWith('depth-map-v1:'))).toHaveLength(3);
    expect([...maps].filter((id) => id.startsWith('vector-map-v1:'))).toHaveLength(4);
  }, 30000);

  it.each(cases)(
    '%s matches its rendered thumbnail and survives portable encoding',
    async (_name, id) => {
      const preset = (await library.list()).find((preset) => preset.id === id)!;
      const png = Buffer.from(preset.thumbnail.slice(22), 'base64');
      const layers = await decodeLayerImages(preset.effects);
      for (const image of layerImages(preset.effects)) {
        expect([layers.get(image.source.id)!.width, layers.get(image.source.id)!.height]).toEqual([
          2048, 2048,
        ]);
      }
      const expected = renderEffects({ width: 384, height: 384, pixels: source }, preset.effects, {
        masterSeed: preset.masterSeed,
        reference: { width: 768, height: 768 },
        layerImages: layers,
      });
      expect(await sharp(png).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(expected.pixels));
      const imported = decodePreset(encodePreset(preset));
      expect(imported.effects).toEqual(preset.effects);
      expect(imported.thumbnail).toBe(preset.thumbnail);
      expect(imported).not.toHaveProperty('builtIn');
    },
    30000,
  );

  it('applies starter recipes with all four placements and Undo/Redo without changing the originals', async () => {
    const preset = (await library.list()).find((preset) => preset.name === 'Spiral Transfer')!;
    const original = JSON.stringify(preset);
    for (const placement of ['replace', 'above', 'below', 'merge'] as const) {
      const commands = createCommandService(createProject('Test', 42));
      commands.setSource({
        id: 'source',
        name: 'source.png',
        width: 8,
        height: 8,
        format: 'png',
        hasAlpha: false,
      });
      commands.addEffect('rgb-split', 'existing');
      const before = commands.getState();
      commands.applyPreset(
        preset,
        placement,
        preset.effects.map((_, index) => `new:${placement}:${index}`),
      );
      const after = commands.getState();
      expect(after.effects.some((effect) => effect.type === 'motion-transfer')).toBe(true);
      commands.undo();
      expect(commands.getState()).toBe(before);
      commands.redo();
      expect(commands.getState()).toBe(after);
      expect(JSON.stringify(preset)).toBe(original);
    }
  });
  it('applies every new shader/field preset with all placements and independent history', async () => {
    const presets = (await library.list()).filter((preset) =>
      preset.createdAt.startsWith('2026-10-09'),
    );
    expect(presets).toHaveLength(12);
    for (const preset of presets) {
      const original = JSON.stringify(preset);
      for (const placement of ['replace', 'above', 'below', 'merge'] as const) {
        const commands = createCommandService(createProject('Expansion', 42));
        commands.setSource({
          id: 'source',
          name: 'source.png',
          width: 8,
          height: 8,
          format: 'png',
          hasAlpha: true,
        });
        commands.addEffect('rgb-split', 'existing');
        const before = commands.getState();
        commands.applyPreset(
          preset,
          placement,
          preset.effects.map((_, index) => `new:${placement}:${index}`),
        );
        const after = commands.getState();
        expect(after.effects.some((effect) => effect.type === preset.effects[0]!.type)).toBe(true);
        expect(new Set(after.effects.map((effect) => effect.instanceId)).size).toBe(
          after.effects.length,
        );
        commands.undo();
        expect(commands.getState()).toBe(before);
        commands.redo();
        expect(commands.getState()).toBe(after);
        expect(JSON.stringify(preset)).toBe(original);
      }
    }
  });
});
