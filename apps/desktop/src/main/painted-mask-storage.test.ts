import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  type EffectPreset,
  createCanvasDrawing,
  attachMaskPattern,
} from '@gleech/project-model';
import { encodePng } from './image-worker';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';
const mask = {
  ...createPaintedMask(17, 11),
  strokes: [
    {
      ...DEFAULT_MASK_BRUSH,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
      ],
    },
    {
      ...DEFAULT_MASK_BRUSH,
      shape: 'square' as const,
      mode: 'erase' as const,
      hardness: 0.2,
      points: [{ x: 0.6, y: 0.4 }],
    },
  ],
};
const effect = {
  ...createEffect('hue-saturation', 'tone'),
  paintedMask: mask,
  patternId: 'tone-pattern',
  locked: true,
};
describe('painted mask persistence', () => {
  it('preserves editable paths, pattern frames and colored drawings in portable presets', () => {
    const path = {
      id: 'curve',
      kind: 'curve' as const,
      mode: 'paint' as const,
      opacity: 0.7,
      feather: 4,
      nodes: [
        { x: 0.2, y: 0.2, outgoing: { x: 0.3, y: 0.05 } },
        { x: 0.8, y: 0.2, incoming: { x: 0.7, y: 0.05 } },
        { x: 0.5, y: 0.8 },
      ],
    };
    const paintedMask = attachMaskPattern(
      { ...mask, paths: [path], frame: { x: 10, y: -5, scaleX: 0.8, scaleY: 1.2, rotation: 35 } },
      true,
    );
    const solid = createEffect('solid', 'drawing');
    const drawing = {
      ...createCanvasDrawing(17, 11),
      baseColor: '#102030',
      paths: [{ ...path, color: '#f02080' }],
      strokes: [{ ...mask.strokes[0]!, color: '#20a0f0', opacity: 0.5 }],
    };
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'canvas',
      name: 'Canvas',
      createdAt: '2026-10-07T00:00:00.000Z',
      masterSeed: 7,
      thumbnail:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
      effects: [
        { ...createEffect('shader-caustics', 'caustics'), paintedMask },
        { ...solid, params: { ...solid.params, content: 'drawing' }, drawing } as typeof solid,
      ],
    };
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
  });
  it('round trips masks in current and snapshot recipes without external assets', async () => {
    const png = await encodePng({
      width: 17,
      height: 11,
      pixels: new Uint8Array(17 * 11 * 4).fill(128).buffer,
    });
    const source = {
      id: 'source',
      name: 'image.png',
      width: 17,
      height: 11,
      format: 'png' as const,
      hasAlpha: true,
    };
    const project = {
      ...createProject('Masks', 123),
      source,
      origin: source,
      effects: [effect],
      snapshots: [
        {
          id: 'snap',
          name: 'Masked',
          createdAt: '2026-10-05T00:00:00.000Z',
          parentId: null,
          source,
          rendered: { ...source, id: 'rendered' },
          effects: [effect],
          masterSeed: 123,
        },
      ],
    };
    const decoded = decodeProject(
      encodeProject(
        project,
        new Map([
          ['source', { png }],
          ['rendered', { png }],
        ]),
      ),
    );
    expect(decoded.project).toEqual(project);
    expect(decoded.assets.size).toBe(2);
  });
  it('round trips portable masks and drops unrecognized mask fields', () => {
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'mask',
      name: 'Masked',
      createdAt: '2026-10-05T00:00:00.000Z',
      masterSeed: 123,
      effects: [effect],
      thumbnail:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
    };
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
    const unsafe = {
      ...preset,
      effects: [
        {
          ...effect,
          paintedMask: {
            ...mask,
            sourcePath: 'private-file',
            strokes: mask.strokes.map((stroke) => ({
              ...stroke,
              path: 'private',
              points: stroke.points.map((point) => ({ ...point, file: 'private' })),
            })),
          },
        },
      ],
    };
    const bytes = encodePreset(unsafe);
    expect(bytes.toString()).not.toContain('private');
    expect(decodePreset(bytes)).toEqual(preset);
  });
});
