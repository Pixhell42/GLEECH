import { describe, expect, it } from 'vitest';
import {
  createEffect,
  heightFieldParams,
  SCANLINE_FINISH_DEFAULTS,
  IMAGE_FINISH_DEFAULTS,
  SHAPE_TILE_DEFAULTS,
  getEffectDefinition,
  type EffectPreset,
  type EffectType,
  type EffectInstance,
} from '@gleech/project-model';
import {
  decodePreset,
  encodePreset,
  MAX_PRESET_BYTES,
  presetFileName,
  presetThumbnailBytes,
} from './preset-file';

const thumbnail =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const preset: EffectPreset = {
  schemaVersion: 1,
  id: 'local-preset',
  name: 'Warm glitch',
  createdAt: '2026-10-04T12:00:00.000Z',
  masterSeed: 0xffffffff,
  thumbnail,
  effects: (
    [
      'rgb-split',
      'block-corruption',
      'spatial-crush',
      'bit-crush',
      'wave-distortion',
      'scanlines',
      'halftone',
      'mirroring',
      'kaleidoscope',
      'motion-mosh',
      'shapes',
      'mandelbrot',
      'recursive-space',
      'compression-breakup',
    ] as EffectType[]
  ).map((type, i) => ({
    ...createEffect(type, `saved-pattern-${i}`),
    enabled: i !== 0,
    seedOffset: i + 40,
    application: { region: 'left', coverage: 0.31, softness: 0.77 },
  })),
};

describe('portable preset files', () => {
  it('writes application attribution and still opens presets without it', () => {
    const document = JSON.parse(encodePreset(preset).toString('utf8'));
    expect(document.application).toMatchObject({
      name: 'GLEECH',
      version: expect.any(String),
      developerUrl: 'https://x.com/pixhell',
      repositoryUrl: 'https://github.com/Pixhell42/GLEECH',
    });
    expect(decodePreset(Buffer.from(JSON.stringify(document)))).toEqual(preset);
    delete document.application;
    expect(decodePreset(Buffer.from(JSON.stringify(document)))).toEqual(preset);
  });
  it.each([
    'solid',
    'reference-mosh',
    'motion-transfer',
    'depth-parallax',
    'depth-haze',
    'depth-color-map',
    'cutout',
  ] as const)('retains the complete embedded %s input through encoding and decoding', (type) => {
    const e = createEffect(type, 'portable-input');
    const image = {
      source: {
        id: 'input',
        name: 'input.png',
        width: 1,
        height: 1,
        format: 'png' as const,
        hasAlpha: true,
      },
      png: thumbnail,
    };
    const saved = {
      ...preset,
      effects: [
        {
          ...e,
          ...(['solid', 'reference-mosh', 'motion-transfer'].includes(type)
            ? { image }
            : { fieldImage: image }),
        } as EffectInstance,
      ],
    };
    expect(decodePreset(encodePreset(saved))).toEqual(saved);
  });
  it('retains compression failures and color settings through preset transfer', () => {
    const effect = createEffect('compression-breakup', 'damage');
    const saved = {
      ...preset,
      effects: [
        {
          ...effect,
          locked: true,
          params: {
            ...effect.params,
            compression: 0.91,
            blockSize: 8,
            colorResolution: 'quarter',
            colorBleed: 0.8,
            damageMode: 'coefficient-loss',
            damageDensity: 0.7,
            damageStrength: 0.9,
            ringing: 0.6,
            seams: 0.4,
            blendMode: 'screen',
            tintEnabled: 'on',
            color: '#a0b0ff',
            tintStrength: 0.4,
            edgeHandling: 'wrap',
          },
        } as EffectInstance,
      ],
    };
    expect(decodePreset(encodePreset(saved))).toEqual(saved);
  });
  it('transfers shared height recipes with independent focus and recursive treatments', () => {
    const field = heightFieldParams({
      fieldSource: 'simplex',
      fieldSeed: 54321,
      fieldInvert: 'on',
    });
    const blur = createEffect('blur', 'focus');
    const recursive = createEffect('recursive-space', 'space');
    if (blur.type !== 'blur' || recursive.type !== 'recursive-space')
      throw new Error('Unexpected effect factory type.');
    const saved = {
      ...preset,
      effects: [
        {
          ...blur,
          params: {
            ...blur.params,
            ...field,
            style: 'depth',
            focusPosition: 0.7,
            focusRange: 0.1,
            focusFalloff: 0.3,
          },
        },
        {
          ...recursive,
          locked: true,
          params: {
            ...recursive.params,
            ...field,
            fieldEnabled: 'on',
            fieldRepetition: -0.4,
            fieldImageScale: 0.3,
            fieldDistortion: 12,
          },
        },
      ] as EffectInstance[],
    };
    expect(decodePreset(encodePreset(saved))).toEqual(saved);
  });
  it('round trips all gradient colors and placements, preserving omitted legacy fields', () => {
    const effects = preset.effects.map((effect) => {
      const params = { ...effect.params } as Record<string, number | string>;
      for (const [key, control] of Object.entries(getEffectDefinition(effect).parameters)) {
        if (control.kind !== 'color' || !control.gradient) continue;
        Object.assign(params, { [`${key}Mode`]: 'gradient', [`${key}End`]: '#2080f0' });
        if (control.gradient === 'spatial')
          Object.assign(params, {
            [`${key}Angle`]: 137,
            [`${key}CenterX`]: 32,
            [`${key}CenterY`]: 64,
            [`${key}Span`]: 73,
          });
      }
      return { ...effect, params } as EffectInstance;
    });
    const current = { ...preset, effects };
    expect(decodePreset(encodePreset(current))).toEqual(current);
    const legacy = {
      ...current,
      effects: effects.map((effect) => {
        const params = { ...effect.params } as Record<string, number | string>;
        for (const [key, control] of Object.entries(getEffectDefinition(effect).parameters))
          if (control.colorSource) delete params[key];
        return { ...effect, params } as EffectInstance;
      }),
    };
    expect(decodePreset(encodePreset(legacy))).toEqual(legacy);
  });
  it('preserves older Single Shapes presets without filling their missing tiling fields', () => {
    const effect = createEffect('shapes', 'legacy-shape');
    if (effect.type !== 'shapes') throw new Error('Unexpected effect');
    const params = { ...effect.params };
    for (const key of Object.keys(SHAPE_TILE_DEFAULTS) as (keyof typeof SHAPE_TILE_DEFAULTS)[])
      delete params[key];
    const saved = { ...preset, effects: [{ ...effect, params }] };
    expect(decodePreset(encodePreset(saved))).toEqual(saved);
  });
  it('retains output placement and accepts reflection presets saved before alignment', () => {
    for (const type of ['mirroring', 'kaleidoscope'] as const) {
      const effect = createEffect(type, 'placed');
      const saved = {
        ...preset,
        effects: [
          {
            ...effect,
            params: {
              ...effect.params,
              outputAlignment: 'bottom-right',
              outputOffsetX: -12.5,
              outputOffsetY: 18.5,
            },
          } as EffectInstance,
        ],
      };
      expect(decodePreset(encodePreset(saved))).toEqual(saved);
      const params = { ...effect.params } as Record<string, number | string>;
      delete params.outputAlignment;
      delete params.outputOffsetX;
      delete params.outputOffsetY;
      const legacy = { ...preset, effects: [{ ...effect, params } as EffectInstance] };
      expect(decodePreset(encodePreset(legacy))).toEqual(legacy);
    }
  });
  it('retains scanline finishing settings and accepts presets made before those controls', () => {
    const scanlines = createEffect('scanlines', 'signal');
    if (scanlines.type !== 'scanlines') throw new Error('Unexpected effect');
    const current = {
      ...scanlines,
      params: {
        ...scanlines.params,
        color: '#1a80ff',
        invert: 'on' as const,
        blendMode: 'screen' as const,
        glow: 0.62,
        glowSize: 1.3,
        signalError: 'sync-loss' as const,
        errorStrength: 0.73,
        errorPositionX: -17.5,
        errorPositionY: 31.2,
        edgeHandling: 'wrap' as const,
      },
    };
    const saved = { ...preset, effects: [current] };
    expect(decodePreset(encodePreset(saved))).toEqual(saved);
    const params = { ...current.params };
    for (const key of Object.keys(
      SCANLINE_FINISH_DEFAULTS,
    ) as (keyof typeof SCANLINE_FINISH_DEFAULTS)[])
      delete params[key];
    const older = { ...saved, effects: [{ ...current, params }] };
    expect(decodePreset(encodePreset(older))).toEqual(older);
  });
  it('retains image-filter finishes and accepts portable recipes without them', () => {
    for (const legacy of [false, true]) {
      const saved = {
        ...preset,
        effects: preset.effects.map((effect) => {
          if (effect.type === 'scanlines' || effect.type === 'halftone') return effect;
          const params = {
            ...effect.params,
            blendMode: 'screen',
            color: '#8090f0',
            tintStrength: 0.42,
            tintEnabled: 'on',
          } as Record<string, number | string>;
          if (legacy) for (const key of Object.keys(IMAGE_FINISH_DEFAULTS)) delete params[key];
          return { ...effect, params } as EffectInstance;
        }),
      };
      expect(decodePreset(encodePreset(saved))).toEqual(saved);
    }
  });
  it('retains Wrap and Mirror choices and accepts older recipes with no edge setting', () => {
    for (const edgeHandling of ['wrap', 'mirror', undefined] as const) {
      const saved = {
        ...preset,
        effects: preset.effects.map((effect) => {
          if (!['rgb-split', 'block-corruption', 'wave-distortion'].includes(effect.type))
            return effect;
          const params = { ...effect.params, edgeHandling };
          if (edgeHandling === undefined) delete (params as Partial<typeof params>).edgeHandling;
          return { ...effect, params } as EffectInstance;
        }),
      };
      expect(decodePreset(encodePreset(saved))).toEqual(saved);
    }
  });
  it('retains the thumbnail source while accepting presets saved before thumbnail choices', () => {
    for (const thumbnailSource of ['image', 'statue'] as const) {
      const saved = { ...preset, thumbnailSource };
      expect(decodePreset(encodePreset(saved))).toEqual(saved);
    }
    expect(decodePreset(encodePreset(preset))).not.toHaveProperty('thumbnailSource');
    expect(() =>
      encodePreset({ ...preset, thumbnailSource: 'unknown' } as unknown as EffectPreset),
    ).toThrow();
  });
  it('round trips every effect, identities, controls, masks, seeds, dates and thumbnail', () => {
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
    expect(new Uint8Array(presetThumbnailBytes(preset)).slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(encodePreset(preset).toString()).toContain('"rendererVersion": 1');
  });
  it('exports and imports only preset fields, excluding source paths and stage metadata', () => {
    const extras = {
      ...preset,
      source: { path: 'C:/private/source.png' },
      snapshots: ['private stage'],
      effects: preset.effects.map((effect) => ({
        ...effect,
        source: 'private source',
        application: { ...effect.application, path: 'private mask' },
      })),
    };
    const encoded = encodePreset(extras);
    expect(encoded.toString()).not.toContain('private');
    expect(decodePreset(encoded)).toEqual(preset);
    const envelope = JSON.parse(encoded.toString());
    envelope.preset = extras;
    expect(decodePreset(Buffer.from(JSON.stringify(envelope)))).toEqual(preset);
  });
  it('rejects damaged files, unknown contracts and invalid effect recipes', () => {
    expect(() => decodePreset(Buffer.from('broken'))).toThrow('damaged');
    expect(() => decodePreset(Buffer.alloc(MAX_PRESET_BYTES + 1))).toThrow('16 MB');
    const valid = JSON.parse(encodePreset(preset).toString());
    for (const changed of [
      { ...valid, format: 'project' },
      { ...valid, schemaVersion: 99 },
      { ...valid, rendererVersion: 99 },
      { ...valid, preset: { ...preset, masterSeed: -1 } },
      { ...valid, preset: { ...preset, name: '' } },
      { ...valid, preset: { ...preset, effects: [preset.effects[0], preset.effects[0]] } },
      {
        ...valid,
        preset: {
          ...preset,
          effects: [
            {
              ...createEffect('bit-crush', 'bits'),
              params: { amount: 1, bits: 2.5, dither: 'none', ditherAmount: 1 },
            },
          ],
        },
      },
    ])
      expect(() => decodePreset(Buffer.from(JSON.stringify(changed)))).toThrow();
    const huge = {
      ...preset,
      effects: Array.from(
        { length: 1000 },
        (_, i) =>
          ({
            ...createEffect('rgb-split', String(i).padStart(1024, 'a')),
            paintedMask: {
              version: 1,
              enabled: true,
              inverted: false,
              base: 0,
              width: 101,
              height: 101,
              strokes: Array.from({ length: 100 }, () => ({
                size: 8,
                shape: 'circle',
                mode: 'paint',
                hardness: 0.6,
                falloff: 'smooth',
                points: [{ x: 0.5, y: 0.5 }],
              })),
            },
          }) as ReturnType<typeof createEffect>,
      ),
      thumbnail: 'data:image/png;base64,' + 'a'.repeat(1000000),
    };
    expect(() => encodePreset(huge)).toThrow('16 MB');
  });
  it('bounds thumbnail dimensions before invoking a decoder and rejects non-PNG payloads', () => {
    const png = Buffer.from(presetThumbnailBytes(preset));
    png.writeUInt32BE(385, 16);
    expect(() =>
      presetThumbnailBytes({
        ...preset,
        thumbnail: 'data:image/png;base64,' + png.toString('base64'),
      }),
    ).toThrow('384');
    png.writeUInt32BE(0, 16);
    expect(() =>
      presetThumbnailBytes({
        ...preset,
        thumbnail: 'data:image/png;base64,' + png.toString('base64'),
      }),
    ).toThrow('384');
    expect(() =>
      presetThumbnailBytes({ ...preset, thumbnail: 'data:image/png;base64,aGVsbG8=' }),
    ).toThrow('damaged');
  });
  it.each([
    ['Warm glitch', 'Warm glitch.gleechpreset'],
    ['A/B:*?"<>|\\C', 'A_B________C.gleechpreset'],
    ['CON', '_CON.gleechpreset'],
    ['LPT1.png', '_LPT1.png.gleechpreset'],
    [' . ', 'Preset.gleechpreset'],
    ['Gold.  ', 'Gold.gleechpreset'],
    ['Été 🎨', 'Été 🎨.gleechpreset'],
  ])('makes a Windows-safe default filename for %s', (name, expected) => {
    expect(presetFileName(name)).toBe(expected);
  });
});

describe('Multi-stop portable gradients', () => {
  it('retains depth field seeds, shaping controls, locks and contour gradients through transfer', () => {
    const effect = createEffect('depth-field', 'depth');
    const next = {
      ...preset,
      effects: [
        {
          ...effect,
          locked: true,
          params: {
            ...effect.params,
            fieldSource: 'simplex',
            fieldSeed: 54321,
            fieldNormalize: 'on',
            fieldSmoothing: 4,
            operation: 'contours',
            fieldColorMode: 'gradient',
            fieldColorStops: JSON.stringify([
              { position: 0, color: '#ff0000' },
              { position: 0.4, color: '#00ff00' },
              { position: 1, color: '#0000ff' },
            ]),
          },
        } as EffectInstance,
      ],
    };
    expect(decodePreset(encodePreset(next)).effects).toEqual(next.effects);
  });
  it('retains ordered intermediate colors and positions through export and import', () => {
    const effect = createEffect('gradient-map', 'multi');
    const stops = JSON.stringify([
      { position: 0, color: '#ff0000' },
      { position: 0.25, color: '#00ff00' },
      { position: 1, color: '#0000ff' },
    ]);
    const next = {
      ...preset,
      effects: [{ ...effect, params: { ...effect.params, shadowsStops: stops } } as EffectInstance],
    };
    expect(decodePreset(encodePreset(next)).effects[0]!.params).toEqual(next.effects[0]!.params);
  });
});
