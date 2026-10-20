import { z } from 'zod';
import { SEMANTIC_CONTROLS } from './semantic-definitions';

const id = z.string().min(1).max(1024);
const seed = z.number().int().min(0).max(0xffffffff);
const expectedRevision = z.number().int().min(0).optional();
const path = z.string().min(1).max(4096);
const placement = z.enum(['replace', 'above', 'below', 'merge']);
const presetName = z.string().trim().min(1).max(120);
// Base64 expands 6 MiB to 8 MiB, leaving room in the 10 MiB local request envelope.
export const MAX_MCP_IMAGE_BYTES = 6 * 1024 * 1024;
export const imagePayloadSchema = z
  .object({
    data: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_MCP_IMAGE_BYTES / 3))
      .refine(
        (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
        'Supply canonical padded base64 image data, without a data URL prefix.',
      ),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (value) =>
          !/[\\/]/.test(value) &&
          !['.', '..'].includes(value) &&
          [...value].every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        'Use a display name without a path or control characters.',
      )
      .default('MCP image'),
  })
  .strict();
export type McpImagePayload = z.infer<typeof imagePayloadSchema>;
export const maskStrokeSchema = z
  .object({
    size: z.number().min(0.1).max(100),
    shape: z.enum(['circle', 'square', 'diamond']),
    hardness: z.number().min(0).max(1),
    falloff: z.enum(['linear', 'smooth', 'gaussian']),
    mode: z.enum(['paint', 'erase']),
    opacity: z.number().min(0).max(1).optional(),
    points: z
      .array(z.object({ x: z.number().finite(), y: z.number().finite() }).strict())
      .min(1)
      .max(65536),
  })
  .strict();
export const maskSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    inverted: z.boolean(),
    width: z.number().int().min(1).max(32768),
    height: z.number().int().min(1).max(32768),
    base: z.union([z.literal(0), z.literal(1)]),
    strokes: z.array(maskStrokeSchema).max(2048),
    paths: z.array(z.unknown()).max(2048).optional(),
    frame: z.unknown().optional(),
    pattern: z.unknown().optional(),
  })
  .strict();
export const semanticControlsSchema = z
  .partialRecord(
    z.enum(
      Object.keys(SEMANTIC_CONTROLS) as [
        keyof typeof SEMANTIC_CONTROLS,
        ...(keyof typeof SEMANTIC_CONTROLS)[],
      ],
    ),
    z.number().min(0).max(1),
  )
  .refine((controls) => Object.keys(controls).length > 0, 'Choose at least one semantic control');
export const recipeSchema = z
  .object({ masterSeed: seed, effects: z.array(z.unknown()).min(1).max(1000) })
  .strict();
const randomization = {
  complexity: z.enum(['simple', 'complex', 'gleeched']),
  mode: z.enum(['replace-all', 'keep-locked', 'keep-all-add', 'randomize-add', 'existing-only']),
  seed,
};
const exportOptions = {
  format: z.enum(['png', 'jpeg', 'webp', 'tiff']).default('png'),
  quality: z.number().int().min(1).max(100).optional(),
  overwrite: z.boolean().default(false),
};
const batchFields = {
  items: z
    .array(z.object({ inputPath: path, outputPath: path }).strict())
    .min(1)
    .max(32),
  presetId: id.optional(),
  ...exportOptions,
  continueOnError: z.boolean().default(false),
  expectedRevision,
};
const parameterKey = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (key) => !['__proto__', 'constructor', 'prototype'].includes(key),
    'Invalid parameter key',
  );
export const parameterValues = z
  .record(parameterKey, z.union([z.number().finite(), z.string().max(8192)]))
  .refine((values) => Object.keys(values).length > 0, 'At least one parameter is required');

// ---------------------------------------------------------------------------
// Timeline. Times are seconds from the timeline start; the adapter snaps them
// to frames. Enumerations mirror @gleech/project-model's timeline constants
// (tests keep them in sync) so this module stays light for the stdio server.

export const MAX_TIMELINE_SECONDS = 3600;
const seconds = z.number().finite().min(0).max(MAX_TIMELINE_SECONDS);
export const timeRangeSchema = z
  .object({ start: seconds, end: seconds })
  .strict()
  .refine((range) => range.end > range.start, 'The range end must be after its start.');
export const KEY_INTERPOLATIONS = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'bezier',
] as const;
export const LFO_SHAPE_VALUES = ['sine', 'triangle', 'square', 'saw', 'random'] as const;
export const LFO_DIVISION_VALUES = ['4', '2', '1', '1/2', '1/4', '1/8', '1/16'] as const;
export const AUDIO_BAND_VALUES = ['low', 'mid', 'high', 'custom'] as const;
export const keyframeSchema = z
  .object({
    time: seconds,
    value: z.union([z.number().finite(), z.string().max(64)]),
    interpolation: z.enum(KEY_INTERPOLATIONS).default('ease-in-out'),
    /** Bezier handle into this key: seconds before it (dt ≤ 0) and a fraction of the range. */
    inHandle: z
      .object({
        dt: z.number().min(-MAX_TIMELINE_SECONDS).max(0),
        dv: z.number().min(-100).max(100),
      })
      .strict()
      .optional(),
    /** Bezier handle out of this key: seconds after it (dt ≥ 0) and a fraction of the range. */
    outHandle: z
      .object({
        dt: z.number().min(0).max(MAX_TIMELINE_SECONDS),
        dv: z.number().min(-100).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
const modulatorId = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (key) => !['__proto__', 'constructor', 'prototype'].includes(key),
    'Invalid modulator id',
  );
export const modulatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('lfo'),
      id: modulatorId.optional(),
      enabled: z.boolean().default(true),
      shape: z.enum(LFO_SHAPE_VALUES).default('sine'),
      sync: z.boolean().default(true),
      division: z.enum(LFO_DIVISION_VALUES).default('1/2'),
      rate: z.number().min(0.01).max(60).default(1),
      depth: z.number().min(0).max(1).default(0.12),
      phase: z.number().min(0).max(360).default(90),
      combine: z.enum(['add', 'multiply']).default('add'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio'),
      id: modulatorId.optional(),
      enabled: z.boolean().default(true),
      band: z.enum(AUDIO_BAND_VALUES).default('low'),
      lowHz: z.number().min(10).max(24000).default(40),
      highHz: z.number().min(10).max(24000).default(160),
      attackMs: z.number().min(0).max(5000).default(8),
      releaseMs: z.number().min(0).max(10000).default(180),
      outMin: z.number().min(0).max(1).default(0.4),
      outMax: z.number().min(0).max(1).default(1),
      combine: z.enum(['replace', 'add', 'multiply']).default('replace'),
    })
    .strict()
    .refine((value) => value.highHz > value.lowHz, {
      message: 'highHz must be above lowHz.',
      path: ['highHz'],
    })
    .refine((value) => value.outMax >= value.outMin, {
      message: 'outMax must be at least outMin.',
      path: ['outMax'],
    }),
]);
export type McpModulator = z.infer<typeof modulatorSchema>;

// ---------------------------------------------------------------------------
// Render settings overrides. These mirror apps/desktop/src/shared/render.ts
// (the renderer type-checks the correspondence). Upscaling through a custom
// command or another MCP server is deliberately not offered to MCP clients.

export const VIDEO_PRESET_IDS = [
  '8k',
  '4k',
  '2k-master',
  '1080p-social',
  'vertical',
  'draft',
  'edit-master',
  '4k-edit-master',
  'custom',
] as const;
export const GIF_PRESET_IDS = ['social', 'hq', 'tiny', 'sticker', 'crunchy', 'custom'] as const;
export const VIDEO_FORMAT_IDS = [
  'mp4-h264',
  'mp4-hevc',
  'mov-prores',
  'mkv-ffv1',
  'mov-v210',
  'webm-vp9',
  'mov-png',
] as const;
export const MCP_UPSCALE_ENGINES = [
  'lanczos',
  'nearest',
  'realesrgan',
  'realcugan',
  'waifu2x',
] as const;
function settingsGroup<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape).partial();
}
const unit = z.number().min(0).max(1);
export const videoOverridesSchema = settingsGroup({
  output: z.enum(['movie', 'sequence']),
  format: z.enum(VIDEO_FORMAT_IDS),
  fps: z.number().min(1).max(240),
  compression: z.enum(['highest', 'high', 'web', 'small', 'lossless', 'raw']),
  advanced: settingsGroup({
    encoder: z.enum(['auto', 'cpu', 'nvenc', 'amf', 'qsv', 'mf', 'videotoolbox']),
    colorDepth: z.union([z.literal(8), z.literal(10)]),
    keyframeInterval: z.number().int().min(0).max(10000),
    speed: z.enum(['fast', 'medium', 'slow']),
    fastStart: z.boolean(),
  }),
  frame: settingsGroup({
    width: z.number().int().min(2).max(16384),
    height: z.number().int().min(2).max(16384),
    fit: z.enum(['fit', 'stretch', 'crop', 'letterbox-h', 'letterbox-v']),
    anchor: z.enum(['center', 'top', 'subject']),
    bars: z.enum(['black', 'blur', 'color', 'transparent']),
    barColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color.'),
    barBlur: unit,
    barDarken: unit,
  }),
  overlay: settingsGroup({
    enabled: z.boolean(),
    matte: z.enum(['difference', 'added-light']),
    threshold: unit,
    softness: unit,
    alpha: z.enum(['straight', 'premultiplied']),
  }),
  audio: settingsGroup({
    enabled: z.boolean(),
    source: z.enum(['track', 'clip', 'mix']),
    codec: z.enum(['aac', 'pcm', 'opus']),
    bitrateKbps: z.number().int().min(0).max(1536),
    normalize: z.boolean(),
    fadeIn: z.number().min(0).max(MAX_TIMELINE_SECONDS),
    fadeOut: z.number().min(0).max(MAX_TIMELINE_SECONDS),
  }),
  sequence: settingsGroup({
    kind: z.enum(['files', 'flipbook']),
    every: z.enum(['all', '2', 'keys', 'markers']),
    depth: z.union([z.literal(8), z.literal(16)]),
    separateAudio: z.boolean(),
    flipbook: settingsGroup({
      kind: z.enum(['pdf', 'sprite']),
      paper: z.enum(['letter', 'a4', '4x6']),
      perPage: z.union([z.literal(4), z.literal(8), z.literal(12)]),
      bindingMargin: z.number().min(0).max(3),
      cutLines: z.boolean(),
      frameNumbers: z.boolean(),
      cover: z.boolean(),
      columns: z.union([z.literal('auto'), z.literal(10), z.literal(16), z.literal('row')]),
      json: z.boolean(),
    }),
  }),
  upscale: settingsGroup({
    method: z.enum(['native', 'upscale-result', 'upscale-source']),
    engine: z.enum(MCP_UPSCALE_ENGINES),
    model: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'Use a model name such as realesr-animevideov3.'),
    mix: unit,
  }),
});
export const gifOverridesSchema = settingsGroup({
  format: z.enum(['gif', 'webp', 'apng', 'mp4']),
  loop: z.enum(['forward', 'reverse', 'boomerang', 'concat']),
  segments: z.array(timeRangeSchema).max(64),
  speed: z.number().min(0.25).max(4),
  fps: z.union([z.literal(10), z.literal(12), z.literal(15), z.literal(24), z.literal(30)]),
  smoothing: z.enum(['off', 'blend', 'motion']),
  repeat: z.enum(['forever', 'once', '3']),
  width: z.number().int().min(16).max(4096),
  scaling: z.enum(['lanczos', 'bicubic', 'nearest']),
  sizeLimitMb: z.union([z.literal(0), z.literal(1), z.literal(8), z.literal(15)]),
  colors: z.number().int().min(2).max(256),
  palette: z.enum(['whole', 'frame', 'changes']),
  dither: z.enum(['none', 'bayer', 'floyd-steinberg', 'sierra']),
  lossy: z.number().min(0).max(100),
  transparent: z.boolean(),
  audio: z.boolean(),
});
export type McpVideoOverrides = z.infer<typeof videoOverridesSchema>;
export type McpGifOverrides = z.infer<typeof gifOverridesSchema>;
function overrideIssues(
  tab: 'video' | 'gif',
  overrides: unknown,
): { path: (string | number)[]; message: string }[] {
  const parsed = (tab === 'video' ? videoOverridesSchema : gifOverridesSchema).safeParse(overrides);
  if (parsed.success) return [];
  const scope = tab === 'video' ? 'Video' : 'GIF & Loops';
  return parsed.error.issues.map((issue) => {
    const path = ['overrides', ...issue.path.map((part) => String(part))];
    if (issue.code === 'unrecognized_keys')
      return {
        path,
        message: `Unknown ${scope} render setting${issue.keys.length > 1 ? 's' : ''}: ${issue.keys
          .map((key) => [...path, key].join('.'))
          .join(
            ', ',
          )}. Use list_render_presets to see every setting with its current value; command and MCP upscalers and sequence subfolders are not available through MCP.`,
      };
    return { path, message: `${path.join('.')}: ${issue.message}` };
  });
}
/** Settings for render_video after validation (`overrides` were checked against its tab). */
export function renderOverrides(request: {
  tab: 'video' | 'gif';
  overrides: Record<string, unknown>;
}): { tab: 'video'; overrides: McpVideoOverrides } | { tab: 'gif'; overrides: McpGifOverrides } {
  return request.tab === 'video'
    ? { tab: 'video', overrides: videoOverridesSchema.parse(request.overrides) }
    : { tab: 'gif', overrides: gifOverridesSchema.parse(request.overrides) };
}
/**
 * Whether render_video writes a folder of PNG files (path is then a folder).
 * Presets never choose a sequence, so this follows the overrides alone.
 */
export function renderOutputIsFolder(request: {
  tab: 'video' | 'gif';
  overrides: Record<string, unknown>;
}): boolean {
  const settings = renderOverrides(request);
  if (settings.tab !== 'video') return false;
  const { output, sequence } = settings.overrides;
  const kind = sequence?.kind ?? 'files';
  return (output ?? (sequence?.kind ? 'sequence' : 'movie')) === 'sequence' && kind === 'files';
}
export const operationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create_mask'),
      instanceId: id,
      base: z.union([z.literal(0), z.literal(1)]).default(0),
      strokes: z.array(maskStrokeSchema).max(2048).default([]),
    })
    .strict(),
  z
    .object({ action: z.literal('set_effect_mask'), instanceId: id, mask: maskSchema.nullable() })
    .strict(),
  z
    .object({ action: z.literal('set_mask_enabled'), instanceId: id, enabled: z.boolean() })
    .strict(),
  z.object({ action: z.literal('invert_mask'), instanceId: id }).strict(),
  z
    .object({ action: z.literal('set_semantic_controls'), controls: semanticControlsSchema })
    .strict(),
  z
    .object({
      action: z.literal('apply_preset'),
      presetId: id,
      placement,
      instanceIds: z.array(z.string().uuid()).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('apply_style_recipe'),
      recipe: recipeSchema,
      placement,
      instanceIds: z.array(z.string().uuid()).max(1000).optional(),
    })
    .strict(),
  z.object({ action: z.literal('randomize'), ...randomization }).strict(),
  z.object({ action: z.literal('clear_effect_stack') }).strict(),
  z
    .object({
      action: z.literal('add_effect'),
      type: z.string().min(1).max(128),
      instanceId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ action: z.literal('remove_effect'), instanceId: id }).strict(),
  z
    .object({ action: z.literal('move_effect'), instanceId: id, index: z.number().int().min(0) })
    .strict(),
  z
    .object({ action: z.literal('set_parameters'), instanceId: id, parameters: parameterValues })
    .strict(),
  z.object({ action: z.literal('set_enabled'), instanceId: id, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('set_locked'), instanceId: id, locked: z.boolean() }).strict(),
  z.object({ action: z.literal('randomize_effect'), instanceId: id }).strict(),
  z
    .object({
      action: z.literal('duplicate_effect'),
      instanceId: id,
      newId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ action: z.literal('set_master_seed'), seed }).strict(),
  z
    .object({
      action: z.literal('set_timeline'),
      fps: z.number().min(1).max(120).optional(),
      duration: z.number().gt(0).max(MAX_TIMELINE_SECONDS).optional(),
      loop: z.boolean().optional(),
      workArea: timeRangeSchema.nullable().optional(),
      inOut: timeRangeSchema.nullable().optional(),
      seed: z
        .object({
          mode: z.enum(['fixed', 'every-frame', 'every-n']),
          every: z.number().int().min(1).max(1000).optional(),
        })
        .strict()
        .optional(),
      bpm: z.number().min(20).max(400).nullable().optional(),
      audioVolume: z.number().min(0).max(1).optional(),
      audioMuted: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_keyframes'),
      instanceId: id,
      parameter: parameterKey,
      keys: z.array(keyframeSchema).min(1).max(4096).nullable(),
      merge: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_modulators'),
      instanceId: id,
      parameter: parameterKey,
      modulators: z.array(modulatorSchema).max(8),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_active_range'),
      instanceId: id,
      range: timeRangeSchema.nullable(),
    })
    .strict(),
]);
export const requestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('render_full'),
      path,
      overwrite: z.boolean().default(false),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      action: z.literal('compare_versions'),
      against: z.enum(['source', 'origin', 'snapshot']).default('source'),
      snapshotId: id.optional(),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('export_batch'), ...batchFields }).strict(),
  z.object({ action: z.literal('batch'), ...batchFields }).strict(),
  z.object({ action: z.literal('list_masks') }).strict(),
  z.object({ action: z.literal('get_effect_mask'), instanceId: id }).strict(),
  z
    .object({
      action: z.literal('analyze_image'),
      includeSubject: z.boolean().default(false),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('list_semantic_controls') }).strict(),
  z.object({ action: z.literal('list_presets') }).strict(),
  z.object({ action: z.literal('get_style_recipe'), presetId: id.optional() }).strict(),
  z
    .object({
      action: z.literal('save_preset'),
      name: presetName,
      thumbnail: z.enum(['image', 'statue']).default('statue'),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('duplicate_preset'), presetId: id, name: presetName }).strict(),
  z.object({ action: z.literal('import_preset'), path }).strict(),
  z
    .object({
      action: z.literal('export_preset'),
      presetId: id,
      path,
      overwrite: z.boolean().default(false),
    })
    .strict(),
  z.object({ action: z.literal('get_seed') }).strict(),
  z
    .object({
      action: z.literal('create_variation'),
      seed,
      intensity: z.number().min(0).max(1).default(0.5),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('render_variation'), variationId: id, expectedRevision }).strict(),
  z.object({ action: z.literal('apply_variation'), variationId: id, expectedRevision }).strict(),
  z.object({ action: z.literal('get_mcp_status') }).strict(),
  z
    .object({
      action: z.literal('request_folder_access'),
      kind: z.enum(['imports', 'projects', 'exports']),
    })
    .strict(),
  z.object({ action: z.literal('revoke_folder_access'), folderId: id }).strict(),
  z.object({ action: z.literal('list_snapshots') }).strict(),
  z.object({ action: z.literal('get_snapshot'), snapshotId: id }).strict(),
  z
    .object({
      action: z.literal('create_snapshot'),
      name: z.string().trim().min(1).max(120),
      bake: z.boolean().default(false),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      action: z.literal('restore_snapshot'),
      snapshotId: id,
      mode: z.enum(['recipe', 'source']).default('recipe'),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      action: z.literal('bake_as_new_source'),
      snapshotId: id.optional(),
      name: z.string().trim().min(1).max(120).default('MCP Bake'),
      expectedRevision,
    })
    .strict(),
  z
    .object({ action: z.literal('branch_from_snapshot'), snapshotId: id, expectedRevision })
    .strict(),
  z
    .object({
      action: z.literal('rename_snapshot'),
      snapshotId: id,
      name: z.string().trim().min(1).max(120),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('get_source_info') }).strict(),
  z
    .object({
      action: z.literal('create_project'),
      name: z.string().trim().min(1).max(120).default('Untitled'),
      seed: seed.default(8172),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('load_image'), path, expectedRevision }).strict(),
  z
    .object({ action: z.literal('load_image_data'), ...imagePayloadSchema.shape, expectedRevision })
    .strict(),
  z.object({ action: z.literal('replace_source'), path, expectedRevision }).strict(),
  z.object({ action: z.literal('open_project'), path, expectedRevision }).strict(),
  z
    .object({
      action: z.literal('save_project'),
      path,
      overwrite: z.boolean().default(false),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      action: z.literal('export_image'),
      path,
      format: z.enum(['png', 'jpeg', 'webp', 'tiff']).default('png'),
      quality: z.number().int().min(1).max(100).optional(),
      overwrite: z.boolean().default(false),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('get_project_state') }).strict(),
  z.object({ action: z.literal('copy_to_clipboard'), expectedRevision }).strict(),
  z.object({ action: z.literal('list_operations') }).strict(),
  z
    .object({
      action: z.literal('revert_to_operation'),
      operationId: z.string().uuid(),
      point: z.enum(['before', 'after']).default('before'),
      expectedRevision,
    })
    .strict(),
  z.object({ action: z.literal('list_effects') }).strict(),
  z
    .object({ action: z.literal('list_effect_types'), type: z.string().max(128).optional() })
    .strict(),
  z.object({ action: z.literal('get_effect_parameters'), instanceId: id }).strict(),
  z
    .object({
      action: z.literal('apply_operations'),
      operations: z.array(operationSchema).min(1).max(64),
      expectedRevision: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('undo'), expectedRevision: z.number().int().min(0).optional() })
    .strict(),
  z
    .object({ action: z.literal('redo'), expectedRevision: z.number().int().min(0).optional() })
    .strict(),
  z
    .object({
      action: z.literal('render_preview'),
      expectedRevision: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ action: z.literal('get_timeline') }).strict(),
  z
    .object({
      action: z.literal('set_playhead'),
      frame: z.number().int().min(0).max(1_000_000).optional(),
      time: seconds.optional(),
    })
    .strict()
    .refine(
      (request) => (request.frame === undefined) !== (request.time === undefined),
      'Pass either frame or time (seconds), not both.',
    ),
  z.object({ action: z.literal('list_render_presets') }).strict(),
  z
    .object({
      action: z.literal('render_video'),
      tab: z.enum(['video', 'gif']).default('video'),
      preset: z.string().min(1).max(64).optional(),
      overrides: z.record(z.string().max(64), z.unknown()).default({}),
      range: z.union([z.enum(['work', 'whole', 'inout']), timeRangeSchema]).optional(),
      path,
      overwrite: z.boolean().default(false),
      wait: z.boolean().default(false),
      expectedRevision,
    })
    .strict()
    .superRefine((request, context) => {
      const presets: readonly string[] =
        request.tab === 'video' ? VIDEO_PRESET_IDS : GIF_PRESET_IDS;
      if (request.preset !== undefined && !presets.includes(request.preset))
        context.addIssue({
          code: 'custom',
          path: ['preset'],
          message: `Unknown ${request.tab === 'video' ? 'Video' : 'GIF & Loops'} preset "${request.preset}". Choose one of: ${presets.join(', ')}.`,
        });
      for (const issue of overrideIssues(request.tab, request.overrides))
        context.addIssue({ code: 'custom', ...issue });
    }),
  z
    .object({
      action: z.literal('render_status'),
      jobId: z.string().uuid().optional(),
      cancel: z.boolean().default(false),
    })
    .strict()
    .refine((request) => !request.cancel || request.jobId !== undefined, {
      message: 'Pass the jobId of the render to cancel.',
      path: ['jobId'],
    }),
]);
export type McpRequest = z.infer<typeof requestSchema>;
export type McpOperation = z.infer<typeof operationSchema>;
export type McpMode = 'off' | 'observe' | 'edit' | 'full';
export interface McpStatus {
  mode: McpMode;
  clients: readonly string[];
  recent: readonly string[];
  error: string | null;
  operation: { action: string; client: string } | null;
  folders: readonly { id: string; kind: 'imports' | 'projects' | 'exports'; path: string }[];
  clipboardAllowed: boolean;
  pendingRequests: number;
}
export type McpReply = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };
export interface McpDispatch {
  id: string;
  request: McpRequest;
  deadline: number;
}
export const INITIAL_MCP_STATUS: McpStatus = {
  mode: 'off',
  clients: [],
  recent: [],
  error: null,
  operation: null,
  folders: [],
  clipboardAllowed: false,
  pendingRequests: 0,
};
export function requiresFullControl(request: McpRequest): boolean {
  return (
    [
      'request_folder_access',
      'revoke_folder_access',
      'load_image',
      'replace_source',
      'open_project',
      'save_project',
      'export_image',
      'import_preset',
      'export_preset',
      'render_full',
      'export_batch',
      'batch',
      'render_video',
    ].includes(request.action) ||
    (request.action === 'render_status' && request.cancel)
  );
}
export function isMutation(request: McpRequest): boolean {
  return (
    requiresFullControl(request) ||
    [
      'load_image_data',
      'create_project',
      'create_snapshot',
      'restore_snapshot',
      'bake_as_new_source',
      'branch_from_snapshot',
      'rename_snapshot',
      'apply_operations',
      'save_preset',
      'duplicate_preset',
      'apply_variation',
      'undo',
      'redo',
      'copy_to_clipboard',
      'revert_to_operation',
      'set_playhead',
    ].includes(request.action)
  );
}
