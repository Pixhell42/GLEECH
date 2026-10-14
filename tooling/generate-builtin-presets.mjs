import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createEffect, renderEffects, assertEffectPreset } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const directory = new URL('../apps/desktop/resources/presets/', import.meta.url);
const previews = new URL('../test-results/builtin-presets/', import.meta.url);
await mkdir(previews, { recursive: true });
const statue = await sharp(await readFile(new URL('statue.png', directory)))
  .resize(384, 384)
  .ensureAlpha()
  .raw()
  .toBuffer();
const assets = new Map();
async function map(kind, id) {
  const catalog = JSON.parse(
    await readFile(
      new URL(`../apps/desktop/resources/${kind}-maps/catalog.json`, import.meta.url),
      'utf8',
    ),
  );
  const name = catalog.maps.find((map) => map.id === id).name;
  const png = await readFile(
    new URL(`../apps/desktop/resources/${kind}-maps/${id}.png`, import.meta.url),
  );
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = {
    id: `${kind}-map-v1:${id}`,
    name: `${name}.png`,
    width: decoded.info.width,
    height: decoded.info.height,
    format: 'png',
    hasAlpha: false,
  };
  assets.set(source.id, {
    width: source.width,
    height: source.height,
    pixels: Uint8Array.from(decoded.data).buffer,
  });
  return { source, png: 'data:image/png;base64,' + png.toString('base64') };
}
const torus = await map('depth', 'torus'),
  corridor = await map('depth', 'receding-corridor'),
  terrain = await map('depth', 'ridged-terrain');
const spiral = await map('vector', 'inward-spiral'),
  broken = await map('vector', 'broken-blocks'),
  shards = await map('vector', 'diagonal-shards'),
  pinwheel = await map('vector', 'pinwheel-sectors');
const e = (type, params = {}, attachment) => ({
  ...createEffect(type, type),
  params: { ...createEffect(type, type).params, ...params },
  ...attachment,
});
const field = { fieldSource: 'image', fieldScale: 100, fieldNormalize: 'off' };
const specs = [
  [
    'analog-afterimage',
    'Analog Afterimage',
    'Soft color separation, interlaced lines and phosphor glow.',
    [
      e('rgb-split', { horizontal: 1.8, vertical: 0.4 }),
      e('scanlines', { style: 'interlaced', frequency: 96, intensity: 0.45 }),
      e('crt', { curvature: 0.08, phosphorStrength: 0.25, bloom: 0.45 }),
    ],
  ],
  [
    'signal-burn',
    'Signal Burn',
    'Broken compression and displaced signal fragments with chromatic edges.',
    [
      e('compression-breakup', { amount: 0.7 }),
      e('signal-tearing', { amount: 0.6 }),
      e('rgb-split', { horizontal: 1.4 }),
    ],
  ],
  [
    'sorted-spectrum',
    'Sorted Spectrum',
    'Long sorted color streaks with a violet-to-gold palette.',
    [
      e('gradient-map', { shadows: '#21113c', highlights: '#ffce73' }),
      e('pixel-sort', {
        direction: 90,
        length: 65,
        thresholdStart: 0.18,
        thresholdEnd: 0.88,
        breakup: 0.2,
      }),
      e('chroma-mosh', { amount: 0.3 }),
    ],
  ],
  [
    'amber-press',
    'Amber Press',
    'Warm printed dots and restrained monochrome paper grain.',
    [
      e('halftone', {
        spacing: 1.8,
        rotation: 25,
        foregroundColor: '#1c1326',
        backgroundColor: '#ffd893',
      }),
      e('noise-grain', { style: 'film', amount: 0.2, intensity: 0.15 }),
    ],
  ],
  [
    'prism-garden',
    'Prism Garden',
    'Mirrored image petals, vivid color mapping and a soft luminous finish.',
    [
      e('kaleidoscope', { segments: 8, rotation: 18, zoom: 1.3, edgeHandling: 'wrap' }),
      e('gradient-map', { shadows: '#251957', highlights: '#fbac65', amount: 0.7 }),
      e('glow', { strength: 0.55, radius: 1.5 }),
    ],
  ],
  [
    'boundary-weave',
    'Boundary Weave',
    'Repeat the source image through a Mandelbrot boundary with mirrored orbit weaving.',
    [
      e('mandelbrot', {
        centerReal: -0.75,
        centerImaginary: 0.1,
        zoom: 18,
        iterations: 96,
        weaveScale: 2.4,
        abstraction: 0.6,
      }),
      e('levels-curves', { gamma: 1.15 }),
    ],
  ],
  [
    'liquid-memory',
    'Liquid Memory',
    'Organic feedback melting with a soft purple-and-amber finish.',
    [
      e('feedback-bloom', {
        style: 'melt',
        iterations: 6,
        displacement: 3.5,
        direction: 100,
        persistence: 0.8,
      }),
      e('blur', { radius: 0.35, amount: 0.45 }),
      e('gradient-map', { shadows: '#1c1538', highlights: '#ffc68a', amount: 0.4 }),
    ],
  ],
  [
    'silver-relief',
    'Silver Relief',
    'Sculptural torus relief with photographic contrast and fine film grain.',
    [
      e(
        'depth-field',
        { ...field, operation: 'relief', relief: 1.4, amount: 0.8 },
        { fieldImage: torus },
      ),
      e('photo-adjustments', { contrast: 0.2 }),
      e('noise-grain', { style: 'film', intensity: 0.1, amount: 0.2 }),
    ],
  ],
  [
    'fogged-architecture',
    'Fogged Architecture',
    'Depth parallax and cool haze shaped by a receding corridor map.',
    [
      e(
        'depth-parallax',
        { ...field, cameraX: 12, cameraY: -5, edges: 'mirror' },
        { fieldImage: corridor },
      ),
      e(
        'depth-haze',
        { ...field, density: 0.65, fogColor: '#aec6dd', start: 0.1, end: 0.95 },
        { fieldImage: corridor },
      ),
      e('halation', { amount: 0.4 }),
    ],
  ],
  [
    'terrain-contours',
    'Terrain Contours',
    'Layered terrain contours and a warm depth palette, with the source still visible.',
    [
      e(
        'depth-field',
        { ...field, operation: 'contours', contourCount: 18, contourWidth: 0.22, amount: 0.65 },
        { fieldImage: terrain },
      ),
      e('depth-color-map', { ...field, amount: 0.55, shading: 0.6 }, { fieldImage: terrain }),
    ],
  ],
  [
    'spiral-transfer',
    'Spiral Transfer',
    'A supplied spiral vector field bends the image into flowing echoes.',
    [
      e('motion-transfer', { strength: 16, edgeHandling: 'mirror' }, { image: spiral }),
      e('temporal-echo', { copies: 3, spacing: 2, rotationStep: 4, strength: 0.35 }),
      e('glow', { strength: 0.3, radius: 0.6 }),
    ],
  ],
  [
    'broken-current',
    'Broken Current',
    'A broken-block vector map drives displaced chunks with signal tearing.',
    [
      e('motion-transfer', { strength: 12, edgeHandling: 'wrap' }, { image: broken }),
      e('signal-tearing', { amount: 0.35 }),
      e('rgb-split', { horizontal: 0.8 }),
    ],
  ],
  [
    'liquid-glass',
    'Liquid Glass',
    'Rippling glass refraction preserves the source beneath a luminous surface.',
    [
      e('shader-liquid-glass', { scale: 4, strength: 6, phase: 0.22, edgeHandling: 'mirror' }),
      e('photo-adjustments', { contrast: 0.12 }),
      e('glow', { strength: 0.22, radius: 0.7 }),
    ],
  ],
  [
    'chrome-relic',
    'Chrome Relic',
    'Sculpted liquid chrome with fine iridescent reflections and deep contrast.',
    [
      e('shader-liquid-chrome', {
        scale: 2.8,
        strength: 3,
        phase: 0.3,
        shine: 0.85,
        contrast: 2.4,
        edgeHandling: 'mirror',
      }),
      e('shader-iridescence', { amount: 0.3, strength: 0.65, scale: 4 }),
      e('levels-curves', { gamma: 0.9 }),
    ],
  ],
  [
    'spectral-halo',
    'Spectral Halo',
    'Spectral diffraction casts cyan and violet rays from the source highlights.',
    [
      e('shader-diffraction', {
        variant: 'third',
        structure: 8,
        scale: 1.6,
        strength: 0.55,
        accent: 0.9,
        threshold: 0.78,
        patternColor: '#a0eaff',
        backgroundColor: '#6b2b90',
        colorMix: 0.65,
        rotation: 18,
      }),
      e('glow', { strength: 0.15, radius: 0.8 }),
    ],
  ],
  [
    'crystal-mosaic',
    'Crystal Mosaic',
    'Hexagonal crystal facets refract the image into an icy geometric mosaic.',
    [
      e('shader-crystal-facets', {
        variant: 'third',
        scale: 9,
        strength: 7,
        structure: 0.34,
        accent: 0.65,
        colorMix: 0.6,
        rotation: 12,
        edgeHandling: 'mirror',
      }),
      e('photo-adjustments', { contrast: 0.16 }),
    ],
  ],
  [
    'holographic-ruin',
    'Holographic Ruin',
    'Holographic bands, fractured signal slices and glow create a damaged transmission.',
    [
      e('shader-hologram', { strength: 0.78, scale: 7, phase: 0.23 }),
      e('signal-tearing', { amount: 0.4, displacement: 3, density: 0.3 }),
      e('scanlines', { style: 'interlaced', frequency: 100, intensity: 0.3 }),
      e('glow', { strength: 0.25, radius: 0.6 }),
    ],
  ],
  [
    'fractured-press',
    'Fractured Press',
    'Diagonal shader shards break a warm halftone print into offset fragments.',
    [
      e('halftone', {
        spacing: 1.5,
        rotation: 20,
        foregroundColor: '#231d36',
        backgroundColor: '#f4cda0',
      }),
      e('shader-digital-fracture', {
        variant: 'third',
        strength: 7,
        structure: 0.17,
        colorMix: 0.3,
        scale: 11,
        accent: 0.65,
        edgeHandling: 'mirror',
      }),
      e('rgb-split', { horizontal: 0.7, vertical: 0.2 }),
    ],
  ],
  [
    'circuit-ghost',
    'Circuit Ghost',
    'Cyan circuit traces and a broken data lattice mingle with lingering color damage.',
    [
      e('shader-data-lattice', { amount: 0.35, strength: 0.6, scale: 12, colorMix: 0.35 }),
      e('shader-circuit-matrix', {
        scale: 16,
        strength: 0.55,
        accent: 0.8,
        patternColor: '#67efff',
        backgroundColor: '#071727',
        colorMix: 0.55,
      }),
      e('chroma-mosh', { amount: 0.3 }),
    ],
  ],
  [
    'polar-terminal',
    'Polar Terminal',
    'Source-colored hexadecimal glyphs sit beneath a luminous radar shader.',
    [
      e('glyph', { style: 'hexadecimal', cellSize: 12, glyphScale: 0.95, contrast: 1.2 }),
      e('shader-polar-grid', {
        variant: 'third',
        strength: 0.65,
        scale: 7,
        accent: 0.2,
        structure: 24,
        colorMix: 0.7,
        amount: 0.7,
      }),
      e('glow', { strength: 0.3, radius: 0.6 }),
    ],
  ],
  [
    'spiral-spectrum',
    'Spiral Spectrum',
    'Curved pixel sorting pulls violet and amber detail along a shared spiral field.',
    [
      e('gradient-map', { shadows: '#21123c', highlights: '#ffd29b', amount: 0.7 }),
      e('pixel-sort', {
        directionSource: 'spiral',
        directionTwist: -0.5,
        directionX: 52,
        directionY: 48,
        length: 70,
        thresholdStart: 0.15,
        thresholdEnd: 0.95,
        breakup: 0.08,
      }),
      e('glow', { strength: 0.25, radius: 0.5 }),
    ],
  ],
  [
    'flow-state',
    'Flow State',
    'Matching saved flow fields steer signal tears and waves into one broken current.',
    [
      e('signal-tearing', {
        directionSource: 'flow',
        directionSeed: 2401,
        directionScale: 70,
        displacement: 10,
        density: 0.65,
        sliceSize: 1.5,
        edgeHandling: 'mirror',
      }),
      e('wave-distortion', {
        directionSource: 'flow',
        directionSeed: 2401,
        directionScale: 70,
        strength: 5,
        frequency: 4,
        edgeHandling: 'mirror',
      }),
      e('rgb-split', { horizontal: 0.9, vertical: 0.3 }),
    ],
  ],
  [
    'shard-current',
    'Shard Current',
    'An embedded diagonal-shard vector map drives quantized digital displacement.',
    [
      e(
        'vector-corruption',
        {
          directionSource: 'image',
          operation: 'quantize',
          strength: 15,
          density: 0.85,
          quantization: 5,
          cellSize: 3,
          edgeHandling: 'mirror',
        },
        { directionImage: shards },
      ),
      e('gradient-map', { shadows: '#101b35', highlights: '#72ead1', amount: 0.45 }),
      e('noise-grain', { style: 'scan', amount: 0.2, intensity: 0.18, scanSpacing: 1.5 }),
    ],
  ],
  [
    'glyph-vortex',
    'Glyph Vortex',
    'An embedded pinwheel vector field bends block glyphs and image waves together.',
    [
      e(
        'glyph',
        {
          style: 'blocks',
          cellSize: 14,
          directionSource: 'image',
          directionDrift: 1.8,
          directionRotation: 15,
        },
        { directionImage: pinwheel },
      ),
      e(
        'wave-distortion',
        {
          strength: 3,
          frequency: 4,
          directionSource: 'image',
          directionRotation: 15,
          edgeHandling: 'mirror',
        },
        { directionImage: pinwheel },
      ),
      e('glow', { strength: 0.25, radius: 0.5 }),
    ],
  ],
];
const presets = [];
const originals = JSON.parse(await readFile(new URL('built-in.json', directory), 'utf8')).presets;
specs.push(
  [
    'psychedelic-skin',
    'Psychedelic Skin',
    'Liquid stripes and iridescent surface highlights retain the source figure.',
    [
      e('shader-liquid-marbling', {
        amount: 0.6,
        strength: 0.75,
        sourceMix: 0.65,
        swirl: 0.85,
        bands: 14,
      }),
      e('shader-iridescence', { amount: 0.65, strength: 0.65, scale: 6 }),
    ],
  ],
  [
    'terminal-noise',
    'Terminal Noise',
    'Diagnostic rows, broken data and optional graphic frames.',
    [
      e('data-weave', { amount: 0.5, sourceMix: 0.6 }),
      e('system-crash', {
        amount: 0.65,
        sourceMix: 0.65,
        textDensity: 0.45,
        annotations: 'on',
        anchorDensity: 0.35,
        annotationLabels: 'on',
        overlayFrames: 'on',
        windowCount: 3,
      }),
    ],
  ],
  [
    'analog-color-drag',
    'Analog Color Drag',
    'Smeared chroma and displaced raster lines with a bright analog palette.',
    [
      e('chroma-mosh', { amount: 0.55 }),
      e('pigment-drag', { amount: 0.4, dragLength: 14, direction: 0, drips: 0, retention: 0.65 }),
      e('scanlines', {
        amount: 0.5,
        frequency: 100,
        style: 'interlaced',
        signalError: 'jitter',
        errorStrength: 0.3,
      }),
    ],
  ],
  [
    'contour-scramble',
    'Contour Scramble',
    'Stepped contour fragments and torn color columns preserve the central subject.',
    [
      e('contour-waves', {
        amount: 0.7,
        breakup: 0.25,
        stepSize: 1.5,
        tearStrength: 3,
        sourceMix: 0.5,
        lines: 75,
      }),
      e('signal-weave', { amount: 0.3 }),
      e('pixel-stretch', {
        amount: 0.4,
        style: 'radial',
        length: 22,
        protectedRadius: 20,
        edgeBias: 0.65,
      }),
    ],
  ],
  [
    'annotated-silhouette',
    'Annotated Silhouette',
    'Decorative anchors and connectors accompany source-preserving edge smears.',
    [
      e('pixel-stretch', {
        amount: 0.5,
        style: 'radial',
        length: 28,
        protectedRadius: 22,
        edgeBias: 0.8,
      }),
      e('system-crash', {
        amount: 0.75,
        sourceMix: 0.85,
        threshold: 0.3,
        textDensity: 0.2,
        annotations: 'on',
        anchorDensity: 0.45,
        connectorStyle: 'elbow',
        overlayFrames: 'off',
        windowCount: 2,
        labelText: 'INPUT / SIGNAL / FRAME / TRACE',
      }),
    ],
  ],
);
for (let index = 0; index < specs.length; index++) {
  const [id, name, description, entries] = specs[index];
  if (index < 24 && !process.argv.includes('--all')) {
    const original = originals.find((preset) => preset.id === `builtin-v1:${id}`);
    if (!original) throw new Error(`Missing original preset ${id}.`);
    assertEffectPreset(original);
    presets.push(original);
    await writeFile(
      new URL(`${id}.png`, previews),
      Buffer.from(original.thumbnail.slice(22), 'base64'),
    );
    continue;
  }
  const effects = entries.map((entry, i) => ({
    ...entry,
    instanceId: `builtin:${id}:${i}`,
    seedOffset: 1000 + index * 17 + i,
  }));
  const masterSeed = 8172 + index * 103;
  const result = renderEffects(
    { width: 384, height: 384, pixels: Uint8Array.from(statue).buffer },
    effects,
    { masterSeed, reference: { width: 768, height: 768 }, layerImages: assets },
  );
  const png = await sharp(new Uint8Array(result.pixels), {
    raw: { width: 384, height: 384, channels: 4 },
  })
    .png()
    .toBuffer();
  const preset = {
    schemaVersion: 1,
    id: `builtin-v1:${id}`,
    name,
    description,
    createdAt:
      index < 12
        ? '2026-10-07T00:00:00.000Z'
        : index < 24
          ? '2026-10-09T00:00:00.000Z'
          : '2026-10-12T00:00:00.000Z',
    masterSeed,
    effects,
    thumbnail: 'data:image/png;base64,' + png.toString('base64'),
    thumbnailSource: 'statue',
  };
  try {
    assertEffectPreset(preset);
  } catch (error) {
    console.error(`${name}: ${error.message}`);
    process.exit(1);
  }
  presets.push(preset);
  await writeFile(new URL(`${id}.png`, previews), png);
  console.log(`${name}: ${effects.length} effects`);
}
await writeFile(
  new URL('built-in.json', directory),
  JSON.stringify({ version: 1, presets }, null, 2) + '\n',
);
const contact = [];
for (let index = 0; index < presets.slice(12).length; index++) {
  const preset = presets[index + 12];
  const x = (index % 4) * 240,
    y = Math.floor(index / 4) * 268;
  contact.push({
    input: await sharp(Buffer.from(preset.thumbnail.slice(22), 'base64'))
      .resize(232, 232)
      .png()
      .toBuffer(),
    left: x + 4,
    top: y + 4,
  });
  contact.push({
    input: Buffer.from(
      `<svg width="232" height="30"><text x="6" y="21" fill="#efcf83" font-size="15" font-family="Segoe UI">${preset.name}</text></svg>`,
    ),
    left: x + 4,
    top: y + 236,
  });
}
await sharp({
  create: {
    width: 960,
    height: Math.ceil((presets.length - 12) / 4) * 268,
    channels: 4,
    background: '#111314',
  },
})
  .composite(contact)
  .png()
  .toFile(fileURLToPath(new URL('new-presets-contact.png', previews)));
