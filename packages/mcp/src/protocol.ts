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
export const parameterValues = z
  .record(
    z
      .string()
      .min(1)
      .max(128)
      .refine(
        (key) => !['__proto__', 'constructor', 'prototype'].includes(key),
        'Invalid parameter key',
      ),
    z.union([z.number().finite(), z.string().max(8192)]),
  )
  .refine((values) => Object.keys(values).length > 0, 'At least one parameter is required');
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
  return [
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
  ].includes(request.action);
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
    ].includes(request.action)
  );
}
