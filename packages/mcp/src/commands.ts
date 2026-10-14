import {
  createCommandService,
  generateVariations,
  type CommandService,
  type VariationCandidate,
} from '@gleech/command-service';
import {
  EFFECT_DEFINITIONS,
  applicationParameters,
  applicationValue,
  setApplicationValue,
  getEffectDefinition,
  effectDefaults,
  effectImages,
  type EffectInstance,
  type EffectType,
  type EffectPreset,
  type PresetRecipe,
  type ProjectState,
  assertPresetRecipe,
  createPaintedMask,
  assertPaintedMask,
  type PaintedMask,
  projectSources,
} from '@gleech/project-model';
import { EFFECT_CATEGORY } from '@gleech/project-model/effect-catalog';
import { requestSchema, type McpRequest, type McpOperation } from './protocol';
import { semanticEffects, SEMANTIC_CONTROLS } from './semantic';

function effectInfo(effect: EffectInstance, index: number, count: number) {
  return {
    instanceId: effect.instanceId,
    type: effect.type,
    title: getEffectDefinition(effect).title,
    enabled: effect.enabled,
    locked: Boolean(effect.locked),
    seedOffset: effect.seedOffset,
    index: count - 1 - index,
    parameters: { ...effectDefaults(effect).params, ...effect.params },
    application: Object.fromEntries(
      Object.keys(applicationParameters()).map((key) => [
        key,
        applicationValue(effect.application, key),
      ]),
    ),
    mask: effect.paintedMask
      ? { enabled: effect.paintedMask.enabled, strokes: effect.paintedMask.strokes.length }
      : null,
    images: effectImages(effect).map((image) => image.source),
    ...(effect.type === 'shader-import'
      ? { shader: { id: effect.shader.id, name: effect.shader.name } }
      : {}),
  };
}

export function createMcpCommands(
  commands: CommandService,
  uuid: () => string = () => crypto.randomUUID(),
) {
  let revision = 0;
  let previous = commands.getState();
  const records: { id: string; revision: number; before: ProjectState; after: ProjectState }[] = [];
  let variationSession: {
    project: ProjectState;
    candidates: readonly VariationCandidate[];
  } | null = null;
  const dispose = commands.subscribe(() => {
    revision++;
    const after = commands.getState();
    records.push({ id: crypto.randomUUID(), revision, before: previous, after });
    if (records.length > 32) records.shift();
    previous = after;
  });
  function operationTarget(id: string, point: 'before' | 'after') {
    const record = records.find((record) => record.id === id);
    if (!record)
      throw new Error('Operation record expired or does not exist. Refresh list_operations.');
    const target = record[point];
    const retained = commands.retainedSourceIds();
    if (projectSources(target).some((source) => !retained.has(source.id)))
      throw new Error('This operation’s image assets are no longer in Undo history.');
    return target;
  }
  function find(service: CommandService, instanceId: string) {
    const effect = service.getState().effects.find((item) => item.instanceId === instanceId);
    if (!effect)
      throw new Error('Effect does not exist. Refresh the stack and use its instanceId.');
    return effect;
  }
  function apply(
    service: CommandService,
    operation: McpOperation,
    presets: readonly EffectPreset[],
  ) {
    if (operation.action === 'set_semantic_controls') {
      service.applyStackRecipe({
        masterSeed: service.getState().masterSeed,
        effects: semanticEffects(service.getState().effects, operation.controls).effects,
      });
      return;
    }
    if (operation.action === 'randomize') {
      service.gleech(operation);
      return;
    }
    if (operation.action === 'clear_effect_stack') {
      service.applyStackRecipe({ effects: [], masterSeed: service.getState().masterSeed });
      return;
    }
    if (operation.action === 'apply_preset' || operation.action === 'apply_style_recipe') {
      const recipe =
        operation.action === 'apply_style_recipe'
          ? operation.recipe
          : presets.find((preset) => preset.id === operation.presetId);
      if (!recipe) throw new Error('Preset does not exist. Refresh list_presets.');
      assertPresetRecipe(recipe);
      const used = new Set(
        operation.placement === 'replace'
          ? []
          : service.getState().effects.map((effect) => effect.instanceId),
      );
      const ids =
        operation.instanceIds ??
        recipe.effects.map((effect) => {
          let id = effect.instanceId;
          let attempts = 0;
          while (used.has(id)) {
            if (++attempts > 8) throw new Error('Could not create a unique layer ID.');
            id = uuid();
          }
          used.add(id);
          return id;
        });
      service.applyPreset(recipe, operation.placement, ids);
      return;
    }
    if (operation.action === 'add_effect') {
      if (!Object.hasOwn(EFFECT_DEFINITIONS, operation.type) || operation.type === 'shader-import')
        throw new Error(
          'Unknown built-in effect type. Use list_effect_types. Importing shader packages is not enabled in this first MCP release.',
        );
      service.addEffect(operation.type as EffectType, operation.instanceId!);
      return;
    }
    if (operation.action === 'set_master_seed') {
      service.setSeed(operation.seed);
      return;
    }
    const effect = find(service, operation.instanceId);
    if (effect.locked && operation.action !== 'set_locked')
      throw new Error('This effect is locked. Unlock it explicitly before modifying it.');
    switch (operation.action) {
      case 'create_mask': {
        const source = service.getState().source;
        if (!source) throw new Error('Open an image before creating a mask.');
        service.setEffectMask(effect.instanceId, {
          ...createPaintedMask(source.width, source.height),
          base: operation.base,
          strokes: operation.strokes.map(({ opacity, ...stroke }) => ({
            ...stroke,
            ...(opacity === undefined ? {} : { opacity }),
          })),
        });
        return;
      }
      case 'set_effect_mask': {
        const mask = operation.mask as PaintedMask | null;
        if (mask) assertPaintedMask(mask);
        service.setEffectMask(effect.instanceId, mask);
        return;
      }
      case 'set_mask_enabled':
      case 'invert_mask': {
        if (!effect.paintedMask)
          throw new Error('This layer has no painted mask. Use create_mask first.');
        service.setEffectMask(effect.instanceId, {
          ...effect.paintedMask,
          ...(operation.action === 'set_mask_enabled'
            ? { enabled: operation.enabled }
            : { inverted: !effect.paintedMask.inverted }),
        });
        return;
      }
      case 'set_parameters': {
        const definitions = getEffectDefinition(effect).parameters;
        const applications = applicationParameters();
        let application = effect.application;
        const params: Record<string, number | string> = {};
        for (const [key, value] of Object.entries(operation.parameters)) {
          if (Object.hasOwn(applications, key))
            application = setApplicationValue(application, key, value);
          else if (Object.hasOwn(definitions, key)) params[key] = value;
          else throw new Error(`Unknown parameter: ${key}. Use get_effect_parameters.`);
        }
        service.updateEffect(effect.instanceId, { params, application });
        return;
      }
      case 'set_enabled':
        service.updateEffect(effect.instanceId, { enabled: operation.enabled });
        return;
      case 'set_locked':
        service.setEffectLocked(effect.instanceId, operation.locked);
        return;
      case 'randomize_effect':
        service.varyEffect(effect.instanceId);
        return;
      case 'duplicate_effect':
        service.duplicateEffect(effect.instanceId, operation.newId!);
        return;
      case 'remove_effect':
        service.removeEffect(effect.instanceId);
        return;
      case 'move_effect':
        service.moveEffectTo(
          effect.instanceId,
          service.getState().effects.length - 1 - operation.index,
        );
        return;
    }
  }
  function checkRevision(request: McpRequest) {
    if (
      'expectedRevision' in request &&
      request.expectedRevision !== undefined &&
      request.expectedRevision !== revision
    )
      throw new Error(
        'Project changed since it was inspected. Refresh get_project_state and retry with its revision.',
      );
  }
  function variation(variationId: string) {
    if (!variationSession || variationSession.project !== commands.getState())
      throw new Error('The project changed. Generate a new variation set.');
    const candidate = variationSession.candidates.find((candidate) => candidate.id === variationId);
    if (!candidate) throw new Error('Variation does not exist. Use create_variation.');
    return { ...candidate, project: variationSession.project, revision };
  }
  function state() {
    const project = commands.getState();
    return {
      revision,
      name: project.name,
      masterSeed: project.masterSeed,
      source: project.source,
      sourceSnapshotId: project.sourceSnapshotId,
      stackOrder: 'top-to-bottom display order; rendering starts at the bottom',
      effects: project.effects
        .map((effect, index) => effectInfo(effect, index, project.effects.length))
        .reverse(),
      snapshots: project.snapshots.map((snapshot) => ({
        id: snapshot.id,
        parentId: snapshot.parentId,
        name: snapshot.name,
        createdAt: snapshot.createdAt,
        source: snapshot.source,
        rendered: snapshot.rendered,
      })),
      canUndo: commands.canUndo(),
      canRedo: commands.canRedo(),
      operationId: records.at(-1)?.id ?? null,
    };
  }
  return {
    dispose,
    state,
    checkRevision,
    variation,
    operationTarget,
    execute(
      input: unknown,
      context: { presets?: readonly EffectPreset[] } = {},
    ): Record<string, unknown> {
      const request = requestSchema.parse(input);
      checkRevision(request);
      switch (request.action) {
        case 'get_project_state':
          return state();
        case 'list_operations':
          return {
            revision,
            operations: records.map(({ id, revision, before, after }) => ({
              id,
              revision,
              before: {
                name: before.name,
                seed: before.masterSeed,
                layerCount: before.effects.length,
              },
              after: { name: after.name, seed: after.masterSeed, layerCount: after.effects.length },
            })),
            note: 'Latest 32 in-session project edits, including GUI edits, Undo and Redo. Revert restores a whole project state as one new Undo step.',
          };
        case 'list_masks':
          return {
            revision,
            masks: commands
              .getState()
              .effects.filter((effect) => effect.paintedMask)
              .map((effect) => ({
                instanceId: effect.instanceId,
                enabled: effect.paintedMask!.enabled,
                inverted: effect.paintedMask!.inverted,
                width: effect.paintedMask!.width,
                height: effect.paintedMask!.height,
                strokes: effect.paintedMask!.strokes.length,
                paths: effect.paintedMask!.paths?.length ?? 0,
              })),
          };
        case 'get_effect_mask':
          return {
            revision,
            instanceId: request.instanceId,
            mask: find(commands, request.instanceId).paintedMask ?? null,
          };
        case 'list_semantic_controls':
          return {
            controls: Object.entries(SEMANTIC_CONTROLS).map(([key, description]) => ({
              key,
              description,
              min: 0,
              max: 1,
            })),
            note: 'These adjust existing compatible unlocked layers only. Use randomize or a preset to add layers.',
          };
        case 'get_seed':
          return { revision, seed: commands.getState().masterSeed };
        case 'get_style_recipe': {
          const recipe: PresetRecipe | undefined = request.presetId
            ? context.presets?.find((preset) => preset.id === request.presetId)
            : { effects: commands.getState().effects, masterSeed: commands.getState().masterSeed };
          if (!recipe) throw new Error('Preset does not exist. Refresh list_presets.');
          assertPresetRecipe(recipe);
          const value = { masterSeed: recipe.masterSeed, effects: recipe.effects };
          if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 8 * 1024 * 1024)
            throw new Error(
              'This recipe is larger than the inline 8 MB limit. Save/export it as a portable preset file.',
            );
          return { revision, recipe: value };
        }
        case 'create_variation': {
          const project = commands.getState();
          if (!project.source || !project.effects.length)
            throw new Error('Add effects to an image before generating variations.');
          const candidates = generateVariations(
            project.effects,
            request.seed,
            request.intensity,
          ).map((candidate) => ({ ...candidate, id: crypto.randomUUID() }));
          variationSession = { project, candidates };
          return {
            revision,
            seed: request.seed,
            intensity: request.intensity,
            variations: candidates.map((candidate) => ({
              id: candidate.id,
              similarity: candidate.similarity,
              layerCount: candidate.effects.length,
              lockedCount: candidate.effects.filter((effect) => effect.locked).length,
            })),
          };
        }
        case 'apply_variation': {
          const candidate = variation(request.variationId);
          commands.applyVariation(candidate.effects);
          return state();
        }
        case 'list_snapshots':
          return {
            revision,
            sourceSnapshotId: commands.getState().sourceSnapshotId,
            snapshots: state().snapshots,
          };
        case 'get_snapshot': {
          const snapshot = commands
            .getState()
            .snapshots.find((snapshot) => snapshot.id === request.snapshotId);
          if (!snapshot) throw new Error('Snapshot does not exist. Use list_snapshots.');
          return {
            revision,
            snapshot: {
              id: snapshot.id,
              name: snapshot.name,
              parentId: snapshot.parentId,
              masterSeed: snapshot.masterSeed,
              createdAt: snapshot.createdAt,
              source: snapshot.source,
              rendered: snapshot.rendered,
              effects: snapshot.effects
                .map((effect, index) => effectInfo(effect, index, snapshot.effects.length))
                .reverse(),
            },
          };
        }
        case 'rename_snapshot':
          commands.renameSnapshot(request.snapshotId, request.name);
          return state();
        case 'get_source_info':
          return {
            revision,
            source: commands.getState().source,
            origin: commands.getState().origin,
            sourceSnapshotId: commands.getState().sourceSnapshotId,
          };
        case 'list_effects':
          return { revision, effects: state().effects };
        case 'list_effect_types': {
          if (request.type) {
            if (
              !Object.hasOwn(EFFECT_DEFINITIONS, request.type) ||
              request.type === 'shader-import'
            )
              throw new Error('Unknown built-in effect type.');
            return {
              type: request.type,
              ...EFFECT_DEFINITIONS[request.type as EffectType],
              applicationParameters: applicationParameters(),
            };
          }
          return {
            effects: Object.entries(EFFECT_DEFINITIONS)
              .filter(([type]) => type !== 'shader-import')
              .map(([type, definition]) => ({
                type,
                title: definition.title,
                description: definition.description,
                category: EFFECT_CATEGORY[type as EffectType],
              }))
              .sort((a, b) => a.title.localeCompare(b.title)),
          };
        }
        case 'get_effect_parameters': {
          const effect = find(commands, request.instanceId);
          return {
            revision,
            instanceId: effect.instanceId,
            ...getEffectDefinition(effect),
            values: { ...effectDefaults(effect).params, ...effect.params },
            applicationParameters: applicationParameters(),
            applicationValues: effectInfo(effect, 0, 1).application,
          };
        }
        case 'apply_operations': {
          if (!commands.getState().source)
            throw new Error('Open an image in GLEECH before editing the stack.');
          const operations = request.operations.map((operation) =>
            operation.action === 'add_effect'
              ? { ...operation, instanceId: operation.instanceId ?? uuid() }
              : operation.action === 'duplicate_effect'
                ? { ...operation, newId: operation.newId ?? uuid() }
                : operation,
          );
          // Rehearse every edit against an isolated service; failures leave the real
          // stack, Undo, Redo and UI notifications untouched.
          const draft = createCommandService(commands.getState());
          for (const operation of operations) apply(draft, operation, context.presets ?? []);
          commands.applyStackRecipe({
            effects: draft.getState().effects,
            masterSeed: draft.getState().masterSeed,
          });
          return { ...state(), operations };
        }
        case 'undo':
          if (!commands.canUndo()) throw new Error('Nothing to undo.');
          commands.undo();
          return state();
        case 'redo':
          if (!commands.canRedo()) throw new Error('Nothing to redo.');
          commands.redo();
          return state();
        case 'render_preview':
        case 'render_full':
        case 'compare_versions':
        case 'export_batch':
        case 'batch':
        case 'analyze_image':
        case 'list_presets':
        case 'save_preset':
        case 'duplicate_preset':
        case 'import_preset':
        case 'export_preset':
        case 'render_variation':
        case 'get_mcp_status':
        case 'create_snapshot':
        case 'restore_snapshot':
        case 'bake_as_new_source':
        case 'branch_from_snapshot':
        case 'create_project':
        case 'load_image':
        case 'replace_source':
        case 'open_project':
        case 'save_project':
        case 'export_image':
        case 'copy_to_clipboard':
        case 'revert_to_operation':
          throw new Error('Previews are supplied by the desktop renderer.');
      }
    },
  };
}
