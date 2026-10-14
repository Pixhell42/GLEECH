import {
  supportsHeightField,
  supportsDirectionField,
  directionFieldParams,
  DIRECTION_KEYS,
  DIRECTION_DEFAULTS,
  DIRECTION_PARAMETERS,
  createEffect,
  copyApplication,
  applicationParameters,
  applicationValue,
  setApplicationValue,
  bitCrushDepths,
  updateBitCrushParams,
  supportsLayerImage,
  effectDefaults,
  createImportedShader,
  getEffectDefinition,
  isParameterText,
  EFFECT_DEFINITIONS,
  parseGradientStops,
  assertEffect,
  copyPaintedMask,
  copyCanvasDrawing,
  type EffectInstance,
  type ImportedShaderEffect,
  type PaintedMask,
  type ParameterDefinition,
  type DirectionFieldParams,
  type LayerImage,
} from '@gleech/project-model';

export type SettingsTarget =
  { kind: 'effect' | 'mask' | 'direction-field' } | { kind: 'parameter' | 'color'; key: string };
type ColorSettings = {
  kind: 'color';
  value: string;
  sourceType?: EffectInstance['type'];
  sourceShader?: ImportedShaderEffect['shader'];
  key?: string;
  gradient?: {
    mode: 'solid' | 'gradient';
    end: string;
    stops?: string;
    angle?: number;
    centerX?: number;
    centerY?: number;
    span?: number;
  };
};
export type SettingsClipboard = {
  format: 'gleech-settings';
  version: 1;
} & (
  | { kind: 'effect'; effect: EffectInstance }
  | { kind: 'mask'; mask: PaintedMask }
  | {
      kind: 'direction-field';
      sourceType: EffectInstance['type'];
      params: DirectionFieldParams;
      image?: LayerImage;
    }
  | {
      kind: 'parameter';
      sourceType: EffectInstance['type'];
      sourceShader?: ImportedShaderEffect['shader'];
      key: string;
      value: number | string;
    }
  | ColorSettings
);
export const MAX_SETTINGS_TEXT = 8 * 1024 * 1024;
const application = applicationParameters();

function control(
  type: EffectInstance | EffectInstance['type'],
  key: string,
  shader?: ImportedShaderEffect['shader'],
): ParameterDefinition | undefined {
  if (Object.hasOwn(application, key)) return application[key];
  const parameters =
    typeof type === 'object'
      ? getEffectDefinition(type).parameters
      : type === 'shader-import'
        ? shader
          ? getEffectDefinition(createImportedShader(shader, 'clipboard')).parameters
          : null
        : Object.hasOwn(EFFECT_DEFINITIONS, type)
          ? EFFECT_DEFINITIONS[type].parameters
          : null;
  return parameters && Object.hasOwn(parameters, key) ? parameters[key] : undefined;
}
function valid(def: ParameterDefinition, value: unknown): value is number | string {
  if (def.kind === 'text') return isParameterText(value, def.maxLength);
  if (def.kind === 'stops') {
    try {
      parseGradientStops(value);
      return true;
    } catch {
      return false;
    }
  }
  return def.kind === 'number'
    ? typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= def.min &&
        value <= def.max &&
        (!['bits', 'count'].includes(def.unit) || Number.isInteger(value))
    : def.kind === 'choice'
      ? def.options.some((x) => x.value === value)
      : typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
function valueOf(effect: EffectInstance, key: string): number | string | undefined {
  if (
    effect.type === 'solid' &&
    key === 'fillColorMode' &&
    ['color', 'gradient'].includes(effect.params.content)
  )
    return effect.params.content === 'gradient' ? 'gradient' : 'solid';
  if (effect.type === 'bit-crush') {
    const channel = ['redBits', 'greenBits', 'blueBits', 'alphaBits'].indexOf(key);
    if (channel >= 0) return bitCrushDepths(effect.params)[channel];
  }
  if (Object.hasOwn(application, key)) return applicationValue(effect.application, key);
  return (effect.params as Record<string, number | string>)[key] ?? control(effect, key)?.default;
}
const gradientFields = {
  mode: 'Mode',
  end: 'End',
  angle: 'Angle',
  centerX: 'CenterX',
  centerY: 'CenterY',
  span: 'Span',
  stops: 'Stops',
} as const;
function rampEnd(
  type: EffectInstance['type'] | undefined,
  key: string | undefined,
): string | undefined {
  if (type === 'gradient-map' && key === 'shadows') return 'highlights';
  if (type === 'indexed-palette' && key === 'paletteStart') return 'paletteEnd';
  if (type === 'dither' && key === 'rampStart') return 'rampEnd';
  return undefined;
}
// A color-group target resets its whole ramp; a color field resets only that field.
export function resetSettings(
  effect: EffectInstance,
  target: SettingsTarget,
): EffectInstance | null {
  if (target.kind === 'direction-field') {
    if (!supportsDirectionField(effect)) return null;
    const next = applyDirectionField(effect, DIRECTION_DEFAULTS);
    return JSON.stringify(next) === JSON.stringify(effect) ? effect : next;
  }
  if (target.kind !== 'parameter' && target.kind !== 'color') return null;
  const def = control(effect, target.key);
  if (!def) return null;
  if (target.kind === 'parameter' && valueOf(effect, target.key) === def.default) return effect;
  const next = {
    ...effect,
    params: { ...effect.params },
    application: copyApplication(effect.application),
  } as EffectInstance;
  if (Object.hasOwn(application, target.key)) {
    Object.assign(next, {
      application: setApplicationValue(next.application, target.key, def.default),
    });
  } else if (target.kind === 'color' && def.kind === 'color') {
    applyColor(next, colorSettings(effectDefaults(effect), target.key, true), target.key);
  } else {
    Object.assign(
      next.params,
      effect.type === 'bit-crush'
        ? updateBitCrushParams(effect.params, { [target.key]: def.default })
        : { [target.key]: def.default },
    );
    if (
      effect.type === 'solid' &&
      target.key === 'fillColorMode' &&
      ['color', 'gradient'].includes(effect.params.content)
    )
      Object.assign(next.params, { content: 'color' });
  }
  assertEffect(next);
  return JSON.stringify(next) === JSON.stringify(effect) ? effect : next;
}
function hex(text: string): string | null {
  const value = text.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(value)) return '#' + value.toLowerCase();
  if (/^[\da-f]{3}$/i.test(value))
    return (
      '#' +
      [...value]
        .map((x) => x + x)
        .join('')
        .toLowerCase()
    );
  return null;
}
function colorSettings(effect: EffectInstance, key: string, bundle: boolean): ColorSettings {
  const result: ColorSettings = {
    kind: 'color',
    sourceType: effect.type,
    ...(effect.type === 'shader-import' ? { sourceShader: effect.shader } : {}),
    key,
    value: String(valueOf(effect, key)),
  };
  const def = control(effect, key);
  const end = rampEnd(effect.type, key);
  if (bundle && end) {
    result.gradient = {
      mode: 'gradient',
      end: String(valueOf(effect, end)),
      stops: String(valueOf(effect, key + 'Stops') ?? '[]'),
    };
    return result;
  }
  if (bundle && def?.kind === 'color' && def.gradient) {
    result.gradient = { mode: 'solid', end: '#ffffff' };
    for (const [field, suffix] of Object.entries(gradientFields)) {
      const value = valueOf(effect, key + suffix);
      if (value !== undefined) Object.assign(result.gradient, { [field]: value });
    }
  }
  return result;
}
function colorRole(key: string): string {
  if (['paletteEnd', 'rampEnd'].includes(key)) return 'light';
  const name = key.replace(/End$/, '').toLowerCase();
  if (
    ['shadows', 'foregroundcolor', 'inkcolor', 'insidecolor', 'palettestart', 'rampstart'].includes(
      name,
    )
  )
    return 'dark';
  if (
    [
      'highlights',
      'backgroundcolor',
      'papercolor',
      'outsidecolor',
      'glowcolor',
      'paletteend',
      'rampend',
    ].includes(name)
  )
    return 'light';
  return name.replace(/color$/, '') || 'color';
}
function colorDestination(
  effect: EffectInstance,
  data: ColorSettings,
  target: SettingsTarget,
  reserved = new Set<string>(),
): string | undefined {
  let candidates = Object.entries(getEffectDefinition(effect).parameters).filter(
    ([key, def]) => def.kind === 'color' && !reserved.has(key),
  );
  // Transfer both stops whenever the destination supports a gradient.
  const supportsGradient = ([key, def]: (typeof candidates)[number]) =>
    (def.kind === 'color' && Boolean(def.gradient)) || Boolean(rampEnd(effect.type, key));
  if (data.gradient && candidates.some(supportsGradient))
    candidates = candidates.filter(supportsGradient);
  let best: string | undefined,
    score = -Infinity;
  for (const [key] of candidates) {
    const rank = data.key
      ? (key === data.key ? 100 : 0) +
        (colorRole(key) === colorRole(data.key) ? 30 : 0) +
        (key.endsWith('End') === data.key.endsWith('End') ? 5 : 0)
      : (target.kind === 'parameter' || target.kind === 'color') && key === target.key
        ? 100
        : 0;
    if (rank > score) {
      best = key;
      score = rank;
    }
  }
  return best;
}
function asColor(data: SettingsClipboard): ColorSettings | null {
  if (data.kind === 'color') return data;
  if (
    data.kind === 'parameter' &&
    control(data.sourceType, data.key, data.sourceShader)?.kind === 'color'
  )
    return {
      kind: 'color',
      sourceType: data.sourceType,
      ...(data.sourceShader ? { sourceShader: data.sourceShader } : {}),
      key: data.key,
      value: String(data.value),
    };
  return null;
}
function pasteColor(
  effect: EffectInstance,
  data: SettingsClipboard,
  target: SettingsTarget,
): ColorSettings | null {
  if (
    data.kind !== 'effect' ||
    (target.kind !== 'parameter' && target.kind !== 'color') ||
    control(effect, target.key)?.kind !== 'color'
  )
    return asColor(data);
  const key = colorDestination(
    data.effect,
    {
      kind: 'color',
      key: target.key,
      value: String(valueOf(effect, target.key)),
    },
    target,
  );
  return key ? colorSettings(data.effect, key, target.kind === 'color') : null;
}
// Channel counterparts share a setting role; unrelated controls keep key matching.
function parameterPasteKey(
  effect: EffectInstance,
  data: Extract<SettingsClipboard, { kind: 'parameter' }>,
  target: SettingsTarget,
): string {
  if (
    effect.type === 'channel-transform' &&
    data.sourceType === effect.type &&
    target.kind === 'parameter'
  ) {
    const role = (key: string) =>
      /^(red|green|blue)(X|Y|Scale|Rotation|Mirror|Source)$/.exec(key)?.[2];
    if (role(data.key) !== undefined && role(data.key) === role(target.key)) return target.key;
  }
  if (
    effect.type === 'bit-crush' &&
    data.sourceType === 'bit-crush' &&
    target.kind === 'parameter' &&
    /^(bits|(red|green|blue|alpha)Bits)$/.test(data.key) &&
    /^(bits|(red|green|blue|alpha)Bits)$/.test(target.key)
  )
    return target.key;
  return data.key;
}
/** Resolve the same destination for the edit and its success notification. */
export function settingsPasteTarget(
  effect: EffectInstance,
  data: SettingsClipboard,
  target: SettingsTarget,
): SettingsTarget {
  if (data.kind === 'direction-field') return { kind: 'direction-field' };
  const color = pasteColor(effect, data, target);
  if (color) {
    const key = colorDestination(effect, color, target);
    return key ? { kind: color.gradient ? 'color' : 'parameter', key } : target;
  }
  return data.kind === 'parameter'
    ? { kind: 'parameter', key: parameterPasteKey(effect, data, target) }
    : data.kind === 'mask'
      ? { kind: 'mask' }
      : target;
}
function applyColor(effect: EffectInstance, data: ColorSettings, key: string): void {
  Object.assign(effect.params, { [key]: data.value });
  if (!data.gradient) return;
  if (
    effect.type === 'solid' &&
    key === 'fillColor' &&
    ['color', 'gradient'].includes(effect.params.content)
  )
    Object.assign(effect.params, {
      content: data.gradient.mode === 'gradient' ? 'gradient' : 'color',
    });
  const end = rampEnd(effect.type, key);
  if (end) {
    Object.assign(effect.params, {
      [end]: data.gradient.end,
      [key + 'Stops']: data.gradient.stops ?? '[]',
    });
    return;
  }
  for (const [field, suffix] of Object.entries(gradientFields)) {
    const value = data.gradient[field as keyof typeof gradientFields];
    const def = control(effect, key + suffix);
    if (def && valid(def, value)) Object.assign(effect.params, { [key + suffix]: value });
  }
}
const canonicalMask = copyPaintedMask;
function applyDirectionField(
  effect: EffectInstance,
  params: DirectionFieldParams,
  image?: LayerImage,
): EffectInstance {
  const next = {
    ...effect,
    params: {
      ...effect.params,
      ...Object.fromEntries(
        DIRECTION_KEYS.filter((key) => control(effect, key)).map((key) => [key, params[key]]),
      ),
    },
  } as EffectInstance;
  if (image)
    Object.assign(next, { directionImage: { source: { ...image.source }, png: image.png } });
  else delete (next as { directionImage?: LayerImage }).directionImage;
  assertEffect(next);
  return next;
}
export function copySettings(
  effect: EffectInstance,
  target: SettingsTarget,
): SettingsClipboard | null {
  const header = { format: 'gleech-settings' as const, version: 1 as const };
  assertEffect(effect);
  if (typeof effect.instanceId !== 'string' || effect.instanceId.length > 1024)
    throw new Error('Invalid clipboard effect identity.');
  if (target.kind === 'direction-field')
    return supportsDirectionField(effect)
      ? {
          ...header,
          kind: 'direction-field',
          sourceType: effect.type,
          params: directionFieldParams(effect.params),
          ...(effect.directionImage
            ? {
                image: {
                  source: { ...effect.directionImage.source },
                  png: effect.directionImage.png,
                },
              }
            : {}),
        }
      : null;
  if (target.kind === 'mask')
    return effect.paintedMask
      ? { ...header, kind: 'mask', mask: canonicalMask(effect.paintedMask) }
      : null;
  if (target.kind === 'parameter' || target.kind === 'color') {
    const value = valueOf(effect, target.key);
    const def = control(effect, target.key);
    if (def?.kind === 'color')
      return { ...header, ...colorSettings(effect, target.key, target.kind === 'color') };
    return value === undefined
      ? null
      : {
          ...header,
          kind: 'parameter',
          sourceType: effect.type,
          ...(effect.type === 'shader-import' ? { sourceShader: effect.shader } : {}),
          key: target.key,
          value,
        };
  }
  return {
    ...header,
    kind: 'effect',
    effect: {
      instanceId: effect.instanceId,
      type: effect.type,
      version: 1,
      enabled: effect.enabled,
      seedOffset: effect.seedOffset,
      patternId: effect.patternId ?? effect.instanceId,
      ...(effect.locked !== undefined ? { locked: effect.locked } : {}),
      application: copyApplication(effect.application),
      params: { ...effect.params },
      ...(effect.directionImage
        ? {
            directionImage: {
              source: { ...effect.directionImage.source },
              png: effect.directionImage.png,
            },
          }
        : {}),
      ...(effect.type === 'shader-import' ? { shader: structuredClone(effect.shader) } : {}),
      ...(effect.type === 'glyph' && effect.glyphFont
        ? { glyphFont: { ...effect.glyphFont } }
        : {}),
      ...(effect.paintedMask ? { paintedMask: canonicalMask(effect.paintedMask) } : {}),
      ...(effect.type === 'solid' && effect.drawing
        ? { drawing: copyCanvasDrawing(effect.drawing) }
        : {}),
      ...(supportsHeightField(effect) && effect.fieldImage
        ? { fieldImage: { source: { ...effect.fieldImage.source }, png: effect.fieldImage.png } }
        : {}),
      ...(supportsLayerImage(effect) && effect.image
        ? { image: { source: { ...effect.image.source }, png: effect.image.png } }
        : {}),
    } as EffectInstance,
  };
}
export function encodeSettings(data: SettingsClipboard): string {
  const text = JSON.stringify(data);
  if (!decodeSettings(text)) throw new Error('Invalid GLEECH clipboard settings.');
  return text;
}
export function decodeSettings(text: string): SettingsClipboard | null {
  if (!text || text.length > MAX_SETTINGS_TEXT) return null;
  const color = hex(text);
  if (color) return { format: 'gleech-settings', version: 1, kind: 'color', value: color };
  try {
    const value = JSON.parse(text) as SettingsClipboard;
    if (!value || value.format !== 'gleech-settings' || value.version !== 1) return null;
    if (value.kind === 'direction-field') {
      if (value.sourceType === 'shader-import') return null;
      const effect = createEffect(value.sourceType, 'clipboard-field');
      if (!supportsDirectionField(effect) || !value.params || typeof value.params !== 'object')
        return null;
      for (const key of DIRECTION_KEYS)
        if (!valid(DIRECTION_PARAMETERS[key], value.params[key])) return null;
      return copySettings(applyDirectionField(effect, value.params, value.image), {
        kind: 'direction-field',
      });
    }
    if (value.kind === 'effect') return copySettings(value.effect, { kind: 'effect' });
    if (value.kind === 'mask')
      return {
        format: 'gleech-settings',
        version: 1,
        kind: 'mask',
        mask: canonicalMask(value.mask),
      };
    if (value.kind === 'color') {
      if (typeof value.value !== 'string' || !hex(value.value)) return null;
      const result: SettingsClipboard = {
        format: 'gleech-settings',
        version: 1,
        kind: 'color',
        value: hex(value.value)!,
      };
      if (value.key !== undefined || value.sourceType !== undefined) {
        if (typeof value.key !== 'string' || !value.sourceType) return null;
        const def = control(value.sourceType, value.key, value.sourceShader);
        if (def?.kind !== 'color') return null;
        result.key = value.key;
        result.sourceType = value.sourceType;
        if (value.sourceShader) result.sourceShader = value.sourceShader;
      }
      if (value.gradient !== undefined) {
        if (
          !value.key ||
          !value.sourceType ||
          !value.gradient ||
          typeof value.gradient !== 'object'
        )
          return null;
        const def = control(value.sourceType, value.key, value.sourceShader);
        if (rampEnd(value.sourceType, value.key)) {
          if (
            value.gradient.mode !== 'gradient' ||
            typeof value.gradient.end !== 'string' ||
            !/^#[\da-f]{6}$/i.test(value.gradient.end) ||
            Object.keys(value.gradient).some((key) => !['mode', 'end', 'stops'].includes(key))
          )
            return null;
          if (value.gradient.stops !== undefined) parseGradientStops(value.gradient.stops);
          result.gradient = {
            mode: 'gradient',
            end: value.gradient.end,
            stops: value.gradient.stops ?? '[]',
          };
          return result;
        }
        if (def?.kind !== 'color' || !def.gradient) return null;
        const fields: Record<string, number | string> = {};
        for (const [field, suffix] of Object.entries(gradientFields)) {
          const definition = control(value.sourceType, value.key + suffix, value.sourceShader);
          if (!definition) {
            if (Object.hasOwn(value.gradient, field)) return null;
            continue;
          }
          const entry = value.gradient[field as keyof typeof gradientFields];
          if (field === 'stops' && entry === undefined) {
            fields[field] = '[]';
            continue;
          }
          if (!valid(definition, entry)) return null;
          fields[field] = entry;
        }
        result.gradient = fields as NonNullable<ColorSettings['gradient']>;
      }
      return result;
    }
    if (
      value.kind === 'parameter' &&
      (Object.hasOwn(EFFECT_DEFINITIONS, value.sourceType) ||
        (value.sourceType === 'shader-import' && value.sourceShader)) &&
      typeof value.key === 'string'
    ) {
      const def = control(value.sourceType, value.key, value.sourceShader);
      if (def && valid(def, value.value))
        return {
          format: 'gleech-settings',
          version: 1,
          kind: 'parameter',
          sourceType: value.sourceType,
          ...(value.sourceShader ? { sourceShader: value.sourceShader } : {}),
          key: value.key,
          value: value.value,
        };
    }
  } catch {
    /* Other clipboard contents are an incompatible paste, never an edit. */
  }
  return null;
}
export function settingsLabel(effect: EffectInstance, target: SettingsTarget): string {
  if (target.kind === 'direction-field') return 'direction field';
  return target.kind === 'mask'
    ? 'mask'
    : target.kind === 'parameter' || target.kind === 'color'
      ? (control(effect, target.key)?.label ?? target.key) +
        (target.kind === 'color' ? ' gradient' : '')
      : `${getEffectDefinition(effect).title} settings`;
}
export function pastedSettings(
  effect: EffectInstance,
  data: SettingsClipboard,
  target: SettingsTarget,
): EffectInstance | null {
  if (data.kind === 'direction-field')
    return supportsDirectionField(effect) &&
      ['effect', 'direction-field', 'parameter'].includes(target.kind)
      ? applyDirectionField(effect, data.params, data.image)
      : null;
  if (target.kind === 'direction-field') {
    if (!supportsDirectionField(effect)) return null;
    if (data.kind === 'effect')
      return supportsDirectionField(data.effect)
        ? applyDirectionField(
            effect,
            directionFieldParams(data.effect.params),
            data.effect.directionImage,
          )
        : null;
    if (
      data.kind !== 'parameter' ||
      !DIRECTION_KEYS.includes(data.key as keyof DirectionFieldParams)
    )
      return null;
  }
  if (data.kind === 'mask') return { ...effect, paintedMask: canonicalMask(data.mask) };
  if (target.kind === 'mask' && data.kind === 'effect')
    return data.effect.paintedMask
      ? { ...effect, paintedMask: canonicalMask(data.effect.paintedMask) }
      : null;
  const color = pasteColor(effect, data, target);
  if (color) {
    const key = colorDestination(effect, color, target);
    if (!key) return null;
    const next = { ...effect, params: { ...effect.params } } as EffectInstance;
    applyColor(next, color, key);
    try {
      assertEffect(next);
      return next;
    } catch {
      return null;
    }
  }
  if (data.kind === 'color') return null;
  const sourceType = data.kind === 'parameter' ? data.sourceType : data.effect.type;
  const entries: [string, number | string][] =
    data.kind === 'parameter'
      ? [[parameterPasteKey(effect, data, target), data.value]]
      : target.kind === 'parameter' || target.kind === 'color'
        ? [[target.key, valueOf(data.effect, target.key)!]]
        : [
            ...Object.keys(getEffectDefinition(data.effect).parameters),
            ...Object.keys(application),
          ].map((key) => [key, valueOf(data.effect, key)!]);
  let next = {
    ...effect,
    params: { ...effect.params },
    application: copyApplication(effect.application),
  } as EffectInstance;
  let compatible = false;
  const reserved = new Set<string>();
  for (const [key, value] of entries) {
    const src = control(
        data.kind === 'effect' ? data.effect : sourceType,
        data.kind === 'parameter' ? data.key : key,
        data.kind === 'parameter' ? data.sourceShader : undefined,
      ),
      dst = control(effect, key);
    if (
      data.kind === 'effect' &&
      target.kind === 'effect' &&
      data.effect.type !== effect.type &&
      src?.kind === 'color'
    ) {
      if (
        src.colorSource ||
        Object.keys(getEffectDefinition(data.effect).parameters).some(
          (k) => rampEnd(sourceType, k) === key,
        )
      )
        continue;
      const color = colorSettings(
        data.effect,
        key,
        Boolean(rampEnd(sourceType, key)) ||
          (Boolean(src.gradient) &&
            (valueOf(data.effect, key + 'Mode') === 'gradient' ||
              (dst?.kind === 'color' && Boolean(dst.gradient)))),
      );
      const destination = colorDestination(effect, color, target, reserved);
      if (destination) {
        applyColor(next, color, destination);
        reserved.add(destination);
        reserved.add(destination + 'End');
        const end = rampEnd(effect.type, destination);
        if (color.gradient && end) reserved.add(end);
        compatible = true;
      }
      continue;
    }
    if (
      data.kind === 'effect' &&
      target.kind === 'effect' &&
      data.effect.type !== effect.type &&
      src?.colorSource
    )
      continue;
    if (
      !src ||
      !dst ||
      src.kind !== dst.kind ||
      (src.kind === 'number' && dst.kind === 'number' && src.unit !== dst.unit) ||
      !valid(dst, value)
    )
      continue;
    compatible = true;
    if (Object.hasOwn(application, key))
      Object.assign(next, { application: setApplicationValue(next.application, key, value) });
    else Object.assign(next.params, { [key]: value });
  }
  if (data.kind === 'effect' && target.kind === 'effect') {
    Object.assign(next, { application: copyApplication(data.effect.application) });
    if (supportsDirectionField(next) && supportsDirectionField(data.effect)) {
      if (data.effect.directionImage)
        next = { ...next, directionImage: data.effect.directionImage };
      else delete (next as { directionImage?: unknown }).directionImage;
    }
    if (
      data.effect.type === effect.type &&
      (effect.type !== 'shader-import' ||
        (data.effect.type === 'shader-import' &&
          JSON.stringify(effect.shader) === JSON.stringify(data.effect.shader)))
    ) {
      next = {
        ...next,
        params: { ...data.effect.params },
        seedOffset: data.effect.seedOffset,
        patternId: data.effect.patternId ?? data.effect.instanceId,
      } as EffectInstance;
      if (supportsHeightField(next) && supportsHeightField(data.effect)) {
        if (data.effect.fieldImage) next = { ...next, fieldImage: data.effect.fieldImage };
        else delete (next as { fieldImage?: unknown }).fieldImage;
      }
      if (supportsLayerImage(next) && supportsLayerImage(data.effect)) {
        if (data.effect.image) Object.assign(next, { image: data.effect.image });
        else delete (next as { image?: unknown }).image;
      }
      if (next.type === 'glyph' && data.effect.type === 'glyph') {
        if (data.effect.glyphFont) next = { ...next, glyphFont: { ...data.effect.glyphFont } };
        else delete (next as { glyphFont?: unknown }).glyphFont;
      }
    }
    if (data.effect.paintedMask)
      next = { ...next, paintedMask: canonicalMask(data.effect.paintedMask) };
    else delete (next as { paintedMask?: PaintedMask }).paintedMask;
    if (next.type === 'solid' && data.effect.type === 'solid') {
      if (data.effect.drawing) next = { ...next, drawing: copyCanvasDrawing(data.effect.drawing) };
      else delete (next as { drawing?: unknown }).drawing;
    }
  }
  if (
    effect.type === 'bit-crush' &&
    next.type === 'bit-crush' &&
    data.kind === 'parameter' &&
    !Object.hasOwn(application, data.key)
  )
    next = {
      ...next,
      params: updateBitCrushParams(effect.params, {
        [parameterPasteKey(effect, data, target)]: data.value,
      }),
    };
  try {
    assertEffect(next);
    return compatible ? next : null;
  } catch {
    return null;
  }
}
