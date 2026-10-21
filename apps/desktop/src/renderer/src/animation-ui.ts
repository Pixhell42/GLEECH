import {
  adjacentKeyFrame,
  animationDefinition,
  keyIndexAtFrame,
  type EffectInstance,
  type Interpolation,
} from '@gleech/project-model';

/** Keyframe state for one inspector control at the playhead. */
export interface ParameterKeyInfo {
  readonly animated: boolean;
  readonly keyHere: boolean;
  readonly previous: boolean;
  readonly next: boolean;
  readonly modulators: 'audio' | 'lfo' | 'both' | null;
  /** A Replace audio modulator owns the value, so the slider is read-only. */
  readonly replaced: boolean;
  readonly note?: string;
}

/** What the inspector needs to draw and drive keyframe diamonds. */
export interface ParameterAnimationUi {
  /** Timeline mode shows grey diamonds on every animatable control. */
  readonly showStatic: boolean;
  readonly selectedKey: string | null;
  info(key: string): ParameterKeyInfo | null;
  toggleKey(key: string): void;
  jump(key: string, direction: -1 | 1): void;
  select(key: string): void;
  openModulators(key: string): void;
}

export function parameterKeyInfo(
  effect: EffectInstance,
  key: string,
  frame: number,
  fps: number,
): ParameterKeyInfo | null {
  if (!animationDefinition(effect, key)) return null;
  const animation = effect.animation?.[key];
  if (!animation)
    return {
      animated: false,
      keyHere: false,
      previous: false,
      next: false,
      modulators: null,
      replaced: false,
    };
  // Disabled modulators keep their tag so the stack stays reachable.
  const all = animation.modulators ?? [];
  const enabled = all.filter((modulator) => modulator.enabled);
  const audio = all.some((modulator) => modulator.kind === 'audio');
  const lfo = all.some((modulator) => modulator.kind === 'lfo');
  return {
    animated: true,
    keyHere: keyIndexAtFrame(animation, frame, fps) >= 0,
    previous: adjacentKeyFrame(animation, frame, fps, -1) !== null,
    next: adjacentKeyFrame(animation, frame, fps, 1) !== null,
    modulators: audio && lfo ? 'both' : audio ? 'audio' : lfo ? 'lfo' : null,
    replaced: enabled.some(
      (modulator) => modulator.kind === 'audio' && modulator.combine === 'replace',
    ),
  };
}

export const EASE_LABELS: Record<Interpolation, string> = {
  linear: 'Linear',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out',
  hold: 'Hold',
  bezier: 'Bezier',
};

/** Signal colors are fixed and never follow the UI color (see the design spec). */
export const SIGNAL_COLORS = {
  audio: '#19B106',
  lfo: '#FC54AF',
  curves: ['#119CF3', '#D266FE', '#5BB8F7', '#B43FE6', '#0B7ACB', '#E094FF'],
} as const;
export function curveColor(index: number): string {
  return SIGNAL_COLORS.curves[index % SIGNAL_COLORS.curves.length]!;
}
