import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  createProject,
  createEffect,
  effectImages,
  withoutImageData,
  assertEffect,
  type EffectPreset,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  pastedSettings,
  encodeSettings,
  decodeSettings,
  resetSettings,
  settingsPasteTarget,
  generateVariations,
} from '@gleech/command-service';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';
import { decodeLayerImages } from './image-worker';

describe('portable shared direction fields', () => {
  it('retains embedded vectors through history, duplicates, clipboard, projects, snapshots and presets', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f08080' } })
      .png()
      .toBuffer();
    const source = {
      id: 'canvas',
      name: 'canvas.png',
      width: 2,
      height: 2,
      format: 'png' as const,
      hasAlpha: true,
    };
    const map = {
      source: { ...source, id: 'vector' },
      png: 'data:image/png;base64,' + png.toString('base64'),
    };
    const commands = createCommandService(createProject('Directions', 17));
    commands.setSource(source);
    commands.addEffect('pixel-sort', 'sort');
    commands.updateEffect('sort', {
      params: { directionSource: 'image', directionRotation: 23 },
      directionImage: map,
    });
    const updated = commands.getState().effects[0]!;
    expect(Object.isFrozen(updated.directionImage)).toBe(true);
    expect(Object.isFrozen(updated.directionImage!.source)).toBe(true);
    expect(effectImages(updated)).toEqual([map]);
    expect(withoutImageData(updated).directionImage!.png).toBe('');
    commands.undo();
    expect(commands.getState().effects[0]!.directionImage).toBeUndefined();
    commands.redo();
    commands.duplicateEffect('sort', 'copy');
    expect(commands.getState().effects[1]!.directionImage).toEqual(map);
    const data = decodeSettings(encodeSettings(copySettings(updated, { kind: 'effect' })!))!;
    const pasted = pastedSettings(createEffect('pixel-sort', 'target'), data, { kind: 'effect' })!;
    expect(pasted.directionImage).toEqual(map);
    const crossPasted = pastedSettings(createEffect('wave-distortion', 'cross-target'), data, {
      kind: 'effect',
    })!;
    expect(crossPasted.directionImage).toEqual(map);
    expect('directionSource' in crossPasted.params && crossPasted.params.directionSource).toBe(
      'image',
    );
    commands.captureSnapshot(
      'snap',
      'Direction snapshot',
      { ...source, id: 'rendered' },
      '2026-10-08T12:00:00Z',
      false,
    );
    const project = commands.getState(),
      restored = decodeProject(
        encodeProject(
          project,
          new Map([
            ['canvas', { png: Uint8Array.from(png).buffer }],
            ['rendered', { png: Uint8Array.from(png).buffer }],
          ]),
        ),
      ).project;
    expect(restored).toEqual(project);
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'direction-preset',
      name: 'Directions',
      createdAt: '2026-10-08T12:00:00Z',
      masterSeed: 17,
      effects: project.effects,
      thumbnail: 'data:image/png;base64,' + png.toString('base64'),
    };
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
    const decoded = await decodeLayerImages(project.effects);
    expect(decoded.size).toBe(1);
    expect(decoded.get('vector')!.width).toBe(2);
    for (const candidate of generateVariations(
      [updated, { ...updated, instanceId: 'locked', locked: true }],
      123,
      0.8,
    )) {
      expect(candidate.effects[0]!.directionImage).toEqual(map);
      expect(candidate.effects[1]).toEqual({ ...updated, instanceId: 'locked', locked: true });
      candidate.effects.forEach(assertEffect);
    }
    commands.updateEffect('copy', { directionImage: null, params: { directionSource: 'flow' } });
    expect(commands.getState().effects[1]!.directionImage).toBeUndefined();
    commands.undo();
    expect(commands.getState().effects[1]!.directionImage).toEqual(map);
  });
  it('rejects incompatible attachments and malformed field controls', () => {
    const e = createEffect('pixel-sort', 'sort');
    expect(() =>
      assertEffect({ ...e, params: { ...e.params, directionScale: 0 } } as typeof e),
    ).toThrow();
    expect(() =>
      assertEffect({ ...createEffect('vignette', 'invalid'), directionImage: {} as never }),
    ).toThrow(/direction maps/);
  });
  it('copies and resets the whole direction field without modifying unrelated settings', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f08080' } })
      .png()
      .toBuffer();
    const source = createEffect('pixel-sort', 'sort');
    if (source.type !== 'pixel-sort') throw new Error('Expected Pixel Sorting');
    const map = {
      source: {
        id: 'map',
        name: 'map.png',
        width: 2,
        height: 2,
        format: 'png' as const,
        hasAlpha: true,
      },
      png: 'data:image/png;base64,' + png.toString('base64'),
    };
    const field = {
      ...source,
      directionImage: map,
      params: {
        ...source.params,
        directionSource: 'image' as const,
        directionX: 27,
        directionSeed: 82,
      },
    };
    const target = { kind: 'direction-field' as const };
    const data = decodeSettings(encodeSettings(copySettings(field, target)!))!;
    expect(data.kind).toBe('direction-field');
    const destination = createEffect('wave-distortion', 'wave');
    const unrelated = Object.fromEntries(
      Object.entries(destination.params).filter(
        ([key]) => !key.startsWith('direction') || key === 'direction',
      ),
    );
    const pasted = pastedSettings(destination, data, target)!;
    expect(pasted.directionImage).toEqual(map);
    expect(pasted.params).toMatchObject({
      directionSource: 'image',
      directionX: 27,
      directionSeed: 82,
    });
    expect(pasted.params).toMatchObject(unrelated);
    expect(pasted.application).toEqual(destination.application);
    expect(settingsPasteTarget(destination, data, { kind: 'effect' })).toEqual(target);
    const reset = resetSettings(pasted, target)!;
    expect(reset.directionImage).toBeUndefined();
    expect(reset.params).toMatchObject({
      directionSource: 'native',
      directionX: 50,
      directionSeed: 0,
    });
    expect(reset.params).toMatchObject(unrelated);
    expect(
      pastedSettings(createEffect('vignette', 'incompatible'), data, { kind: 'effect' }),
    ).toBeNull();
    expect(pastedSettings(destination, copySettings(field, { kind: 'effect' })!, target)).toEqual(
      pasted,
    );
    expect(
      pastedSettings(
        destination,
        { format: 'gleech-settings', version: 1, kind: 'color', value: '#ffffff' },
        target,
      ),
    ).toBeNull();
    expect(
      decodeSettings(JSON.stringify({ ...data, params: { directionSource: 'image' } })),
    ).toBeNull();
    const commands = createCommandService(createProject('Field clipboard', 17));
    commands.setSource(map.source);
    commands.addEffect('wave-distortion', 'wave');
    expect(commands.pasteEffectSettings('wave', data, target)).toBe(true);
    const beforeReset = commands.getState().effects[0]!;
    expect(commands.resetEffectSetting('wave', target)).toBe(true);
    expect(commands.getState().effects[0]!.directionImage).toBeUndefined();
    commands.undo();
    expect(commands.getState().effects[0]).toEqual(beforeReset);
  });
});
