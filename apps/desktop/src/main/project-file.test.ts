import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  SCANLINE_FINISH_DEFAULTS,
  IMAGE_FINISH_DEFAULTS,
  type EffectType,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects } from '@gleech/effects';
import { decodeImage, encodePng } from './image-worker';
import { encodeProject, decodeProject } from './project-file';
import { FILE_APPLICATION } from './file-metadata';

describe('portable projects', () => {
  it('stores software/version/profile metadata and still opens files without it', async () => {
    const png = await encodePng({
      width: 1,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 255]).buffer,
    });
    const source = {
      id: 'source',
      name: 'sample.png',
      width: 1,
      height: 1,
      format: 'png' as const,
      hasAlpha: false,
    };
    const project = { ...createProject('Metadata'), source, origin: source };
    const output = encodeProject(project, new Map([[source.id, { png }]]));
    const length = output.readUInt32LE(8);
    const recipe = JSON.parse(output.subarray(12, 12 + length).toString('utf8'));
    expect(recipe.application).toEqual({
      name: 'GLEECH',
      version: FILE_APPLICATION.version,
      developerUrl: 'https://x.com/pixhell',
      repositoryUrl: 'https://github.com/Pixhell42/GLEECH',
    });
    expect(decodeProject(output).project).toEqual(project);
    delete recipe.application;
    const oldRecipe = Buffer.from(JSON.stringify(recipe));
    const header = Buffer.from(output.subarray(0, 12));
    header.writeUInt32LE(oldRecipe.length, 8);
    const oldFile = Buffer.concat([header, oldRecipe, output.subarray(12 + length)]);
    const reopened = decodeProject(oldFile);
    expect(reopened.project).toEqual(project);
    expect(Buffer.from(reopened.assets.get(source.id)!.png)).toEqual(Buffer.from(png));
  });
  it('retains scanline finishing controls in project and snapshot stacks, including legacy recipes', async () => {
    const png = await encodePng({
      width: 1,
      height: 1,
      pixels: new Uint8Array([71, 93, 127, 128]).buffer,
    });
    const source = {
      id: 'source',
      name: 'old.png',
      width: 1,
      height: 1,
      format: 'png' as const,
      hasAlpha: true,
    };
    const scanlines = createEffect('scanlines', 'signal');
    if (scanlines.type !== 'scanlines') throw new Error('Unexpected effect');
    const current = {
      ...scanlines,
      params: {
        ...scanlines.params,
        color: '#1a80ff',
        invert: 'on' as const,
        blendMode: 'overlay' as const,
        glow: 0.42,
        glowSize: 2.3,
        signalError: 'tear' as const,
        errorStrength: 0.83,
        errorPositionX: -17.5,
        errorPositionY: 31.2,
        edgeHandling: 'mirror' as const,
      },
    };
    for (const legacy of [false, true]) {
      const params = { ...current.params };
      if (legacy)
        for (const key of Object.keys(
          SCANLINE_FINISH_DEFAULTS,
        ) as (keyof typeof SCANLINE_FINISH_DEFAULTS)[])
          delete params[key];
      const effects: EffectInstance[] = [{ ...current, params }];
      for (const type of [
        'rgb-split',
        'block-corruption',
        'spatial-crush',
        'bit-crush',
        'wave-distortion',
      ] as EffectType[]) {
        const effect = createEffect(type, 'finish-' + type);
        const imageParams = {
          ...effect.params,
          blendMode: 'difference',
          color: '#a070ff',
          tintStrength: 0.68,
        } as Record<string, number | string>;
        if (legacy) for (const key of Object.keys(IMAGE_FINISH_DEFAULTS)) delete imageParams[key];
        effects.push({ ...effect, params: imageParams } as EffectInstance);
      }
      const project = {
        ...createProject('Signal'),
        source,
        origin: source,
        effects,
        snapshots: [
          {
            id: 'saved',
            name: 'Saved',
            createdAt: '2026-10-04T12:00:00Z',
            parentId: null,
            source,
            rendered: { ...source, id: 'render' },
            masterSeed: 83,
            effects,
          },
        ],
      };
      const assets = new Map([
        ['source', { png }],
        ['render', { png }],
      ]);
      expect(decodeProject(encodeProject(project, assets)).project).toEqual(project);
    }
  });
  it('retains edge modes in live and snapshot stacks, and opens older recipes without them', async () => {
    const png = await encodePng({
      width: 1,
      height: 1,
      pixels: new Uint8Array([71, 93, 127, 128]).buffer,
    });
    const source = {
      id: 'source',
      name: 'old.png',
      width: 1,
      height: 1,
      format: 'png' as const,
      hasAlpha: true,
    };
    const effects = (['rgb-split', 'block-corruption', 'wave-distortion'] as const).map(
      (type, i) => {
        const effect = createEffect(type, type);
        return {
          ...effect,
          params: { ...effect.params, edgeHandling: i === 0 ? 'wrap' : 'mirror' },
        } as EffectInstance;
      },
    );
    for (const legacy of [false, true]) {
      const stack = effects.map((effect) => {
        const params = { ...effect.params };
        if (legacy && 'edgeHandling' in params) delete params.edgeHandling;
        return { ...effect, params } as EffectInstance;
      });
      const project = {
        ...createProject('Edges'),
        source,
        origin: source,
        effects: stack,
        snapshots: [
          {
            id: 'saved',
            name: 'Saved',
            createdAt: '2026-10-04T12:00:00Z',
            parentId: null,
            source,
            rendered: { ...source, id: 'render' },
            masterSeed: 83,
            effects: stack,
          },
        ],
      };
      const assets = new Map([
        ['source', { png }],
        ['render', { png }],
      ]);
      expect(decodeProject(encodeProject(project, assets)).project).toEqual(project);
    }
  });
  it('retains original pixels including hidden RGB, seeds, masks, order, and disabled effects', async () => {
    const pixels = new Uint8Array([19, 23, 29, 0, 101, 109, 113, 128]).buffer;
    const png = await encodePng({ width: 2, height: 1, pixels });
    const first = createEffect('block-corruption', 'stable-seed-identity');
    const project = {
      ...createProject('photo.webp', 0xffffffff),
      source: {
        id: 'asset',
        name: 'photo.webp',
        width: 2,
        height: 1,
        format: 'webp' as const,
        hasAlpha: true,
      },
      effects: [
        {
          ...first,
          seedOffset: 83,
          enabled: false,
          application: { region: 'subject' as const, coverage: 0.37, softness: 0.62 },
        },
        createEffect('rgb-split', 'second'),
        {
          ...createEffect('wave-distortion', 'wave'),
          seedOffset: 19,
          application: { region: 'left' as const, coverage: 0.63, softness: 0.42 },
        },
        {
          ...createEffect('scanlines', 'scanlines'),
          application: { region: 'background' as const, coverage: 0.73, softness: 0.19 },
        },
      ],
    };
    const decoded = decodeProject(encodeProject(project, new Map([[project.source.id, { png }]])));
    expect(decoded.project).toEqual(project);
    const image = await decodeImage(decoded.assets.get(project.source.id)!.png, true);
    expect(Array.from(new Uint8Array(image.fullPixels))).toEqual(
      Array.from(new Uint8Array(pixels)),
    );
  });

  it('rejects broken containers, future renderer versions, and invalid recipes', async () => {
    const project = {
      ...createProject('image'),
      source: {
        id: 'asset',
        name: 'image.png',
        width: 1,
        height: 1,
        format: 'png' as const,
        hasAlpha: true,
      },
      effects: [createEffect('rgb-split', 'id')],
    };
    const png = await encodePng({ width: 1, height: 1, pixels: new Uint8Array(4).buffer });
    const valid = encodeProject(project, new Map([[project.source.id, { png }]]));
    expect(() => decodeProject(Buffer.from('invalid'))).toThrow('valid GLEECH project');
    expect(() => decodeProject(valid.subarray(0, 12))).toThrow();
    const corrupt = Buffer.from(valid);
    corrupt.writeUInt32LE(0xffffffff, 8);
    expect(() => decodeProject(corrupt)).toThrow('damaged');
    const future = Buffer.from(valid);
    const index = future.indexOf('"rendererVersion":1') + '"rendererVersion":'.length;
    future[index] = 50;
    expect(() => decodeProject(future)).toThrow('Unsupported project renderer');
    expect(() =>
      encodeProject(
        { ...project, effects: [project.effects[0]!, project.effects[0]!] },
        new Map([[project.source.id, { png }]]),
      ),
    ).toThrow('Invalid project effect');
    expect(() =>
      encodeProject({ ...project, masterSeed: -1 }, new Map([[project.source.id, { png }]])),
    ).toThrow('Seed');
    expect(() =>
      encodeProject(
        {
          ...project,
          effects: [
            { ...project.effects[0]!, application: { region: 'all', coverage: 0.5, softness: 2 } },
          ],
        },
        new Map([[project.source.id, { png }]]),
      ),
    ).toThrow('application');
  });
});

it('migrates version-one files while preserving recipe identities and pixels', async () => {
  const source = {
    id: 'old-source',
    name: 'old.png',
    width: 1,
    height: 1,
    format: 'png' as const,
    hasAlpha: true,
  };
  const old = {
    schemaVersion: 1,
    name: 'Old',
    masterSeed: 8172,
    source,
    effects: [createEffect('rgb-split', 'old-effect')],
  };
  const png = await encodePng({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 0]).buffer });
  const recipe = Buffer.from(JSON.stringify({ rendererVersion: 1, project: old }));
  const header = Buffer.alloc(12);
  header.write('GLEECH01');
  header.writeUInt32LE(recipe.length, 8);
  const migrated = decodeProject(Buffer.concat([header, recipe, Buffer.from(png)]));
  expect(migrated.project.schemaVersion).toBe(2);
  expect(migrated.project.origin).toEqual(source);
  expect(migrated.project.snapshots).toEqual([]);
  expect(migrated.project.effects).toEqual(old.effects);
  expect(new Uint8Array(migrated.assets.get(source.id)!.png)).toEqual(new Uint8Array(png));
});

it('persists multiple stage assets and exact subject probabilities; detects tampering and missing assets', async () => {
  const source = {
    id: 'source',
    name: 'original.png',
    width: 2,
    height: 1,
    format: 'png' as const,
    hasAlpha: true,
  };
  const rendered = { ...source, id: 'render', name: 'baked.png' };
  const originalPixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 255]).buffer;
  const outputPixels = new Uint8Array([70, 80, 90, 0, 100, 110, 120, 128]).buffer;
  const png = await encodePng({ width: 2, height: 1, pixels: originalPixels });
  const outputPng = await encodePng({ width: 2, height: 1, pixels: outputPixels });
  const subject = { width: 2, height: 1, values: new Uint8Array([83, 194]).buffer };
  const project = {
    ...createProject('Stages'),
    source: rendered,
    origin: source,
    sourceSnapshotId: 'a',
    snapshots: [
      {
        id: 'a',
        name: 'A',
        createdAt: '2026-10-03T19:00:00Z',
        parentId: null,
        source,
        rendered,
        masterSeed: 89,
        effects: [createEffect('block-corruption', 'stable-id')],
      },
    ],
  };
  const assets = new Map([
    [source.id, { png, subject }],
    [rendered.id, { png: outputPng }],
  ]);
  const valid = encodeProject(project, assets);
  const decoded = decodeProject(valid);
  expect(decoded.project).toEqual(project);
  expect(decoded.assets.size).toBe(2);
  expect(new Uint8Array(decoded.assets.get('source')!.subject!.values)).toEqual(
    new Uint8Array(subject.values),
  );
  const output = await decodeImage(decoded.assets.get('render')!.png, true);
  expect(new Uint8Array(output.fullPixels)).toEqual(new Uint8Array(outputPixels));
  const changed = Buffer.from(valid);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  expect(() => decodeProject(changed)).toThrow('checksum');
  expect(() => decodeProject(Buffer.concat([valid, Buffer.from([0])]))).toThrow('trailing');
  expect(() => decodeProject(valid.subarray(0, valid.length - 1))).toThrow('damaged');
  expect(() => encodeProject(project, new Map([[source.id, { png }]]))).toThrow('missing');
});

it('persists print/reflection, mosh, primitive and fractal recipes, actual snapshot output and baked-source lineage', async () => {
  const width = 16,
    height = 12;
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 17) % 256,
  ).buffer;
  const image = { width, height, pixels };
  const effects: EffectInstance[] = [
    {
      ...(createEffect('halftone', 'print') as Extract<EffectInstance, { type: 'halftone' }>),
      params: {
        ...(createEffect('halftone', 'print') as Extract<EffectInstance, { type: 'halftone' }>)
          .params,
        style: 'lines',
        size: 1.3,
        spacing: 4.5,
        rotation: 37,
        contrast: 1.75,
        foregroundColor: '#4080e0',
        foregroundColorMode: 'gradient',
        foregroundColorEnd: '#e04080',
        foregroundColorAngle: 37,
        foregroundColorCenterX: 35,
        foregroundColorCenterY: 61,
        foregroundColorSpan: 80,
        backgroundColor: '#f0b060',
        backgroundColorMode: 'gradient',
        backgroundColorEnd: '#20a080',
        blendMode: 'multiply',
      },
    },
    {
      ...(createEffect('mirroring', 'reflection') as Extract<
        EffectInstance,
        { type: 'mirroring' }
      >),
      params: {
        ...(
          createEffect('mirroring', 'reflection') as Extract<EffectInstance, { type: 'mirroring' }>
        ).params,
        axis: 'angled',
        outputAlignment: 'top-right',
        outputOffsetX: -12.5,
        outputOffsetY: 8.2,
        positionX: 31.5,
        positionY: 68.5,
        rotation: 55,
        sourceSide: 'opposite',
        edgeHandling: 'wrap',
        color: '#80b0e0',
        colorMode: 'gradient',
        colorEnd: '#e08040',
        colorAngle: 55,
        colorCenterX: 31,
        colorCenterY: 64,
        colorSpan: 75,
        tintStrength: 0.4,
        tintEnabled: 'on',
        blendMode: 'screen',
      },
    },
    {
      ...(createEffect('kaleidoscope', 'radial') as Extract<
        EffectInstance,
        { type: 'kaleidoscope' }
      >),
      params: {
        ...(
          createEffect('kaleidoscope', 'radial') as Extract<
            EffectInstance,
            { type: 'kaleidoscope' }
          >
        ).params,
        segments: 9,
        outputAlignment: 'center',
        outputOffsetX: 14.5,
        outputOffsetY: -9.2,
        rotation: 27,
        centerX: 33.5,
        centerY: 62.5,
        zoom: 1.75,
        edgeHandling: 'mirror',
        color: '#e0a040',
        tintStrength: 0.6,
        tintEnabled: 'on',
        blendMode: 'difference',
      },
    },
    {
      ...(createEffect('motion-mosh', 'motion') as Extract<
        EffectInstance,
        { type: 'motion-mosh' }
      >),
      seedOffset: 19,
      params: {
        ...(
          createEffect('motion-mosh', 'motion') as Extract<EffectInstance, { type: 'motion-mosh' }>
        ).params,
        blockSize: 12,
        density: 0.35,
        direction: 35,
        travel: 40,
        trailLength: 1,
        persistence: 0.9,
        samples: 12,
        edgeHandling: 'wrap',
      },
    },
    {
      ...(createEffect('shapes', 'primitive') as Extract<EffectInstance, { type: 'shapes' }>),
      application: { region: 'left', coverage: 0.8, softness: 0.4 },
      params: {
        ...(createEffect('shapes', 'primitive') as Extract<EffectInstance, { type: 'shapes' }>)
          .params,
        shape: 'polygon',
        layout: 'tiled',
        tilePattern: 'radial',
        spacing: 25,
        layoutRotation: 20,
        radialRepeats: 9,
        rotationStyle: 'graduated',
        endRotation: 230,
        startSides: 10,
        endSides: 3,
        polygonStyle: 'linear',
        progressionField: 'square',
        progressionX: 40,
        progressionY: 60,
        progressionRange: 80,
        operation: 'distort',
        size: 85,
        scale: 1.2,
        rotation: 35,
        positionX: 30,
        positionY: 60,
        ringThickness: 0.4,
        feather: 2,
        distortionScale: 1.8,
        twist: -60,
        shapeColor: '#40a0e0',
        shapeColorMode: 'gradient',
        shapeColorEnd: '#e06040',
        shapeColorAngle: 72,
        shapeColorCenterX: 45,
        shapeColorCenterY: 68,
        shapeColorSpan: 50,
        edgeHandling: 'mirror',
      },
    },
    {
      ...(createEffect('mandelbrot', 'fractal') as Extract<EffectInstance, { type: 'mandelbrot' }>),
      params: {
        ...(
          createEffect('mandelbrot', 'fractal') as Extract<EffectInstance, { type: 'mandelbrot' }>
        ).params,
        operation: 'weave',
        formula: 'julia',
        juliaReal: -0.123,
        juliaImaginary: 0.745,
        weaveScale: 0.65,
        weaveRotation: 45,
        weaveMirror: 'off',
        abstraction: 0.95,
        centerReal: -0.75,
        centerImaginary: 0.1,
        zoom: 2.5,
        rotation: 25,
        iterations: 96,
        paletteCycles: 7,
        paletteOffset: 0.3,
        outsideColor: '#f08030',
        outsideColorMode: 'gradient',
        outsideColorEnd: '#30a0e0',
        insideColor: '#102040',
        distortion: 30,
        tintEnabled: 'on',
        color: '#80b0e0',
        tintStrength: 0.4,
        blendMode: 'overlay',
        edgeHandling: 'wrap',
      },
    },
    {
      ...createEffect('recursive-space', 'space'),
      application: { region: 'right', coverage: 0.7, softness: 0.3 },
      params: {
        ...createEffect('recursive-space', 'space').params,
        style: 'spiral',
        depth: 11,
        repetitionScale: 0.7,
        perspective: 0.8,
        centerX: 35,
        centerY: 60,
        rotation: 20,
        twist: -45,
        symmetry: 9,
        imageScale: 1.3,
        mirrorCopies: 'off',
        edgeHandling: 'mirror',
      },
    },
  ] as EffectInstance[];
  const source = {
    id: 'source',
    name: 'original.png',
    width,
    height,
    format: 'png' as const,
    hasAlpha: true,
  };
  const rendered = { ...source, id: 'render', name: 'baked.png' };
  const result = renderEffects(image, effects, { masterSeed: 83 });
  const assets = new Map([
    ['source', { png: await encodePng(image) }],
    ['render', { png: await encodePng(result) }],
  ]);
  const snapshot = {
    id: 'saved',
    name: 'Print reflections',
    createdAt: '2026-10-04T18:00:00Z',
    parentId: null,
    source,
    rendered,
    masterSeed: 83,
    effects,
  };
  for (const baked of [false, true]) {
    const project = {
      ...createProject('Print reflections'),
      masterSeed: 83,
      source: baked ? rendered : source,
      origin: source,
      sourceSnapshotId: baked ? snapshot.id : null,
      effects: baked ? [] : effects,
      snapshots: [snapshot],
    };
    const decoded = decodeProject(encodeProject(project, assets));
    expect(decoded.project).toEqual(project);
    expect(
      new Uint8Array((await decodeImage(decoded.assets.get('render')!.png, true)).fullPixels),
    ).toEqual(new Uint8Array(result.pixels));
  }
});
