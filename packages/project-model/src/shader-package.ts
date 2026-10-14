/** Portable shader-package metadata. GPU compilation is a separate runtime check. */
export const SHADER_PACKAGE_FORMAT = 'gleech-shader';
export const MAX_SHADER_PACKAGE_BYTES = 256 * 1024;
export const MAX_SHADER_SOURCE_BYTES = 64 * 1024;
export const MAX_SHADER_CONTROLS = 32;

/** Initial runtime policy: a small single-pixel function, with no loops or owned resources. */
export function assertExecutableShader(value: unknown): asserts value is ShaderPackage {
  assertShaderPackage(value);
  const pkg = value;
  if (pkg.language === 'isf') {
    const code = uncomment(pkg.source).replace(/^\s*#version[^\n]*$/gm, '');
    if (
      new TextEncoder().encode(code).byteLength > 4096 ||
      [...code.matchAll(/\b\w+\s*\(/g)].length > 128 ||
      /\b(for|while|do|uniform|buffer|sampler\w*|layout)\b|#|\bgleech\w*\b/i.test(code)
    )
      throw new Error(
        'This ISF shader exceeds the import policy: up to 4 KiB of code and 128 calls, without loops, preprocessor directives or owned resources.',
      );
    return;
  }
  const code = uncomment(pkg.source);
  const calls = [...code.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map((match) => match[1]!);
  const allowed = new Set([
    'gleechShade',
    'gleechSample',
    'gleechControl',
    'if',
    'switch',
    'vec2f',
    'vec3f',
    'vec4f',
    'vec2i',
    'vec3i',
    'vec4i',
    'vec2u',
    'vec3u',
    'vec4u',
    'f32',
    'i32',
    'u32',
    'abs',
    'acos',
    'asin',
    'atan',
    'atan2',
    'ceil',
    'clamp',
    'cos',
    'cross',
    'degrees',
    'distance',
    'dot',
    'exp',
    'exp2',
    'floor',
    'fract',
    'inverseSqrt',
    'length',
    'log',
    'log2',
    'max',
    'min',
    'mix',
    'normalize',
    'pow',
    'radians',
    'reflect',
    'refract',
    'round',
    'select',
    'sign',
    'sin',
    'smoothstep',
    'sqrt',
    'step',
    'tan',
    'trunc',
  ]);
  if (
    new TextEncoder().encode(code).byteLength > 4096 ||
    calls.length > 96 ||
    [...code.matchAll(/\bfn\b/g)].length !== 1 ||
    /\b(for|while|loop|continuing|array|ptr|alias|struct|const|override|texture\w*|atomic\w*)\b/.test(
      code,
    ) ||
    /@|\bgleech(?:Input|Output|Settings|Controls|Kernel|RawSample|Edge)\b/.test(code) ||
    calls.some((call) => !allowed.has(call))
  )
    throw new Error(
      'This shader exceeds the first import runtime policy. Use one function, up to 4 KiB of code and 96 calls, without loops, arrays or GPU resources.',
    );
}

interface ControlBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}
export type ShaderControl =
  | (ControlBase & {
      readonly kind: 'number';
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly default: number;
      readonly unit: 'number' | 'percent' | 'degrees' | 'multiplier';
    })
  | (ControlBase & {
      readonly kind: 'choice';
      readonly default: string;
      readonly options: readonly {
        readonly value: string;
        readonly label: string;
        readonly shaderValue: number;
      }[];
    })
  | (ControlBase & { readonly kind: 'color'; readonly default: string });

export interface ShaderPackage {
  readonly format: typeof SHADER_PACKAGE_FORMAT;
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly authors: readonly { readonly name: string; readonly url?: string }[];
  readonly sourceUrl?: string;
  readonly license: { readonly expression: string; readonly text?: string };
  readonly kind: 'image' | 'generator';
  readonly language: 'wgsl' | 'isf';
  readonly entryPoint: 'gleechShade' | 'main';
  readonly isfInputs?: readonly {
    readonly name: string;
    readonly type: 'image' | 'float' | 'bool' | 'long' | 'point2D' | 'color';
    readonly keys: readonly string[];
  }[];
  readonly controls: readonly ShaderControl[];
  readonly source: string;
}
export type ShaderValues = Readonly<Record<string, number | string>>;

// These belong to GLEECH's common effect controls, not the imported parameter set.
const reserved = new Set([
  'phase',
  'seed',
  'resolution',
  'reference',
  'source',
  'amount',
  'opacity',
  'blendMode',
  'tintEnabled',
  'tintStrength',
  'color',
]);
const encoder = new TextEncoder();
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${label}.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`Unknown ${label} field.`);
}
function text(
  value: unknown,
  maximum: number,
  label: string,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    (!allowEmpty && !value.trim()) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 9 || code === 11 || code === 12 || (code >= 14 && code < 32) || code === 127;
    })
  )
    throw new Error(`Invalid shader ${label}.`);
}
function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value));
}
function url(value: unknown): void {
  text(value, 2048, 'credit URL');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid shader credit URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname)
    throw new Error('Shader credit links must use HTTPS without credentials.');
}
function color(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

// Strip nested WGSL comments before looking for package-owned declarations.
// This is a contract check, not a WGSL parser or a guarantee of bounded GPU work.
function uncomment(source: string): string {
  let result = '',
    depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (!depth && source.slice(i, i + 2) === '//') {
      while (i < source.length && source[i] !== '\n') i++;
      result += '\n';
    } else if (source.slice(i, i + 2) === '/*') {
      depth++;
      i++;
      result += ' ';
    } else if (depth && source.slice(i, i + 2) === '*/') {
      depth--;
      i++;
      result += ' ';
    } else if (!depth) result += source[i];
  }
  if (depth) throw new Error('Unclosed shader comment.');
  return result;
}

export function assertShaderPackage(value: unknown): asserts value is ShaderPackage {
  const pkg = record(value, 'shader package');
  keys(
    pkg,
    [
      'format',
      'schemaVersion',
      'id',
      'version',
      'name',
      'description',
      'authors',
      'sourceUrl',
      'license',
      'kind',
      'language',
      'entryPoint',
      'controls',
      'source',
      'isfInputs',
    ],
    'shader package',
  );
  if (
    pkg.format !== SHADER_PACKAGE_FORMAT ||
    pkg.schemaVersion !== 1 ||
    !['wgsl', 'isf'].includes(String(pkg.language)) ||
    pkg.entryPoint !== (pkg.language === 'isf' ? 'main' : 'gleechShade')
  )
    throw new Error('Unsupported shader package format, version or language.');
  text(pkg.id, 128, 'ID');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pkg.id)) throw new Error('Invalid shader ID.');
  text(pkg.version, 32, 'version');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))
    throw new Error('Invalid shader version.');
  text(pkg.name, 120, 'name');
  text(pkg.description, 2048, 'description');
  if (typeof pkg.kind !== 'string' || !['image', 'generator'].includes(pkg.kind))
    throw new Error('Invalid shader kind.');
  if (!Array.isArray(pkg.authors) || !pkg.authors.length || pkg.authors.length > 8)
    throw new Error('Shader packages need between one and eight authors.');
  for (const author of pkg.authors) {
    const entry = record(author, 'shader author');
    keys(entry, ['name', 'url'], 'shader author');
    text(entry.name, 120, 'author');
    if (entry.url !== undefined) url(entry.url);
  }
  if (pkg.sourceUrl !== undefined) url(pkg.sourceUrl);
  const license = record(pkg.license, 'shader license');
  keys(license, ['expression', 'text'], 'shader license');
  text(license.expression, 256, 'license expression');
  if (license.text !== undefined) text(license.text, 16 * 1024, 'license text');
  if (!Array.isArray(pkg.controls) || pkg.controls.length > MAX_SHADER_CONTROLS)
    throw new Error('Shader packages support at most 32 controls.');
  const names = new Set<string>();
  for (const raw of pkg.controls) {
    const control = record(raw, 'shader control');
    text(control.key, 32, 'control key');
    if (
      !/^[a-z][a-zA-Z0-9]*$/.test(control.key) ||
      reserved.has(control.key) ||
      names.has(control.key)
    )
      throw new Error('Shader control keys must be unique and cannot replace common controls.');
    names.add(control.key);
    text(control.label, 80, 'control label');
    text(control.description, 1024, 'control description');
    const common = ['key', 'kind', 'label', 'description', 'default'];
    if (control.kind === 'number') {
      keys(control, [...common, 'min', 'max', 'step', 'unit'], 'numeric shader control');
      if (
        !numeric(control.min) ||
        !numeric(control.max) ||
        !numeric(control.step) ||
        !numeric(control.default) ||
        Math.fround(control.min) >= Math.fround(control.max) ||
        Math.fround(control.step) <= 0 ||
        control.step > control.max - control.min ||
        control.default < control.min ||
        control.default > control.max ||
        typeof control.unit !== 'string' ||
        !['number', 'percent', 'degrees', 'multiplier'].includes(control.unit)
      )
        throw new Error('Invalid shader numeric range, step or default.');
    } else if (control.kind === 'choice') {
      keys(control, [...common, 'options'], 'choice shader control');
      if (
        !Array.isArray(control.options) ||
        control.options.length < 2 ||
        control.options.length > 32
      )
        throw new Error('Shader choices need between two and 32 options.');
      const values = new Set<string>(),
        codes = new Set<number>();
      for (const rawOption of control.options) {
        const option = record(rawOption, 'shader choice');
        keys(option, ['value', 'label', 'shaderValue'], 'shader choice');
        text(option.value, 64, 'choice value');
        text(option.label, 80, 'choice label');
        if (
          !numeric(option.shaderValue) ||
          values.has(option.value) ||
          codes.has(Math.fround(option.shaderValue))
        )
          throw new Error('Shader choices need unique values and finite, distinct GPU codes.');
        values.add(option.value);
        codes.add(Math.fround(option.shaderValue));
      }
      if (typeof control.default !== 'string' || !values.has(control.default))
        throw new Error('Invalid shader choice default.');
    } else if (control.kind === 'color') {
      keys(control, common, 'color shader control');
      if (!color(control.default))
        throw new Error('Shader colors must use six-digit hexadecimal RGB.');
    } else throw new Error('Unsupported shader control kind.');
  }
  text(pkg.source, MAX_SHADER_SOURCE_BYTES, 'source');
  if (encoder.encode(pkg.source).byteLength > MAX_SHADER_SOURCE_BYTES)
    throw new Error('Shader source exceeds 64 KiB.');
  const code = uncomment(pkg.source);
  if (pkg.language === 'isf') {
    if (!Array.isArray(pkg.isfInputs) || pkg.isfInputs.length > 32)
      throw new Error('Invalid ISF input bindings.');
    const bound = new Set<string>(),
      identifiers = new Set<string>();
    let images = 0;
    const controls = pkg.controls as ShaderControl[];
    for (const raw of pkg.isfInputs) {
      const binding = record(raw, 'ISF input');
      keys(binding, ['name', 'type', 'keys'], 'ISF input');
      text(binding.name, 64, 'ISF input name');
      if (
        !/^[a-zA-Z_]\w*$/.test(binding.name) ||
        /^gl_|^gleech/i.test(binding.name) ||
        [
          'main',
          'TIME',
          'TIMEDELTA',
          'FRAMEINDEX',
          'DATE',
          'RENDERSIZE',
          'PASSINDEX',
          'isf_FragNormCoord',
        ].includes(binding.name) ||
        identifiers.has(binding.name)
      )
        throw new Error('Invalid ISF input name.');
      identifiers.add(binding.name);
      const lengths = { image: 0, float: 1, bool: 1, long: 1, point2D: 2, color: 2 };
      const expected = lengths[binding.type as keyof typeof lengths];
      if (
        expected === undefined ||
        !Array.isArray(binding.keys) ||
        binding.keys.length !== expected
      )
        throw new Error('Unsupported ISF input type.');
      for (const name of binding.keys) {
        if (typeof name !== 'string' || !names.has(name) || bound.has(name))
          throw new Error('Invalid ISF control binding.');
        bound.add(name);
      }
      if (binding.type === 'image') images++;
      const mapped = binding.keys.map((name) => controls.find((control) => control.key === name)!);
      if (
        ((binding.type === 'float' || binding.type === 'point2D') &&
          mapped.some((c) => c.kind !== 'number')) ||
        ((binding.type === 'bool' || binding.type === 'long') &&
          mapped.some((c) => c.kind !== 'choice')) ||
        (binding.type === 'color' &&
          (mapped[0]?.kind !== 'color' ||
            mapped[1]?.kind !== 'number' ||
            mapped[1].min < 0 ||
            mapped[1].max > 1))
      )
        throw new Error('Incompatible ISF control binding.');
    }
    if (images > 1 || bound.size !== controls.length)
      throw new Error('ISF supports one input image and bound controls only.');
    if ([...code.matchAll(/\bvoid\s+main\s*\(\s*(?:void\s*)?\)/g)].length !== 1)
      throw new Error('ISF source must define one void main().');
  } else {
    if (pkg.isfInputs !== undefined)
      throw new Error('WGSL packages cannot declare ISF input bindings.');
    if (
      /(@\s*(group|binding|compute|fragment|vertex|workgroup_size)\b|\bvar\s*<\s*(storage|uniform|workgroup)\b)/.test(
        code,
      )
    )
      throw new Error(
        'GLEECH owns shader bindings and GPU entry points. Supply the gleechShade function only.',
      );
    if (
      [...code.matchAll(/\bfn\s+gleechShade\b/g)].length !== 1 ||
      !/\bfn\s+gleechShade\s*\(\s*[a-zA-Z_]\w*\s*:\s*GleechShaderContext\s*\)\s*->\s*vec4f\s*\{/.test(
        code,
      )
    )
      throw new Error(
        'Shader source must define fn gleechShade(context: GleechShaderContext) -> vec4f.',
      );
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > MAX_SHADER_PACKAGE_BYTES)
    throw new Error('Shader package exceeds 256 KiB.');
}

export function decodeShaderPackage(contents: string): ShaderPackage {
  if (encoder.encode(contents).byteLength > MAX_SHADER_PACKAGE_BYTES)
    throw new Error('Shader package exceeds 256 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('This is not a valid GLEECH shader package JSON file.');
  }
  assertShaderPackage(value);
  return value;
}
/** Import data only: native packages, one-function WGSL and a single-pass ISF subset. */
export function decodeShaderImport(
  contents: string,
  name: string,
  sourceUrl?: string,
): ShaderPackage {
  if (encoder.encode(contents).byteLength > MAX_SHADER_PACKAGE_BYTES)
    throw new Error('Shader file exceeds 256 KiB.');
  const trimmed = contents.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('{')) {
    const pkg = decodeShaderPackage(trimmed);
    assertExecutableShader(pkg);
    return pkg;
  }
  let hash = 0x811c9dc5,
    second = 0x9e3779b9;
  for (const character of contents) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
    second = Math.imul(second ^ character.charCodeAt(0), 0x85ebca6b);
  }
  const identity = `imported-${(hash >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  const common = {
    format: SHADER_PACKAGE_FORMAT as typeof SHADER_PACKAGE_FORMAT,
    schemaVersion: 1 as const,
    id: identity,
    version: '1.0.0',
    name: name.replace(/\.(?:wgsl|fs|isf|frag|glsl)$/i, '').slice(0, 120) || 'Imported shader',
    description: 'Imported still-image shader.',
    authors: [{ name: 'Unknown author' }],
    license: { expression: 'LicenseRef-Unspecified' },
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  if (/\bfn\s+gleechShade\b/.test(uncomment(contents))) {
    const pkg: ShaderPackage = {
      ...common,
      language: 'wgsl',
      entryPoint: 'gleechShade',
      kind: 'image',
      controls: [],
      source: contents,
    };
    assertExecutableShader(pkg);
    return pkg;
  }
  const header = /^\/\*([\s\S]*?)\*\//.exec(trimmed);
  if (!header)
    throw new Error(
      'Choose a GLEECH shader package, a gleechShade WGSL function or an ISF file with JSON metadata.',
    );
  let metadata: Record<string, unknown>;
  try {
    metadata = record(JSON.parse(header[1]!), 'ISF metadata');
  } catch {
    throw new Error('Invalid ISF JSON metadata.');
  }
  if (
    (metadata.IMPORTED && Object.keys(record(metadata.IMPORTED, 'ISF imported assets')).length) ||
    (metadata.PASSES &&
      (!Array.isArray(metadata.PASSES) ||
        metadata.PASSES.length > 1 ||
        metadata.PASSES.some((pass) => Object.keys(record(pass, 'ISF pass')).length)))
  )
    throw new Error(
      'This import supports single-pass ISF without external assets or persistent buffers.',
    );
  if (metadata.ISFVSN !== undefined && !/^2(?:\.\d+)*$/.test(String(metadata.ISFVSN)))
    throw new Error('This import supports ISF version 2.');
  const inputs = metadata.INPUTS ?? [];
  if (!Array.isArray(inputs) || inputs.length > 32)
    throw new Error('ISF supports at most 32 inputs.');
  const controls: ShaderControl[] = [];
  const bindings: NonNullable<ShaderPackage['isfInputs']>[number][] = [];
  const number = (
    key: string,
    label: string,
    initial: unknown,
    min: unknown,
    max: unknown,
    unit: 'number' | 'percent' = 'number',
  ): ShaderControl => ({
    key,
    label,
    kind: 'number',
    description: `Adjust ${label.toLowerCase()} in this shader.`,
    default: initial as number,
    min: min as number,
    max: max as number,
    step: 0.001,
    unit,
  });
  inputs.forEach((raw, index) => {
    const input = record(raw, 'ISF input'),
      type = input.TYPE as NonNullable<ShaderPackage['isfInputs']>[number]['type'];
    text(input.NAME, 64, 'ISF input name');
    const name = input.NAME as string;
    const label = typeof input.LABEL === 'string' ? input.LABEL : name;
    const key = `isf${index}`;
    const bound: string[] = [];
    if (type === 'image') {
      // The current stage supplies the engine-owned input texture.
    } else if (type === 'float') {
      controls.push(number(key, label, input.DEFAULT ?? 0, input.MIN ?? 0, input.MAX ?? 1));
      bound.push(key);
    } else if (type === 'bool') {
      controls.push({
        key,
        label,
        description: `Enable ${label.toLowerCase()} in this shader.`,
        kind: 'choice',
        default: input.DEFAULT ? 'on' : 'off',
        options: [
          { value: 'off', label: 'Off', shaderValue: 0 },
          { value: 'on', label: 'On', shaderValue: 1 },
        ],
      });
      bound.push(key);
    } else if (type === 'long') {
      if (
        !Array.isArray(input.VALUES) ||
        !input.VALUES.length ||
        input.VALUES.some((value) => !Number.isSafeInteger(value) || Math.abs(value) > 0x1000000)
      )
        throw new Error('ISF long inputs need bounded integer VALUES.');
      const values = input.VALUES as number[],
        labels = Array.isArray(input.LABELS) ? input.LABELS : values.map(String);
      const selected = input.DEFAULT === undefined ? 0 : values.indexOf(input.DEFAULT as number);
      if (selected < 0 || labels.length !== values.length)
        throw new Error('Invalid ISF choice default or labels.');
      controls.push({
        key,
        label,
        description: `Choose ${label.toLowerCase()} in this shader.`,
        kind: 'choice',
        default: `v${selected}`,
        options: values.map((value, i) => ({
          value: `v${i}`,
          label: String(labels[i]),
          shaderValue: value,
        })),
      });
      bound.push(key);
    } else if (type === 'point2D') {
      const initial = input.DEFAULT ?? [0.5, 0.5],
        min = input.MIN ?? [0, 0],
        max = input.MAX ?? [1, 1];
      if (
        !Array.isArray(initial) ||
        !Array.isArray(min) ||
        !Array.isArray(max) ||
        initial.length !== 2 ||
        min.length !== 2 ||
        max.length !== 2
      )
        throw new Error('Invalid ISF point input.');
      for (let axis = 0; axis < 2; axis++) {
        const axisKey = key + (axis === 0 ? 'X' : 'Y');
        controls.push(
          number(axisKey, label + (axis === 0 ? ' X' : ' Y'), initial[axis], min[axis], max[axis]),
        );
        bound.push(axisKey);
      }
    } else if (type === 'color') {
      const value = input.DEFAULT ?? [1, 1, 1, 1];
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        value.some((channel) => !numeric(channel) || channel < 0 || channel > 1)
      )
        throw new Error('Invalid ISF color input.');
      controls.push({
        key,
        label,
        description: `Choose ${label.toLowerCase()} in this shader.`,
        kind: 'color',
        default:
          '#' +
          value
            .slice(0, 3)
            .map((channel) =>
              Math.round(channel * 255)
                .toString(16)
                .padStart(2, '0'),
            )
            .join(''),
      });
      controls.push(number(key + 'Alpha', label + ' alpha', value[3], 0, 1, 'percent'));
      bound.push(key, key + 'Alpha');
    } else
      throw new Error(
        `Unsupported ISF input type: ${String(input.TYPE)}. Audio, events and extra images remain deferred.`,
      );
    bindings.push({ name, type, keys: bound });
  });
  const creator =
    typeof metadata.CREDIT === 'string'
      ? metadata.CREDIT.replace(/^by\s+/i, '').trim()
      : 'Unknown author';
  const pkg: ShaderPackage = {
    ...common,
    description:
      typeof metadata.DESCRIPTION === 'string' && metadata.DESCRIPTION.trim()
        ? metadata.DESCRIPTION
        : common.description,
    authors: [
      {
        name: creator || 'Unknown author',
        ...(typeof metadata.CREDIT_URL === 'string' ? { url: metadata.CREDIT_URL } : {}),
      },
    ],
    license: {
      expression:
        typeof metadata.LICENSE === 'string' && metadata.LICENSE.trim()
          ? metadata.LICENSE
          : 'LicenseRef-Unspecified',
    },
    language: 'isf',
    entryPoint: 'main',
    kind: bindings.some((binding) => binding.type === 'image') ? 'image' : 'generator',
    isfInputs: bindings,
    controls,
    source: contents,
  };
  assertExecutableShader(pkg);
  return pkg;
}
export function encodeShaderPackage(pkg: ShaderPackage): string {
  assertShaderPackage(pkg);
  const contents = JSON.stringify(pkg, null, 2) + '\n';
  if (encoder.encode(contents).byteLength > MAX_SHADER_PACKAGE_BYTES)
    throw new Error('Shader package exceeds 256 KiB.');
  return contents;
}
export function shaderControlDefaults(pkg: ShaderPackage): ShaderValues {
  assertShaderPackage(pkg);
  return Object.fromEntries(pkg.controls.map((control) => [control.key, control.default]));
}
export function assertShaderValues(
  pkg: ShaderPackage,
  values: unknown,
): asserts values is ShaderValues {
  assertShaderPackage(pkg);
  const data = record(values, 'shader values');
  keys(
    data,
    pkg.controls.map((control) => control.key),
    'shader values',
  );
  for (const control of pkg.controls) {
    const value = data[control.key];
    if (
      control.kind === 'number'
        ? !numeric(value) || value < control.min || value > control.max
        : control.kind === 'color'
          ? !color(value)
          : !control.options.some((option) => option.value === value)
    )
      throw new Error(`Invalid value for shader control ${control.label}.`);
  }
}

/** One aligned vec4 per control, in declaration order; unused components are zero. */
export function shaderControlUniforms(pkg: ShaderPackage, values: ShaderValues): Float32Array {
  assertShaderValues(pkg, values);
  const uniforms = new Float32Array(pkg.controls.length * 4);
  pkg.controls.forEach((control, index) => {
    const value = values[control.key]!;
    const offset = index * 4;
    if (control.kind === 'number') uniforms[offset] = value as number;
    else if (control.kind === 'choice')
      uniforms[offset] = control.options.find((option) => option.value === value)!.shaderValue;
    else {
      const hex = (value as string).slice(1);
      for (let channel = 0; channel < 3; channel++)
        uniforms[offset + channel] = parseInt(hex.slice(channel * 2, channel * 2 + 2), 16) / 255;
      uniforms[offset + 3] = 1;
    }
  });
  return uniforms;
}
