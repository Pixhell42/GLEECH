export const SEMANTIC_CONTROLS = {
  corruption:
    'Opacity of existing Glitch layers and corruption-oriented shaders. Zero removes their contribution; one applies them fully.',
  fragmentation:
    'Opacity of existing collage, fragment, dissolve, block and geometric breakup layers.',
  color_damage:
    'Opacity of channel separation, palette reduction, bit damage and chromatic-corruption layers.',
  signal_loss:
    'Opacity of existing digital dropout, compression, interlacing and damaged-signal layers.',
  glyphification: 'Opacity of existing glyph/terminal text treatments. Does not add a glyph layer.',
  smear: 'Opacity of existing motion trails, directional smear, echo and blur layers.',
  analog_decay: 'Opacity of CRT, scanline, halation and signal-tearing treatments.',
  optical_damage: 'Opacity of existing optical/refraction/lens distortion treatments.',
  structure_preservation:
    'Inverse opacity of existing Glitch and Distortion layers: one preserves the input structure by removing their contribution.',
  depth_distortion: 'Opacity of existing depth parallax/distortion layers.',
  background_isolation:
    'Apply existing unlocked filters to the detected photo background. Zero disables that application; one covers the complete detected background. May require cached subject analysis.',
} as const;
export type SemanticControl = keyof typeof SEMANTIC_CONTROLS;
