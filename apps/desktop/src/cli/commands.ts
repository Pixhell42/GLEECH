import { installCli } from './install';
import { runUpdateCommand, UPDATE_HELP } from './update-command';
import { notifyCliUpdate, shouldNotifyCli } from './updates';
import { UsageError } from './errors';
import { exportTimeline, TIMELINE_OPTIONS, validateTimelineOptions } from './timeline';
import { closeGpu, configureRendering, gpuCapabilities, renderingSettings } from './gpu';
import { randomUUID, randomInt } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  generateGleechStack,
  generateVariations,
  type GleechComplexity,
  type GleechMode,
} from '@gleech/command-service';
import {
  EFFECT_DEFINITIONS,
  type EffectInstance,
  type EffectPreset,
  type PresetPlacement,
} from '@gleech/project-model';
import { EFFECT_CATEGORIES, EFFECT_CATEGORY } from '@gleech/project-model/effect-catalog';
import { APP_VERSION } from '../shared/branding';
import { SUPPORT_LINKS } from '../shared/support';
import { encodePreset, presetFileName } from '../main/preset-file';
import { decodeProject } from '../main/project-file';
import { blockLines } from './blocks';
import { itermImage, kittyImage, protocolFromEnv, sixelImage, terminalName } from './tui/graphics';
import {
  codecName,
  encodeImage,
  fitInside,
  formatFromPath,
  resizeImage,
  type ExportFormat,
  type RgbaImage,
} from './codec';
import { renderHeadless } from './engine';
import { findPreset, listPresets, presetSlug, findShader, listShaders } from './library';
import {
  EFFECT_TYPES,
  addEffectFromSpec,
  effectTitle,
  formatValue,
  paramEntries,
  resolveEffectType,
} from './params';
import {
  restoreWindowsConsoleInput,
  loadOnnx,
  loadSharp,
  resourcesDir,
  subjectModelPath,
} from './runtime';
import { Session } from './session';
import { contactSheet } from './sheet';
import {
  createPaint,
  cellWidth,
  glitchWordmark,
  padEnd,
  truncate,
  wrapText,
  type Paint,
} from './style';

export { UsageError } from './errors';

const out = createPaint(process.stdout);
const err = createPaint(process.stderr);
const write = (text = '') => process.stdout.write(`${text}\n`);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// ─── progress ─────────────────────────────────────────────────────────────

const FRAMES = ['▖', '▘', '▝', '▗'];
function progress(label: string) {
  const started = performance.now();
  const live = process.stderr.isTTY && !process.env['CI'];
  let frame = 0;
  let text = label;
  const draw = () => {
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    process.stderr.write(
      `\r\x1b[2K  ${err.accent(FRAMES[frame++ % FRAMES.length]!)} ${text} ${err.faint(`${seconds}s`)}`,
    );
  };
  const timer = live ? setInterval(draw, 90) : null;
  if (live) draw();
  return {
    update(next: string) {
      text = next;
    },
    done(summary: string) {
      if (timer) clearInterval(timer);
      const seconds = ((performance.now() - started) / 1000).toFixed(2);
      process.stderr.write(
        `${live ? '\r\x1b[2K' : ''}  ${err.green('✓')} ${summary} ${err.faint(`${seconds}s`)}\n`,
      );
    },
    fail() {
      if (timer) clearInterval(timer);
      if (live) process.stderr.write('\r\x1b[2K');
    },
  };
}

function warn(message: string) {
  process.stderr.write(`  ${err.warn('▲')} ${message}\n`);
}

// ─── shared option handling ──────────────────────────────────────────────

type Options = ParseArgsConfig['options'];
const COMMON: Options = {
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  renderer: { type: 'string' },
  'skip-unsupported-shaders': { type: 'boolean' },
};
const OUTPUT: Options = {
  output: { type: 'string', short: 'o' },
  format: { type: 'string', short: 'f' },
  quality: { type: 'string', short: 'q' },
  'max-size': { type: 'string' },
  overwrite: { type: 'boolean', short: 'y' },
  show: { type: 'boolean' },
};
const STACK: Options = {
  preset: { type: 'string', short: 'p', multiple: true },
  shader: { type: 'string', multiple: true },
  effect: { type: 'string', short: 'e', multiple: true },
  place: { type: 'string' },
  seed: { type: 'string', short: 's' },
};

function parse(args: string[], options: Options) {
  try {
    const parsed = parseArgs({
      args,
      options: { ...COMMON, ...options },
      allowPositionals: true,
      strict: true,
    });
    const renderer = choice(
      (parsed.values['renderer'] ?? process.env['GLEECH_RENDERER'] ?? 'auto') as string,
      'renderer',
      ['auto', 'gpu', 'cpu'] as const,
    )!;
    configureRendering({
      renderer,
      skipUnsupportedShaders: !!parsed.values['skip-unsupported-shaders'],
    });
    return parsed;
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message.replace(/^.*?: /, '') : String(error),
    );
  }
}

function integer(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.startsWith('0x') ? parseInt(value, 16) : value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new UsageError(`--${name} must be an integer from ${min} to ${max}.`);
  return n;
}

function choice<T extends string>(
  value: string | undefined,
  name: string,
  options: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (!options.includes(value as T))
    throw new UsageError(`--${name} must be one of: ${options.join(', ')}.`);
  return value as T;
}

async function expandInputs(inputs: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const input of inputs) {
    if (input === 'sample') {
      result.push(input);
      continue;
    }
    const path = resolve(input);
    if (!existsSync(path)) throw new Error(`No such file: ${input}`);
    if (statSync(path).isDirectory()) {
      const entries = (await readdir(path)).filter(
        (name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) || /\.gleech$/i.test(name),
      );
      result.push(...entries.sort().map((name) => join(path, name)));
    } else result.push(path);
  }
  if (!result.length)
    throw new UsageError(
      'No input images. Pass image files, folders, .gleech projects or "sample".',
    );
  return result;
}

const openInput = (input: string) => (input === 'sample' ? Session.sample() : Session.open(input));
const stemOf = (input: string) => (input === 'sample' ? 'statue' : basename(input, extname(input)));

interface OutputPlan {
  path(input: string, suffix: string): string;
  format(path: string): ExportFormat;
  quality: number;
  overwrite: boolean;
}

function outputPlan(
  values: Record<string, unknown>,
  many: boolean,
  defaultSuffix: string,
): OutputPlan {
  const output = values['output'] as string | undefined;
  const forced = choice(values['format'] as string | undefined, 'format', [
    'png',
    'jpeg',
    'jpg',
    'webp',
    'tiff',
  ] as const);
  const format = forced === 'jpg' ? 'jpeg' : forced;
  const quality = integer(values['quality'] as string | undefined, 'quality', 1, 100) ?? 90;
  const outputIsDir =
    !!output &&
    (output.endsWith('/') ||
      output.endsWith('\\') ||
      (existsSync(output) && statSync(output).isDirectory()) ||
      (many && !formatFromPath(output)));
  if (many && output && !outputIsDir)
    throw new UsageError('With several outputs, --output must be a folder.');
  const extension = format === 'jpeg' ? '.jpg' : `.${format ?? 'png'}`;
  return {
    path(input, suffix) {
      if (output && !outputIsDir) return resolve(output);
      const folder = output ? resolve(output) : input === 'sample' ? process.cwd() : dirname(input);
      return join(folder, `${stemOf(input)}${suffix || defaultSuffix}${extension}`);
    },
    format: (path) => format ?? formatFromPath(path) ?? 'png',
    quality,
    overwrite: !!values['overwrite'],
  };
}

async function writeOutput(path: string, bytes: Buffer, overwrite: boolean): Promise<void> {
  if (existsSync(path) && !overwrite)
    throw new Error(`${path} exists. Use --overwrite (-y) to replace it.`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: overwrite ? 'w' : 'wx' });
}

function nextEffectId(session: Session, kind: string): string {
  const ids = new Set(session.state.effects.map((effect) => effect.instanceId));
  let index = session.state.effects.length;
  while (ids.has('cli-' + kind + '-' + index)) index++;
  return 'cli-' + kind + '-' + index;
}
async function applyStackOptions(
  session: Session,
  values: Record<string, unknown>,
  presets: EffectPreset[],
): Promise<void> {
  const placement =
    choice(values['place'] as string | undefined, 'place', [
      'replace',
      'above',
      'below',
      'merge',
    ] as const) ?? 'replace';
  presets.forEach((preset, index) => {
    const ids = preset.effects.map(() => randomUUID());
    session.service.applyPreset(
      {
        ...preset,
        effects: preset.effects.map((effect) => ({
          ...effect,
          patternId: effect.patternId ?? effect.instanceId,
        })),
      },
      index === 0 ? (placement as PresetPlacement) : 'above',
      ids,
    );
  });
  for (const spec of (values['effect'] as string[] | undefined) ?? [])
    addEffectFromSpec(session.service, spec, nextEffectId(session, 'effect'));
  for (const shader of (values['shader'] as string[] | undefined) ?? [])
    session.service.addShader(await findShader(shader), nextEffectId(session, 'shader'));
  const seed = integer(values['seed'] as string | undefined, 'seed', 0, 0xffffffff);
  if (seed !== undefined) session.service.setSeed(seed);
}

/** The preview protocol a plain (non-raw) stdout can use without asking the terminal. */
function showProtocol(): 'kitty' | 'iterm' | 'sixel' | 'blocks' {
  if (!process.stdout.isTTY) return 'blocks';
  const known = protocolFromEnv();
  if (known) return known;
  return process.env['WT_SESSION'] ? 'sixel' : 'blocks';
}

async function showImage(image: RgbaImage, paint: Paint): Promise<void> {
  const cols = Math.min(process.stdout.columns ?? 80, 100) - 4;
  const maxRows = Math.max(8, Math.min(40, (process.stdout.rows ?? 40) - 6));
  const protocol = showProtocol();
  if (protocol === 'blocks') {
    for (const line of blockLines(image, cols, maxRows, paint.level)) write(`  ${line}`);
    return;
  }
  // Size in 10×20-pixel cells (the VT340 cell sixel terminals scale from).
  const size = fitInside(image.width, image.height, Math.min(cols, 72) * 10, maxRows * 20);
  const fitted = await resizeImage(image, size.width, size.height);
  const c = Math.max(1, Math.round(size.width / 10));
  const r = Math.max(1, Math.round(size.height / 20));
  process.stdout.write('  ');
  if (protocol === 'kitty') process.stdout.write(kittyImage(fitted, c, r, false));
  else if (protocol === 'iterm') process.stdout.write(itermImage(fitted, c, r, false));
  else process.stdout.write(sixelImage(fitted, [16, 16, 17]));
  write();
}

async function presetFromImage(
  image: RgbaImage,
  name: string,
  effects: readonly EffectInstance[],
  masterSeed: number,
): Promise<EffectPreset> {
  const scale = Math.min(1, 384 / Math.max(image.width, image.height));
  const thumb = await resizeImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: name.slice(0, 120),
    createdAt: new Date().toISOString(),
    masterSeed,
    effects: effects.map((effect) => ({
      ...effect,
      patternId: effect.patternId ?? effect.instanceId,
    })),
    thumbnail: `data:image/png;base64,${(await encodeImage(thumb, 'png')).toString('base64')}`,
    thumbnailSource: 'image',
  };
}

const stackSummary = (effects: readonly EffectInstance[]) =>
  [...effects]
    .reverse()
    .map((effect) => effectTitle(effect))
    .join(out.faint(' › '));

// ─── commands ────────────────────────────────────────────────────────────

async function render(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    ...OUTPUT,
    ...STACK,
    ...TIMELINE_OPTIONS,
    'save-project': { type: 'string' },
    'save-preset': { type: 'string' },
  });
  if (values.help || !positionals.length) return help('render');
  validateTimelineOptions(values);
  if (values['timeline']) {
    if (positionals.length !== 1 || !/\.gleech$/i.test(positionals[0]!))
      throw new UsageError('--timeline takes one saved .gleech project.');
    const input = resolve(positionals[0]!);
    const session = await openInput(input);
    await applyStackOptions(
      session,
      values,
      await Promise.all(((values.preset as string[] | undefined) ?? []).map(findPreset)),
    );
    const task = progress(`Rendering timeline ${out.bold(stemOf(input))}`);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      const result = await exportTimeline(session, values, {
        signal: abort.signal,
        onProgress: ({ phase, done, total }) =>
          task.update(`${phase === 'encoding' ? 'Encoding' : 'Rendering'} ${done}/${total}`),
      });
      task.done(`${out.text(result.output)} ${out.faint(`${result.frames} frames`)}`);
      result.warnings.forEach(warn);
      result.notes.forEach(warn);
      if (values.json) write(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      task.fail();
      if (abort.signal.aborted) {
        warn('Timeline export cancelled.');
        return 130;
      }
      throw error;
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  }
  const inputs = await expandInputs(positionals);
  const plan = outputPlan(values, inputs.length > 1, '-gleech');
  if (inputs.length > 1 && (values['save-project'] || values['save-preset']))
    throw new UsageError('--save-project and --save-preset take a single input.');
  const maxSize = integer(values['max-size'] as string | undefined, 'max-size', 16, 32768);
  const presets = await Promise.all(
    ((values.preset as string[] | undefined) ?? []).map(findPreset),
  );
  if (
    !presets.length &&
    !(values.effect as string[] | undefined)?.length &&
    !(values.shader as string[] | undefined)?.length &&
    !inputs.some((i) => /\.gleech$/i.test(i))
  )
    throw new UsageError('Nothing to render. Add --preset, --effect, or open a .gleech project.');
  const results: object[] = [];
  for (const input of inputs) {
    const task = progress(`Rendering ${out.bold(stemOf(input))}`);
    try {
      const session = await openInput(input);
      await applyStackOptions(session, values, presets);
      const state = session.state;
      task.update(
        `Rendering ${out.bold(stemOf(input))} ${out.faint(`· ${state.effects.length} layers`)}`,
      );
      const result = maxSize ? await session.preview(maxSize) : await session.render();
      const path = plan.path(input, '');
      const format = plan.format(path);
      await writeOutput(
        path,
        await encodeImage(result.image, format, plan.quality),
        plan.overwrite,
      );
      if (values['save-project'])
        await session.save(resolve(String(values['save-project'])), plan.overwrite);
      if (values['save-preset']) {
        const preset = await presetFromImage(
          result.image,
          `${stemOf(input)} recipe`,
          state.effects,
          state.masterSeed,
        );
        await writeOutput(
          resolve(String(values['save-preset'])),
          encodePreset(preset),
          plan.overwrite,
        );
      }
      task.done(
        `${out.text(path)} ${out.faint(`${result.image.width}×${result.image.height} ${format.toUpperCase()}`)}`,
      );
      result.warnings.forEach(warn);
      results.push({
        input,
        output: path,
        width: result.image.width,
        height: result.image.height,
        format,
        masterSeed: state.masterSeed,
        layers: state.effects.length,
        milliseconds: Math.round(result.milliseconds),
        backend: result.backend,
        warnings: result.warnings,
      });
      if (values.show && !values.json) await showImage(result.image, out);
    } catch (error) {
      task.fail();
      throw error;
    }
  }
  if (values.json) write(JSON.stringify(inputs.length === 1 ? results[0] : results, null, 2));
  return 0;
}

const COMPLEXITIES = ['simple', 'complex', 'gleeched'] as const;
const MODES = [
  'replace-all',
  'keep-locked',
  'keep-all-add',
  'randomize-add',
  'existing-only',
] as const;

async function gleech(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    ...OUTPUT,
    ...STACK,
    complexity: { type: 'string', short: 'c' },
    mode: { type: 'string', short: 'm' },
    count: { type: 'string', short: 'n' },
    sheet: { type: 'string' },
    'save-preset': { type: 'boolean' },
  });
  if (values.help) return help('gleech');
  const input = positionals[0] ?? 'sample';
  if (positionals.length > 1) throw new UsageError('gleech takes one input image or project.');
  const complexity: GleechComplexity =
    choice(values.complexity as string | undefined, 'complexity', COMPLEXITIES) ?? 'complex';
  const mode: GleechMode =
    choice(values.mode as string | undefined, 'mode', MODES) ?? 'replace-all';
  const count = integer(values.count as string | undefined, 'count', 1, 64) ?? 1;
  const maxSize = integer(values['max-size'] as string | undefined, 'max-size', 16, 32768);
  const firstSeed =
    integer(values.seed as string | undefined, 'seed', 0, 0xffffffff) ?? randomInt(0, 0xffffffff);
  const plan = outputPlan(values, count > 1, '');
  const session = await openInput(input === 'sample' ? input : resolve(input));
  await applyStackOptions(
    session,
    { ...values, seed: undefined },
    await Promise.all(((values.preset as string[] | undefined) ?? []).map(findPreset)),
  );
  const base = session.state;
  const source = await session.sourceImage();
  const images: RgbaImage[] = [];
  const results: object[] = [];
  if (!values.json)
    write(
      `\n  ${out.accent('GLEECH')} ${out.muted(`${complexity} · ${mode} · ${count} ${count === 1 ? 'variant' : 'variants'}`)}\n`,
    );
  for (let i = 0; i < count; i++) {
    const seed = (firstSeed + i) >>> 0;
    const hex = seed.toString(16).padStart(8, '0');
    const task = progress(`Gleeching ${out.bold(hex)}`);
    const effects = generateGleechStack(base.effects, { complexity, mode, seed });
    const masterSeed = seed;
    try {
      const result = await renderHeadless({
        source,
        effects,
        masterSeed,
        subject: () => session.subject(),
        ...(maxSize ? { previewMaxDimension: maxSize } : {}),
      });
      const path = plan.path(input, `-gleech-${hex}`);
      await writeOutput(
        path,
        await encodeImage(result.image, plan.format(path), plan.quality),
        plan.overwrite,
      );
      if (values['save-preset']) {
        const preset = await presetFromImage(result.image, `GLEECH ${hex}`, effects, masterSeed);
        await writeOutput(
          join(dirname(path), presetFileName(`${stemOf(input)}-gleech-${hex}`)),
          encodePreset(preset),
          plan.overwrite,
        );
      }
      task.done(`${out.accent(hex)} ${out.text(basename(path))}`);
      if (!values.json) write(`     ${out.faint('└')} ${stackSummary(effects)}`);
      result.warnings.forEach(warn);
      if (values.sheet) {
        const size = fitInside(result.image.width, result.image.height, 512, 512);
        images.push(await resizeImage(result.image, size.width, size.height));
      } else if (values.show && count === 1) images.push(result.image);
      results.push({ seed, output: path, effects: effects.map((e) => e.type) });
    } catch (error) {
      task.fail();
      throw error;
    }
  }
  if (values.sheet && images.length) {
    const sheetPath = resolve(String(values.sheet));
    await writeOutput(sheetPath, await encodeImage(contactSheet(images), 'png'), plan.overwrite);
    if (!values.json) write(`\n  ${out.green('▦')} contact sheet ${out.text(sheetPath)}`);
  }
  if (values.json) write(JSON.stringify(results, null, 2));
  else {
    write(
      `\n  ${out.faint('reproduce:')} ${out.muted(`gleech gleech ${input === 'sample' ? '' : `${JSON.stringify(input)} `}--seed ${firstSeed} -c ${complexity}${count > 1 ? ` -n ${count}` : ''}`)}`,
    );
    if (values.show && images.length === 1) await showImage(images[0]!, out);
    write();
  }
  return 0;
}

async function vary(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    ...OUTPUT,
    ...STACK,
    count: { type: 'string', short: 'n' },
    intensity: { type: 'string', short: 'i' },
    sheet: { type: 'string' },
  });
  if (values.help || !positionals.length) return help('vary');
  const input = positionals[0]!;
  const count = integer(values.count as string | undefined, 'count', 1, 9) ?? 9;
  const intensity = Number(values.intensity ?? 0.5);
  if (!(intensity >= 0 && intensity <= 1))
    throw new UsageError('--intensity must be between 0 and 1.');
  const maxSize = integer(values['max-size'] as string | undefined, 'max-size', 16, 32768);
  const plan = outputPlan(values, true, '');
  const session = await openInput(input === 'sample' ? input : resolve(input));
  await applyStackOptions(
    session,
    { ...values, seed: undefined },
    await Promise.all(((values.preset as string[] | undefined) ?? []).map(findPreset)),
  );
  if (!session.state.effects.length)
    throw new UsageError(
      'vary needs a stack. Add --preset or --effect, or open a .gleech project.',
    );
  const seed =
    integer(values.seed as string | undefined, 'seed', 0, 0xffffffff) ?? randomInt(0, 0xffffffff);
  const source = await session.sourceImage();
  const candidates = generateVariations(session.state.effects, seed, intensity).slice(0, count);
  const images: RgbaImage[] = [];
  const results: object[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const task = progress(
      `Variation ${index + 1}/${candidates.length} ${out.faint(candidate.similarity)}`,
    );
    try {
      const result = await renderHeadless({
        source,
        effects: candidate.effects,
        masterSeed: session.state.masterSeed,
        subject: () => session.subject(),
        ...(maxSize ? { previewMaxDimension: maxSize } : {}),
      });
      const path = plan.path(input, `-var-${index + 1}-${candidate.similarity}`);
      await writeOutput(
        path,
        await encodeImage(result.image, plan.format(path), plan.quality),
        plan.overwrite,
      );
      task.done(`${out.text(basename(path))}`);
      if (values.sheet || values.show) {
        const size = fitInside(result.image.width, result.image.height, 512, 512);
        images.push(await resizeImage(result.image, size.width, size.height));
      }
      result.warnings.forEach(warn);
      results.push({
        output: path,
        seed,
        similarity: candidate.similarity,
        backend: result.backend,
        warnings: result.warnings,
      });
    } catch (error) {
      task.fail();
      throw error;
    }
  }
  if (values.sheet) {
    const sheetPath = resolve(String(values.sheet));
    await writeOutput(sheetPath, await encodeImage(contactSheet(images), 'png'), plan.overwrite);
    if (!values.json) write(`  ${out.green('▦')} contact sheet ${out.text(sheetPath)}`);
  }
  if (values.show && !values.json && images.length) await showImage(contactSheet(images), out);
  if (values.json) write(JSON.stringify(results, null, 2));
  return 0;
}

async function effects(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { category: { type: 'string', short: 'c' } });
  if (values.help) return help('effects');
  const category = values.category
    ? EFFECT_CATEGORIES.find((c) => c.toLowerCase() === String(values.category).toLowerCase())
    : 'All';
  if (!category)
    throw new UsageError(`--category must be one of: ${EFFECT_CATEGORIES.slice(1).join(', ')}.`);
  const { filterEffectCatalog } = await import('@gleech/project-model/effect-catalog');
  const types = filterEffectCatalog(positionals.join(' '), category);
  if (values.json) {
    write(
      JSON.stringify(
        types.map((type) => ({
          type,
          title: EFFECT_DEFINITIONS[type].title,
          category: EFFECT_CATEGORY[type],
          description: EFFECT_DEFINITIONS[type].description,
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  const width = Math.min(process.stdout.columns ?? 100, 120);
  write();
  for (const group of EFFECT_CATEGORIES.slice(1)) {
    const members = types.filter((type) => EFFECT_CATEGORY[type] === group);
    if (!members.length) continue;
    write(
      `  ${out.accent('▍')}${out.bold(group.toUpperCase())} ${out.faint(String(members.length))}`,
    );
    for (const type of members) {
      const definition = EFFECT_DEFINITIONS[type];
      const title = padEnd(out.text(definition.title), 26);
      const id = padEnd(out.muted(type), 28);
      const room = width - 2 - 26 - 28 - 2;
      write(
        `   ${title}${id}${room > 12 ? out.faint(truncate(definition.description, room)) : ''}`,
      );
    }
    write();
  }
  write(`  ${out.faint(`${types.length} effects · gleech effect <id> for parameters`)}\n`);
  return 0;
}

function rangeLabel(entry: ReturnType<typeof paramEntries>[number]): string {
  const d = entry.definition;
  if (d.kind === 'number') return `${formatValue(d, d.min)} … ${formatValue(d, d.max)}`;
  if (d.kind === 'choice') return d.options.map((o) => o.value).join(' | ');
  if (d.kind === 'color') return '#RRGGBB';
  if (d.kind === 'stops') return 'JSON gradient stops';
  return `text ≤ ${d.maxLength}`;
}

async function effect(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { all: { type: 'boolean', short: 'a' } });
  if (values.help || !positionals.length) return help('effect');
  const type = resolveEffectType(positionals.join(' '));
  const definition = EFFECT_DEFINITIONS[type];
  const { createEffect } = await import('@gleech/project-model');
  const entries = paramEntries(createEffect(type, 'preview')).filter(
    (entry) => values.all || !entry.key.startsWith('application.'),
  );
  if (values.json) {
    write(
      JSON.stringify(
        {
          type,
          title: definition.title,
          category: EFFECT_CATEGORY[type],
          description: definition.description,
          hint: definition.hint,
          parameters: Object.fromEntries(entries.map((e) => [e.key, e.definition])),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const width = Math.min(process.stdout.columns ?? 100, 110);
  write(
    `\n  ${out.accent('◆')} ${out.bold(definition.title)} ${out.faint(`${type} · ${EFFECT_CATEGORY[type]}`)}`,
  );
  for (const line of wrapText(`${definition.description} ${definition.hint}`, width - 6))
    write(`    ${out.muted(line)}`);
  let group = '';
  for (const entry of entries) {
    if (entry.group !== group) {
      group = entry.group;
      write(`\n  ${out.accent('▍')}${out.bold(group.toUpperCase())}`);
    }
    write(
      `   ${padEnd(out.text(entry.key), 26)}${padEnd(out.hot(formatValue(entry.definition, entry.value)), 14)}${out.faint(truncate(rangeLabel(entry), width - 44))}`,
    );
  }
  write(
    `\n  ${out.faint('example:')} ${out.muted(`gleech render photo.jpg -e "${type}:amount=60%"`)}${values.all ? '' : out.faint('   (--all adds application/mask keys)')}\n`,
  );
  return 0;
}

async function presets(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {});
  if (values.help) return help('presets');
  const query = positionals.join(' ').toLowerCase();
  const list = (await listPresets()).filter(
    (preset) =>
      !query ||
      preset.name.toLowerCase().includes(query) ||
      (preset.description ?? '').toLowerCase().includes(query),
  );
  if (values.json) {
    write(
      JSON.stringify(
        list.map((p) => ({
          id: p.id,
          name: p.name,
          slug: presetSlug(p),
          origin: p.origin,
          description: p.description,
          layers: p.effects.length,
          effects: p.effects.map((e) => e.type),
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  const width = Math.min(process.stdout.columns ?? 100, 120);
  write();
  let origin = '';
  for (const preset of list) {
    if (preset.origin !== origin) {
      origin = preset.origin;
      write(`  ${out.accent('▍')}${out.bold(origin === 'built-in' ? 'BUILT-IN' : 'YOUR LIBRARY')}`);
    }
    const name = padEnd(out.text(preset.name), 24);
    const slug = padEnd(out.muted(presetSlug(preset)), 24);
    const layers = padEnd(out.faint(`${preset.effects.length}L`), 5);
    write(
      `   ${name}${slug}${layers}${out.faint(truncate(preset.description ?? stackSummary(preset.effects), Math.max(10, width - 58)))}`,
    );
  }
  write(`\n  ${out.faint(`${list.length} presets · gleech render photo.jpg -p <name>`)}\n`);
  return 0;
}

async function inspect(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {});
  if (values.help || !positionals.length) return help('inspect');
  const target = positionals[0]!;
  let name: string;
  let masterSeed: number;
  let stack: readonly EffectInstance[];
  let extra: string;
  if (/\.gleech$/i.test(target)) {
    const { project } = decodeProject(await readFile(resolve(target)));
    name = project.name;
    masterSeed = project.masterSeed;
    stack = project.effects;
    extra = project.source
      ? `${project.source.name} · ${project.source.width}×${project.source.height} · ${project.snapshots.length} snapshots`
      : '';
  } else {
    const preset = await findPreset(target);
    name = preset.name;
    masterSeed = preset.masterSeed;
    stack = preset.effects;
    extra = preset.description ?? '';
  }
  if (values.json) {
    write(
      JSON.stringify(
        {
          name,
          masterSeed,
          effects: [...stack].reverse().map((e) => ({
            instanceId: e.instanceId,
            type: e.type,
            title: effectTitle(e),
            enabled: e.enabled,
            params: e.params,
            application: e.application,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  write(`\n  ${out.accent('◆')} ${out.bold(name)} ${out.faint(`seed ${masterSeed}`)}`);
  if (extra) write(`    ${out.muted(extra)}`);
  write();
  [...stack].reverse().forEach((effect, index) => {
    const changed = paramEntries(effect).filter((entry) => {
      const d = entry.definition;
      return !entry.key.startsWith('application.') && String(entry.value) !== String(d.default);
    });
    const mark = effect.enabled ? out.accent('●') : out.faint('○');
    write(
      `  ${out.faint(String(index + 1).padStart(2))} ${mark} ${out.bold(effectTitle(effect))} ${out.faint(effect.type)}`,
    );
    const pairs = changed
      .slice(0, 8)
      .map((e) => `${out.muted(e.key)} ${out.text(formatValue(e.definition, e.value))}`);
    if (pairs.length)
      write(
        `       ${pairs.join(out.faint('  ·  '))}${changed.length > 8 ? out.faint(`  +${changed.length - 8}`) : ''}`,
      );
  });
  write();
  return 0;
}

async function info(args: string[]): Promise<number> {
  const { values } = parse(args, {});
  if (values.help) return help('info');
  let subject = 'unavailable';
  if (loadSharp() && existsSync(subjectModelPath()))
    subject = await loadOnnx().then(
      () => 'ready',
      (e: Error) => e.message,
    );
  else if (!loadSharp()) subject = 'needs Sharp';
  const gpu =
    renderingSettings().renderer === 'cpu'
      ? { webgpu: false, webgl2: false, reason: 'CPU selected; GPU probe skipped.' }
      : await gpuCapabilities().catch((error) => ({
          webgpu: false,
          webgl2: false,
          reason: String(error),
        }));
  const details = {
    renderer: { mode: renderingSettings().renderer, ...gpu },
    version: APP_VERSION,
    runtime: (process.versions as Record<string, string>)['electron']
      ? `GLEECH runtime (Electron ${process.versions['electron']})`
      : `Node.js ${process.version}`,
    codec: codecName(),
    resources: resourcesDir(),
    presets: (await listPresets().catch(() => [])).length,
    effects: EFFECT_TYPES.length,
    subjectDetection: subject,
    terminal: {
      colors: ['none', '16', '256', 'truecolor'][out.level],
      name: terminalName(),
      preview: protocolFromEnv() ?? 'detected when the TUI starts',
    },
  };
  if (values.json) {
    write(JSON.stringify(details, null, 2));
    return 0;
  }
  write();
  for (const line of glitchWordmark(out, 42)) write(`  ${line}`);
  write();
  const rows: [string, string][] = [
    ['version', details.version],
    [
      'renderer',
      details.renderer.mode +
        ' · WebGPU ' +
        (gpu.webgpu ? 'ready' : 'unavailable') +
        ' · WebGL2 ' +
        (gpu.webgl2 ? 'ready' : 'unavailable'),
    ],
    ['runtime', details.runtime],
    [
      'codec',
      details.codec === 'sharp'
        ? 'Sharp (PNG · JPEG · WebP · TIFF)'
        : 'built-in PNG only — run pnpm install for Sharp',
    ],
    ['effects', `${details.effects} built-in`],
    ['presets', String(details.presets)],
    ['subject', details.subjectDetection],
    ['resources', details.resources],
    [
      'terminal',
      `${details.terminal.name} · ${details.terminal.colors} color · preview ${details.terminal.preview}`,
    ],
  ];
  for (const [key, value] of rows) write(`  ${out.muted(key.padEnd(10))} ${out.text(value)}`);
  write();
  return 0;
}

async function tui(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { ...STACK });
  if (values.help) return help('tui');
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new UsageError('The TUI needs an interactive terminal.');
  const input = positionals[0];
  const session = input
    ? await openInput(input === 'sample' ? input : resolve(input))
    : await Session.sample();
  await applyStackOptions(
    session,
    values,
    await Promise.all(((values.preset as string[] | undefined) ?? []).map(findPreset)),
  );
  session.dirty = false;
  const { runTui } = await import('./tui/app');
  return runTui(session, input === undefined);
}

// ─── help ────────────────────────────────────────────────────────────────

const HELP: Record<
  string,
  { usage: string; summary: string; options?: [string, string][]; examples?: string[] }
> = {
  render: {
    usage: 'gleech render <image|folder|project.gleech|sample>... [options]',
    summary:
      'Render images through presets and effects with the desktop engine, at full resolution.',
    options: [
      [
        '-p, --preset <name|file>',
        'apply a built-in, library or .gleechpreset preset (repeatable)',
      ],
      ['-e, --effect <spec>', 'add an effect on top: type[:key=value,...] (repeatable)'],
      ['    --place <mode>', 'first preset placement: replace | above | below | merge'],
      ['-s, --seed <n>', 'master seed (0–4294967295)'],
      ['-o, --output <file|dir>', 'output file, or folder for several inputs'],
      ['-f, --format <fmt>', 'png | jpeg | webp | tiff (default from extension)'],
      ['    --timeline', 'export one saved timeline: mp4 | gif | png (sequence)'],
      ['    --fps <rate>', 'timeline output rate (GIF: 10, 12, 15, 24 or 30)'],
      ['    --range <range>', 'whole | work | inout (default whole)'],
      ['    --start / --end <s>', 'override timeline range boundaries in seconds'],
      ['    --width <px>', 'timeline output width; preserve source aspect ratio'],
      ['    --no-audio', 'omit timeline audio (PNG sequences are always silent)'],
      ['-q, --quality <1-100>', 'JPEG/WebP quality (default 90)'],
      ['    --max-size <px>', 'render a reduced draft with matching field placement'],
      ['    --save-project <f>', 'also save an editable .gleech project'],
      ['    --save-preset <f>', 'also save the stack as a .gleechpreset'],
      ['    --show', 'preview the result in the terminal'],
      ['-y, --overwrite', 'replace existing files'],
      ['    --json', 'machine-readable result'],
    ],
    examples: [
      'gleech render photo.jpg -p signal-burn',
      'gleech render shots/ -p "liquid glass" -o out/ -f webp -q 85',
      'gleech render photo.png -e "pixel-sort:amount=70%,direction=vertical" -e crt --show',
      'gleech render project.gleech -o final.tiff',
      'gleech render project.gleech --timeline -o movie.mp4',
      'gleech render project.gleech --timeline -f png -o frames/ --range work',
    ],
  },
  gleech: {
    usage: 'gleech gleech [image|project|sample] [options]',
    summary: 'Roll random GLEECH stacks — the app’s GLEECH button, reproducible by seed.',
    options: [
      ['-c, --complexity <c>', 'simple | complex | gleeched (default complex)'],
      [
        '-m, --mode <mode>',
        'replace-all | keep-locked | keep-all-add | randomize-add | existing-only',
      ],
      ['-n, --count <n>', 'variants to roll (1–64), consecutive seeds'],
      ['-s, --seed <n>', 'first seed (default random)'],
      ['    --sheet <file>', 'also write a contact sheet of every variant'],
      ['    --save-preset', 'write a .gleechpreset beside each variant'],
      ['-p, -e', 'start from a preset/effects (with keep/randomize modes)'],
    ],
    examples: [
      'gleech gleech photo.jpg -n 9 --sheet sheet.png -o rolls/',
      'gleech gleech photo.jpg --seed 3735928559 -c gleeched --show',
    ],
  },
  vary: {
    usage: 'gleech vary <image|project> [options]',
    summary: 'Render close, medium and distant variations of a stack (the app’s Var button).',
    options: [
      ['-n, --count <n>', 'variations (1–9, default 9)'],
      ['-i, --intensity <0-1>', 'variation strength (default 0.5)'],
      ['-s, --seed <n>', 'variation seed'],
      ['    --sheet <file>', 'also write a contact sheet'],
    ],
    examples: ['gleech vary photo.jpg -p prism-garden -o vars/ --sheet vars.png'],
  },
  effects: {
    usage: 'gleech effects [search] [-c category]',
    summary: 'Browse the effect catalog.',
    examples: ['gleech effects sort', 'gleech effects -c Shaders'],
  },
  effect: {
    usage: 'gleech effect <id|title> [--all]',
    summary: 'Show an effect’s parameters, units and ranges.',
    examples: ['gleech effect pixel-sort', 'gleech effect "rgb split" --all'],
  },
  presets: {
    usage: 'gleech presets [search]',
    summary: 'List built-in presets and your GLEECH preset library.',
  },
  inspect: {
    usage: 'gleech inspect <project.gleech|preset>',
    summary: 'Show the layer stack of a project or preset.',
  },
  info: {
    usage: 'gleech info',
    summary: 'Show runtime, codec, resources and terminal capabilities.',
  },
  tui: {
    usage: 'gleech tui [image|project.gleech] [-p preset] [-e spec]',
    summary: 'Open the interactive terminal editor.',
    examples: ['gleech tui photo.jpg', 'gleech tui project.gleech'],
  },
};

export function help(command?: string): number {
  if (command === 'update') {
    write(UPDATE_HELP);
    return 0;
  }
  write('  Shaders: --shader <name|local .gleech-shader/.wgsl/.isf> (repeatable)');
  write('  Renderer: --renderer auto|gpu|cpu · --skip-unsupported-shaders (explicit CPU bypass)');
  if (command && HELP[command]) {
    const entry = HELP[command]!;
    write(`\n  ${out.bold(entry.usage)}\n\n  ${out.muted(entry.summary)}`);
    if (entry.options) {
      write(`\n  ${out.accent('▍')}${out.bold('OPTIONS')}`);
      const width = Math.max(...entry.options.map(([flag]) => cellWidth(flag))) + 3;
      for (const [flag, text] of entry.options)
        write(`   ${padEnd(out.hot(flag), width)}${out.muted(text)}`);
    }
    if (entry.examples) {
      write(`\n  ${out.accent('▍')}${out.bold('EXAMPLES')}`);
      for (const example of entry.examples) write(`   ${out.faint('$')} ${out.text(example)}`);
    }
    write();
    return 0;
  }
  write();
  for (const line of glitchWordmark(out)) write(`  ${line}`);
  write(
    `  ${out.muted("It's not broken. It's just a GLEECH.")}  ${out.faint(`v${APP_VERSION}`)}\n`,
  );
  const rows: [string, string][] = [
    ['tui [file]', 'interactive terminal editor with live preview'],
    ['render <inputs>', 'render images or projects through presets/effects'],
    ['gleech [input]', 'roll random GLEECH stacks, reproducible by seed'],
    ['vary <input>', 'render variations of a stack'],
    ['effects [search]', `browse ${EFFECT_TYPES.length} effects`],
    ['effect <id>', 'parameters, units and ranges of one effect'],
    ['presets [search]', 'built-in and library presets'],
    ['inspect <file>', 'layer stack of a project or preset'],
    ['info', 'runtime, codec and terminal capabilities'],
    ['update', 'check, download and install a GLEECH update'],
    ['install-cli', 'install the terminal command on your user PATH'],
    ['uninstall-cli', 'remove the terminal command and its PATH setup'],
  ];
  write(`  ${out.accent('▍')}${out.bold('COMMANDS')}`);
  for (const [cmd, text] of rows) write(`   ${padEnd(out.hot(cmd), 20)}${out.muted(text)}`);
  write(
    `\n  ${out.faint('gleech <command> --help for options ·')} ${out.faint(SUPPORT_LINKS.repository)}\n`,
  );
  return 0;
}

// ─── entry ───────────────────────────────────────────────────────────────

async function shaders(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {});
  if (values.help) {
    write('gleech shaders [search] [--json] · render/tui --shader <name|local file>');
    return 0;
  }
  const query = positionals.join(' ').toLowerCase();
  const shaders = (await listShaders()).filter(
    (pkg) =>
      !query || pkg.name.toLowerCase().includes(query) || pkg.id.toLowerCase().includes(query),
  );
  if (values.json) write(JSON.stringify(shaders, null, 2));
  else
    for (const pkg of shaders)
      write(
        pkg.name +
          ' · ' +
          pkg.language.toUpperCase() +
          ' · by ' +
          pkg.authors.map((a) => a.name).join(', ') +
          ' · ' +
          pkg.license.expression,
      );
  return 0;
}

async function setupCli(args: string[], install: boolean): Promise<number> {
  if (args.includes('--help')) {
    write(
      'gleech ' +
        (install ? 'install-cli' : 'uninstall-cli') +
        ' · configure the terminal command for this user',
    );
    return 0;
  }
  if (args.length) throw new UsageError('This command accepts no arguments.');
  for (const message of await installCli(install)) write(message);
  return 0;
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  update: runUpdateCommand,
  'install-cli': (args) => setupCli(args, true),
  'uninstall-cli': (args) => setupCli(args, false),
  render,
  gleech,
  vary,
  effects,
  effect,
  presets,
  shaders,
  inspect,
  info,
  tui,
};

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const notification = shouldNotifyCli(argv, {
    stdout: !!process.stdout.isTTY,
    stderr: !!process.stderr.isTTY,
    env: process.env,
  })
    ? notifyCliUpdate()
    : null;
  if (
    !command ||
    command === 'update' ||
    command === 'tui' ||
    command === 'sample' ||
    !Object.hasOwn(COMMANDS, command)
  )
    restoreWindowsConsoleInput();
  try {
    if (!command) {
      if (process.stdin.isTTY && process.stdout.isTTY) return await tui([]);
      return help();
    }
    if (command === '--help' || command === '-h' || command === 'help') return help(rest[0]);
    if (command === '--version' || command === '-v') {
      write(APP_VERSION);
      return 0;
    }
    const run = COMMANDS[command];
    if (run) return await run(rest);
    // `gleech photo.jpg` opens the editor; anything else is a typo.
    if (existsSync(command) || command === 'sample') return await tui(argv);
    throw new UsageError(`Unknown command “${command}”. Run gleech --help.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n  ${err.red('✕')} ${message}\n\n`);
    if (process.env['GLEECH_DEBUG'] && error instanceof Error)
      process.stderr.write(`${error.stack}\n`);
    return error instanceof UsageError ? 2 : 1;
  } finally {
    await closeGpu();
    await notification;
  }
}
