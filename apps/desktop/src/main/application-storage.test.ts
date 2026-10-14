import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  heightFieldParams,
  layerImages,
  effectImages,
  withoutImageData,
  type EffectPreset,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  pastedSettings,
  resetSettings,
  generateVariations,
} from '@gleech/command-service';
import { encodePng, decodeLayerImages } from './image-worker';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';
import { renderEffects } from '@gleech/effects';
describe('Application field persistence and editing', () => {
  async function fixture() {
    const image = {
      width: 4,
      height: 2,
      pixels: Uint8Array.from(
        Array.from({ length: 8 }, (_, i) => [i * 30, i * 30, i * 30, 255]).flat(),
      ).buffer,
    };
    const png = await encodePng(image);
    const source = {
      id: 'source',
      name: 'source.png',
      width: 4,
      height: 2,
      format: 'png' as const,
      hasAlpha: false,
    };
    const asset = {
      source: { ...source, id: 'mask-map' },
      png: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
    };
    const commands = createCommandService(createProject('Application', 17));
    commands.setSource(source);
    commands.addEffect('solid', 'solid');
    commands.updateEffect('solid', {
      application: {
        region: 'depth-band',
        rangeStart: 0.2,
        rangeEnd: 0.8,
        softness: 0.15,
        depthField: heightFieldParams({ fieldSource: 'image' }),
        depthImage: asset,
      },
    });
    return { image, png, source, asset, commands };
  }
  it('freezes independent fields/assets and retains them through undo, duplication, clipboard and variations', async () => {
    const { commands, asset } = await fixture();
    const effect = commands.getState().effects[0]!;
    expect(Object.isFrozen(effect.application.depthField)).toBe(true);
    expect(Object.isFrozen(effect.application.depthImage!.source)).toBe(true);
    expect(layerImages([effect])).toEqual([asset]);
    expect(effectImages(withoutImageData(effect))[0]?.png).toBe('');
  });
  it('copies and resets field controls and keeps embedded assets when pasting onto another filter type', async () => {
    const { commands, asset } = await fixture();
    const effect = commands.getState().effects[0]!;
    commands.duplicateEffect('solid', 'copy');
    const duplicate = commands.getState();
    commands.updateEffect('copy', { application: { rangeStart: 0.45 } });
    commands.undo();
    expect(commands.getState()).toBe(duplicate);
    commands.redo();
    const pasted = pastedSettings(
      createEffect('bit-crush', 'bits'),
      copySettings(effect, { kind: 'effect' })!,
      { kind: 'effect' },
    )!;
    expect(pasted.application).toEqual(effect.application);
    expect(layerImages([pasted])).toEqual([asset]);
    const reset = resetSettings(effect, { kind: 'parameter', key: 'application.rangeStart' })!;
    expect(reset.application.rangeStart).toBe(0);
    const fieldReset = resetSettings(effect, {
      kind: 'parameter',
      key: 'application.depthField.fieldSource',
    })!;
    expect(fieldReset.application.depthField?.fieldSource).toBe('brightness');
    for (const variation of generateVariations([effect], 17, 0.7))
      expect(variation.effects[0]!.application.depthImage).toEqual(asset);
  });
  it('round-trips imported Application maps through projects, snapshots and portable presets and decodes them for rendering', async () => {
    const { commands, png, source, image, asset } = await fixture();
    commands.captureSnapshot(
      'snap',
      'Mask snapshot',
      { ...source, id: 'rendered' },
      '2026-10-08T12:00:00Z',
      false,
    );
    const project = commands.getState();
    const restored = decodeProject(
      encodeProject(
        project,
        new Map([
          ['source', { png }],
          ['rendered', { png }],
        ]),
      ),
    ).project;
    expect(restored).toEqual(project);
    const layers = await decodeLayerImages(restored.effects);
    expect(layers.get(asset.source.id)).toBeDefined();
    const recipe = { effects: project.effects, masterSeed: project.masterSeed };
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'preset',
      name: 'Mask map',
      createdAt: '2026-10-08T12:00:00Z',
      thumbnail: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
      ...recipe,
    };
    const imported = decodePreset(encodePreset(preset));
    expect(imported).toEqual(preset);
    expect(renderEffects(image, imported.effects, { layerImages: layers }).pixels).toEqual(
      renderEffects(image, restored.effects, { layerImages: layers }).pixels,
    );
  });
});
