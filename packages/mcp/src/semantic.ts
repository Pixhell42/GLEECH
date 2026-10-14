import { getEffectDefinition, type EffectInstance } from '@gleech/project-model';
import { EFFECT_CATEGORY } from '@gleech/project-model/effect-catalog';
import { SEMANTIC_CONTROLS, type SemanticControl } from './semantic-definitions';
export { SEMANTIC_CONTROLS } from './semantic-definitions';
const targets: Partial<Record<SemanticControl, readonly EffectInstance['type'][]>> = {
  fragmentation: [
    'window-fragments',
    'micro-collage',
    'pixel-dissolve',
    'block-corruption',
    'compression-breakup',
    'shader-prismatic-shatter',
    'shader-digital-fracture',
    'shader-signal-collapse',
  ],
  color_damage: [
    'rgb-split',
    'channel-transform',
    'bit-crush',
    'bit-damage',
    'indexed-palette',
    'dither',
    'shader-chromatic-erosion',
  ],
  signal_loss: [
    'signal-tearing',
    'signal-weave',
    'compression-breakup',
    'jpeg-recompression',
    'shader-signal-collapse',
  ],
  glyphification: ['glyph', 'system-crash', 'terminal-wireframe'],
  smear: ['blur', 'temporal-echo', 'motion-mosh', 'reference-mosh', 'motion-transfer'],
  analog_decay: ['crt', 'scanlines', 'halation', 'signal-tearing'],
  optical_damage: [
    'wave-distortion',
    'shader-liquid-glass',
    'shader-liquid-chrome',
    'shader-heat-mirage',
    'shader-ripple',
    'shader-diffraction',
  ],
  depth_distortion: ['depth-parallax'],
};
const corruptionShaders: readonly EffectInstance['type'][] = [
  'shader-digital-fracture',
  'shader-prismatic-shatter',
  'shader-chromatic-erosion',
  'shader-signal-collapse',
];
export function semanticEffects(
  effects: readonly EffectInstance[],
  controls: Readonly<Partial<Record<SemanticControl, number>>>,
) {
  const matched = new Set<string>();
  const next = effects.map((effect) => {
    if (effect.locked) return effect;
    let result = effect;
    // Fixed order makes the result independent of JSON property order. Specific
    // treatments follow corruption; structure preservation deliberately follows them.
    for (const key of Object.keys(SEMANTIC_CONTROLS) as SemanticControl[]) {
      const value = controls[key];
      if (value === undefined) continue;
      const category = effect.type === 'shader-import' ? 'Shaders' : EFFECT_CATEGORY[effect.type];
      const matches =
        key === 'background_isolation' ||
        (key === 'corruption'
          ? category === 'Glitch' || corruptionShaders.includes(effect.type)
          : key === 'structure_preservation'
            ? ['Glitch', 'Distortion'].includes(category)
            : targets[key]?.includes(effect.type));
      if (!matches) continue;
      matched.add(effect.instanceId);
      if (key === 'background_isolation')
        result = {
          ...result,
          application: { ...result.application, region: 'background', coverage: value },
        } as EffectInstance;
      else {
        const definition = getEffectDefinition(result).parameters.amount;
        if (!definition || definition.kind !== 'number') continue;
        const amount = key === 'structure_preservation' ? Number((1 - value).toFixed(12)) : value;
        result = { ...result, params: { ...result.params, amount } } as EffectInstance;
      }
    }
    return result;
  });
  return { effects: next, matched: [...matched] };
}
