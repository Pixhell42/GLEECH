import { APP_IS_BETA } from './branding';
import { getEffectDefinition, type ProjectState } from '@gleech/project-model';

export type FeedbackKind = 'bug' | 'feature';
export interface FeedbackDraft {
  requestId: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  context: string;
  expected: string;
  stack?: FeedbackStack;
}
export interface FeedbackStack {
  seed: number;
  effects: readonly {
    type: string;
    name: string;
    enabled: boolean;
    locked: boolean;
    seedOffset: number;
    params: Readonly<Record<string, number | string>>;
    application: {
      region: string;
      coverage: number;
      softness: number;
      settings?: Readonly<Record<string, number | string>>;
      depthField?: Readonly<Record<string, number | string>>;
    };
    paintedMask: boolean;
  }[];
}

// Explicit whitelist: image bytes, shader source, font atlases, paths and
// painted strokes never enter an issue. This is diagnostic settings, not a project.
export function feedbackStack(project: ProjectState): FeedbackStack {
  return {
    seed: project.masterSeed,
    effects: project.effects.map((effect) => ({
      type: effect.type,
      name: getEffectDefinition(effect).title,
      enabled: effect.enabled,
      locked: Boolean(effect.locked),
      seedOffset: effect.seedOffset,
      params: effect.params,
      application: {
        region: effect.application.region,
        coverage: effect.application.coverage,
        softness: effect.application.softness,
        settings: Object.fromEntries(
          Object.entries(effect.application).filter(
            ([key, value]) =>
              !['region', 'coverage', 'softness'].includes(key) &&
              ['string', 'number'].includes(typeof value),
          ),
        ),
        ...(effect.application.depthField ? { depthField: effect.application.depthField } : {}),
      },
      paintedMask: Boolean(effect.paintedMask),
    })),
  };
}

function validateStack(value: unknown): FeedbackStack {
  if (!value || typeof value !== 'object') throw new Error('Invalid stack attachment.');
  const stack = value as Record<string, unknown>;
  const seed = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid stack seed.');
    return value;
  };
  const text = (value: unknown, limit = 200) => {
    if (typeof value !== 'string' || value.length > limit || /[\0\r\n]/.test(value))
      throw new Error('Invalid stack setting.');
    return value;
  };
  const fraction = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      throw new Error('Invalid application setting.');
    return value;
  };
  if (!Array.isArray(stack.effects) || stack.effects.length > 100)
    throw new Error('Stack attachments support up to 100 effects.');
  const effects = stack.effects.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid attached effect.');
    const effect = raw as Record<string, unknown>;
    const application = effect.application as Record<string, unknown> | undefined;
    if (
      !application ||
      !effect.params ||
      typeof effect.params !== 'object' ||
      Array.isArray(effect.params)
    )
      throw new Error('Invalid attached effect settings.');
    const record = (value: unknown): Readonly<Record<string, number | string>> => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid attached settings.');
      const entries = Object.entries(value);
      if (entries.length > 200) throw new Error('Too many attached effect settings.');
      return Object.fromEntries(
        entries.map(([key, value]) => {
          text(key);
          if (typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'string')
            throw new Error('Invalid stack parameter.');
          if (typeof value === 'string') text(value, 2000);
          return [key, value as number | string];
        }),
      );
    };
    const params = record(effect.params);
    if (['enabled', 'locked', 'paintedMask'].some((key) => typeof effect[key] !== 'boolean'))
      throw new Error('Invalid attached effect flags.');
    return {
      type: text(effect.type),
      name: text(effect.name),
      enabled: effect.enabled as boolean,
      locked: effect.locked as boolean,
      paintedMask: effect.paintedMask as boolean,
      seedOffset: seed(effect.seedOffset),
      params,
      application: {
        region: text(application.region),
        coverage: fraction(application.coverage),
        softness: fraction(application.softness),
        ...(application.settings ? { settings: record(application.settings) } : {}),
        ...(application.depthField ? { depthField: record(application.depthField) } : {}),
      },
    };
  });
  const result = { seed: seed(stack.seed), effects };
  if (JSON.stringify(result, null, 2).length > 30000)
    throw new Error('Stack attachment is too large.');
  return result;
}
export interface FeedbackEnvironment {
  version: string;
  platform: string;
  electron: string;
  chromium: string;
}
export interface FeedbackStatus {
  configured: boolean;
  login: string | null;
}
export interface FeedbackSignIn {
  userCode: string;
  expiresAt: number;
  retryAfterMs: number;
}
export type FeedbackSignInProgress =
  { state: 'pending'; retryAfterMs: number } | { state: 'connected'; login: string };
export interface FeedbackReceipt {
  number: number;
}

export function validateFeedback(value: unknown): FeedbackDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid feedback form.');
  const data = value as Record<string, unknown>;
  if (data.kind !== 'bug' && data.kind !== 'feature') throw new Error('Choose a report type.');
  if (
    typeof data.requestId !== 'string' ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.requestId)
  )
    throw new Error('Invalid feedback request ID.');
  const field = (name: string, max: number, required = false) => {
    const raw = data[name];
    if (typeof raw !== 'string' || raw.length > max || raw.includes('\0'))
      throw new Error(`Invalid feedback ${name}.`);
    const result = raw.trim();
    if (required && !result) throw new Error(`Enter a ${name} for your report.`);
    return result;
  };
  return {
    requestId: data.requestId,
    kind: data.kind,
    title: field('title', 200, true),
    description: field('description', 10000, true),
    context: field('context', 6000),
    expected: field('expected', 6000),
    ...(data.stack !== undefined ? { stack: validateStack(data.stack) } : {}),
  };
}

export function feedbackIssue(
  value: unknown,
  environment: FeedbackEnvironment,
): { title: string; body: string } {
  const draft = validateFeedback(value);
  const bug = draft.kind === 'bug';
  return {
    title: `${bug ? '[Bug]' : '[Feature]'} ${draft.title}`,
    body: [
      `### ${bug ? 'What happened?' : 'Feature description'}\n\n${draft.description}`,
      ...(draft.context
        ? [`### ${bug ? 'Steps to reproduce' : 'Problem or use case'}\n\n${draft.context}`]
        : []),
      ...(draft.expected
        ? [`### ${bug ? 'Expected behavior' : 'Suggested behavior'}\n\n${draft.expected}`]
        : []),
      ...(draft.stack
        ? [
            `### Effect stack and seed\n\nSettings only; image assets, shader code and painted strokes omitted.\n\n<details><summary>Stack settings (render order)</summary>\n\n\u0060\u0060\u0060json\n${JSON.stringify(draft.stack, null, 2).replaceAll('`', '\\u0060').replaceAll('<', '\\u003c')}\n\u0060\u0060\u0060\n\n</details>`,
          ]
        : []),
      `### Environment\n\nGLEECH ${environment.version}${APP_IS_BETA ? ' (beta)' : ''}\nOS: ${environment.platform}\nElectron: ${environment.electron}\nChromium: ${environment.chromium}`,
      `<!-- gleech-feedback:${draft.requestId} -->`,
    ].join('\n\n'),
  };
}
