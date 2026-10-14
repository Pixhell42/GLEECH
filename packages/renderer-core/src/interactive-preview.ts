export const INTERACTIVE_PREVIEW_SIZE = 256;
export const PREVIEW_REFINE_DELAY_MS = 180;

// A measured policy bounds only transient draft work. Refinement/export never
// use its size, and hysteresis prevents a slider drag from oscillating quality.
export class InteractivePreviewBudget {
  private index = 0;
  private fastFrames = 0;
  private readonly sizes = [256, 192, 128, 96];
  get maximum() {
    return this.sizes[this.index]!;
  }
  reset() {
    this.index = 0;
    this.fastFrames = 0;
  }
  record(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    if (milliseconds > 48) {
      this.index = Math.min(this.sizes.length - 1, this.index + (milliseconds > 150 ? 2 : 1));
      this.fastFrames = 0;
    } else if (milliseconds < 18) {
      if (++this.fastFrames >= 6) {
        this.index = Math.max(0, this.index - 1);
        this.fastFrames = 0;
      }
    } else this.fastFrames = 0;
  }
}

export function previewSize(width: number, height: number, maximum: number) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function needsInteractivePreview(
  image: { width: number; height: number },
  effects: readonly {
    type: string;
    enabled: boolean;
    params: { amount: number };
    application: { coverage: number };
  }[],
): boolean {
  return (
    Math.max(image.width, image.height) > INTERACTIVE_PREVIEW_SIZE &&
    (effects.filter(
      (effect) => effect.enabled && effect.params.amount > 0 && effect.application.coverage > 0,
    ).length >= 3 ||
      effects.some(
        (effect) =>
          effect.enabled &&
          effect.params.amount > 0 &&
          effect.application.coverage > 0 &&
          [
            'shader-ripple',
            'shader-contour-melt',
            'shader-filament-flow',
            'shader-signal-orb',
            'shader-hatched-solids',
            'shader-mandelbrot-slices',
            'shader-arc-network',
            'shader-bead-weave',
            'shader-facet-mandala',
            'shader-particle-web',
            'shader-liquid-foil',
            'granular-echo',
            'pigment-drag',
            'shader-liquid-marbling',
            'shader-truchet-mosaic',
            'shader-microculture',
            'shader-prismatic-panels',
            'led-matrix',
            'shader-chromatic-erosion',
            'shader-radial-extrusion',
            'shader-cellular-mesh',
            'shader-particle-burst',
            'cel-shading',
            'shader-signal-collapse',
            'shader-paint-flow',
            'shader-billowing-smoke',
            'shader-spectral-terrain',
            'shader-neon-edges',
            'shader-wire-ghost',
            'shader-prismatic-shatter',
            'shader-bloom-field',
            'contour-waves',
            'window-fragments',
            'system-crash',
            'terminal-wireframe',
            'signal-weave',
            'data-weave',
            'micro-collage',
            'pixel-dissolve',
            'neon-print',
            'shader-plasma',
            'shader-liquid-glass',
            'shader-iridescence',
            'shader-hologram',
            'shader-flow-field',
            'shader-caustics',
            'shader-liquid-chrome',
            'shader-heat-mirage',
            'shader-nebula',
            'shader-cellular-membrane',
            'shader-moire',
            'shader-digital-fracture',
            'shader-diffraction',
            'shader-infinity-tunnel',
            'shader-crystal-facets',
            'shader-circuit-matrix',
            'shader-data-lattice',
            'shader-op-art',
            'shader-polar-grid',
            'shader-import',
            'vector-corruption',
            'reference-mosh',
            'motion-transfer',
            'depth-parallax',
            'depth-haze',
            'depth-color-map',
            'cutout',
            'lens-distortion',
            'blur',
            'bit-damage',
            'freeze-dropout',
            'photo-adjustments',
            'detail',
            'halation',
            'vignette',
            'noise-grain',
            'feedback-bloom',
            'depth-field',
            'recursive-space',
            'compression-breakup',
            'indexed-palette',
            'threshold',
            'dither',
            'glyph',
            'crt',
            'signal-tearing',
            'channel-transform',
            'temporal-echo',
          ].includes(effect.type),
      ))
  );
}
