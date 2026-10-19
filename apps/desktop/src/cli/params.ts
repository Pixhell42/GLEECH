import type { CommandService } from '@gleech/command-service';
import {
  EFFECT_DEFINITIONS,
  applicationParameters,
  applicationValue,
  effectDefaults,
  getEffectDefinition,
  setApplicationValue,
  type EffectInstance,
  type EffectType,
  type ParameterDefinition,
} from '@gleech/project-model';
import { EFFECT_CATEGORY, filterEffectCatalog } from '@gleech/project-model/effect-catalog';

export const EFFECT_TYPES = Object.keys(EFFECT_DEFINITIONS) as EffectType[];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Accept an effect type ID, its title ("Pixel Sorting") or a unique search match. */
export function resolveEffectType(query: string): EffectType {
  const wanted = slug(query);
  const direct = EFFECT_TYPES.find(
    (type) =>
      type === query || slug(type) === wanted || slug(EFFECT_DEFINITIONS[type].title) === wanted,
  );
  if (direct) return direct;
  const matches = filterEffectCatalog(query.replace(/[-_]/g, ' '));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1 && matches.length <= 8)
    throw new Error(
      `“${query}” matches ${matches.map((t) => `${EFFECT_DEFINITIONS[t].title} (${t})`).join(', ')}.`,
    );
  throw new Error(
    `Unknown effect “${query}”. Run gleech effects to browse all ${EFFECT_TYPES.length}.`,
  );
}

export function effectTitle(effect: EffectInstance): string {
  return effect.type === 'shader-import' ? effect.shader.name : getEffectDefinition(effect).title;
}

export function effectCategory(effect: EffectInstance): string {
  return effect.type === 'shader-import' ? 'Shaders' : EFFECT_CATEGORY[effect.type];
}

export interface ParamEntry {
  key: string;
  definition: ParameterDefinition;
  value: number | string;
  group: 'Main' | 'Color' | 'Direction' | 'Application' | 'Field';
}

export const GROUP_ORDER: readonly ParamEntry['group'][] = [
  'Main',
  'Color',
  'Direction',
  'Application',
  'Field',
];

function groupFor(key: string): ParamEntry['group'] {
  if (key.startsWith('application.depthField.')) return 'Field';
  if (key.startsWith('application.')) return 'Application';
  if (/^(color|tint)/.test(key)) return 'Color';
  if (/^direction/.test(key)) return 'Direction';
  return 'Main';
}

/** Every editable parameter of a layer, in definition order. */
export function paramEntries(effect: EffectInstance): ParamEntry[] {
  const definitions = getEffectDefinition(effect).parameters;
  const defaults = effectDefaults(effect).params as Record<string, number | string>;
  const params = effect.params as Record<string, number | string>;
  const entries: ParamEntry[] = Object.entries(definitions).map(([key, definition]) => ({
    key,
    definition,
    value: params[key] ?? defaults[key] ?? definition.default,
    group: groupFor(key),
  }));
  for (const [key, definition] of Object.entries(applicationParameters()))
    entries.push({
      key,
      definition,
      value: applicationValue(effect.application, key),
      group: groupFor(key),
    });
  // Stable sort keeps definition order inside each group.
  return entries.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export function formatValue(definition: ParameterDefinition, value: number | string): string {
  if (definition.kind === 'choice')
    return definition.options.find((option) => option.value === value)?.label ?? String(value);
  if (definition.kind === 'color') return String(value).toUpperCase();
  if (definition.kind === 'stops') {
    let count = 0;
    try {
      const stops: unknown = JSON.parse(String(value));
      count = Array.isArray(stops) ? stops.length : 0;
    } catch {
      /* Shown as zero stops; the model validates the real value. */
    }
    return count ? `${count} stop${count === 1 ? '' : 's'}` : 'off';
  }
  if (definition.kind === 'text') return JSON.stringify(String(value));
  const n = Number(value);
  switch (definition.unit) {
    case 'percent':
      return `${Math.round(n * 100)}%`;
    case 'bits':
      return `${n} ${n === 1 ? 'bit' : 'bits'}`;
    case 'count':
      return String(n);
    case 'multiplier':
      return `${n.toFixed(2)}×`;
    case 'degrees':
      return `${Number(n.toFixed(2))}°`;
    case 'cycles':
      return `${n} ${n === 1 ? 'cycle' : 'cycles'}`;
    case 'coordinate':
      return n.toFixed(3);
    default:
      return `${n.toFixed(1)}%`;
  }
}

const decimals = (step: number) => {
  const text = String(step);
  return text.includes('e-') ? Number(text.split('e-')[1]) : (text.split('.')[1]?.length ?? 0);
};

export function clampNumber(
  definition: Extract<ParameterDefinition, { kind: 'number' }>,
  value: number,
): number {
  const stepped =
    Math.round((value - definition.min) / definition.step) * definition.step + definition.min;
  const clamped = Math.min(definition.max, Math.max(definition.min, stepped));
  return Number(clamped.toFixed(Math.min(10, decimals(definition.step))));
}

/** Nudge a value one notch: ±1 step for fine control, ±5% of the range for coarse. */
export function stepParam(
  definition: ParameterDefinition,
  value: number | string,
  direction: -1 | 1,
  coarse: boolean,
): number | string {
  if (definition.kind === 'number') {
    const range = definition.max - definition.min;
    const delta = coarse ? Math.max(definition.step, range / 20) : definition.step;
    return clampNumber(definition, Number(value) + direction * delta);
  }
  if (definition.kind === 'choice') {
    const index = definition.options.findIndex((option) => option.value === value);
    const next = (index + direction + definition.options.length) % definition.options.length;
    return definition.options[next]!.value;
  }
  return value;
}

/** Parse a user-typed value ("60%", "45deg", "vertical", "#ff00aa") for a parameter. */
export function parseParamValue(
  definition: ParameterDefinition,
  raw: string,
  key = '',
): number | string {
  const text = raw.trim();
  if (definition.kind === 'number') {
    let n: number;
    if (/%$/.test(text) && definition.unit === 'percent') n = Number(text.slice(0, -1)) / 100;
    else n = Number(text.replace(/(%|°|deg|x|×|bits?|cycles?)$/i, ''));
    if (!Number.isFinite(n)) throw new Error(`${key || definition.label} needs a number.`);
    if (n < definition.min || n > definition.max)
      throw new Error(
        `${key || definition.label} must be between ${formatValue(definition, definition.min)} and ${formatValue(definition, definition.max)}.`,
      );
    return clampNumber(definition, n);
  }
  if (definition.kind === 'choice') {
    const wanted = slug(text);
    const option = definition.options.find(
      (candidate) =>
        candidate.value === text ||
        slug(candidate.value) === wanted ||
        slug(candidate.label) === wanted,
    );
    if (!option)
      throw new Error(
        `${key || definition.label} must be one of: ${definition.options.map((o) => o.value).join(', ')}.`,
      );
    return option.value;
  }
  if (definition.kind === 'color') {
    const hex = text.startsWith('#') ? text : `#${text}`;
    if (!/^#[0-9a-f]{6}$/i.test(hex))
      throw new Error(`${key || definition.label} needs a #RRGGBB color.`);
    return hex.toLowerCase();
  }
  if (definition.kind === 'text' && text.length > definition.maxLength)
    throw new Error(
      `${key || definition.label} allows at most ${definition.maxLength} characters.`,
    );
  return raw;
}

/** Resolve a parameter key case-insensitively, accepting "coverage" for "application.coverage". */
export function resolveParamKey(effect: EffectInstance, key: string): string {
  const keys = paramEntries(effect).map((entry) => entry.key);
  const lower = key.toLowerCase();
  const found =
    keys.find((candidate) => candidate === key) ??
    keys.find((candidate) => candidate.toLowerCase() === lower) ??
    keys.find((candidate) => candidate.toLowerCase() === `application.${lower}`) ??
    keys.find((candidate) => candidate.toLowerCase() === `application.depthfield.${lower}`);
  if (!found)
    throw new Error(
      `${effectTitle(effect)} has no parameter “${key}”. Try gleech effect ${effect.type}.`,
    );
  return found;
}

/** Apply typed values to one layer as a single undoable edit. */
export function setParams(
  service: CommandService,
  instanceId: string,
  values: Readonly<Record<string, number | string>>,
): void {
  const effect = service
    .getState()
    .effects.find((candidate) => candidate.instanceId === instanceId);
  if (!effect) throw new Error('Effect does not exist.');
  const definitions = getEffectDefinition(effect).parameters;
  let application = effect.application;
  const params: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('application.')) application = setApplicationValue(application, key, value);
    else if (Object.hasOwn(definitions, key)) params[key] = value;
    else throw new Error(`Unknown parameter ${key}.`);
  }
  service.updateEffect(instanceId, { params, application });
}

/** "pixel-sort:amount=60%,direction=vertical" → type plus raw values. */
export function parseEffectSpec(spec: string): { type: EffectType; values: [string, string][] } {
  const colon = spec.indexOf(':');
  const name = colon < 0 ? spec : spec.slice(0, colon);
  const rest = colon < 0 ? '' : spec.slice(colon + 1);
  const values: [string, string][] = [];
  // Commas separate pairs; a comma inside a value must not be followed by key=.
  for (const part of rest.split(/,(?=\s*[\w.]+\s*=)/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    if (eq < 1) throw new Error(`Expected key=value in “${part}”.`);
    values.push([part.slice(0, eq).trim(), part.slice(eq + 1)]);
  }
  return { type: resolveEffectType(name.trim()), values };
}

/** Add an effect from a spec on top of the stack, returning its instance ID. */
export function addEffectFromSpec(
  service: CommandService,
  spec: string,
  instanceId: string,
): string {
  const { type, values } = parseEffectSpec(spec);
  service.addEffect(type, instanceId);
  if (values.length) {
    const effect = service.getState().effects.at(-1)!;
    const typed: Record<string, number | string> = {};
    const entries = new Map(paramEntries(effect).map((entry) => [entry.key, entry.definition]));
    for (const [rawKey, raw] of values) {
      const key = resolveParamKey(effect, rawKey);
      typed[key] = parseParamValue(entries.get(key)!, raw, rawKey);
    }
    setParams(service, instanceId, typed);
  }
  return instanceId;
}
