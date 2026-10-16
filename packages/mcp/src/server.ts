import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import mcpPackage from '../package.json';
import {
  requestSchema,
  operationSchema,
  parameterValues,
  recipeSchema,
  semanticControlsSchema,
  maskStrokeSchema,
  maskSchema,
  type McpRequest,
} from './protocol';

export function createGleechMcpServer(
  call: (request: McpRequest, signal?: AbortSignal) => Promise<Record<string, unknown>>,
) {
  const server = new McpServer(
    { name: 'GLEECH', version: mcpPackage.version },
    {
      instructions:
        'Control the open GLEECH desktop project. Enable MCP in the app first. Observe mode allows inspection and previews; Edit mode enables reversible project/stack edits. Full Control also permits file I/O inside folders approved in the app. Read get_project_state and pass expectedRevision when editing or rendering. Stack indexes follow the visible top-to-bottom order, with index 0 at the top. Use instanceId, never titles, to target layers. All values use the exact units and limits returned by get_effect_parameters. Locked layers must be explicitly unlocked before changing them. File paths must be absolute; matching folder grants are required. Exports and project saves default to refusing existing destinations unless overwrite is explicitly true.',
    },
  );
  function register(
    name: string,
    description: string,
    schema: z.ZodRawShape,
    make: (args: Record<string, unknown>) => unknown,
    mutation = false,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !mutation,
          destructiveHint: [
            'save_project',
            'export_image',
            'export_preset',
            'render_full',
            'export_batch',
            'batch',
            'request_folder_access',
          ].includes(name),
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        try {
          const value = await call(requestSchema.parse(make(args)), extra.signal);
          const { png, images, ...metadata } = value;
          const encoded = JSON.stringify(metadata);
          const text =
            new TextEncoder().encode(encoded).byteLength > 2 * 1024 * 1024
              ? JSON.stringify({
                  message: 'Large result is available in structuredContent.',
                  keys: Object.keys(metadata),
                })
              : encoded;
          const comparisons = Array.isArray(images)
            ? images.filter((item): item is { name: string; png: string } =>
                Boolean(
                  item &&
                  typeof item === 'object' &&
                  'png' in item &&
                  typeof item.png === 'string' &&
                  'name' in item &&
                  typeof item.name === 'string',
                ),
              )
            : [];
          return {
            content: [
              { type: 'text' as const, text },
              ...(typeof png === 'string'
                ? [{ type: 'image' as const, mimeType: 'image/png', data: png }]
                : []),
              ...comparisons.flatMap((item) => [
                { type: 'text' as const, text: item.name },
                { type: 'image' as const, mimeType: 'image/png', data: item.png },
              ]),
            ],
            structuredContent: metadata,
          };
        } catch (failure) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: failure instanceof Error ? failure.message : 'GLEECH operation failed.',
              },
            ],
          };
        }
      },
    );
  }
  const expectedRevision = z.number().int().min(0).optional();
  const instanceId = z.string().min(1).max(1024);
  for (const schema of requestSchema.options) {
    const name = schema.shape.action.value;
    register(
      name,
      {
        get_mcp_status:
          'Inspect the current control mode, connected clients and approved Imports, Projects and Exports folder paths before using file tools.',
        request_folder_access:
          'Ask the user to choose and approve an Imports, Projects or Exports folder in GLEECH’s native folder picker. Requires Full Control. No access is granted without a selection; cancellation, timeout or a mode change grants nothing. Grants last for this app session. Allow up to five minutes for user interaction.',
        revoke_folder_access:
          'Remove a folder grant by its ID from get_mcp_status. Requires Full Control. Does not delete any files or change the project.',
        copy_to_clipboard:
          'Copy the full-resolution edited image as PNG to the Windows clipboard. Requires Edit or Full Control and the separate clipboard permission enabled in GLEECH. Does not change the project or create files.',
        list_operations:
          'List the latest 32 in-session project edits with stable operation IDs and before/after summaries. Includes GUI edits, Undo and Redo. Records expire; exported files and preset library writes are separate from project history.',
        revert_to_operation:
          'Restore the full project state before (default) or after a recent operation ID as one new Undo step. Uses list_operations IDs, preserves saved-source assets, and restores document bindings. Includes locked layers like Undo. Does not delete external exports or change preset library files.',
        render_full:
          'Render and write a full-resolution PNG to an approved Exports folder, with original stage reference dimensions and all editable effects. Requires Full Control; overwrite is false by default.',
        compare_versions:
          'Return labelled edited and comparison PNG images without changing the project. Compare to current stage source (UI Original), original project input, or a saved snapshot’s rendered image.',
        export_batch:
          'Render up to 32 approved input images to explicit approved output paths using the current stack/seed or a preset. Uses full resolution and per-input subject analysis; never changes the open project. Requires Full Control; reports per-file success/errors and preserves existing outputs by default.',
        batch:
          'Batch-render approved image inputs using the current stack or a preset; equivalent to export_batch. The working project and its history remain unchanged.',
        list_masks:
          'List static painted masks by owning layer ID, including enable/inversion, reference dimensions, stroke and path counts.',
        get_effect_mask:
          'Read a layer’s exact painted mask, including geometry and brush controls. Null means no painted mask. Use the layer instanceId as its stable mask resource ID.',
        analyze_image:
          'Inspect full-resolution source color/alpha/luminance statistics without changing the project. Optional includeSubject uses the same cached photo-subject detector as GLEECH and returns its grayscale PNG and confidence statistics.',
        list_semantic_controls:
          'Inspect high-level controls for existing corruption, fragmentation, color damage, signal loss, glyphs, smear, analog/optical damage, structure preservation, depth distortion and background isolation.',
        list_presets:
          'Browse built-in and user presets, including creator-independent metadata, effect types, layer counts and shader inclusion. Does not change the project.',
        get_style_recipe:
          'Read the exact portable current-stack or preset recipe, including masks, embedded images and imported shader data. Up to 8 MB inline; use preset import/export files for larger recipes.',
        save_preset:
          'Save the current editable stack and master seed to the user preset library, with a current-image or statue thumbnail. Library files are separate from project Undo.',
        duplicate_preset:
          'Copy a built-in or user preset into the user library under a new name, preserving its recipe and thumbnail. Does not change the project.',
        import_preset:
          'Import a portable .gleechpreset from an approved Imports folder into the user library. Requires Full Control.',
        export_preset:
          'Export a built-in or user preset with all embedded assets to .gleechpreset in an approved Exports folder. Requires Full Control; overwrite is false by default.',
        get_seed: 'Read the current deterministic master seed and project revision.',
        create_variation:
          'Generate nine variations without changing the project: three close, three medium, three distant. Intensity 0–1 controls stable to distorted; locked layers are preserved. Render or apply a returned variationId; IDs expire when another set is generated or the project changes.',
        render_variation:
          'Preview a generated variation as a PNG without applying it. Uses the same current stage input and original master seed. Fails if its project changed.',
        apply_variation:
          'Apply a generated variation as one Undo step. The stack must still match the project used to generate it; locked layers remain unchanged.',
        get_project_state:
          'Inspect the current project, revision, seed, visible stack, snapshots and history availability. Image bytes, mask strokes and shader source are omitted.',
        list_snapshots:
          'List saved snapshot IDs, parent lineage, input and rendered dimensions, and the active baked stage.',
        get_snapshot:
          'Inspect a snapshot’s saved seed, source/rendered images and effect parameters without restoring it or changing the project.',
        create_snapshot:
          'Capture the current full-resolution edited stack, recipe and seed as an undoable snapshot. Optional bake=true starts a new stage from its rendered image.',
        restore_snapshot:
          'Restore a saved snapshot recipe (default) or use its rendered image as a new stage. Undo restores the previous stage.',
        bake_as_new_source:
          'Use a saved snapshot as the baked source, or capture and bake the current stack when snapshotId is omitted. Clears the active stack while preserving saved lineage and Undo.',
        branch_from_snapshot:
          'Begin an editable stage from a snapshot’s rendered image. The snapshot becomes its lineage parent; subsequent captured stages become children. Undo restores the previous stage.',
        rename_snapshot: 'Rename a saved snapshot as one Undo step.',
        get_source_info:
          'Inspect current stage input, original source, dimensions and baked-stage identity.',
        create_project:
          'Create an empty project as one Undo step. Previous images and stack remain in history.',
        load_image:
          'Open an image from an approved Imports folder using the same source replacement as the UI. Preserves current effects and snapshots; use create_project first for an empty stack. Requires Full Control.',
        load_image_data:
          'Import a still PNG, JPEG or WebP supplied as canonical padded base64 in data (no data URL), with mimeType and an optional display name. Maximum decoded size is 6 MiB. Requires Edit or Full Control, with no filesystem or clipboard grant. Preserves the effect stack; use create_project first for an empty stack. Undo restores the previous source. Read get_project_state and pass expectedRevision.',
        replace_source:
          'Replace the current source from an approved Imports folder while preserving effects and snapshots. Undo restores the previous source. Requires Full Control.',
        open_project:
          'Open a .gleech project from an approved Projects folder. The previous project remains undoable. Requires Full Control.',
        save_project:
          'Save the current project to an absolute .gleech path in an approved Projects folder. Existing files are protected unless overwrite=true. Requires Full Control.',
        export_image:
          'Export the full-resolution edited image as PNG (default), JPEG, WebP or TIFF to an approved Exports folder. Existing files are protected unless overwrite=true. Requires Full Control.',
        list_effects:
          'List current layers in visible top-to-bottom order with stable IDs and current parameters.',
        list_effect_types:
          'List built-in filters and shaders. Supply a type to inspect its parameter definitions, units, defaults, choices and application controls.',
        get_effect_parameters:
          'Read a layer’s current parameters and definitions, including imported shader controls and procedural application masks.',
        apply_operations:
          'Atomically apply up to 64 stack edits as one Undo step. Invalid edits leave the stack and history untouched. add_effect and duplicate_effect return generated IDs; supply a UUID to target a new layer later in the same batch.',
        undo: 'Undo one edit through GLEECH’s existing history.',
        redo: 'Redo one edit through GLEECH’s existing history.',
        render_preview:
          'Render the current edited image as a PNG, using the same CPU/GPU pipeline as the app. Returns the exact project revision; errors if the project changes while rendering.',
      }[name],
      Object.fromEntries(Object.entries(schema.shape).filter(([key]) => key !== 'action')),
      (args) => ({ action: name, ...args }),
      [
        'create_project',
        'create_snapshot',
        'restore_snapshot',
        'bake_as_new_source',
        'branch_from_snapshot',
        'rename_snapshot',
        'load_image',
        'load_image_data',
        'request_folder_access',
        'revoke_folder_access',
        'replace_source',
        'open_project',
        'save_project',
        'export_image',
        'render_full',
        'export_batch',
        'batch',
        'apply_operations',
        'save_preset',
        'duplicate_preset',
        'import_preset',
        'export_preset',
        'apply_variation',
        'undo',
        'redo',
        'copy_to_clipboard',
        'revert_to_operation',
      ].includes(name),
    );
  }
  const aliases: [string, string, z.ZodRawShape][] = [
    [
      'create_mask',
      'Create or replace a static painted mask using current source dimensions. Base 0 hides the effect; paint strokes reveal it. Base 1 reveals it; erase strokes hide it. Coordinates are normalized to the image; brush size is percent of its shorter side. Requires an unlocked layer; one Undo step.',
      {
        instanceId,
        base: z.union([z.literal(0), z.literal(1)]).default(0),
        strokes: z.array(maskStrokeSchema).max(2048).default([]),
      },
    ],
    [
      'set_effect_mask',
      'Paste/replace an exact validated static mask on an unlocked layer, or remove it with mask=null. Masks keep their own reference dimensions and normalized geometry; one Undo step.',
      { instanceId, mask: maskSchema.nullable() },
    ],
    [
      'set_mask_enabled',
      'Enable/disable an unlocked layer’s existing painted mask, preserving its geometry. One Undo step.',
      { instanceId, enabled: z.boolean() },
    ],
    [
      'invert_mask',
      'Invert an unlocked layer’s existing painted mask without altering brush/path geometry. One Undo step.',
      { instanceId },
    ],
    [
      'set_semantic_controls',
      'Set high-level 0–1 treatments on existing compatible unlocked layers as one Undo step. Uses visible opacity/application controls, adds/removes no layers. Inspect list_semantic_controls first for exact behavior.',
      { controls: semanticControlsSchema },
    ],
    [
      'apply_preset',
      'Apply a library preset using an explicit placement: Replace All (including locked layers), Add Above, Add Below or Merge, matching the UI. Returns resulting layer IDs. Can be included in apply_operations as one Undo transaction.',
      {
        presetId: instanceId,
        placement: z.enum(['replace', 'above', 'below', 'merge']),
        instanceIds: z.array(z.string().uuid()).max(1000).optional(),
      },
    ],
    [
      'apply_style_recipe',
      'Apply an exact portable recipe using the UI preset placement behavior. Recipe contents, masks, images and shader packages must satisfy the same project-model validation. Replace removes all current layers including locked layers; Merge follows the UI.',
      {
        recipe: recipeSchema,
        placement: z.enum(['replace', 'above', 'below', 'merge']),
        instanceIds: z.array(z.string().uuid()).max(1000).optional(),
      },
    ],
    [
      'randomize',
      'Run the GLEECH engine with explicit complexity, seed and mode. replace-all removes locked layers too; other modes preserve locks. existing-only randomizes unlocked parameters/patterns without adding/removing. One Undo step.',
      {
        complexity: z.enum(['simple', 'complex', 'gleeched']),
        mode: z.enum([
          'replace-all',
          'keep-locked',
          'keep-all-add',
          'randomize-add',
          'existing-only',
        ]),
        seed: z.number().int().min(0).max(0xffffffff),
      },
    ],
    [
      'clear_effect_stack',
      'Remove all layers, including locked layers, as one Undo step. Use only when replacing the entire stack is intended.',
      {},
    ],
    [
      'add_effect',
      'Add a built-in filter or shader at the top of the visible stack.',
      { type: z.string().min(1).max(128), instanceId: z.string().uuid().optional() },
    ],
    ['remove_effect', 'Remove an unlocked layer by instanceId.', { instanceId }],
    [
      'move_effect',
      'Move an unlocked layer to a visible top-to-bottom index.',
      { instanceId, index: z.number().int().min(0) },
    ],
    [
      'set_parameters',
      'Set effect and/or application.* parameters using get_effect_parameters definitions.',
      { instanceId, parameters: parameterValues },
    ],
    ['set_enabled', 'Toggle an unlocked layer’s visibility.', { instanceId, enabled: z.boolean() }],
    ['set_locked', 'Set a layer’s lock state explicitly.', { instanceId, locked: z.boolean() }],
    [
      'set_master_seed',
      'Set the project’s deterministic master seed.',
      { seed: z.number().int().min(0).max(0xffffffff) },
    ],
    [
      'randomize_effect',
      'Generate the next pattern for an unlocked layer, preserving its parameter settings.',
      { instanceId },
    ],
    [
      'duplicate_effect',
      'Duplicate an unlocked layer directly above the original.',
      { instanceId, newId: z.string().uuid().optional() },
    ],
  ];
  for (const [name, description, schema] of aliases)
    register(
      name,
      description,
      { ...schema, expectedRevision },
      (args) => {
        const { expectedRevision, ...values } = args;
        return {
          action: 'apply_operations',
          operations: [operationSchema.parse({ action: name, ...values })],
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
        };
      },
      true,
    );
  for (const [name, uri, request] of [
    ['current-project', 'gleech://project/current', { action: 'get_project_state' }],
    ['current-stack', 'gleech://current-stack', { action: 'list_effects' }],
    ['effect-library', 'gleech://effects', { action: 'list_effect_types' }],
    ['current-source', 'gleech://project/current/source', { action: 'get_source_info' }],
    ['snapshot-library', 'gleech://snapshots', { action: 'list_snapshots' }],
    ['mask-library', 'gleech://masks', { action: 'list_masks' }],
    ['preset-library', 'gleech://presets', { action: 'list_presets' }],
  ] as const)
    server.registerResource(name, uri, { mimeType: 'application/json' }, async (_uri, extra) => ({
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(await call(request, extra.signal)),
        },
      ],
    }));
  for (const [name, template, action, key] of [
    ['preset-recipe', 'gleech://presets/{presetId}', 'get_style_recipe', 'presetId'],
    ['saved-snapshot', 'gleech://snapshots/{snapshotId}', 'get_snapshot', 'snapshotId'],
    ['painted-mask', 'gleech://masks/{instanceId}', 'get_effect_mask', 'instanceId'],
  ] as const)
    server.registerResource(
      name,
      new ResourceTemplate(template, { list: undefined }),
      { mimeType: 'application/json' },
      async (uri, variables, extra) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              await call(
                requestSchema.parse({ action, [key]: decodeURIComponent(String(variables[key])) }),
                extra.signal,
              ),
            ),
          },
        ],
      }),
    );
  server.registerResource(
    'current-render',
    'gleech://current-render',
    {
      mimeType: 'image/png',
      description:
        'Current edited preview, bounded to 384px; uses the actual desktop rendering pipeline.',
    },
    async (uri, extra) => {
      const value = await call({ action: 'render_preview' }, extra.signal);
      if (typeof value.png !== 'string') throw new Error('GLEECH did not return a preview.');
      return { contents: [{ uri: uri.href, mimeType: 'image/png', blob: value.png }] };
    },
  );
  server.registerResource(
    'current-palettes',
    'gleech://palettes',
    {
      mimeType: 'application/json',
      description:
        'Color, gradient and palette parameters currently used by the stack, grouped by layer.',
    },
    async (uri, extra) => {
      const stack = await call({ action: 'list_effects' }, extra.signal);
      const layers = Array.isArray(stack.effects) ? stack.effects : [];
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              revision: stack.revision,
              palettes: layers.flatMap((layer) => {
                if (
                  !layer ||
                  typeof layer !== 'object' ||
                  !('parameters' in layer) ||
                  !layer.parameters ||
                  typeof layer.parameters !== 'object'
                )
                  return [];
                const parameters = Object.fromEntries(
                  Object.entries(layer.parameters).filter(
                    ([key, value]) =>
                      typeof value === 'string' &&
                      (/^#[a-f0-9]{6,8}$/i.test(value) || /palette|Stops$|ColorMode$/i.test(key)),
                  ),
                );
                return Object.keys(parameters).length
                  ? [{ instanceId: 'instanceId' in layer ? layer.instanceId : null, parameters }]
                  : [];
              }),
            }),
          },
        ],
      };
    },
  );
  return server;
}
