import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertLayerImage,
  createEffect,
  createProject,
  layerImages,
  type SolidEffect,
  type EffectPreset,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  decodeSettings,
  encodeSettings,
} from '@gleech/command-service';
import { renderEffects } from '@gleech/effects';
import { encodePng, decodeLayerImages, renderPresetThumbnail, decodeImage } from './image-worker';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';

async function fixture() {
  const image = {
    width: 4,
    height: 2,
    pixels: Uint8Array.from({ length: 32 }, (_, i) =>
      i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4]! : i * 7,
    ).buffer,
  };
  const png = await encodePng(image);
  const source = {
    id: 'layer-image',
    name: 'separate.png',
    width: 4,
    height: 2,
    format: 'png' as const,
    hasAlpha: true,
  };
  const base = createEffect('solid', 'content') as SolidEffect;
  const effect: SolidEffect = {
    ...base,
    image: { source, png: 'data:image/png;base64,' + Buffer.from(png).toString('base64') },
    params: { ...base.params, content: 'image', placement: 'fill' },
  };
  return { image, png, source, effect };
}

describe('portable Solid layers', () => {
  it('preserves all RGBA bytes through decoding, including hidden colors and alpha 1', async () => {
    const { image, effect } = await fixture();
    expect((await decodeLayerImages([effect])).get('layer-image')).toEqual(image);
    assertEffect(effect);
  });
  it('round trips projects and snapshot stacks without external image files', async () => {
    const { image, png, source, effect } = await fixture();
    const commands = createCommandService(createProject('Layers', 17));
    commands.setSource({ ...source, id: 'canvas' });
    commands.addEffect('solid', effect.instanceId);
    commands.updateEffect(effect.instanceId, { image: effect.image!, params: effect.params });
    commands.captureSnapshot(
      'saved',
      'Layer snapshot',
      { ...source, id: 'rendered' },
      '2026-10-06T12:00:00Z',
      false,
    );
    const project = commands.getState();
    const assets = new Map([
      ['canvas', { png }],
      ['rendered', { png }],
    ]);
    const opened = decodeProject(encodeProject(project, assets));
    expect(opened.project).toEqual(project);
    const restored = opened.project.effects[0]!;
    const layers = await decodeLayerImages([restored]);
    expect(renderEffects(image, [restored], { layerImages: layers })).toEqual(
      renderEffects(image, [effect], { layerImages: layers }),
    );
    expect(opened.project.snapshots[0]!.effects[0]).toEqual(effect);
  });
  it('exports and imports embedded image presets and renders their thumbnails', async () => {
    const { image, effect } = await fixture();
    const thumbnail = await renderPresetThumbnail(image, { masterSeed: 17, effects: [effect] });
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'preset',
      name: 'Image layer',
      createdAt: '2026-10-06T12:00:00Z',
      masterSeed: 17,
      effects: [effect],
      thumbnail,
    };
    const imported = decodePreset(encodePreset(preset));
    expect(imported).toEqual(preset);
    const rendered = await decodeImage(
      Uint8Array.from(Buffer.from(thumbnail.slice(22), 'base64')).buffer,
    );
    expect(rendered.width).toBe(4);
    expect(rendered.height).toBe(2);
    expect((await decodeLayerImages(imported.effects)).get('layer-image')).toEqual(image);
  });
  it('preserves immutable image attachments in undo, duplicate and settings clipboard', async () => {
    const { effect } = await fixture();
    const commands = createCommandService(createProject('Layers', 17));
    commands.setSource({ ...effect.image!.source, id: 'canvas' });
    commands.addEffect('solid', effect.instanceId);
    commands.updateEffect(effect.instanceId, { image: effect.image!, params: effect.params });
    const saved = commands.getState();
    const frozen = saved.effects[0] as SolidEffect;
    expect(Object.isFrozen(frozen.image)).toBe(true);
    expect(Object.isFrozen(frozen.image!.source)).toBe(true);
    commands.updateEffect(effect.instanceId, { params: { content: 'gradient' } });
    commands.undo();
    expect(commands.getState()).toBe(saved);
    commands.duplicateEffect(effect.instanceId, 'copy');
    expect((commands.getState().effects[1] as SolidEffect).image).toEqual(effect.image);
    const copied = copySettings(frozen, { kind: 'effect' })!;
    const transferred = decodeSettings(encodeSettings(copied))!;
    commands.updateEffect('copy', { params: { content: 'color' } });
    expect(commands.pasteEffectSettings('copy', transferred, { kind: 'effect' })).toBe(true);
    expect((commands.getState().effects[1] as SolidEffect).image).toEqual(effect.image);
    commands.updateEffect('copy', {
      image: { ...effect.image!, source: { ...effect.image!.source, id: 'replacement' } },
    });
    commands.undo();
    expect((commands.getState().effects[1] as SolidEffect).image).toEqual(effect.image);
    const before = commands.getState();
    expect(() =>
      commands.updateEffect('copy', {
        image: { ...effect.image!, source: { ...effect.image!.source, name: 'conflict.png' } },
      }),
    ).toThrow('Conflicting');
    expect(commands.getState()).toBe(before);
  });
  it('rejects malformed headers, dimensions, metadata and conflicting identities', async () => {
    const { effect } = await fixture(),
      embedded = effect.image!;
    for (const invalid of [
      { ...embedded, png: 'file:///C:/photo.png' },
      { ...embedded, source: { ...embedded.source, width: 5 } },
      { ...embedded, source: { ...embedded.source, width: 65536 } },
      { ...embedded, png: embedded.png.replace('iVBOR', 'aVBOR') },
    ])
      expect(() => assertLayerImage(invalid)).toThrow();
    expect(() =>
      layerImages([
        effect,
        {
          ...effect,
          instanceId: 'other',
          image: { ...embedded, source: { ...embedded.source, name: 'conflict.png' } },
        },
      ]),
    ).toThrow('Conflicting');
    const corrupted = {
      ...effect,
      image: { ...embedded, png: embedded.png.slice(0, 70) + 'AAAA' + embedded.png.slice(74) },
    };
    await expect(decodeLayerImages([corrupted])).rejects.toThrow();
  });
  it('pastes compatible gradients into the active Solid content mode and copies the visible mode', async () => {
    const { effect } = await fixture();
    const commands = createCommandService(createProject('Gradient paste', 17));
    commands.setSource({ ...effect.image!.source, id: 'canvas' });
    commands.addEffect('solid', 'target');
    const ramp = createEffect('gradient-map', 'ramp');
    const copied = copySettings(ramp, { kind: 'color', key: 'shadows' })!;
    expect(
      commands.pasteEffectSettings('target', copied, { kind: 'color', key: 'fillColor' }),
    ).toBe(true);
    const pasted = commands.getState().effects[0] as SolidEffect;
    expect(pasted.params.content).toBe('gradient');
    expect(pasted.params.fillColorMode).toBe('gradient');
    // Programmatic variations may retain a dormant mode flag; copying uses visible content.
    const variation = { ...pasted, params: { ...pasted.params, fillColorMode: 'solid' as const } };
    const transferred = copySettings(variation, { kind: 'color', key: 'fillColor' });
    expect(transferred?.kind === 'color' && transferred.gradient?.mode).toBe('gradient');
  });
});
