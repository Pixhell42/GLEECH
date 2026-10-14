import {
  EFFECT_DEFINITIONS,
  getEffectDefinition,
  parseGradientStops,
  assertEffect,
  supportsHeightField,
  assertSeed,
  createEffect,
  type EffectInstance,
  type EffectType,
  type ParameterDefinition,
} from '@gleech/project-model';

export type GleechComplexity = 'simple' | 'complex' | 'gleeched';
export type GleechMode =
  'replace-all' | 'keep-locked' | 'keep-all-add' | 'randomize-add' | 'existing-only';
export interface GleechOptions {
  complexity: GleechComplexity;
  mode: GleechMode;
  seed: number;
}
export interface VariationCandidate {
  id: string;
  similarity: 'close' | 'medium' | 'distant';
  effects: readonly EffectInstance[];
}
// Content layers are added deliberately; random opaque fills would hide an entire stack.
const types = Object.keys(EFFECT_DEFINITIONS).filter(
  (type) =>
    ![
      'solid',
      'reference-mosh',
      'motion-transfer',
      'shader-plasma',
      'shader-nebula',
      'shader-bloom-field',
      'shader-billowing-smoke',
    ].includes(type),
) as EffectType[];
const simpleTypes: readonly EffectType[] = [
  'rgb-split',
  'wave-distortion',
  'block-corruption',
  'bit-crush',
  'scanlines',
  'hue-saturation',
  'spatial-crush',
  'noise-grain',
  'mirroring',
];
// Useful creative ranges, rather than sampling every control's full legal range.
const ranges: Partial<Record<EffectInstance['type'], Record<string, readonly [number, number]>>> = {
  'shader-contour-melt': {
    strength: [0.2, 0.7],
    scale: [2, 7],
    contours: [6, 24],
    flow: [0.2, 0.8],
    sourceMix: [0.3, 0.85],
  },
  'shader-filament-flow': {
    strength: [0.2, 0.65],
    scale: [4, 14],
    curl: [0.2, 0.8],
    thickness: [0.08, 0.3],
    layers: [1, 4],
    sourceMix: [0.4, 0.85],
  },
  'shader-signal-orb': {
    strength: [0.2, 0.6],
    scale: [2, 8],
    bands: [6, 18],
    bulge: [0.2, 0.7],
    sourceMix: [0.4, 0.85],
  },
  'shader-hatched-solids': {
    strength: [0.2, 0.65],
    scale: [6, 18],
    objectCount: [2, 7],
    objectSize: [0.1, 0.25],
    hatchWidth: [0.15, 0.5],
    sourceMix: [0.4, 0.85],
  },
  'shader-mandelbrot-slices': {
    strength: [0.2, 0.6],
    scale: [1, 3],
    slices: [3, 9],
    iterations: [32, 64],
    fractalZoom: [0.7, 2],
    fractalX: [-0.8, -0.4],
    fractalY: [-0.25, 0.25],
    sourceMix: [0.4, 0.85],
  },
  'shader-arc-network': {
    strength: [0.2, 0.65],
    scale: [4, 12],
    branchLength: [0.5, 1],
    emitterDensity: [0.4, 0.85],
    lineWidth: [0.02, 0.08],
    sourceMix: [0.4, 0.85],
  },
  'shader-bead-weave': {
    strength: [0.2, 0.6],
    scale: [5, 14],
    beadSize: [0.2, 0.4],
    gaps: [0, 0.35],
    wave: [0.1, 0.7],
    sourceMix: [0.4, 0.85],
  },
  'shader-facet-mandala': {
    strength: [0.2, 0.65],
    scale: [1, 5],
    symmetry: [6, 20],
    rings: [2, 6],
    divisions: [2, 5],
    sourceMix: [0.4, 0.85],
  },
  'shader-particle-web': {
    strength: [0.2, 0.65],
    scale: [5, 15],
    density: [0.4, 0.9],
    lineWidth: [0.01, 0.05],
    jitter: [0.2, 0.8],
    sourceMix: [0.4, 0.85],
  },
  'shader-liquid-foil': {
    strength: [0.2, 0.65],
    scale: [2, 8],
    foldScale: [3, 12],
    foldStrength: [0.2, 0.75],
    roughness: [0.15, 0.6],
    heightRelief: [0.2, 0.7],
    sourceMix: [0.4, 0.85],
  },
  'granular-echo': {
    particleSize: [0.4, 2],
    trailLength: [2, 15],
    trailLayers: [2, 5],
    breakup: [0.1, 0.6],
  },
  'pigment-drag': {
    brushSize: [1, 5],
    dragLength: [3, 20],
    scraping: [0.1, 0.5],
    retention: [0.35, 0.75],
    grain: [0.1, 0.45],
    drips: [0, 0.4],
  },
  'shader-liquid-marbling': {
    strength: [0.25, 0.75],
    scale: [1, 5],
    swirl: [0.2, 0.8],
    bands: [3, 14],
    travel: [1, 12],
    sourceMix: [0.2, 0.7],
  },
  'shader-truchet-mosaic': {
    strength: [0.15, 0.55],
    scale: [3, 14],
    arcWidth: [0.08, 0.25],
    dotSize: [0.1, 0.35],
    sourceMix: [0.3, 0.8],
  },
  'shader-microculture': {
    strength: [0.15, 0.5],
    scale: [2, 9],
    radius: [0.2, 0.5],
    clustering: [0.2, 0.8],
    sourceMix: [0.35, 0.8],
  },
  'shader-prismatic-panels': {
    strength: [0.2, 0.65],
    scale: [3, 12],
    refraction: [2, 15],
    sourceMix: [0.4, 0.9],
  },
  'pixel-stretch': {
    length: [5, 40],
    stripWidth: [0.5, 5],
    density: [0.2, 0.7],
    softness: [0.1, 0.6],
  },
  'led-matrix': {
    cellSize: [1, 5],
    gap: [0.1, 0.5],
    glow: [0.1, 0.6],
    brightness: [0.8, 1.8],
    deadCells: [0, 0.15],
  },
  'cel-shading': {
    shadeBands: [3, 8],
    colorBands: [4, 12],
    smoothing: [0.1, 1],
    outlineWidth: [0.1, 0.6],
    outlineThreshold: [0.05, 0.4],
    outlineStrength: [0.3, 1],
  },
  'shader-signal-collapse': {
    strength: [0.3, 1],
    scale: [5, 24],
    collapse: [0.2, 0.8],
    stretch: [0.2, 0.9],
    static: [0.1, 0.5],
    dropout: [0.05, 0.3],
    ribbons: [0.2, 0.8],
  },
  'shader-paint-flow': {
    strength: [0.3, 1],
    scale: [3, 18],
    density: [0.3, 0.9],
    radius: [0.2, 0.7],
    travel: [3, 25],
    sourceMix: [0.3, 1],
    viscosity: [0.2, 0.8],
  },
  'shader-billowing-smoke': {
    strength: [0.3, 1],
    scale: [2, 7],
    density: [0.4, 0.85],
    volume: [0.2, 0.85],
    turbulence: [0.2, 0.9],
    smokeLayers: [2, 5],
  },
  'system-crash': {
    textSize: [0.5, 3],
    textDensity: [0.5, 1],
    windowCount: [2, 10],
    windowSize: [10, 35],
    windowTravel: [5, 35],
  },
  'terminal-wireframe': {
    cellSize: [0.5, 3],
    edgeStrength: [2, 8],
    continuity: [0.4, 0.9],
    density: [0.3, 0.8],
    perspective: [0, 0.6],
  },
  'signal-weave': {
    rasterSpacing: [0.15, 1.5],
    rasterWidth: [0.25, 0.8],
    bands: [8, 32],
    dropouts: [0.05, 0.4],
    distortion: [1, 10],
  },
  'data-weave': {
    dashLength: [0.5, 4],
    spacing: [0.1, 1],
    rowSpacing: [0.3, 2],
    thickness: [0.3, 0.8],
    disruption: [0.1, 0.5],
  },
  'micro-collage': {
    fragmentSize: [1, 8],
    travel: [5, 30],
    zoom: [0.8, 3],
    rotation: [0, 40],
    sourceMix: [0.15, 0.6],
  },
  'pixel-dissolve': {
    cellSize: [0.5, 5],
    dissolve: [0.05, 0.6],
    breakup: [0.2, 0.9],
    scatter: [2, 25],
  },
  'neon-print': {
    cellSize: [0.1, 1],
    grain: [0.2, 0.8],
    contrast: [0.8, 1.8],
    outlines: [0.2, 0.8],
    outlineWidth: [0.1, 0.5],
  },
  'shader-chromatic-erosion': {
    strength: [0.3, 1],
    scale: [3, 15],
    distortion: [1, 15],
    banding: [3, 16],
    erosion: [0, 0.45],
  },
  'shader-radial-extrusion': {
    strength: [0.4, 1],
    spokes: [16, 64],
    depth: [0.2, 0.8],
    tunnel: [0.05, 0.3],
  },
  'shader-cellular-mesh': {
    strength: [0.4, 1],
    scale: [8, 22],
    holes: [0.1, 0.5],
    rounding: [0.2, 0.9],
    wireframe: [0.1, 0.7],
  },
  'shader-particle-burst': {
    strength: [0.4, 1],
    scale: [20, 55],
    density: [0.3, 0.9],
    particleSize: [0.06, 0.2],
    branches: [0.1, 0.6],
  },
  'shader-spectral-terrain': {
    strength: [0.4, 1],
    height: [0.2, 0.7],
    ridges: [5, 20],
    lineWidth: [0.1, 0.4],
    scale: [1, 6],
  },
  'shader-neon-edges': {
    strength: [0.4, 1],
    edgeWidth: [0.1, 1],
    glow: [0.3, 1],
    darkness: [0.6, 1],
  },
  'shader-wire-ghost': {
    strength: [0.4, 1],
    trails: [2, 6],
    travel: [2, 15],
    edgeWidth: [0.1, 0.8],
    disruption: [0.1, 0.5],
  },
  'shader-prismatic-shatter': {
    strength: [0.4, 1],
    scale: [10, 35],
    distortion: [2, 15],
    interference: [0.2, 1],
    shredding: [0, 0.5],
  },
  'shader-bloom-field': {
    strength: [0.4, 1],
    scale: [6, 18],
    density: [0.3, 0.8],
    radius: [0.12, 0.35],
    dotSize: [0.03, 0.12],
  },
  'window-fragments': {
    count: [2, 12],
    width: [10, 45],
    height: [10, 45],
    travel: [0, 30],
    zoom: [0.75, 3],
    borderWidth: [0, 0.5],
  },
  'contour-waves': {
    lines: [24, 128],
    amplitude: [2, 15],
    lineWidth: [0.08, 0.35],
    rotation: [-35, 35],
  },
  'shader-ripple': { strength: [0.5, 5], scale: [2, 12], centerX: [30, 70], centerY: [30, 70] },
  'shader-liquid-glass': { strength: [1, 8], scale: [1, 6], centerX: [30, 70], centerY: [30, 70] },
  'shader-flow-field': { strength: [1, 8], scale: [1, 5], centerX: [30, 70], centerY: [30, 70] },
  'shader-iridescence': { strength: [0.25, 0.9], scale: [1, 8] },
  'shader-hologram': { strength: [0.25, 0.9], scale: [2, 12] },
  'shader-plasma': { strength: [0.5, 1.5], scale: [2, 10] },
  'shader-caustics': { strength: [0.25, 0.9], scale: [1, 6], focus: [2, 9] },
  'shader-liquid-chrome': {
    strength: [1, 7],
    scale: [1, 4],
    shine: [0.2, 0.8],
    contrast: [1.2, 3],
  },
  'shader-heat-mirage': { strength: [0.5, 6], scale: [2, 8], falloff: [0, 0.8] },
  'shader-nebula': { strength: [0.5, 1.5], scale: [1, 4], detail: [2, 5], core: [0.2, 0.9] },
  'shader-cellular-membrane': {
    strength: [1, 8],
    scale: [3, 10],
    structure: [0.05, 0.4],
    accent: [0.2, 1],
  },
  'shader-moire': { strength: [0.2, 0.8], scale: [6, 20], structure: [0.03, 0.3] },
  'shader-digital-fracture': {
    strength: [1, 9],
    scale: [3, 14],
    structure: [0.02, 0.2],
    accent: [0.2, 1],
  },
  'shader-diffraction': {
    strength: [0.2, 0.9],
    scale: [1, 5],
    structure: [4, 10],
    accent: [0.2, 0.8],
    threshold: [0.45, 0.8],
  },
  'shader-infinity-tunnel': {
    strength: [2, 12],
    scale: [1, 6],
    structure: [2, 8],
    accent: [0.1, 0.6],
  },
  'shader-crystal-facets': {
    strength: [1, 8],
    scale: [3, 12],
    structure: [0.05, 0.35],
    accent: [0.2, 0.8],
  },
  'shader-circuit-matrix': { strength: [0.2, 0.8], scale: [5, 18], structure: [0.05, 0.35] },
  'shader-data-lattice': {
    strength: [0.2, 0.8],
    scale: [8, 24],
    structure: [0.25, 0.8],
    accent: [0.1, 0.7],
  },
  'shader-op-art': { strength: [0.2, 0.8], scale: [3, 12], structure: [0.1, 0.8] },
  'shader-polar-grid': {
    strength: [0.2, 0.8],
    scale: [2, 10],
    structure: [8, 32],
    accent: [0.05, 0.25],
  },
  'vector-corruption': {
    strength: [2, 15],
    cellSize: [2, 15],
    coherence: [0.3, 0.9],
    density: [0.2, 0.8],
  },
  'reference-mosh': {
    referenceX: [-30, 30],
    referenceY: [-30, 30],
    replacementDensity: [0.2, 0.9],
    progression: [0.15, 0.8],
    persistence: [0.2, 0.8],
    patchSize: [2, 12],
    travel: [2, 15],
  },
  'motion-transfer': {
    strength: [2, 15],
    mapScale: [75, 150],
    mapX: [35, 65],
    mapY: [35, 65],
    mapRotation: [-45, 45],
  },
  'depth-parallax': {
    cameraX: [-15, 15],
    cameraY: [-15, 15],
    focusDepth: [0.3, 0.7],
    strength: [-0.6, 0.8],
    bands: [4, 24],
    scatter: [0.1, 0.6],
  },
  'depth-haze': { density: [0.2, 0.8], start: [0, 0.4], end: [0.6, 1], falloff: [0.5, 3] },
  'depth-color-map': { shading: [0.1, 0.6] },
  cutout: { near: [0.7, 1], far: [0.1, 0.4], softness: [0, 0.15], subjectThreshold: [0.3, 0.7] },
  'lens-distortion': {
    distortion: [-0.3, 0.5],
    secondary: [-0.05, 0.1],
    zoom: [90, 135],
    centerX: [35, 65],
    centerY: [35, 65],
  },
  'bit-damage': {
    lowBit: [2, 5],
    highBit: [5, 7],
    shift: [-2, 2],
    density: [0.15, 0.65],
    cellSize: [2, 24],
  },
  'freeze-dropout': {
    patchSize: [2, 12],
    density: [0.15, 0.65],
    clustering: [0, 0.8],
    steps: [2, 12],
    holdAge: [2, 8],
    travel: [0.25, 2],
    scatter: [0, 0.6],
    positionX: [-10, 10],
    positionY: [-10, 10],
  },
  'photo-adjustments': {
    exposure: [-0.75, 0.75],
    contrast: [-0.2, 0.3],
    highlights: [-0.5, 0.2],
    shadows: [-0.2, 0.5],
    vibrance: [-0.3, 0.5],
    temperature: [-0.35, 0.35],
    tint: [-0.2, 0.2],
  },
  detail: {
    sharpen: [0, 1.5],
    radius: [0.5, 4],
    threshold: [0, 0.04],
    clarity: [-0.2, 0.6],
    clarityRadius: [0.5, 4],
  },
  halation: {
    strength: [0.5, 3],
    radius: [0.3, 3],
    threshold: [0.4, 0.8],
    knee: [0.05, 0.3],
    edgeBias: [0.5, 1],
  },
  vignette: {
    strength: [0.2, 0.8],
    size: [0.8, 1.4],
    softness: [0.3, 0.9],
    roundness: [0, 1],
    centerX: [35, 65],
    centerY: [35, 65],
    rotation: [-30, 30],
  },
  'channel-transform': {
    redX: [-8, 8],
    redY: [-8, 8],
    greenX: [-8, 8],
    greenY: [-8, 8],
    blueX: [-8, 8],
    blueY: [-8, 8],
    redScale: [80, 125],
    greenScale: [80, 125],
    blueScale: [80, 125],
    redRotation: [-25, 25],
    greenRotation: [-25, 25],
    blueRotation: [-25, 25],
    crossfeed: [0.25, 1],
    centerX: [35, 65],
    centerY: [35, 65],
  },
  'temporal-echo': {
    copies: [2, 8],
    strength: [0.15, 0.65],
    spacing: [1, 10],
    falloff: [0.4, 0.9],
    scaleStep: [0.94, 1.06],
    rotationStep: [-10, 10],
    jitter: [0, 0.5],
    centerX: [35, 65],
    centerY: [35, 65],
  },
  'signal-tearing': {
    displacement: [2, 18],
    sliceSize: [0.5, 8],
    density: [0.15, 0.8],
    frequency: [2, 20],
    randomness: [0.25, 1],
    burstLength: [2, 8],
    sliceSoftness: [0, 0.4],
    fieldInfluence: [0.15, 0.65],
  },
  crt: {
    curvature: [0, 0.3],
    phosphorStrength: [0.15, 0.8],
    phosphorPitch: [3, 15],
    phosphorWidth: [0.55, 1],
    phosphorGain: [2, 4],
    fieldBlend: [0, 0.6],
    fieldSize: [1, 5],
    fieldOffsetX: [-8, 8],
    fieldOffsetY: [-3, 3],
    bloom: [0, 0.8],
    bloomRadius: [0.2, 2],
    bloomThreshold: [0.4, 0.8],
  },
  glyph: {
    cellSize: [8, 28],
    aspect: [0.8, 2],
    glyphScale: [0.65, 1],
    contrast: [0.7, 2],
    density: [0.6, 1.5],
    threshold: [0.3, 0.7],
  },
  transform: { positionX: [-15, 15], positionY: [-15, 15], scale: [75, 135], rotation: [-35, 35] },
  'rgb-split': { horizontal: [-4, 4], vertical: [-4, 4] },
  'block-corruption': { blockSize: [1, 12], density: [0.15, 0.8], displacement: [2, 18] },
  'spatial-crush': { blockSize: [0.5, 8], jitter: [0.2, 1], corruption: [0.1, 0.8] },
  'bit-crush': {
    bits: [2, 7],
    redBits: [2, 7],
    greenBits: [2, 7],
    blueBits: [2, 7],
    ditherAmount: [0.1, 1],
  },
  'wave-distortion': { strength: [1, 14], frequency: [1, 15] },
  scanlines: {
    frequency: [20, 220],
    intensity: [0.15, 0.85],
    thickness: [0.1, 0.6],
    glowSize: [0.1, 3],
  },
  halftone: { size: [0.4, 1.5], spacing: [0.5, 8], contrast: [0.5, 2] },
  'hue-saturation': { saturation: [-0.5, 0.7], lightness: [-0.2, 0.2] },
  'levels-curves': {
    inputBlack: [0, 0.25],
    inputWhite: [0.7, 1],
    outputBlack: [0, 0.2],
    outputWhite: [0.7, 1],
    gamma: [0.5, 2],
  },
  glow: { radius: [0.5, 6], strength: [0.2, 2], threshold: [0.25, 0.8] },
  'noise-grain': {
    intensity: [0.05, 0.6],
    size: [0.05, 1.5],
    scale: [1, 25],
    density: [0.05, 0.4],
  },
  blur: {
    radius: [0.3, 5],
    travel: [-40, 40],
    pointCount: [1, 4],
    density: [8, 32],
    width: [5, 50],
    falloff: [5, 50],
    focusPosition: [0.2, 0.8],
    focusRange: [0.1, 0.5],
    focusFalloff: [0.1, 0.6],
    fieldScale: [10, 80],
  },
  kaleidoscope: { segments: [3, 14], zoom: [0.5, 2.5], centerX: [25, 75], centerY: [25, 75] },
  mirroring: {
    positionX: [25, 75],
    positionY: [25, 75],
    outputOffsetX: [-15, 15],
    outputOffsetY: [-15, 15],
  },
  'recursive-space': {
    depth: [3, 14],
    perspective: [0.1, 0.7],
    centerX: [25, 75],
    centerY: [25, 75],
    imageScale: [0.6, 2.5],
    fieldRepetition: [-0.7, 0.7],
    fieldImageScale: [-0.5, 0.5],
    fieldDistortion: [-12, 12],
    fieldScale: [10, 80],
  },
  'depth-field': {
    strength: [-15, 15],
    fieldScale: [10, 80],
    relief: [0.2, 1.5],
    ambient: [0.1, 0.5],
    highlights: [0, 0.4],
    lightElevation: [20, 75],
    terraceBevel: [0.05, 0.6],
    fieldContrast: [0.5, 2],
    fieldSmoothing: [0, 3],
  },
  'feedback-bloom': {
    iterations: [3, 10],
    displacement: [0.5, 4],
    scale: [0.95, 1.08],
    rotation: [-8, 8],
    persistence: [0.5, 0.95],
    decay: [0, 0.12],
    refresh: [0, 0.15],
  },
  'compression-breakup': {
    compression: [0.2, 0.8],
    blockSize: [1, 6],
    colorBleed: [0, 0.6],
    ringing: [0, 0.6],
    seams: [0, 0.35],
    damageDensity: [0.05, 0.4],
    damageStrength: [0.25, 0.8],
  },
  'pixel-sort': {
    thresholdStart: [0.05, 0.35],
    thresholdEnd: [0.65, 0.98],
    length: [15, 70],
    density: [0.4, 1],
    breakup: [0, 0.4],
  },
  'indexed-palette': {
    colors: [4, 32],
    cellSize: [1, 4],
    colorSwap: [0, 0.7],
    hueDamage: [0, 0.6],
    saturationDamage: [0, 0.5],
    drift: [0, 0.5],
    driftSize: [2, 18],
    ditherStrength: [0.3, 1],
  },
  threshold: {
    threshold: [0.25, 0.75],
    inputBlack: [0, 0.2],
    inputWhite: [0.75, 1],
    gamma: [0.6, 1.8],
    levels: [2, 8],
    localRadius: [1, 10],
    edgeEmphasis: [0.1, 1],
    dirt: [0.05, 0.4],
    dirtSize: [0.05, 0.7],
  },
  dither: {
    levels: [2, 8],
    cellSize: [1, 5],
    ditherStrength: [0.3, 1],
    skippedCells: [0, 0.25],
    errorDisplacement: [0, 6],
    randomDirection: [0, 0.5],
    blockInterruptions: [0, 0.4],
    blockSize: [8, 32],
    channelDivergence: [0, 0.6],
  },
  'chroma-mosh': {
    colorResolution: [0.5, 8],
    displacement: [2, 20],
    density: [0.3, 1],
    persistence: [0.3, 0.9],
    samples: [3, 9],
  },
  'jpeg-recompression': { quality: [5, 65], generations: [1, 4], qualityLoss: [0, 8] },
  'motion-mosh': {
    blockSize: [1, 10],
    density: [0.2, 0.8],
    travel: [5, 45],
    samples: [3, 10],
    coherence: [0.3, 1],
  },
  shapes: {
    spacing: [6, 40],
    size: [25, 100],
    scale: [0.5, 2],
    positionX: [25, 75],
    positionY: [25, 75],
    feather: [0, 8],
    distortionScale: [0.5, 2.5],
  },
  mandelbrot: {
    iterations: [32, 160],
    distortion: [5, 30],
    weaveScale: [0.5, 3],
    paletteCycles: [1, 8],
  },
};
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}
function checkEffects(effects: readonly EffectInstance[]): void {
  const ids = new Set<string>();
  for (const effect of effects) {
    assertEffect(effect);
    if (ids.has(effect.instanceId)) throw new Error('Duplicate effect identity.');
    ids.add(effect.instanceId);
  }
}
function snap(value: number, def: Extract<ParameterDefinition, { kind: 'number' }>): number {
  const rounded = def.min + Math.round((value - def.min) / def.step) * def.step;
  return Math.min(def.max, Math.max(def.min, Number(rounded.toFixed(8))));
}
function color(value: string, rng: () => number, distance: number): string {
  const channels = [1, 3, 5].map((index) => {
    const current = Number.parseInt(value.slice(index, index + 2), 16);
    return Math.min(255, Math.max(0, Math.round(current + (rng() * 2 - 1) * 255 * distance)));
  });
  return '#' + channels.map((x) => x.toString(16).padStart(2, '0')).join('');
}
function vary(
  effect: EffectInstance,
  rng: () => number,
  distance: number,
  born = false,
): EffectInstance {
  if (effect.locked || distance === 0) return effect;
  const params: Record<string, number | string> = { ...effect.params };
  const definitions = getEffectDefinition(effect).parameters;
  for (const [key, def] of Object.entries(definitions)) {
    const current =
      params[key] ??
      (effect.type === 'bit-crush' && ['redBits', 'greenBits', 'blueBits'].includes(key)
        ? effect.params.bits
        : def.default);
    // Keep image placement predictable in close variations, and avoid expensive
    // subject detection when creating new random stacks. Existing masks stay fixed.
    if (['outputAlignment', 'outputOffsetX', 'outputOffsetY'].includes(key)) continue;
    // Geometry is an explicit composition choice. New stacks project materials;
    // close variations keep the user's projected/3D selection unchanged.
    if (key === 'objects' && (born || distance <= 0.34)) continue;
    // Typeface selection is user content, like custom text, and stays stable in variations.
    if (effect.type === 'glyph' && key === 'fontSource') continue;
    if (
      effect.type === 'bit-crush' &&
      (key === 'linkRGB' ||
        (key === 'alphaBits' && (effect.params.alphaBits ?? 8) === 8) ||
        (key === 'bits' && effect.params.linkRGB === 'off') ||
        (['redBits', 'greenBits', 'blueBits'].includes(key) && effect.params.linkRGB !== 'off'))
    )
      continue;
    if (def.kind === 'text') continue;
    if (def.kind === 'stops') {
      params[key] = JSON.stringify(
        parseGradientStops(current).map((stop) => ({
          ...stop,
          color: color(stop.color, rng, distance * 0.7),
        })),
      );
    } else if (def.kind === 'color') {
      params[key] = color(String(current), rng, distance * 0.7);
    } else if (def.kind === 'choice') {
      const change = rng();
      const options = def.options.filter(
        (option) =>
          !(key === 'directionSource' && option.value === 'image' && !effect.directionImage) &&
          !(
            key === 'fieldSource' &&
            option.value === 'image' &&
            (!supportsHeightField(effect) || !effect.fieldImage)
          ) &&
          !(
            effect.type === 'solid' &&
            key === 'content' &&
            option.value === 'image' &&
            !effect.image
          ) &&
          !(effect.type === 'solid' && key === 'content' && option.value === 'drawing') &&
          !(born && effect.type === 'blur' && key === 'style' && option.value === 'background') &&
          !(born && effect.type === 'cutout' && key === 'mode' && option.value !== 'depth'),
      );
      const selected = options[Math.floor(rng() * options.length)]!.value;
      if (distance > 0.12 && change < distance * 0.65) params[key] = selected;
    } else {
      let value: number;
      const window = ranges[effect.type]?.[key] ?? [def.min, def.max];
      if (born) {
        value = window[0] + rng() * (window[1] - window[0]);
        if (key === 'amount') value = 0.35 + rng() * 0.6;
        value = Number(current) + (value - Number(current)) * Math.min(1, 0.2 + distance * 1.5);
      } else if (effect.type === 'mandelbrot' && key === 'zoom') {
        value = Number(current) * Math.exp((rng() * 2 - 1) * distance * 3);
      } else if (effect.type === 'mandelbrot' && ['centerReal', 'centerImaginary'].includes(key)) {
        value = Number(current) + ((rng() * 2 - 1) * distance * 1.5) / Number(params.zoom ?? 1);
      } else {
        value = Number(current) + (rng() * 2 - 1) * (window[1] - window[0]) * distance * 0.5;
      }
      params[key] = snap(value, def);
    }
  }
  if (
    (effect.type === 'levels-curves' || effect.type === 'threshold') &&
    Number(params.inputBlack) >= Number(params.inputWhite)
  ) {
    params.inputBlack = Math.max(0, Number(params.inputWhite) - 0.01);
  }
  if (born && effect.type === 'mandelbrot') {
    const boundary = [
      [-0.7435, 0.1314, 40],
      [-0.745, 0.186, 12],
      [-1.25, 0, 4],
      [-0.5, 0, 1],
    ][Math.floor(rng() * 4)]!;
    Object.assign(params, {
      centerReal: boundary[0],
      centerImaginary: boundary[1],
      zoom: boundary[2],
      operation: 'weave',
    });
  }
  const patternRoll = rng(),
    patternOffset = Math.floor(rng() * 0xffffff);
  const next = {
    ...effect,
    params,
    seedOffset:
      born || (distance > 0.12 && patternRoll < distance)
        ? (effect.seedOffset + 1 + patternOffset) >>> 0
        : effect.seedOffset,
  } as EffectInstance;
  assertEffect(next);
  return next;
}
/** Pure and repeatable: generation itself never mutates a project or its history. */
export function generateGleechStack(
  effects: readonly EffectInstance[],
  options: GleechOptions,
): readonly EffectInstance[] {
  checkEffects(effects);
  assertSeed(options.seed);
  if (
    !['simple', 'complex', 'gleeched'].includes(options.complexity) ||
    !['replace-all', 'keep-locked', 'keep-all-add', 'randomize-add', 'existing-only'].includes(
      options.mode,
    )
  )
    throw new Error('Invalid GLEECH options.');
  const rng = random(options.seed);
  const intensity = { simple: 0.22, complex: 0.5, gleeched: 0.9 }[options.complexity];
  if (options.mode === 'existing-only')
    return effects.map((effect) => vary(effect, rng, intensity));
  const count =
    options.complexity === 'simple'
      ? 2 + Math.floor(rng() * 2)
      : options.complexity === 'complex'
        ? 5 + Math.floor(rng() * 3)
        : 9 + Math.floor(rng() * 4);
  const pool = [...(options.complexity === 'simple' ? simpleTypes : types)];
  const taken = new Set(effects.map((effect) => effect.instanceId));
  let serial = 0;
  function newEffect(): EffectInstance {
    if (!pool.length) pool.push(...types);
    const [type] = pool.splice(Math.floor(rng() * pool.length), 1);
    let id: string;
    do {
      id = `gleech-${options.seed.toString(16)}-${serial++}`;
    } while (taken.has(id));
    taken.add(id);
    return vary(createEffect(type!, id), rng, intensity, true);
  }
  if (options.mode === 'replace-all') return Array.from({ length: count }, newEffect);
  if (options.mode === 'keep-all-add' || options.mode === 'randomize-add') {
    const retained =
      options.mode === 'randomize-add'
        ? effects.map((effect) => vary(effect, rng, intensity))
        : effects;
    const next = [...retained, ...Array.from({ length: count }, newEffect)];
    checkEffects(next);
    return next;
  }
  // Retain locked anchors in order. Unlocked slots can survive, be replaced or
  // disappear; remaining new effects are added above the retained stack.
  let slots = count;
  const next: EffectInstance[] = [];
  for (const effect of effects) {
    if (effect.locked) {
      next.push(effect);
      continue;
    }
    if (slots > 0 && rng() > 0.35) {
      next.push(rng() < 0.45 ? vary(effect, rng, intensity) : newEffect());
      slots--;
    }
  }
  while (slots-- > 0) next.push(newEffect());
  checkEffects(next);
  return next;
}
export function generateVariations(
  effects: readonly EffectInstance[],
  seed: number,
  intensity: number,
): readonly VariationCandidate[] {
  checkEffects(effects);
  assertSeed(seed);
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1)
    throw new Error('Invalid variation intensity.');
  return Array.from({ length: 9 }, (_, index) => {
    const similarity = (['close', 'medium', 'distant'] as const)[Math.floor(index / 3)]!;
    const distance = ([0.12, 0.4, 0.85] as const)[Math.floor(index / 3)]! * intensity;
    const rng = random((seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    return {
      id: `var-${seed.toString(16)}-${index}`,
      similarity,
      effects: effects.map((effect) => vary(effect, rng, distance)),
    };
  });
}
