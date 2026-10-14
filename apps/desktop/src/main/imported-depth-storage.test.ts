import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  assertEffect,
  createProject,
  createEffect,
  layerImages,
  type DepthFieldEffect,
  type EffectPreset,
  type EffectInstance,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  encodeSettings,
  decodeSettings,
} from '@gleech/command-service';
import { encodePng, decodeLayerImages, renderPresetThumbnail } from './image-worker';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';
import { createDepthMapLibrary } from './depth-maps';

const directory = 'apps/desktop/resources/depth-maps';
async function fixture() {
  const pixels = {
    width: 4,
    height: 2,
    pixels: Uint8Array.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 255 : i * 7)).buffer,
  };
  const png = await encodePng(pixels);
  const source = {
    id: 'canvas',
    name: 'canvas.png',
    width: 4,
    height: 2,
    format: 'png' as const,
    hasAlpha: false,
  };
  const commands = createCommandService(createProject('Map', 17));
  commands.setSource(source);
  commands.addEffect('depth-field', 'field');
  const fieldImage = {
    source: { ...source, id: 'height-map' },
    png: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
  };
  commands.updateEffect('field', { fieldImage, params: { fieldSource: 'image', fieldScale: 100 } });
  return { commands, pixels, png, source, fieldImage };
}
describe('portable depth map assets', () => {
  it('freezes, duplicates, copies, pastes and clears imported maps with Undo', async () => {
    const { commands, fieldImage } = await fixture();
    const effect = commands.getState().effects[0] as DepthFieldEffect;
    expect(Object.isFrozen(effect.fieldImage)).toBe(true);
    expect(Object.isFrozen(effect.fieldImage!.source)).toBe(true);
    commands.duplicateEffect('field', 'copy');
    expect((commands.getState().effects[1] as DepthFieldEffect).fieldImage).toEqual(fieldImage);
    commands.updateEffect('copy', { fieldImage: null, params: { fieldSource: 'radial' } });
    const data = decodeSettings(encodeSettings(copySettings(effect, { kind: 'effect' })!))!;
    expect(commands.pasteEffectSettings('copy', data, { kind: 'effect' })).toBe(true);
    expect((commands.getState().effects[1] as DepthFieldEffect).fieldImage).toEqual(fieldImage);
    const pasted = commands.getState();
    commands.updateEffect('copy', { fieldImage: null, params: { fieldSource: 'brightness' } });
    commands.undo();
    expect(commands.getState()).toBe(pasted);
    const procedural = createEffect('depth-field', 'procedural');
    commands.pasteEffectSettings('copy', copySettings(procedural, { kind: 'effect' })!, {
      kind: 'effect',
    });
    expect((commands.getState().effects[1] as DepthFieldEffect).fieldImage).toBeUndefined();
  });
  it('persists map bytes in saved projects and snapshots', async () => {
    const { commands, png, source, fieldImage } = await fixture();
    commands.captureSnapshot(
      'snapshot',
      'Map snapshot',
      { ...source, id: 'rendered' },
      '2026-10-06T12:00:00Z',
      false,
    );
    const project = commands.getState();
    const restored = decodeProject(
      encodeProject(
        project,
        new Map([
          ['canvas', { png }],
          ['rendered', { png }],
        ]),
      ),
    ).project;
    expect(restored).toEqual(project);
    expect(
      layerImages([...restored.effects, ...restored.snapshots.flatMap((s) => s.effects)]),
    ).toEqual([fieldImage]);
    expect((await decodeLayerImages(restored.effects)).get('height-map')).toBeDefined();
  });
  it('exports and imports map presets with independent thumbnails', async () => {
    const { commands, pixels } = await fixture();
    const recipe = { masterSeed: 17, effects: commands.getState().effects };
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'map-preset',
      name: 'Map preset',
      createdAt: '2026-10-06T12:00:00Z',
      ...recipe,
      thumbnail: await renderPresetThumbnail(pixels, recipe),
    };
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
  });
  it('rejects conflicting, malformed and incompatible map attachments before mutating state', async () => {
    const { commands, fieldImage } = await fixture();
    commands.duplicateEffect('field', 'copy');
    const before = commands.getState();
    expect(() =>
      commands.updateEffect('copy', {
        fieldImage: { ...fieldImage, source: { ...fieldImage.source, name: 'conflicting.png' } },
      }),
    ).toThrow('Conflicting');
    expect(() =>
      commands.updateEffect('copy', { fieldImage: { ...fieldImage, png: 'file:///secret.png' } }),
    ).toThrow();
    expect(commands.getState()).toBe(before);
    expect(() =>
      assertEffect({ ...createEffect('transform', 'bad'), fieldImage } as EffectInstance),
    ).toThrow('support depth');
    expect(() =>
      assertEffect({
        ...createEffect('depth-field', 'bad'),
        fieldImage: null,
      } as unknown as EffectInstance),
    ).toThrow();
  });
});
describe('shipped starter map library', () => {
  it('ships forty distinct, opaque 2048px grayscale PNGs with matching hashes and thumbnails', async () => {
    const library = createDepthMapLibrary(directory);
    const catalog = await library.list();
    expect(catalog).toHaveLength(40);
    expect(new Set(catalog.map((map) => map.category)).size).toBeGreaterThanOrEqual(6);
    const hashes = new Set();
    const manifest = JSON.parse(await readFile(`${directory}/catalog.json`, 'utf8')) as {
      maps: { id: string; sha256: string }[];
    };
    for (const item of catalog) {
      const map = await library.image(item.id);
      const png = Buffer.from(map.png.slice(22), 'base64');
      const metadata = await sharp(png).metadata();
      expect([metadata.width, metadata.height, metadata.channels, metadata.hasAlpha]).toEqual([
        2048,
        2048,
        1,
        false,
      ]);
      const stats = await sharp(png).stats();
      expect(stats.channels[0]!.max - stats.channels[0]!.min).toBeGreaterThan(100);
      const hash = createHash('sha256').update(png).digest('hex');
      hashes.add(hash);
      expect(hash).toBe(manifest.maps.find((map) => map.id === item.id)!.sha256);
      const thumb = await sharp(Buffer.from(item.thumbnail.slice(22), 'base64')).metadata();
      expect([thumb.width, thumb.height]).toEqual([192, 192]);
    }
    expect(hashes.size).toBe(40);
  }, 20000);
  it('resolves only known catalog IDs and deduplicates selected maps', async () => {
    const library = createDepthMapLibrary(directory);
    await expect(library.image('../branding/icon')).rejects.toThrow('Choose');
    const map = await library.image('radial-dome');
    const field = createEffect('depth-field', 'field') as DepthFieldEffect;
    expect(
      layerImages([
        { ...field, fieldImage: map },
        { ...field, instanceId: 'copy', fieldImage: map },
      ]),
    ).toHaveLength(1);
  });
});
