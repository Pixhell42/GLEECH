import {
  effectImages,
  copyApplication,
  updateBitCrushParams,
  withoutImageData,
  supportsHeightField,
  supportsDirectionField,
  supportsLayerImage,
  assertSeed,
  assertProject,
  assertImageSource,
  assertEffect,
  assertPresetRecipe,
  assertPaintedMask,
  freezePaintedMask,
  freezeCanvasDrawing,
  createEffect,
  createImportedShader,
  type ImportedShaderEffect,
  projectSources,
  layerImages,
  type EffectInstance,
  type EffectType,
  type EffectApplication,
  type ImageSource,
  type ProjectState,
  type StageSnapshot,
  type PresetRecipe,
  type PresetPlacement,
  type PaintedMask,
  assertTimeline,
  assertActiveRange,
  freezeAnimation,
  freezeTimeline,
  snapAnimationToRate,
  clampTimelineRanges,
  type ActiveRange,
  type ParameterAnimation,
  type Timeline,
  activeVideo,
} from '@gleech/project-model';
import {
  pastedSettings,
  resetSettings,
  type SettingsClipboard,
  type SettingsTarget,
} from './settings-clipboard';
import { generateGleechStack, type GleechOptions } from './gleech';
export { generateGleechStack, generateVariations } from './gleech';
export type { GleechOptions, GleechComplexity, GleechMode, VariationCandidate } from './gleech';
export {
  copySettings,
  decodeSettings,
  encodeSettings,
  settingsLabel,
  settingsPasteTarget,
  pastedSettings,
  resetSettings,
} from './settings-clipboard';
export type { SettingsClipboard, SettingsTarget } from './settings-clipboard';

/** Timeline settings to merge; undefined removes optional media and tempo. */
export type TimelineChange = {
  [K in Exclude<keyof Timeline, 'version'>]?: Timeline[K] | undefined;
};

export interface CommandService {
  getState(): ProjectState;
  subscribe(listener: () => void): () => void;
  setSeed(seed: number): void;
  /** Create, replace or remove the project timeline. */
  setTimeline(timeline: Timeline | null): void;
  /** Merge timeline settings. Frame rate changes re-time keys onto the new frames. */
  updateTimeline(change: TimelineChange): void;
  /** Replace an already validated stack and seed as one reversible operation. */
  applyStackRecipe(recipe: PresetRecipe): void;
  /** Open an image: it names the project and replaces any video clip. */
  setSource(source: ImageSource): void;
  /**
   * Make a frame of the video clip (at clip time t) the source image. Switching
   * to Image mode is navigation, not an edit: no undo step is added, and history
   * states of the same clip use the frame too, so Undo only reverts edits.
   */
  useClipFrame(source: ImageSource, t: number): void;
  renameProject(name: string): void;
  loadProject(project: ProjectState): void;
  replaceProject(project: ProjectState): void;
  captureSnapshot(
    id: string,
    name: string,
    rendered: ImageSource,
    createdAt: string,
    bake: boolean,
  ): void;
  restoreSnapshot(id: string, mode: 'recipe' | 'source'): void;
  restoreOrigin(): void;
  renameSnapshot(id: string, name: string): void;
  addEffect(type: EffectType, instanceId: string): void;
  addShader(shader: ImportedShaderEffect['shader'], instanceId: string): void;
  applyPreset(
    recipe: PresetRecipe,
    placement: PresetPlacement,
    instanceIds?: readonly string[],
  ): void;
  varyEffect(instanceId: string): void;
  setEffectLocked(instanceId: string, locked: boolean): void;
  gleech(options: GleechOptions): void;
  applyVariation(effects: readonly EffectInstance[]): void;
  duplicateEffect(instanceId: string, newId: string): void;
  pasteEffectSettings(instanceId: string, data: SettingsClipboard, target: SettingsTarget): boolean;
  resetEffectSetting(instanceId: string, target: SettingsTarget): boolean;
  setEffectMask(instanceId: string, mask: PaintedMask | null): void;
  setEffectDrawing(
    instanceId: string,
    drawing: import('@gleech/project-model').CanvasDrawing,
  ): void;
  updateEffect(
    instanceId: string,
    change: {
      enabled?: boolean;
      params?: Readonly<Record<string, number | string>>;
      application?: Partial<EffectApplication>;
      image?: import('@gleech/project-model').LayerImage;
      fieldImage?: import('@gleech/project-model').LayerImage | null;
      directionImage?: import('@gleech/project-model').LayerImage | null;
      glyphFont?: import('@gleech/project-model').GlyphFontAtlas | null;
      /** Per parameter key; null removes that key's animation. */
      animation?: Readonly<Record<string, ParameterAnimation | null>>;
      activeRange?: ActiveRange | null;
    },
  ): void;
  removeEffect(instanceId: string): void;
  moveEffect(instanceId: string, direction: -1 | 1): void;
  moveEffectTo(instanceId: string, index: number): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  beginHistoryGroup(): void;
  endHistoryGroup(): void;
  retainedSourceIds(): ReadonlySet<string>;
}

function frozenLayer(effect: EffectInstance) {
  const image = supportsLayerImage(effect)
    ? effect.image
    : supportsHeightField(effect)
      ? effect.fieldImage
      : undefined;
  const direction = effect.directionImage
    ? {
        directionImage: Object.freeze({
          ...effect.directionImage,
          source: Object.freeze({ ...effect.directionImage.source }),
        }),
      }
    : {};
  if (!image) return direction;
  return {
    ...direction,
    [supportsLayerImage(effect) ? 'image' : 'fieldImage']:
      Object.isFrozen(image) && Object.isFrozen(image.source)
        ? image
        : Object.freeze({ ...image, source: Object.freeze({ ...image.source }) }),
  };
}
function freezeApplication(application: EffectInstance['application']) {
  const copy = copyApplication(application);
  if (copy.depthField) Object.freeze(copy.depthField);
  if (copy.depthImage) {
    Object.freeze(copy.depthImage.source);
    Object.freeze(copy.depthImage);
  }
  return Object.freeze(copy);
}
function equalEffect(a: EffectInstance, b: EffectInstance): boolean {
  if (a === b) return true;
  return (
    JSON.stringify(effectImages(a).map((image) => image.png)) ===
      JSON.stringify(effectImages(b).map((image) => image.png)) &&
    JSON.stringify(withoutImageData(a)) === JSON.stringify(withoutImageData(b))
  );
}

const frozenShaders = new WeakMap<object, ImportedShaderEffect['shader']>();
function frozenShader(effect: EffectInstance) {
  if (effect.type !== 'shader-import') return {};
  let shader = frozenShaders.get(effect.shader);
  if (!shader) {
    shader = structuredClone(effect.shader);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(shader);
    frozenShaders.set(effect.shader, shader);
    frozenShaders.set(shader, shader);
  }
  return { shader };
}

export function createCommandService(initialState: ProjectState): CommandService {
  assertProject(initialState);
  // Only reuse objects deeply frozen by this service. A shallow-frozen input
  // from a caller still needs validation and a defensive copy of its children.
  const ownedEffects = new WeakSet<EffectInstance>();
  let state: ProjectState = Object.freeze({
    ...initialState,
    source: initialState.source ? Object.freeze({ ...initialState.source }) : null,
    origin: initialState.origin ? Object.freeze({ ...initialState.origin }) : null,
    effects: freezeEffects(initialState.effects),
    snapshots: Object.freeze(initialState.snapshots.map(freezeSnapshot)),
    ...(initialState.timeline ? { timeline: freezeTimeline(initialState.timeline) } : {}),
  });
  const listeners = new Set<() => void>();
  const past: ProjectState[] = [];
  const future: ProjectState[] = [];
  let groupStart: ProjectState | null = null;
  let groupRecorded = false;
  const endHistoryGroup = () => {
    groupStart = null;
    groupRecorded = false;
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  function commit(next: ProjectState): void {
    if (!groupStart || !groupRecorded) {
      past.push(groupStart ?? state);
      if (past.length > 50) past.shift();
      if (groupStart) groupRecorded = true;
    }
    future.length = 0;
    state = Object.freeze(next);
    notify();
  }

  function freezeEffects(effects: readonly EffectInstance[]): readonly EffectInstance[] {
    return Object.freeze(
      effects.map((effect) => {
        if (ownedEffects.has(effect)) return effect;
        const frozen = Object.freeze({
          ...effect,
          ...frozenLayer(effect),
          ...frozenShader(effect),
          ...(effect.type === 'glyph' && effect.glyphFont
            ? {
                glyphFont: Object.isFrozen(effect.glyphFont)
                  ? effect.glyphFont
                  : Object.freeze({ ...effect.glyphFont }),
              }
            : {}),
          params: Object.freeze({ ...effect.params }),
          application: freezeApplication(effect.application),
          ...(effect.paintedMask ? { paintedMask: freezePaintedMask(effect.paintedMask) } : {}),
          ...(effect.type === 'solid' && effect.drawing
            ? { drawing: freezeCanvasDrawing(effect.drawing) }
            : {}),
          ...(effect.animation ? { animation: freezeAnimation(effect.animation) } : {}),
          ...(effect.activeRange ? { activeRange: Object.freeze({ ...effect.activeRange }) } : {}),
        }) as EffectInstance;
        ownedEffects.add(frozen);
        return frozen;
      }),
    );
  }
  function freezeSnapshot(snapshot: StageSnapshot): StageSnapshot {
    return Object.freeze({
      ...snapshot,
      source: Object.freeze({ ...snapshot.source }),
      rendered: Object.freeze({ ...snapshot.rendered }),
      effects: freezeEffects(snapshot.effects),
    });
  }
  function stage(id: string): StageSnapshot {
    const snapshot = state.snapshots.find((entry) => entry.id === id);
    if (!snapshot) throw new Error('Snapshot does not exist.');
    return snapshot;
  }
  function commitStage(next: ProjectState): void {
    assertProject(next);
    endHistoryGroup();
    commit(next);
  }

  function setEffects(effects: readonly EffectInstance[]): void {
    for (const effect of effects) if (!ownedEffects.has(effect)) assertEffect(effect);
    layerImages(effects);
    if (
      effects.length === state.effects.length &&
      effects.every((effect, index) => equalEffect(effect, state.effects[index]!))
    )
      return;
    commit({
      ...state,
      effects: freezeEffects(effects),
    });
  }

  return {
    getState: () => state,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    beginHistoryGroup() {
      if (!groupStart) groupStart = state;
    },
    endHistoryGroup,
    retainedSourceIds: () =>
      new Set(
        [state, ...past, ...future].flatMap((project) =>
          projectSources(project).map((source) => source.id),
        ),
      ),
    undo() {
      endHistoryGroup();
      const previous = past.pop();
      if (!previous) return;
      future.push(state);
      state = previous;
      notify();
    },
    redo() {
      endHistoryGroup();
      const next = future.pop();
      if (!next) return;
      past.push(state);
      state = next;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimeline(timeline) {
      if (timeline) assertTimeline(timeline);
      if (!timeline && !state.timeline) return;
      endHistoryGroup();
      const next: { -readonly [K in keyof ProjectState]: ProjectState[K] } = { ...state };
      if (timeline) next.timeline = freezeTimeline(timeline);
      else delete next.timeline;
      commit(next);
    },
    updateTimeline(change) {
      if (!state.timeline) throw new Error('Open Timeline mode first.');
      let timeline = {
        ...state.timeline,
        ...change,
        version: state.timeline.version,
      } as Timeline;
      for (const key of ['video', 'audio', 'bpm', 'inOut'] as const)
        if (Object.hasOwn(change, key) && change[key] === undefined)
          delete (timeline as unknown as Record<string, unknown>)[key];
      assertTimeline(timeline);
      // A shorter timeline keeps its work area and In/Out inside the new end.
      if (timeline.duration < state.timeline.duration || timeline.fps !== state.timeline.fps)
        timeline = clampTimelineRanges(timeline);
      if (JSON.stringify(timeline) === JSON.stringify(state.timeline)) return;
      const retime = timeline.fps !== state.timeline.fps;
      commit({
        ...state,
        timeline: freezeTimeline(timeline),
        ...(retime
          ? {
              effects: freezeEffects(
                state.effects.map((effect) =>
                  effect.animation
                    ? ({
                        ...effect,
                        animation: Object.fromEntries(
                          Object.entries(effect.animation).map(([key, value]) => [
                            key,
                            snapAnimationToRate(value, timeline.fps),
                          ]),
                        ),
                      } as EffectInstance)
                    : effect,
                ),
              ),
            }
          : {}),
      });
    },
    setSeed(seed) {
      assertSeed(seed);
      if (seed === state.masterSeed) return;
      endHistoryGroup();
      commit({ ...state, masterSeed: seed });
    },
    applyStackRecipe(recipe) {
      const next = { ...state, effects: recipe.effects, masterSeed: recipe.masterSeed };
      assertProject(next);
      if (
        state.masterSeed === recipe.masterSeed &&
        state.effects.length === recipe.effects.length &&
        state.effects.every((effect, index) => equalEffect(effect, recipe.effects[index]!))
      )
        return;
      endHistoryGroup();
      const current = new Map(state.effects.map((effect) => [effect.instanceId, effect]));
      const effects = recipe.effects.map((effect) => {
        const original = current.get(effect.instanceId);
        return original && equalEffect(original, effect) ? original : effect;
      });
      commit({ ...next, effects: freezeEffects(effects) });
    },
    renameProject(name) {
      if (typeof name !== 'string' || !name.trim() || name.length > 120)
        throw new Error('Choose a project name between 1 and 120 characters.');
      name = name.trim();
      if (state.name === name) return;
      endHistoryGroup();
      commit({ ...state, name });
    },
    setSource(source) {
      assertImageSource(source);
      endHistoryGroup();
      const next: { -readonly [K in keyof ProjectState]: ProjectState[K] } = {
        ...state,
        name: source.name,
        source: Object.freeze({ ...source }),
        origin: Object.freeze({ ...source }),
        sourceSnapshotId: null,
      };
      // An image replaces the clip; the rest of the timeline (keys, audio) stays.
      if (state.timeline?.video) {
        const timeline: { -readonly [K in keyof Timeline]: Timeline[K] } = { ...state.timeline };
        delete timeline.video;
        next.timeline = freezeTimeline(timeline);
      }
      commit(next);
    },
    useClipFrame(source, t) {
      assertImageSource(source);
      const video = activeVideo(state);
      if (!state.timeline || !video) throw new Error('Open a video clip first.');
      assertTimeline({
        ...state.timeline,
        video: { ...video, posterId: source.id, posterTime: t },
      });
      const frame = Object.freeze({ ...source });
      // Which clip frame is the still is a view of the clip, not an edit: apply it
      // to every history state of this clip so Undo only reverts real edits.
      const swap = (project: ProjectState): ProjectState => {
        const clip = activeVideo(project);
        if (!project.timeline || !clip || clip.path !== video.path) return project;
        return Object.freeze({
          ...project,
          source: frame,
          origin: frame,
          sourceSnapshotId: null,
          timeline: freezeTimeline({
            ...project.timeline,
            video: { ...clip, posterId: frame.id, posterTime: t },
          }),
        });
      };
      endHistoryGroup();
      past.splice(0, past.length, ...past.map(swap));
      future.splice(0, future.length, ...future.map(swap));
      state = swap(state);
      notify();
    },
    replaceProject(project) {
      assertProject(project);
      endHistoryGroup();
      commit({
        ...project,
        ...(project.timeline ? { timeline: freezeTimeline(project.timeline) } : {}),
        source: project.source ? Object.freeze({ ...project.source }) : null,
        origin: project.origin ? Object.freeze({ ...project.origin }) : null,
        snapshots: Object.freeze(project.snapshots.map(freezeSnapshot)),
        effects: freezeEffects(project.effects),
      });
    },
    loadProject(project) {
      assertProject(project);
      endHistoryGroup();
      past.length = 0;
      future.length = 0;
      state = Object.freeze({
        ...project,
        ...(project.timeline ? { timeline: freezeTimeline(project.timeline) } : {}),
        source: project.source ? Object.freeze({ ...project.source }) : null,
        origin: project.origin ? Object.freeze({ ...project.origin }) : null,
        snapshots: Object.freeze(project.snapshots.map(freezeSnapshot)),
        effects: Object.freeze(
          project.effects.map(
            (effect) =>
              Object.freeze({
                ...effect,
                ...frozenLayer(effect),
                params: Object.freeze({ ...effect.params }),
                application: freezeApplication(effect.application),
              }) as EffectInstance,
          ),
        ),
      });
      notify();
    },
    captureSnapshot(id, name, rendered, createdAt, bake) {
      if (!state.source) throw new Error('Open an image before capturing a snapshot.');
      const snapshot = freezeSnapshot({
        id,
        name: name.trim(),
        createdAt,
        parentId: state.sourceSnapshotId,
        source: state.source,
        rendered,
        effects: state.effects,
        masterSeed: state.masterSeed,
      });
      commitStage({
        ...state,
        snapshots: Object.freeze([...state.snapshots, snapshot]),
        ...(bake
          ? { source: snapshot.rendered, sourceSnapshotId: id, effects: Object.freeze([]) }
          : {}),
      });
    },
    restoreSnapshot(id, mode) {
      const snapshot = stage(id);
      commitStage({
        ...state,
        masterSeed: snapshot.masterSeed,
        source: mode === 'source' ? snapshot.rendered : snapshot.source,
        sourceSnapshotId: mode === 'source' ? snapshot.id : snapshot.parentId,
        effects: mode === 'source' ? Object.freeze([]) : snapshot.effects,
      });
    },
    restoreOrigin() {
      if (!state.origin) return;
      commitStage({
        ...state,
        source: state.origin,
        sourceSnapshotId: null,
        effects: Object.freeze([]),
      });
    },
    renameSnapshot(id, name) {
      const snapshot = stage(id);
      if (snapshot.name === name.trim()) return;
      commitStage({
        ...state,
        snapshots: Object.freeze(
          state.snapshots.map((entry) =>
            entry.id === id ? freezeSnapshot({ ...entry, name: name.trim() }) : entry,
          ),
        ),
      });
    },
    addEffect(type, instanceId) {
      if (!state.source) throw new Error('Open an image before adding effects.');
      if (state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect ID already exists.');
      endHistoryGroup();
      setEffects([...state.effects, createEffect(type, instanceId)]);
    },
    addShader(shader, instanceId) {
      if (!state.source) throw new Error('Open an image before adding a shader.');
      if (state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect ID already exists.');
      endHistoryGroup();
      setEffects([...state.effects, createImportedShader(shader, instanceId)]);
    },
    applyPreset(recipe, placement, instanceIds) {
      if (!state.source) throw new Error('Open an image before applying a preset.');
      assertPresetRecipe(recipe);
      if (!['replace', 'above', 'below', 'merge'].includes(placement))
        throw new Error('Invalid preset placement.');
      if (instanceIds && instanceIds.length !== recipe.effects.length)
        throw new Error('Invalid preset effect IDs.');
      const incoming = recipe.effects.map((effect, index) => ({
        ...effect,
        ...frozenLayer(effect),
        instanceId: instanceIds?.[index] ?? effect.instanceId,
      }));
      assertPresetRecipe({ ...recipe, effects: incoming });
      const effects =
        placement === 'replace'
          ? incoming
          : placement === 'merge'
            ? mergeEffects(state.effects, incoming)
            : placement === 'above'
              ? [...state.effects, ...incoming]
              : [...incoming, ...state.effects];
      const next = {
        ...state,
        masterSeed: placement === 'replace' ? recipe.masterSeed : state.masterSeed,
        effects: freezeEffects(effects),
      };
      assertProject(next);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      endHistoryGroup();
      commit(next);
    },
    varyEffect(instanceId) {
      if (!state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect does not exist.');
      endHistoryGroup();
      setEffects(
        state.effects.map((effect) =>
          effect.instanceId === instanceId
            ? { ...effect, seedOffset: (effect.seedOffset + 1) >>> 0 }
            : effect,
        ),
      );
    },
    setEffectLocked(instanceId, locked) {
      if (!state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect does not exist.');
      if (typeof locked !== 'boolean') throw new Error('Invalid effect lock.');
      endHistoryGroup();
      setEffects(
        state.effects.map((effect) =>
          effect.instanceId === instanceId ? { ...effect, locked } : effect,
        ),
      );
    },
    gleech(options) {
      if (!state.source) throw new Error('Open an image before using GLEECH.');
      const effects = generateGleechStack(state.effects, options);
      endHistoryGroup();
      setEffects(effects);
    },
    applyVariation(effects) {
      if (!state.source) throw new Error('Open an image before using Var.');
      if (
        effects.length !== state.effects.length ||
        effects.some((effect, index) => {
          const original = state.effects[index]!;
          return (
            effect.instanceId !== original.instanceId ||
            effect.type !== original.type ||
            Boolean(effect.locked) !== Boolean(original.locked) ||
            (original.locked && JSON.stringify(effect) !== JSON.stringify(original))
          );
        })
      )
        throw new Error('Variation no longer matches the current stack.');
      endHistoryGroup();
      setEffects(effects);
    },
    duplicateEffect(instanceId, newId) {
      const index = state.effects.findIndex((e) => e.instanceId === instanceId);
      if (index < 0) throw new Error('Effect does not exist.');
      if (!newId || state.effects.some((e) => e.instanceId === newId))
        throw new Error('Effect ID already exists.');
      const effect = state.effects[index]!;
      endHistoryGroup();
      setEffects([
        ...state.effects.slice(0, index + 1),
        { ...effect, instanceId: newId, patternId: effect.patternId ?? effect.instanceId },
        ...state.effects.slice(index + 1),
      ]);
    },
    resetEffectSetting(instanceId, target) {
      const effect = state.effects.find((e) => e.instanceId === instanceId);
      if (!effect) return false;
      const next = resetSettings(effect, target);
      if (!next) return false;
      if (next !== effect) {
        endHistoryGroup();
        setEffects(state.effects.map((e) => (e.instanceId === instanceId ? next : e)));
      }
      return true;
    },
    pasteEffectSettings(instanceId, data, target) {
      const effect = state.effects.find((e) => e.instanceId === instanceId);
      if (!effect) return false;
      const next = pastedSettings(effect, data, target);
      if (!next) return false;
      endHistoryGroup();
      setEffects(state.effects.map((e) => (e.instanceId === instanceId ? next : e)));
      return true;
    },
    updateEffect(instanceId, change) {
      if (!state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect does not exist.');
      if (
        change.glyphFont !== undefined &&
        state.effects.find((effect) => effect.instanceId === instanceId)!.type !== 'glyph'
      )
        throw new Error('This effect does not support glyph fonts.');
      if (
        change.image !== undefined &&
        !supportsLayerImage(state.effects.find((effect) => effect.instanceId === instanceId)!)
      )
        throw new Error('This effect does not support image inputs.');
      if (
        change.fieldImage !== undefined &&
        !supportsHeightField(state.effects.find((effect) => effect.instanceId === instanceId)!)
      )
        throw new Error('This effect does not use a height field.');
      if (
        change.directionImage !== undefined &&
        !supportsDirectionField(state.effects.find((e) => e.instanceId === instanceId)!)
      )
        throw new Error('This effect does not use a direction field.');
      if (change.enabled !== undefined) endHistoryGroup();
      if (change.activeRange) assertActiveRange(change.activeRange);
      const animated = (effect: EffectInstance) => {
        if (change.animation === undefined && change.activeRange === undefined) return {};
        const animation: Record<string, ParameterAnimation> = { ...(effect.animation ?? {}) };
        for (const [key, value] of Object.entries(change.animation ?? {})) {
          if (value) animation[key] = value;
          else delete animation[key];
        }
        return {
          animation: Object.keys(animation).length ? animation : undefined,
          activeRange:
            change.activeRange === undefined
              ? effect.activeRange
              : (change.activeRange ?? undefined),
        };
      };
      const stripUndefined = (effect: EffectInstance): EffectInstance => {
        const copy = { ...effect } as Record<string, unknown>;
        if (copy.animation === undefined) delete copy.animation;
        if (copy.activeRange === undefined) delete copy.activeRange;
        return copy as unknown as EffectInstance;
      };
      setEffects(
        state.effects.map((effect) =>
          effect.instanceId === instanceId
            ? stripUndefined({
                ...effect,
                ...frozenLayer(effect),
                enabled: change.enabled ?? effect.enabled,
                params:
                  effect.type === 'bit-crush' && change.params
                    ? updateBitCrushParams(effect.params, change.params)
                    : { ...effect.params, ...change.params },
                application: { ...effect.application, ...change.application },
                ...(change.image !== undefined ? { image: change.image } : {}),
                ...(change.glyphFont !== undefined
                  ? { glyphFont: change.glyphFont ?? undefined }
                  : {}),
                ...(change.directionImage !== undefined
                  ? { directionImage: change.directionImage ?? undefined }
                  : {}),
                ...(change.fieldImage !== undefined
                  ? { fieldImage: change.fieldImage ?? undefined }
                  : {}),
                ...animated(effect),
              } as EffectInstance)
            : effect,
        ),
      );
    },
    setEffectMask(instanceId, mask) {
      if (!state.effects.some((effect) => effect.instanceId === instanceId))
        throw new Error('Effect does not exist.');
      if (mask) assertPaintedMask(mask);
      endHistoryGroup();
      setEffects(
        state.effects.map((effect) => {
          if (effect.instanceId !== instanceId) return effect;
          const next = { ...effect };
          if (mask) next.paintedMask = mask;
          else delete next.paintedMask;
          return next;
        }),
      );
    },
    setEffectDrawing(instanceId, drawing) {
      const target = state.effects.find((effect) => effect.instanceId === instanceId);
      if (!target || target.type !== 'solid') throw new Error('Drawing requires a Solid layer.');
      setEffects(
        state.effects.map((effect) =>
          effect.instanceId === instanceId
            ? { ...target, drawing: freezeCanvasDrawing(drawing) }
            : effect,
        ),
      );
    },
    removeEffect(instanceId) {
      endHistoryGroup();
      setEffects(state.effects.filter((effect) => effect.instanceId !== instanceId));
    },
    moveEffect(instanceId, direction) {
      const index = state.effects.findIndex((effect) => effect.instanceId === instanceId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= state.effects.length) return;
      endHistoryGroup();
      const effects = [...state.effects];
      [effects[index], effects[next]] = [effects[next]!, effects[index]!];
      setEffects(effects);
    },
    moveEffectTo(instanceId, index) {
      const previous = state.effects.findIndex((effect) => effect.instanceId === instanceId);
      if (previous < 0 || !Number.isInteger(index) || index < 0 || index >= state.effects.length)
        throw new RangeError('Invalid effect position.');
      if (previous === index) return;
      endHistoryGroup();
      const effects = [...state.effects];
      const [effect] = effects.splice(previous, 1);
      effects.splice(index, 0, effect!);
      setEffects(effects);
    },
  };
}

function mergeEffects(
  current: readonly EffectInstance[],
  preset: readonly EffectInstance[],
): readonly EffectInstance[] {
  const identity = (effect: EffectInstance) =>
    effect.type === 'shader-import' ? `shader:${effect.shader.id}` : effect.type;
  const originals = new Map<string, EffectInstance[]>();
  for (const effect of current) {
    const matches = originals.get(identity(effect)) ?? [];
    matches.push(effect);
    originals.set(identity(effect), matches);
  }
  // Walk the visible preset order. Keep all existing copies of a matching type
  // at its first visible preset position, retaining their relative order.
  const retained = new Set<string>();
  return [...preset]
    .reverse()
    .flatMap((effect) => {
      const matches = originals.get(identity(effect));
      if (!matches) return [effect];
      if (retained.has(identity(effect))) return [];
      retained.add(identity(effect));
      return [...matches].reverse();
    })
    .reverse();
}
