import { DEFAULT_PREVIEW_BACKDROP, type PreviewBackdrop } from './preview-backdrop';
import { createMcpCommands } from '@gleech/mcp/commands';
import { isMutation, type McpMode } from '@gleech/mcp/protocol';
import { McpDialog } from './McpDialog';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createCommandService,
  copySettings,
  settingsLabel,
  settingsPasteTarget,
  type SettingsTarget,
  type GleechComplexity,
  type GleechMode,
} from '@gleech/command-service';
import {
  createProject,
  getEffectDefinition,
  supportsLayerImage,
  effectDefaults,
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  type MaskBrush,
  type ProjectState,
  type EffectPreset,
  type PresetPlacement,
  type PresetRecipe,
  type EffectInstance,
  type EffectApplication,
  type PaintedMask,
  createTimeline,
  activeVideo,
  audioIsClipSound,
  audioTrackLevel,
  bakeModulation,
  restoreBaked,
  type Timeline,
  clampTimelineRanges,
  evaluateKeys,
  roundParameter,
  snapAnimationToRate,
  FRAME_RATES,
  evaluateEffectsAt,
  frameSeed,
  frameTime,
  frameCount,
  timeFrame,
  workRange,
  formatTimecode,
  upsertKey,
  removeKeyAtFrame,
  adjacentKeyFrame,
  keyIndexAtFrame,
  parameterBaseValue,
  evaluateParameter,
  animationDefinition,
  setKeysInterpolation,
  createLfo,
  createAudioModulator,
  effectsAnimate,
  DEFAULT_MODULATION,
  type ParameterAnimation,
  type ModulationContext,
} from '@gleech/project-model';
import { TimelineDock, type SelectedParameter } from './timeline/TimelineDock';
import { AnimationCard } from './AnimationControls';
import { parameterKeyInfo, type ParameterAnimationUi } from './animation-ui';
import { RenderDialog, type RenderSettingsMemory } from './RenderDialog';
import { RenderQueuePanel } from './RenderQueuePanel';
import { ModulatorPanel } from './ModulatorPanel';
import { normalizedValue } from './animation-format';
import { SIGNAL_COLORS } from './animation-ui';
import { renderQueue } from './render-queue';
import { TIMELINE_MCP_ACTIONS, runTimelineMcp } from './mcp-timeline';
import { rememberMedia, useTimelineMedia, useVideoFrame } from './timeline/use-media';
import { VideoFrameSource } from './video-frames';
import { analyzeMediaAudio } from './timeline-audio';
import type { FilmstripFrame } from './timeline/TimelineDock';
import type { VideoProbe, AudioProbe, OpenedMedia } from '../../shared/render';
import type { PixelImage, RenderInfo } from '@gleech/renderer-core';
import { APP_IS_BETA, APP_VERSION_LABEL } from '../../shared/branding';
import {
  unwrap,
  type ImportedImage,
  type Result,
  type ProjectDocument,
  type RecentProject,
  type ImageExportOptions,
} from '../../shared/image-api';
import { ImageViewport, type ViewportHandle } from './ImageViewport';
import { EffectEditor } from './EffectEditor';
import { EffectStack } from './EffectStack';
import { EffectPicker } from './EffectPicker';
import { RecentProjectsMenu } from './RecentProjectsMenu';
import { MenuFlyout, MenuFlyoutProvider } from './MenuFlyout';
import { InspectorSections, InspectorSection, InspectorSectionActions } from './InspectorSections';
import { PanelResizeHandle } from './PanelResizeHandle';
import { usePanelWidths } from './usePanelWidths';
import { ProjectName } from './ProjectName';
import { WindowControls } from './WindowControls';
import { ExportDialog } from './ExportDialog';
import { PresetNameDialog } from './PresetNameDialog';
import {
  shaderPackageThumbnail,
  renderMcpPreview,
  renderMcpImage,
  presetThumbnails as renderPresetThumbnails,
} from './ShaderPreview';
import { trackPointer } from './timeline/pointer';
import { ShaderImportDialog } from './ShaderImportDialog';
import type { ShaderImportRequest, ShaderImportPreview } from './ShaderImportDialog';
import {
  decodeShaderImport,
  assertExecutableShader,
  type ShaderPackage,
} from '@gleech/project-model/shader-package';
import type { LibraryShader } from '../../shared/image-api';
import { SnapshotPanel, StageDialog } from './SnapshotPanel';
import { PaintedMaskControls } from './PaintedMaskControls';
import { SettingsContextMenu } from './SettingsContextMenu';
import { GleechDialog } from './GleechDialog';
import { VariationDialog } from './VariationDialog';
import { SupportDialog } from './SupportDialog';
import { UiColorDialog } from './UiColorDialog';
import { applyUiColor, readUiColor, saveUiColor } from './ui-color';
import {
  DiceIcon,
  FlagIcon,
  HeartIcon,
  PlusIcon,
  RedoIcon,
  SparkleIcon,
  TrashIcon,
  UndoIcon,
  ImageModeIcon,
  TimelineModeIcon,
  DiamondIcon,
} from './Icons';
import { FeedbackDialog } from './FeedbackDialog';
import type { FeedbackDraft, FeedbackKind } from '../../shared/feedback';

const commands = createCommandService(createProject('Untitled', 8172));

// Stable small numbers for recipe identities; frame-cache keys include them.
const recipeIds = new WeakMap<object, number>();
let recipeSequence = 0;
function recipeIdentity(value: object): number {
  let id = recipeIds.get(value);
  if (id === undefined) {
    id = ++recipeSequence;
    recipeIds.set(value, id);
  }
  return id;
}
const NO_FRAMES: ReadonlySet<number> = new Set();
/** A small PNG data URL of rendered pixels, for the Render dialog preview. */
async function previewDataUrl(image: PixelImage, maxDimension = 640): Promise<string> {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const full = new OffscreenCanvas(image.width, image.height);
  full
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  const small = new OffscreenCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  const context = small.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(full, 0, 0, small.width, small.height);
  const blob = await small.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the preview.'));
    reader.readAsDataURL(blob);
  });
}
const DOCK_HEIGHT_KEY = 'gleech.timeline.dockHeight';
/** Playback-only listening level; never saved in projects or used by renders. */
const PLAYBACK_AUDIO_KEY = 'gleech.timeline.playbackAudio';
/** Name for a source image made from a clip frame, e.g. "clip frame 75". */
function clipFrameName(clip: string, frame: number): string {
  const base =
    clip
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .trim()
      .slice(0, 96) || 'clip';
  return `${base} frame ${frame}`;
}

function readPlaybackAudio(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYBACK_AUDIO_KEY) ?? 'null') as {
      volume?: unknown;
      muted?: unknown;
    } | null;
    const volume = Number(saved?.volume);
    return {
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
      muted: saved?.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

/**
 * Register a video file's own sound as audio and analyze it, ready to be the
 * audio track. Analysis runs once so modulators stay deterministic.
 */
async function clipSoundTrack(path: string) {
  const opened = unwrap(
    await window.gleech.registerMedia(path, 'audio'),
  ) as OpenedMedia<AudioProbe>;
  rememberMedia('audio', opened);
  const result = await analyzeMediaAudio(opened.mediaId);
  return {
    path: opened.path,
    name: opened.name,
    duration: opened.info.duration || result.duration,
    sampleRate: opened.info.sampleRate || 48000,
    channels: opened.info.channels || result.channels || 2,
    analysis: result.analysis,
  };
}

function readDockHeight(): number {
  try {
    const value = Number(localStorage.getItem(DOCK_HEIGHT_KEY));
    return Number.isFinite(value) && value >= 220 ? value : 420;
  } catch {
    return 420;
  }
}

export function App() {
  const { setWorkspace, style: panelStyle, handle: panelHandle } = usePanelWidths();
  const project = useSyncExternalStore(commands.subscribe, commands.getState);
  const viewport = useRef<ViewportHandle>(null);
  const locked = useRef(false);
  const assets = useRef(new Map<string, ImportedImage>());
  const [fieldImages, setFieldImages] = useState<ReadonlyMap<string, ImportedImage>>(new Map());
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
  const rememberImage = useCallback((image: ImportedImage) => {
    assets.current.set(image.source.id, image);
    setFieldImages((previous) => new Map([...previous, [image.source.id, image]]));
    setThumbnails((previous) => new Map([...previous, [image.source.id, image.thumbnail]]));
  }, []);
  const [busy, setBusy] = useState<
    'import' | 'export' | 'history' | 'project' | 'snapshot' | 'preset' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('Ready');
  const [clipboardFeedback, setClipboardFeedback] = useState<{ text: string; id: number } | null>(
    null,
  );
  const [settingsMenu, setSettingsMenu] = useState<{
    x: number;
    y: number;
    effectId: string;
    target: SettingsTarget;
  } | null>(null);
  const closeSettingsMenu = useCallback(() => setSettingsMenu(null), []);
  const clipboardPending = useRef(false);
  const clipboardSequence = useRef(0);
  useEffect(() => {
    if (!clipboardFeedback) return;
    const timer = setTimeout(() => setClipboardFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [clipboardFeedback]);
  const [info, setInfo] = useState<RenderInfo | null>(null);
  const [exportBackend, setExportBackend] = useState<string | null>(null);
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  const [savedState, setSavedState] = useState<ProjectState | null>(null);
  const documentState = useRef<{
    document: ProjectDocument | null;
    savedState: ProjectState | null;
  }>({ document: null, savedState: null });
  const documentHistory = useRef(
    new WeakMap<
      ProjectState,
      { document: ProjectDocument | null; savedState: ProjectState | null }
    >(),
  );
  useEffect(() => {
    documentState.current = { document, savedState };
  }, [document, savedState]);
  const [stageDialog, setStageDialog] = useState<{
    bake: boolean;
    renameId?: string;
    name: string;
  } | null>(null);
  const [fileMenu, setFileMenu] = useState(false);
  const [uiColor, setUiColor] = useState(readUiColor);
  const [uiColorDialog, setUiColorDialog] = useState(false);
  const [supportDialog, setSupportDialog] = useState(false);
  const [mcpDialog, setMcpDialog] = useState(false);
  const [mcpMode, setMcpMode] = useState<McpMode>('off');
  const [mcpOperation, setMcpOperation] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<
    Partial<Record<FeedbackKind, FeedbackDraft>>
  >({});
  const showFeedback = (kind: FeedbackKind) => {
    if (fileMenu) fileMenuRef.current?.querySelector('button')?.focus();
    setFileMenu(false);
    setFeedbackDrafts((previous) =>
      previous[kind]
        ? previous
        : {
            ...previous,
            [kind]: {
              requestId: crypto.randomUUID(),
              kind,
              title: '',
              description: '',
              context: '',
              expected: '',
            },
          },
    );
    setFeedbackKind(kind);
  };
  const showSupport = () => {
    if (fileMenu) fileMenuRef.current?.querySelector('button')?.focus();
    setFileMenu(false);
    setSupportDialog(true);
  };
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [recentProjects, setRecentProjects] = useState<readonly RecentProject[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentReload, setRecentReload] = useState(0);
  useEffect(() => {
    if (!fileMenu) return;
    let active = true;
    void window.gleech
      .listRecentProjects()
      .then((result) => {
        if (!active) return;
        try {
          setRecentProjects(unwrap(result));
          setRecentError(null);
        } catch (failure) {
          setRecentError(failure instanceof Error ? failure.message : 'Could not load Recents.');
        }
      })
      .catch((failure) => {
        if (active)
          setRecentError(failure instanceof Error ? failure.message : 'Could not load Recents.');
      })
      .finally(() => {
        if (active) setRecentLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fileMenu, recentReload]);
  const clearRecents = async () => {
    setRecentLoading(true);
    try {
      unwrap(await window.gleech.clearRecentProjects());
      setRecentProjects([]);
      setRecentError(null);
      setNotice('Cleared Recents');
    } catch (failure) {
      setRecentError(failure instanceof Error ? failure.message : 'Could not clear Recents.');
    } finally {
      setRecentLoading(false);
    }
  };
  const dirty = Boolean(project.source && project !== savedState);
  const [addingEffect, setAddingEffect] = useState(false);
  const [pickerTab, setPickerTab] = useState<'effects' | 'presets'>('effects');
  const [presets, setPresets] = useState<readonly EffectPreset[]>([]);
  const [shaders, setShaders] = useState<readonly LibraryShader[]>([]);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetLibraryError, setPresetLibraryError] = useState<string | null>(null);
  const [presetReload, setPresetReload] = useState(0);
  const pickerOpener = useRef<HTMLElement | null>(null);
  const [presetDialog, setPresetDialog] = useState<{
    name: string;
    id?: string;
    fromMenu?: boolean;
    recipe: PresetRecipe;
    preset?: EffectPreset;
  } | null>(null);
  const openPicker = useCallback((tab: 'effects' | 'presets' = 'effects') => {
    const active = window.document.activeElement;
    if (active instanceof HTMLButtonElement && !active.closest('dialog'))
      pickerOpener.current = active;
    setPickerTab(tab);
    setPresetLoading(true);
    setAddingEffect(true);
  }, []);
  const [exportDialog, setExportDialog] = useState(false);
  const [shaderImportDialog, setShaderImportDialog] = useState(false);
  const [shaderImportError, setShaderImportError] = useState<string | null>(null);
  const [shaderImportPreview, setShaderImportPreview] = useState<ShaderImportPreview | null>(null);
  const showShaderImport = () => {
    setShaderImportError(null);
    setShaderImportPreview(null);
    setFileMenu(false);
    setShaderImportDialog(true);
  };
  const prepareShader = async (request: ShaderImportRequest) => {
    if (locked.current) return;
    locked.current = true;
    setBusy('import');
    setError(null);
    setFileMenu(false);
    try {
      setShaderImportError(null);
      setShaderImportPreview(null);
      const pkg =
        request.kind === 'code'
          ? decodeShaderImport(request.code, 'Pasted shader')
          : unwrap(
              await (request.kind === 'url'
                ? window.gleech.fetchShader(request.url)
                : window.gleech.openShader()),
            );
      if (!pkg) return;
      setNotice(`Preparing ${pkg.name}…`);
      const thumbnail = await shaderPackageThumbnail(pkg);
      setShaderImportPreview({ pkg, thumbnail });
      setNotice(`Ready to import ${pkg.name}`);
    } catch (failure) {
      setShaderImportError(
        failure instanceof Error ? failure.message : 'Could not prepare shader.',
      );
      setNotice('Shader was not imported');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const importShader = async (pkg: ShaderPackage) => {
    if (locked.current || !shaderImportPreview) return;
    locked.current = true;
    setBusy('import');
    setShaderImportError(null);
    try {
      assertExecutableShader(pkg);
      const entry = unwrap(await window.gleech.storeShader(pkg, shaderImportPreview.thumbnail));
      setShaders((previous) => [...previous.filter((shader) => shader.id !== entry.id), entry]);
      setNotice(`Added shader ${pkg.name}`);
      setShaderImportDialog(false);
      setShaderImportPreview(null);
      openPicker();
    } catch (failure) {
      setShaderImportError(failure instanceof Error ? failure.message : 'Could not import shader.');
      setNotice('Shader was not imported');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const deleteShader = async (shader: LibraryShader) => {
    if (locked.current) return;
    try {
      unwrap(await window.gleech.deleteShader(shader.id));
      setShaders((previous) => previous.filter((entry) => entry.id !== shader.id));
      setNotice(`Removed ${shader.package.name} from library`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove shader.');
    }
  };
  const [gleechDialog, setGleechDialog] = useState(false);
  const [variationSession, setVariationSession] = useState<{
    project: ProjectState;
    image: ImportedImage;
  } | null>(null);
  const [comparisonContainer, setComparisonContainer] = useState<HTMLDivElement | null>(null);
  const displayName =
    savedState && project.name === savedState.name
      ? (document?.name ?? project.name)
      : project.name;
  const [cutoutBackdrop, setCutoutBackdrop] = useState<PreviewBackdrop>(DEFAULT_PREVIEW_BACKDROP);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'controls' | 'details'>('controls');
  const [mode, setMode] = useState<'image' | 'timeline'>('image');
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackAudio, setPlaybackAudio] = useState(readPlaybackAudio);
  const changePlaybackAudio = (change: Partial<{ volume: number; muted: boolean }>) =>
    setPlaybackAudio((previous) => {
      const next = { ...previous, ...change };
      try {
        localStorage.setItem(PLAYBACK_AUDIO_KEY, JSON.stringify(next));
      } catch {
        // The level still applies for this session.
      }
      return next;
    });
  // Bumped by seeks while playing so the playback clock restarts from the new frame.
  const [clockEpoch, setClockEpoch] = useState(0);
  const [selectedParam, setSelectedParam] = useState<SelectedParameter | null>(null);
  const [modulatorParam, setModulatorParam] = useState<SelectedParameter | null>(null);
  const [laneView, setLaneView] = useState<'keys' | 'curves'>('keys');
  const [frameCache, setFrameCache] = useState<{
    token: string;
    frames: ReadonlySet<number>;
    fps: number | null;
  }>({ token: '', frames: NO_FRAMES, fps: null });
  const [dockHeight, setDockHeight] = useState(readDockHeight);
  const [viewportControlsContainer, setViewportControlsContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const selected =
    project.effects.find((effect) => effect.instanceId === selectedId) ?? project.effects.at(-1);
  const newSeed = () => {
    let seed: number;
    do {
      seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    } while (seed === project.masterSeed);
    commands.setSeed(seed);
  };
  const [maskTarget, setMaskTarget] = useState<string | null>(null);
  const [maskBrush, setMaskBrush] = useState<MaskBrush>(DEFAULT_MASK_BRUSH);
  const [maskOverlay, setMaskOverlay] = useState(true);
  const [maskGeometryDraft, setMaskGeometryDraft] = useState<PaintedMask | null>(null);
  const maskEffect = project.effects.find((effect) => effect.instanceId === maskTarget);
  const editingMask = maskEffect?.paintedMask;
  const commitCanvasMask = (mask: PaintedMask) => {
    const current = commands.getState().effects.find((effect) => effect.instanceId === maskTarget);
    if (current) commands.setEffectMask(current.instanceId, mask);
  };
  const finishMask = () => {
    setMaskTarget(null);
    setMaskGeometryDraft(null);
    commands.endHistoryGroup();
  };
  const applyGleech = (complexity: GleechComplexity, mode: GleechMode) => {
    setGleechDialog(false);
    if (locked.current) return;
    try {
      commands.gleech({ complexity, mode, seed: crypto.getRandomValues(new Uint32Array(1))[0]! });
      setSelectedId(commands.getState().effects.at(-1)?.instanceId ?? null);
      setInspectorTab('controls');
      setNotice('GLEECH applied · Undo restores your previous stack');
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not GLEECH this stack.');
    }
  };
  const applyVariation = (effects: readonly EffectInstance[]) => {
    try {
      if (locked.current || commands.getState() !== variationSession?.project)
        throw new Error('The stack changed. Reopen Var to generate new previews.');
      commands.applyVariation(effects);
      setNotice('Variation applied · Undo restores your previous stack');
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not apply this variation.');
    } finally {
      setVariationSession(null);
    }
  };
  const previewEffects = useMemo(
    () =>
      maskGeometryDraft && maskTarget
        ? project.effects.map((effect) =>
            effect.instanceId === maskTarget && effect.paintedMask
              ? {
                  ...effect,
                  paintedMask: maskGeometryDraft,
                }
              : effect,
          )
        : project.effects,
    [project.effects, maskGeometryDraft, maskTarget],
  );

  // Timeline: Image mode always shows the frame at the playhead.
  const timeline = project.timeline;
  const timelineMode = mode === 'timeline' && Boolean(timeline && project.source);
  const fps = timeline?.fps ?? 30;
  const totalFrames = timeline ? frameCount(timeline) : 1;
  const frame = Math.min(playhead, totalFrames - 1);
  const frameT = frameTime(frame, fps);
  const modulation = useMemo<ModulationContext>(
    () => ({
      bpm: timeline?.bpm ?? (timeline?.audio?.analysis?.bpm || 120),
      seed: project.masterSeed,
      audio: timeline?.audio?.analysis,
    }),
    [timeline?.bpm, timeline?.audio?.analysis, project.masterSeed],
  );
  const frameEffects = useMemo(
    () => evaluateEffectsAt(previewEffects, frameT, modulation),
    [previewEffects, frameT, modulation],
  );
  const frameMasterSeed = timeline
    ? frameSeed(project.masterSeed, timeline.seed, frame)
    : project.masterSeed;
  const media = useTimelineMedia(timeline, setError);
  const clip = activeVideo(project);
  const videoFrame = useVideoFrame(
    clip ? media.video : null,
    frame,
    frameT,
    clip
      ? playing
        ? Math.ceil(Math.max(clip.width, clip.height) / 2)
        : Math.max(clip.width, clip.height)
      : 0,
    playing,
  );
  const clipFrames = useRef<VideoFrameSource | null>(null);
  const clipMediaId = useRef<string | null>(null);
  useEffect(() => {
    clipFrames.current = clip ? (media.video?.frames ?? null) : null;
    clipMediaId.current = clip ? (media.video?.mediaId ?? null) : null;
  }, [clip, media.video]);
  const [filmstrip, setFilmstrip] = useState<{
    mediaId: string;
    frames: readonly FilmstripFrame[];
  } | null>(null);
  useEffect(() => {
    const source = media.video;
    if (!source || !clip || !timeline) return;
    let active = true;
    const span = Math.min(timeline.duration, clip.duration);
    const count = 48;
    const times = Array.from({ length: count }, (_, index) => (index / count) * span);
    void source.frames
      .thumbnails(times, 48)
      .then((urls) => {
        if (active)
          setFilmstrip({
            mediaId: source.mediaId,
            frames: urls.map((url, index) => ({
              frame: timeFrame(times[index]!, timeline.fps),
              url,
            })),
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [media.video, clip, timeline]);
  // What you hear: the track level (saved, also used by renders) times the
  // playback level (listening only).
  const trackLevel = timeline?.audio ? audioTrackLevel(timeline.audio) : 1;
  useEffect(() => {
    const player = media.audio?.player;
    if (!player) return;
    player.setVolume(trackLevel * playbackAudio.volume);
    player.setMuted(playbackAudio.muted || trackLevel === 0);
  }, [media.audio, trackLevel, playbackAudio]);
  // Keep the audio track in step with playback.
  useEffect(() => {
    const player = media.audio?.player;
    if (!player || !playing) return;
    void player.play(frameContext.current.t).catch(() => {});
    return () => player.pause();
  }, [playing, media.audio]);
  useEffect(() => {
    const player = media.audio?.player;
    if (!playing || !player) return;
    // An element that reached its end stops; replay it when the loop wraps.
    if (!player.isPlaying && frameT < player.duration - 0.05)
      void player.play(frameT).catch(() => {});
    else player.sync(frameT);
  }, [playing, frameT, media.audio]);
  const recipeToken = useMemo(
    () =>
      [
        recipeIdentity(previewEffects),
        project.masterSeed,
        fps,
        timeline?.seed.mode,
        timeline?.seed.every,
        project.source?.id,
        timeline?.video?.path,
        modulation.bpm,
        timeline?.audio?.analysis ? timeline.audio.path : '',
      ].join(':'),
    [previewEffects, project.masterSeed, fps, timeline, project.source?.id, modulation.bpm],
  );
  const frameKey =
    timeline && (!clip || videoFrame?.frame === frame) ? `${recipeToken}:${frame}` : null;
  const cachedFrames = frameCache.token === recipeToken ? frameCache.frames : NO_FRAMES;
  // Frames shown by the viewport arrive many times a second; batch the state updates.
  const shownFrames = useRef<{
    token: string;
    frames: number[];
    evicted: number[];
    times: number[];
  }>({ token: '', frames: [], evicted: [], times: [] });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushFrames = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const batch = shownFrames.current;
      const added = batch.frames;
      const evicted = batch.evicted;
      batch.frames = [];
      batch.evicted = [];
      setFrameCache((previous) => {
        const base = previous.token === batch.token ? previous.frames : NO_FRAMES;
        const frames = new Set(base);
        for (const value of added) frames.add(value);
        for (const value of evicted) frames.delete(value);
        return {
          token: batch.token,
          frames,
          fps: batch.times.length > 1 ? batch.times.length : previous.fps,
        };
      });
    }, 250);
  }, []);
  const pendingFor = (key: string) => {
    const split = key.lastIndexOf(':');
    const token = key.slice(0, split);
    const pending = shownFrames.current;
    if (pending.token !== token) {
      pending.token = token;
      pending.frames = [];
      pending.evicted = [];
    }
    return { pending, frame: Number(key.slice(split + 1)) };
  };
  const onFrameShown = useCallback(
    (key: string) => {
      const { pending, frame: shown } = pendingFor(key);
      pending.frames.push(shown);
      const now = performance.now();
      pending.times = [...pending.times.filter((time) => now - time < 1000), now];
      flushFrames();
    },
    [flushFrames],
  );
  const onFrameEvicted = useCallback(
    (key: string) => {
      const split = key.lastIndexOf(':');
      // Only frames of the current recipe are on the ruler.
      if (key.slice(0, split) !== shownFrames.current.token) return;
      shownFrames.current.evicted.push(Number(key.slice(split + 1)));
      flushFrames();
    },
    [flushFrames],
  );
  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );
  const frameContext = useRef({ t: 0, frame: 0, modulation: DEFAULT_MODULATION });
  useEffect(() => {
    frameContext.current = { t: frameT, frame, modulation };
  }, [frameT, frame, modulation]);
  /** The still recipe at the playhead, for exports, snapshots and MCP renders. */
  const atPlayhead = useCallback((state: ProjectState) => {
    const context = frameContext.current;
    return {
      effects: evaluateEffectsAt(state.effects, context.t, {
        ...context.modulation,
        seed: state.masterSeed,
      }),
      masterSeed: state.timeline
        ? frameSeed(state.masterSeed, state.timeline.seed, context.frame)
        : state.masterSeed,
    };
  }, []);

  // The play clock restarts only when timing changes. Other timeline edits made
  // while playing (track volume, markers, tempo) must not move the playhead.
  const hasTimeline = Boolean(timeline);
  const playLoop = timeline?.loop ?? false;
  const playRange =
    timeline?.loop && timeline.workArea
      ? workRange(timeline)
      : { start: 0, end: totalFrames / fps };
  const playStart = playRange.start;
  const playEnd = playRange.end;
  useEffect(() => {
    if (!playing || !hasTimeline) return;
    const first = timeFrame(playStart, fps);
    const last = Math.max(first + 1, Math.min(totalFrames, timeFrame(playEnd, fps)));
    const current = frameContext.current.frame;
    const start = current >= first && current < last - 1 ? current : first;
    const origin = performance.now();
    let request = requestAnimationFrame(function tick(now) {
      let target = start + Math.floor(((now - origin) / 1000) * fps);
      if (target >= last) {
        if (!playLoop) {
          setPlayhead(last - 1);
          setPlaying(false);
          return;
        }
        target = first + ((target - first) % (last - first));
      }
      setPlayhead(target);
      request = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(request);
  }, [playing, hasTimeline, fps, playLoop, playStart, playEnd, totalFrames, clockEpoch]);

  const [renderDialog, setRenderDialog] = useState<'video' | 'gif' | null>(null);
  const [renderMemory, setRenderMemory] = useState<RenderSettingsMemory>({
    video: null,
    gif: null,
    outputFolder: null,
    tab: 'video',
  });
  const [renderPreview, setRenderPreview] = useState<string | null>(null);
  const openRender = (tab: 'video' | 'gif') => {
    const state = commands.getState();
    if (!state.timeline || !state.source || locked.current) return;
    setFileMenu(false);
    setPlaying(false);
    setRenderPreview(null);
    setRenderDialog(tab);
    const sourceId = state.source.id;
    void (
      activeVideo(state) && clipFrames.current
        ? stillPixels(sourceId)
            .then((pixels) => renderMcpImage(sourceId, pixels, atPlayhead(state)))
            .then((image) => previewDataUrl(image))
        : renderMcpPreview(sourceId, atPlayhead(state))
    )
      .then(setRenderPreview)
      .catch(() => setRenderPreview(null));
  };
  const addMarker = () => {
    const active = commands.getState().timeline;
    if (!active) return;
    commands.updateTimeline({
      markers: [
        ...active.markers.filter((marker) => timeFrame(marker.t, active.fps) !== frame),
        {
          id: crypto.randomUUID(),
          t: frameTime(frame, active.fps),
          name: `Marker ${active.markers.length + 1}`,
        },
      ],
    });
  };
  const seek = (target: number) => {
    setPlayhead(Math.max(0, Math.min(totalFrames - 1, Math.round(target))));
    if (playing) setClockEpoch((value) => value + 1);
  };
  const openTimeline = () => {
    if (!commands.getState().source || busy !== null) return;
    try {
      if (!commands.getState().timeline) commands.setTimeline(createTimeline());
      finishMask();
      setMode('timeline');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open Timeline mode.');
    }
  };
  /** Image mode edits a still: the clip frame at the playhead becomes the source image. */
  const adoptPlayheadFrame = async () => {
    const state = commands.getState();
    const video = activeVideo(state);
    const frames = clipFrames.current;
    const { t, frame: at } = frameContext.current;
    if (!video || !frames || !state.timeline || locked.current) return;
    if (Math.abs((video.posterTime ?? 0) - t) < 1e-6) return;
    locked.current = true;
    setBusy('project');
    setError(null);
    const label = formatTimecode(at, state.timeline.fps);
    setNotice(`Using frame ${label}…`);
    let image: ImportedImage | null = null;
    try {
      const pixels = await frames.frameAt(t, Math.max(video.width, video.height));
      image = unwrap(
        await window.gleech.importPixels(
          pixels.width,
          pixels.height,
          pixels.pixels,
          clipFrameName(video.name, at),
        ),
      );
      if (commands.getState() !== state || !viewport.current)
        throw new Error('The project changed while GLEECH was reading the frame.');
      rememberImage(image);
      await viewport.current.showImage(image, state.effects, state.masterSeed);
      if (commands.getState() !== state)
        throw new Error('The project changed while GLEECH was reading the frame.');
      commands.useClipFrame(image.source, t);
      setNotice(`Editing frame ${label}`);
    } catch (failure) {
      if (image && !commands.retainedSourceIds().has(image.source.id)) {
        // Put the current source back in the viewport before freeing the frame.
        const current = commands.getState();
        const previous = current.source && assets.current.get(current.source.id);
        if (previous)
          await viewport.current
            ?.showImage(previous, current.effects, current.masterSeed)
            .catch(() => {});
        const imageId = image.source.id;
        assets.current.delete(imageId);
        setFieldImages((before) => {
          const next = new Map(before);
          next.delete(imageId);
          return next;
        });
        await window.gleech.releaseImage(imageId).catch(() => {});
      }
      setError(failure instanceof Error ? failure.message : 'Could not use this frame.');
      setNotice('Ready');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const openImageMode = () => {
    setPlaying(false);
    setMode('image');
    void adoptPlayheadFrame();
  };
  /**
   * Open a video clip like an image: it replaces the source (and any clip), names
   * the project, and keeps the effect stack and keys. Its first frame becomes the
   * source image.
   */
  const addVideo = async () => {
    if (locked.current || !viewport.current) return;
    locked.current = true;
    setBusy('project');
    setError(null);
    setFileMenu(false);
    setPlaying(false);
    setNotice('Opening video…');
    try {
      if (!(await confirmLeave())) return;
      const opened = unwrap(await window.gleech.openVideo());
      if (!opened) {
        setNotice('Ready');
        return;
      }
      rememberMedia('video', opened);
      setNotice(`Reading ${opened.name}…`);
      const info: VideoProbe = opened.info;
      const frames = new VideoFrameSource(opened.mediaId, info);
      let poster;
      try {
        poster = await frames.frameAt(0, Math.max(info.width, info.height));
      } finally {
        frames.dispose();
      }
      const image = unwrap(
        await window.gleech.importPixels(
          poster.width,
          poster.height,
          poster.pixels,
          clipFrameName(opened.name, 0),
        ),
      );
      const state = commands.getState();
      const previous = state.timeline ?? createTimeline();
      // The clip's sound becomes the audio track, unless a separate track was added.
      const base: { -readonly [K in keyof Timeline]: Timeline[K] } = { ...previous };
      if (audioIsClipSound(previous)) delete base.audio;
      if (info.hasAudio && !base.audio) {
        setNotice(`Analyzing the sound of ${opened.name}…`);
        try {
          base.audio = await clipSoundTrack(opened.path);
        } catch (failure) {
          setError(
            `${opened.name} opened without its sound: ${
              failure instanceof Error ? failure.message : 'the audio could not be read.'
            }`,
          );
        }
      }
      const rate =
        FRAME_RATES.find((candidate) => Math.abs(candidate - info.fps) < 0.01) ??
        Math.min(120, Math.max(1, Math.round(info.fps * 1000) / 1000));
      await viewport.current.showImage(image, state.effects, state.masterSeed);
      rememberImage(image);
      commands.replaceProject({
        ...state,
        name: opened.name,
        source: image.source,
        origin: image.source,
        sourceSnapshotId: null,
        // Keys stay on frames when the clip brings a different frame rate.
        effects: state.effects.map((effect) =>
          effect.animation
            ? ({
                ...effect,
                animation: Object.fromEntries(
                  Object.entries(effect.animation).map(([key, lane]) => [
                    key,
                    snapAnimationToRate(lane, rate),
                  ]),
                ),
              } as EffectInstance)
            : effect,
        ),
        timeline: clampTimelineRanges({
          ...base,
          fps: rate,
          duration: Math.min(3600, Math.max(1 / rate, info.duration)),
          workArea: null,
          video: {
            path: opened.path,
            name: opened.name,
            width: poster.width,
            height: poster.height,
            fps: info.fps,
            duration: info.duration,
            hasAudio: info.hasAudio,
            posterId: image.source.id,
            posterTime: 0,
          },
        }),
      });
      setDocument(null);
      setSavedState(null);
      setPlayhead(0);
      finishMask();
      setMode('timeline');
      setNotice(`Added ${opened.name}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open this video.');
      setNotice('Ready');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  /** Add (or replace) the audio track; it is analyzed once so modulators stay deterministic. */
  const addAudio = async () => {
    if (locked.current || !commands.getState().timeline) return;
    locked.current = true;
    setBusy('project');
    setError(null);
    setNotice('Opening audio…');
    try {
      const opened = unwrap(await window.gleech.openAudio());
      if (!opened) {
        setNotice('Ready');
        return;
      }
      rememberMedia('audio', opened);
      setNotice(`Analyzing ${opened.name}…`);
      const info: AudioProbe = opened.info;
      const result = await analyzeMediaAudio(opened.mediaId);
      commands.updateTimeline({
        audio: {
          path: opened.path,
          name: opened.name,
          duration: info.duration || result.duration,
          sampleRate: info.sampleRate || 48000,
          channels: info.channels || result.channels || 2,
          analysis: result.analysis,
        },
      });
      setNotice(
        `Added ${opened.name}${result.analysis.bpm ? ` · ${result.analysis.bpm} BPM` : ''}`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add this audio track.');
      setNotice('Ready');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  /** Make the video clip's own sound the audio track again. */
  const addClipAudio = async () => {
    const clipInfo = commands.getState().timeline?.video;
    if (locked.current || !clipInfo?.hasAudio) return;
    locked.current = true;
    setBusy('project');
    setError(null);
    setNotice(`Analyzing the sound of ${clipInfo.name}…`);
    try {
      const audio = await clipSoundTrack(clipInfo.path);
      commands.updateTimeline({ audio });
      setNotice(
        `Using the sound of ${clipInfo.name}${audio.analysis.bpm ? ` · ${audio.analysis.bpm} BPM` : ''}`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read the clip’s sound.');
      setNotice('Ready');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const ensureTimeline = () => {
    if (!commands.getState().timeline) commands.setTimeline(createTimeline());
    return commands.getState().timeline!;
  };
  /** Click a diamond: animate, add a key at the playhead, or remove the key there. */
  const toggleKey = (effectId: string, key: string) => {
    try {
      const current = commands.getState().effects.find((effect) => effect.instanceId === effectId);
      if (!current || !animationDefinition(current, key)) return;
      const active = ensureTimeline();
      const t = frameTime(frame, active.fps);
      const animation = current.animation?.[key];
      // Keys hold keyed values; modulation is applied on top at render time.
      const definition = animationDefinition(current, key)!;
      const keyedValue = animation?.keys.length
        ? evaluateKeys(animation.keys, t, definition)
        : undefined;
      const value =
        keyedValue === undefined
          ? parameterBaseValue(current, key)
          : typeof keyedValue === 'number'
            ? roundParameter(keyedValue, definition)
            : keyedValue;
      if (animation && keyIndexAtFrame(animation, frame, active.fps) >= 0) {
        const next = removeKeyAtFrame(animation, frame, active.fps);
        const keyed = animation.keys[keyIndexAtFrame(animation, frame, active.fps)]!.value;
        // Removing the last key keeps the value it showed as the new static value.
        commands.updateEffect(effectId, {
          animation: { [key]: next },
          ...(next
            ? {}
            : key.startsWith('application.')
              ? { application: { [key.slice(12)]: keyed } as Partial<EffectApplication> }
              : { params: { [key]: keyed } }),
        });
      } else {
        commands.updateEffect(effectId, {
          animation: { [key]: upsertKey(animation, t, value, active.fps) },
        });
        setSelectedParam({ effectId, key });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not change this keyframe.');
    }
  };
  /** Route control edits: animated controls get a key at the playhead, others change as before. */
  const routeChange = (
    effectId: string,
    params: Readonly<Record<string, number | string>>,
    application?: Readonly<Record<string, number | string>>,
  ) => {
    const current = commands.getState().effects.find((effect) => effect.instanceId === effectId);
    if (!current) return null;
    const animation: Record<string, ParameterAnimation> = {};
    const staticParams: Record<string, number | string> = {};
    const staticApplication: Record<string, number | string> = {};
    const fpsNow = commands.getState().timeline?.fps ?? 30;
    const t = frameTime(frame, fpsNow);
    for (const [key, value] of Object.entries(params)) {
      const lane = current.animation?.[key];
      if (lane?.keys.length) animation[key] = upsertKey(lane, t, value, fpsNow);
      else staticParams[key] = value;
    }
    for (const [key, value] of Object.entries(application ?? {})) {
      const lane = current.animation?.[`application.${key}`];
      if (lane?.keys.length) animation[`application.${key}`] = upsertKey(lane, t, value, fpsNow);
      else staticApplication[key] = value;
    }
    return { animation, staticParams, staticApplication };
  };
  const animationUi = (effect: EffectInstance): ParameterAnimationUi => ({
    showStatic: timelineMode,
    selectedKey: selectedParam?.effectId === effect.instanceId ? selectedParam.key : null,
    info: (key) => {
      const info = parameterKeyInfo(effect, key, frame, fps);
      if (!info?.modulators) return info;
      const audio = effect.animation?.[key]?.modulators?.find(
        (modulator) => modulator.kind === 'audio' && modulator.enabled,
      );
      return audio && audio.kind === 'audio'
        ? {
            ...info,
            note: `Follows ${timeline?.audio?.name ?? 'the audio track'} · ${audio.band === 'custom' ? `${audio.lowHz}–${audio.highHz} Hz` : `${audio.band[0]!.toUpperCase()}${audio.band.slice(1)} band`} · range ${Math.round(audio.outMin * 100)}–${Math.round(audio.outMax * 100)}%`,
          }
        : info;
    },
    toggleKey: (key) => toggleKey(effect.instanceId, key),
    jump: (key, direction) => {
      const target = adjacentKeyFrame(effect.animation?.[key], frame, fps, direction);
      if (target !== null) seek(target);
    },
    select: (key) => setSelectedParam({ effectId: effect.instanceId, key }),
    openModulators: (key) => {
      setSelectedParam({ effectId: effect.instanceId, key });
      setModulatorParam({ effectId: effect.instanceId, key });
    },
  });
  /** Copy a modulated control's curve to editable keys; the link is kept to restore. */
  const bakeCurve = (effectId: string, key: string) => {
    const state = commands.getState();
    const effect = state.effects.find((entry) => entry.instanceId === effectId);
    const animation = effect?.animation?.[key];
    const definition = effect && animationDefinition(effect, key);
    if (!effect || !animation || !definition || !state.timeline) return;
    try {
      const baked = bakeModulation(
        animation,
        parameterBaseValue(effect, key),
        definition,
        modulation,
        state.timeline,
      );
      commands.endHistoryGroup();
      commands.updateEffect(effectId, { animation: { [key]: baked } });
      setModulatorParam(null);
      setSelectedParam({ effectId, key });
      revealAnimationCard();
      setNotice(`Copied ${definition.label} to ${baked.keys.length} keyframes`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not copy the curve.');
    }
  };
  /** Put back the link a copy replaced, after warning that the edited keys go. */
  const restoreLink = async (effectId: string, key: string) => {
    const before = commands.getState().effects.find((entry) => entry.instanceId === effectId)
      ?.animation?.[key];
    if (!before?.baked) return;
    try {
      const confirmed = unwrap(
        await window.gleech.confirmAction(
          'Restore audio link',
          'Restore the audio link?',
          `The edited curve (${before.keys.length} keyframe${
            before.keys.length === 1 ? '' : 's'
          }) will be replaced by the original link and its settings.`,
          'Restore',
        ),
      );
      const animation = commands.getState().effects.find((entry) => entry.instanceId === effectId)
        ?.animation?.[key];
      if (!confirmed || !animation?.baked) return;
      const restored = restoreBaked(animation);
      commands.endHistoryGroup();
      commands.updateEffect(effectId, { animation: { [key]: restored } });
      setSelectedParam({ effectId, key });
      setModulatorParam(restored?.modulators?.length ? { effectId, key } : null);
      setNotice('Restored the audio link');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not restore the link.');
    }
  };
  /** Scroll the inspector to the selected control's Animation card once it renders. */
  const revealAnimationCard = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.document
          .querySelector('.detail-panel .animation-card')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      ),
    );
  const animationCardFor = (effect: EffectInstance) => {
    if (!selectedParam || selectedParam.effectId !== effect.instanceId) return null;
    const key = selectedParam.key;
    const animation = effect.animation?.[key];
    const definition = animationDefinition(effect, key);
    if (!animation || !definition) return null;
    const eases = new Set(animation.keys.slice(0, -1).map((entry) => entry.interpolation));
    const update = (next: ParameterAnimation | null, extra: Record<string, unknown> = {}) => {
      try {
        commands.endHistoryGroup();
        commands.updateEffect(effect.instanceId, { animation: { [key]: next }, ...extra });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not change the animation.');
      }
    };
    return (
      <AnimationCard
        label={definition.label}
        interpolation={
          animation.keys.length === 0
            ? null
            : eases.size > 1
              ? 'mixed'
              : (animation.keys[0]?.interpolation ?? null)
        }
        keyCount={animation.keys.length}
        canLinkAudio={Boolean(timeline?.audio) && definition.kind === 'number'}
        copied={Boolean(animation.baked)}
        disabled={busy !== null}
        onEase={(interpolation) => update(setKeysInterpolation(animation, 'all', interpolation))}
        onAddLfo={() => {
          if (definition.kind !== 'number') {
            setError('LFOs drive numeric controls only.');
            return;
          }
          update({
            ...animation,
            modulators: [...(animation.modulators ?? []), createLfo(crypto.randomUUID())],
          });
          setModulatorParam({ effectId: effect.instanceId, key });
        }}
        onLinkAudio={() => {
          if (animation.baked) {
            void restoreLink(effect.instanceId, key);
            return;
          }
          update({
            ...animation,
            modulators: [
              ...(animation.modulators ?? []),
              createAudioModulator(crypto.randomUUID()),
            ],
          });
          setModulatorParam({ effectId: effect.instanceId, key });
        }}
        onClear={() => {
          // Clearing keeps the value shown at the playhead as the static value.
          const value = evaluateParameter(
            animation,
            parameterBaseValue(effect, key),
            frameT,
            definition,
            modulation,
          );
          update(
            null,
            key.startsWith('application.')
              ? { application: { [key.slice(12)]: value } }
              : { params: { [key]: value } },
          );
          setSelectedParam(null);
        }}
      />
    );
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input:not([type="range"]):not([type="checkbox"]), textarea, select, [contenteditable="true"], dialog[open]',
        )
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === 'r' || key === 'g')) {
        event.preventDefault();
        openRender(key === 'r' ? 'video' : 'gif');
        return;
      }
      if (!timelineMode || event.ctrlKey || event.metaKey || event.altKey) return;
      // The canvas keeps Space (compare) and Home (fit); sliders keep their arrows.
      if (target?.closest('.viewport-stage')) return;
      const onRange = target instanceof HTMLInputElement && target.type === 'range';
      const active = commands.getState().timeline;
      if (!active) return;
      const step = event.shiftKey ? 10 : 1;
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !onRange) {
        event.preventDefault();
        setPlaying(false);
        seek(frame + (event.key === 'ArrowLeft' ? -step : step));
      } else if (event.key === 'Home' && !onRange) {
        event.preventDefault();
        seek(0);
      } else if (event.key === 'End' && !onRange) {
        event.preventDefault();
        seek(totalFrames - 1);
      } else if (key === 'm') {
        event.preventDefault();
        addMarker();
      } else if (key === 'i' || key === 'o') {
        event.preventDefault();
        const t = frameTime(frame, active.fps);
        const end = totalFrames / active.fps;
        const current = active.inOut ?? { start: 0, end };
        // Out includes the frame under the playhead.
        const out = Math.min(end, frameTime(frame + 1, active.fps));
        const next =
          key === 'i' ? { start: t, end: current.end } : { start: current.start, end: out };
        if (next.end > next.start) commands.updateTimeline({ inOut: next });
      } else if (event.key === ',' || event.key === '.') {
        event.preventDefault();
        const lanes = selected?.animation
          ? Object.values(selected.animation)
          : commands.getState().effects.flatMap((effect) => Object.values(effect.animation ?? {}));
        const frames = lanes
          .flatMap((lane) => lane.keys.map((entry) => timeFrame(entry.t, active.fps)))
          .filter((value) => (event.key === ',' ? value < frame : value > frame));
        if (frames.length) seek(event.key === ',' ? Math.max(...frames) : Math.min(...frames));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const paintMask = (id: string) => {
    setMaskGeometryDraft(null);
    const current = commands.getState();
    const effect = current.effects.find((e) => e.instanceId === id);
    if (!effect || !current.source) return;
    if (!effect.paintedMask)
      commands.setEffectMask(id, createPaintedMask(current.source.width, current.source.height));
    setSelectedId(id);
    setMaskTarget(id);
  };
  const clipboardAction = async (action: 'copy' | 'paste' | 'duplicate' | 'reset') => {
    const menu = settingsMenu;
    setSettingsMenu(null);
    if (!menu || locked.current || clipboardPending.current) return;
    const effect = commands.getState().effects.find((e) => e.instanceId === menu.effectId);
    if (!effect) return;
    const feedback = (text: string) =>
      setClipboardFeedback({ text, id: ++clipboardSequence.current });
    clipboardPending.current = true;
    try {
      if (action === 'reset') {
        feedback(
          commands.resetEffectSetting(effect.instanceId, menu.target)
            ? 'Reset ' + settingsLabel(effect, menu.target)
            : 'Nothing reset',
        );
      } else if (action === 'duplicate') {
        const id = crypto.randomUUID();
        commands.duplicateEffect(effect.instanceId, id);
        finishMask();
        setSelectedId(id);
        feedback('Duplicated filter');
      } else if (action === 'copy') {
        const data = copySettings(effect, menu.target);
        if (!data) {
          feedback('Nothing copied');
          return;
        }
        unwrap(await window.gleech.writeSettings(data));
        feedback('Copied ' + settingsLabel(effect, menu.target));
      } else {
        const data = unwrap(await window.gleech.readSettings());
        // The project may have changed while Windows read the clipboard.
        if (locked.current) {
          feedback('Nothing pasted');
          return;
        }
        const applied = data && commands.pasteEffectSettings(effect.instanceId, data, menu.target);
        if (!applied) feedback('Nothing pasted');
        else {
          const labelTarget = settingsPasteTarget(effect, data, menu.target);
          feedback('Pasted ' + settingsLabel(effect, labelTarget));
        }
      }
    } catch (failure) {
      feedback(
        action === 'paste'
          ? 'Nothing pasted'
          : action === 'duplicate'
            ? 'Could not duplicate filter'
            : action === 'reset'
              ? 'Could not reset control'
              : 'Copy failed',
      );
      setNotice(failure instanceof Error ? failure.message : 'Clipboard operation failed.');
    } finally {
      clipboardPending.current = false;
    }
  };
  const originalPixels = useCallback(
    async (id: string) => unwrap(await window.gleech.originalPixels(id)),
    [],
  );
  /** Full-resolution source pixels at the playhead: the clip frame, or the still image. */
  const stillPixels = useCallback(
    async (id: string) => {
      const state = commands.getState();
      const frames = clipFrames.current;
      const active = activeVideo(state);
      if (frames && active && state.source?.id === id)
        return frames.frameAt(frameContext.current.t, Math.max(active.width, active.height));
      return originalPixels(id);
    },
    [originalPixels],
  );

  useEffect(() => {
    if (!addingEffect) return;
    let active = true;
    void window.gleech
      .listShaders()
      .then((result) => {
        if (active) setShaders(unwrap(result));
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Could not load shaders.');
      });
    void window.gleech
      .listPresets()
      .then((result) => {
        if (!active) return;
        const entries = unwrap(result);
        setPresets(entries);
        setPresetLibraryError(null);
      })
      .catch((failure) => {
        if (active)
          setPresetLibraryError(
            failure instanceof Error ? failure.message : 'Could not load presets.',
          );
      })
      .finally(() => {
        if (active) setPresetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addingEffect, presetReload]);

  const editPreset = useCallback(
    async (
      name: string,
      thumbnail: string,
      choice: 'image' | 'statue',
      draft: NonNullable<typeof presetDialog>,
    ) => {
      if (locked.current) return;
      locked.current = true;
      setBusy('preset');
      setError(null);
      setNotice(draft.id ? 'Updating preset…' : 'Saving preset…');
      try {
        unwrap(
          draft.id
            ? await window.gleech.editPreset(draft.id, name, thumbnail, choice)
            : await window.gleech.storePreset(draft.recipe, name, thumbnail, choice),
        );
        setPresetDialog(null);
        setNotice((draft.id ? 'Updated preset ' : 'Saved preset ') + name);
        openPicker('presets');
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not save this preset.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [openPicker],
  );

  const deletePreset = useCallback(
    async (preset: EffectPreset) => {
      if (locked.current) return;
      locked.current = true;
      setFileMenu(false);
      setAddingEffect(false);
      setBusy('preset');
      setError(null);
      setNotice('Deleting preset…');
      try {
        unwrap(await window.gleech.deletePreset(preset.id));
        setNotice('Deleted preset ' + preset.name);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not delete this preset.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
        openPicker('presets');
      }
    },
    [openPicker],
  );

  const transferPreset = useCallback(
    async (preset?: EffectPreset) => {
      if (locked.current) return;
      locked.current = true;
      setFileMenu(false);
      setAddingEffect(false);
      setBusy('preset');
      setError(null);
      setNotice(preset ? 'Exporting preset…' : 'Importing preset…');
      try {
        if (preset) {
          const file = unwrap(await window.gleech.exportPreset(preset.id));
          setNotice(file ? 'Exported preset ' + file : 'Preset export canceled');
        } else {
          const imported = unwrap(await window.gleech.importPreset());
          setNotice(imported ? 'Imported preset ' + imported.name : 'Preset import canceled');
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not transfer this preset.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
        openPicker('presets');
      }
    },
    [openPicker],
  );

  const beginPresetSave = (fromMenu = false) => {
    const current = commands.getState();
    if (locked.current || !current.source || !current.effects.length) return;
    setFileMenu(false);
    setAddingEffect(false);
    setError(null);
    setPresetDialog({
      name: `Preset ${String(presets.length + 1).padStart(2, '0')}`,
      fromMenu,
      recipe: { effects: current.effects, masterSeed: current.masterSeed },
    });
  };

  const applyPreset = (preset: EffectPreset, placement: PresetPlacement) => {
    if (locked.current || !commands.getState().source) return;
    try {
      const used = new Set(
        placement === 'replace'
          ? []
          : commands.getState().effects.map((effect) => effect.instanceId),
      );
      const ids = preset.effects.map((effect) => {
        let id = effect.instanceId;
        while (used.has(id)) id = crypto.randomUUID();
        used.add(id);
        return id;
      });
      commands.applyPreset(preset, placement, ids);
      setSelectedId(
        placement === 'merge'
          ? (commands.getState().effects.at(-1)?.instanceId ?? null)
          : (ids.at(-1) ?? null),
      );
      setInspectorTab('controls');
      setAddingEffect(false);
      setNotice(
        placement === 'replace'
          ? 'Applied preset ' + preset.name
          : placement === 'merge'
            ? 'Merged preset ' + preset.name
            : `Added ${preset.name} ${placement} current effects`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not apply this preset.');
    }
  };

  // Called only while the operation lock is held, including Save from an unsaved-changes prompt.
  const saveLocked = useCallback(
    async (saveAs = false) => {
      const snapshot = commands.getState();
      if (!snapshot.source) return false;
      setNotice('Saving project…');
      const saved = unwrap(
        await window.gleech.saveProject(
          snapshot,
          document?.id ?? null,
          saveAs || Boolean(document && savedState && snapshot.name !== savedState.name),
        ),
      );
      if (saved) {
        setDocument(saved);
        setSavedState(snapshot);
      }
      setNotice(
        saved
          ? 'Saved ' + saved.name + (saved.recentWarning ? ` · ${saved.recentWarning}` : '')
          : 'Save canceled',
      );
      return Boolean(saved);
    },
    [document, savedState],
  );
  const confirmLeave = useCallback(async () => {
    const current = commands.getState();
    if (!current.source || current === savedState) return true;
    const decision = unwrap(await window.gleech.confirmDiscard(document?.name ?? current.name));
    if (decision === 'save') return saveLocked();
    if (decision === 'cancel') setNotice('Canceled');
    return decision === 'discard';
  }, [document, savedState, saveLocked]);

  const importImage = useCallback(
    async (load: () => Promise<Result<ImportedImage | null>>) => {
      if (locked.current) return;
      locked.current = true;
      setBusy('import');
      setError(null);
      setNotice('Opening image…');
      let candidate: ImportedImage | null = null;
      try {
        if (!(await confirmLeave())) return;
        candidate = unwrap(await load());
        if (!candidate) {
          setNotice('Ready');
          return;
        }
        if (!viewport.current) throw new Error('The viewport is not ready.');
        await viewport.current.showImage(candidate);
        rememberImage(candidate);
        commands.setSource(candidate.source);
        setDocument(null);
        setSavedState(null);
        setNotice(`Opened ${candidate.source.name}`);
      } catch (failure) {
        if (candidate && commands.getState().source?.id !== candidate.source.id)
          await window.gleech.releaseImage(candidate.source.id);
        setError(failure instanceof Error ? failure.message : 'Could not open this image.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [confirmLeave, rememberImage],
  );

  const openImage = useCallback(() => {
    setFileMenu(false);
    void importImage(() => window.gleech.openImage());
  }, [importImage]);
  const openSampleImage = useCallback(() => {
    setFileMenu(false);
    void importImage(() => window.gleech.openSampleImage());
  }, [importImage]);
  const pasteImage = useCallback(() => {
    setFileMenu(false);
    void importImage(() => window.gleech.pasteImage());
  }, [importImage]);
  const copyImage = useCallback(async () => {
    setFileMenu(false);
    const source = commands.getState().source;
    if (locked.current || !source || !viewport.current) return;
    locked.current = true;
    setBusy('export');
    setError(null);
    setNotice('Copying edited image…');
    try {
      const pixels = await stillPixels(source.id);
      const rendered = await viewport.current.exportPixels(pixels);
      unwrap(await window.gleech.copyImage(source.id, rendered.pixels));
      setNotice('Copied edited image');
      setClipboardFeedback({ text: 'Copied image', id: ++clipboardSequence.current });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not copy the image.');
      setNotice('Copy failed');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }, [stillPixels]);
  const exitGleech = async () => {
    setFileMenu(false);
    try {
      await window.gleech.requestClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not close GLEECH.');
    }
  };
  const saveImage = useCallback(
    async (options: ImageExportOptions = { format: 'png' }) => {
      setFileMenu(false);
      const source = commands.getState().source;
      if (locked.current || !source || !viewport.current) return;
      locked.current = true;
      setBusy('export');
      setError(null);
      setNotice('Exporting original-resolution ' + options.format.toUpperCase() + '…');
      try {
        const pixels = await stillPixels(source.id);
        const rendered = await viewport.current.exportPixels(pixels);
        const name = unwrap(
          await window.gleech.saveImage(
            source.id,
            rendered.pixels,
            options,
            commands.getState().name,
          ),
        );
        setExportBackend(rendered.backend);
        setNotice(name ? `Exported ${name}` : 'Export canceled');
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not export the image.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [stillPixels],
  );

  const saveProject = useCallback(
    async (saveAs = false) => {
      if (locked.current || !commands.getState().source) return;
      locked.current = true;
      setBusy('project');
      setError(null);
      setNotice('Saving project…');
      setFileMenu(false);
      try {
        await saveLocked(saveAs);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not save the project.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [saveLocked],
  );

  const openProject = useCallback(
    async (recentId?: string) => {
      if (locked.current || !viewport.current) return;
      locked.current = true;
      setBusy('project');
      setError(null);
      setFileMenu(false);
      setNotice('Opening project…');
      let candidate;
      try {
        if (!(await confirmLeave())) return;
        candidate = unwrap(
          await (recentId
            ? window.gleech.openRecentProject(recentId)
            : window.gleech.openProject()),
        );
        if (!candidate) {
          setNotice('Open canceled');
          return;
        }
        try {
          await viewport.current.showImage(
            candidate.image,
            candidate.project.effects,
            candidate.project.masterSeed,
          );
        } catch (failure) {
          // Keep a GPU-only recipe editable on machines without WebGPU. Display
          // its source so the user can disable that effect and continue on CPU.
          if (
            !candidate.project.effects.some((effect) => effect.type === 'shader-import') ||
            !(failure instanceof Error) ||
            !failure.message.includes('requires WebGPU')
          )
            throw failure;
          await viewport.current.showImage(candidate.image, [], candidate.project.masterSeed);
          setError(failure.message);
        }
        for (const image of candidate.images) rememberImage(image);
        commands.loadProject(candidate.project);
        setSavedState(commands.getState());
        setDocument(candidate.document);
        setSelectedId(null);
        setPlaying(false);
        // Image mode shows the clip frame that is the source image.
        const reopened = activeVideo(candidate.project);
        setPlayhead(
          reopened && candidate.project.timeline
            ? timeFrame(reopened.posterTime ?? 0, candidate.project.timeline.fps)
            : 0,
        );
        setSelectedParam(null);
        setModulatorParam(null);
        setMode('image');
        setNotice(
          `Opened ${candidate.document.name}${candidate.document.recentWarning ? ` · ${candidate.document.recentWarning}` : ''}`,
        );
      } catch (failure) {
        if (candidate && commands.getState().source?.id !== candidate.image.source.id)
          await Promise.all(
            candidate.images.map((image) => window.gleech.releaseImage(image.source.id)),
          );
        setError(failure instanceof Error ? failure.message : 'Could not open the project.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [confirmLeave, rememberImage],
  );

  useEffect(() => {
    window.document.title = `${dirty ? '• ' : ''}${displayName} — GLEECH`;
  }, [dirty, displayName]);

  useEffect(() => {
    if (!fileMenu) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !fileMenuRef.current?.contains(event.target))
        setFileMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFileMenu(false);
        fileMenuRef.current?.querySelector('button')?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [fileMenu]);

  useEffect(() => {
    const retained = commands.retainedSourceIds();
    for (const id of assets.current.keys()) {
      if (retained.has(id)) continue;
      assets.current.delete(id);
      setFieldImages((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      void window.gleech.releaseImage(id);
    }
  }, [project]);

  const restoreHistory = useCallback(async (direction: 'undo' | 'redo', guard?: () => void) => {
    if (
      locked.current ||
      !viewport.current ||
      !(direction === 'undo' ? commands.canUndo() : commands.canRedo())
    )
      return;
    locked.current = true;
    setBusy('history');
    setError(null);
    const previousId = commands.getState().source?.id;
    commands[direction]();
    try {
      const source = commands.getState().source;
      if (source?.id !== previousId) {
        if (source) {
          const image = assets.current.get(source.id);
          if (!image) throw new Error('This image is no longer available.');
          await viewport.current.showImage(
            image,
            commands.getState().effects,
            commands.getState().masterSeed,
          );
        } else viewport.current.clearImage();
      }
      guard?.();
      setNotice(direction === 'undo' ? 'Undid edit' : 'Redid edit');
      const context = documentHistory.current.get(commands.getState());
      if (context) {
        setDocument(context.document);
        setSavedState(context.savedState);
        documentState.current = context;
      }
      return true;
    } catch (failure) {
      commands[direction === 'undo' ? 'redo' : 'undo']();
      setError(failure instanceof Error ? failure.message : 'Could not restore this edit.');
      return false;
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }, []);

  useEffect(
    () =>
      window.gleech.onCloseRequested(() => {
        if (locked.current) {
          setNotice('Please wait for the current operation before closing.');
          void window.gleech.resolveClose(false);
          return;
        }
        if (
          renderQueue.busy() &&
          !window.confirm('A render is still running. Close GLEECH and cancel it?')
        ) {
          void window.gleech.resolveClose(false);
          return;
        }
        locked.current = true;
        setBusy('project');
        setError(null);
        void (async () => {
          let allow = false;
          try {
            allow = await confirmLeave();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save the project.');
          } finally {
            await window.gleech.resolveClose(allow);
            locked.current = false;
            setBusy(null);
          }
        })();
      }),
    [confirmLeave],
  );

  const captureStage = useCallback(
    async (name: string, bake: boolean, guard?: () => void, signal?: AbortSignal) => {
      if (locked.current || !viewport.current) return;
      locked.current = true;
      setBusy('snapshot');
      setError(null);
      setNotice(bake ? 'Baking full-resolution image…' : 'Capturing full-resolution snapshot…');
      const before = commands.getState();
      let candidate: ImportedImage | null = null;
      try {
        if (!before.source) throw new Error('Open an image first.');
        const pixels = await stillPixels(before.source.id);
        const still = atPlayhead(before);
        const rendered = await viewport.current.exportPixels(
          pixels,
          still.effects,
          still.masterSeed,
          signal,
        );
        candidate = unwrap(
          await window.gleech.captureImage(before.source.id, rendered.pixels, name),
        );
        guard?.();
        if (bake) await viewport.current.showImage(candidate, [], before.masterSeed);
        guard?.();
        rememberImage(candidate);
        const snapshotId = crypto.randomUUID();
        commands.captureSnapshot(
          snapshotId,
          name,
          candidate.source,
          new Date().toISOString(),
          bake,
        );
        // On a timeline, stages appear as markers at the frame they captured.
        const active = commands.getState().timeline;
        if (active)
          commands.updateTimeline({
            markers: [
              ...active.markers,
              { id: crypto.randomUUID(), t: frameContext.current.t, name, snapshotId },
            ],
          });
        setSelectedId(null);
        setExportBackend(rendered.backend);
        setNotice((bake ? 'Baked ' : 'Captured ') + name);
        return snapshotId;
      } catch (failure) {
        if (candidate && !commands.retainedSourceIds().has(candidate.source.id)) {
          const candidateId = candidate.source.id;
          assets.current.delete(candidateId);
          setFieldImages((previous) => {
            const next = new Map(previous);
            next.delete(candidateId);
            return next;
          });
          await window.gleech.releaseImage(candidate.source.id);
          const previous = before.source && assets.current.get(before.source.id);
          if (previous)
            await viewport.current
              .showImage(previous, before.effects, before.masterSeed)
              .catch(() => {});
        }
        setError(failure instanceof Error ? failure.message : 'Could not capture this stage.');
        setNotice('Ready');
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [stillPixels, rememberImage, atPlayhead],
  );

  const restoreStage = useCallback(
    async (id: string | null, mode: 'recipe' | 'source', guard?: () => void) => {
      if (locked.current || !viewport.current) return;
      const before = commands.getState();
      const snapshot = id ? before.snapshots.find((entry) => entry.id === id) : null;
      const source = snapshot
        ? mode === 'source'
          ? snapshot.rendered
          : snapshot.source
        : before.origin;
      if (!source) return;
      locked.current = true;
      setBusy('history');
      setError(null);
      try {
        const image = assets.current.get(source.id);
        if (!image) throw new Error('This stage is no longer available.');
        await viewport.current.showImage(
          image,
          mode === 'recipe' && snapshot ? snapshot.effects : [],
          snapshot?.masterSeed ?? before.masterSeed,
        );
        guard?.();
        if (id) commands.restoreSnapshot(id, mode);
        else commands.restoreOrigin();
        setSelectedId(null);
        setNotice(
          snapshot
            ? (mode === 'source' ? 'Using ' : 'Restored ') + snapshot.name
            : 'Restored origin',
        );
        return true;
      } catch (failure) {
        const previous = before.source && assets.current.get(before.source.id);
        if (previous)
          await viewport.current
            .showImage(previous, before.effects, before.masterSeed)
            .catch(() => {});
        setError(failure instanceof Error ? failure.message : 'Could not restore this stage.');
        return false;
      } finally {
        locked.current = false;
        setBusy(null);
      }
    },
    [],
  );

  useEffect(() => {
    const adapter = createMcpCommands(commands);
    documentHistory.current.set(commands.getState(), { ...documentState.current });
    let observedDocumentState = commands.getState();
    const unsubscribeDocuments = commands.subscribe(() => {
      // Record the state being left. Its replacement can receive a different
      // document binding after the project notification (Open, Save As, Undo).
      documentHistory.current.set(observedDocumentState, { ...documentState.current });
      observedDocumentState = commands.getState();
    });
    let mode: McpMode = 'off';
    let active = true;
    const unsubscribeStatus = window.gleech.onMcpStatusChanged((status) => {
      mode = status.mode;
      setMcpMode(status.mode);
      setMcpOperation(
        status.operation ? `${status.operation.client} · ${status.operation.action}` : null,
      );
    });
    void window.gleech
      .mcpStatus()
      .then((status) => {
        if (active) {
          mode = status.mode;
          setMcpMode(status.mode);
        }
      })
      .catch(() => {});
    const controllers = new Map<string, AbortController>();
    const unsubscribeCancel = window.gleech.onMcpCancelled((id) => controllers.get(id)?.abort());
    const unsubscribeRequest = window.gleech.onMcpRequest((dispatch) => {
      const controller = new AbortController();
      const signal = controller.signal;
      const abortViewport = () => {
        if (locked.current) viewport.current?.cancelRender();
      };
      signal.addEventListener('abort', abortViewport, { once: true });
      controllers.set(dispatch.id, controller);
      void (async () => {
        try {
          const request = dispatch.request;
          if (!active || signal.aborted || Date.now() > dispatch.deadline || mode === 'off')
            throw new Error('MCP request is no longer active.');
          if (isMutation(request) && !['edit', 'full'].includes(mode))
            throw new Error('Enable Edit mode in GLEECH to make changes.');
          if (
            locked.current &&
            (isMutation(request) ||
              request.action === 'render_preview' ||
              request.action === 'render_variation' ||
              request.action === 'compare_versions' ||
              request.action === 'analyze_image')
          )
            throw new Error('GLEECH is busy. Try again after the current operation.');
          if (isMutation(request) && globalThis.document.querySelector('.mask-paint-surface'))
            throw new Error('Finish mask painting before editing through MCP.');
          if (
            isMutation(request) &&
            (globalThis.document.querySelector('dialog[open]') ||
              globalThis.document.querySelector('input:active'))
          )
            throw new Error(
              'Finish the current dialog or control interaction before editing through MCP.',
            );
          adapter.checkRevision(request);
          let value: Record<string, unknown>;
          if (request.action === 'get_mcp_status') {
            value = { ...(await window.gleech.mcpStatus()) };
          } else if (request.action === 'analyze_image') {
            const before = commands.getState();
            if (!before.source) throw new Error('Open an image before analysis.');
            locked.current = true;
            setBusy('export');
            setNotice('MCP · analyzing source image…');
            try {
              const analysis = unwrap(
                await window.gleech.analyzeMcpImage(dispatch.id, before.source.id),
              );
              if (
                commands.getState() !== before ||
                signal.aborted ||
                Date.now() >= dispatch.deadline
              )
                throw new Error('Project changed or analysis expired.');
              value = {
                ...analysis,
                revision: adapter.state().revision,
                sourceId: before.source.id,
              };
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'compare_versions') {
            const before = commands.getState();
            if (!before.source) throw new Error('Open an image before comparing versions.');
            const other =
              request.against === 'source'
                ? before.source
                : request.against === 'origin'
                  ? before.origin
                  : before.snapshots.find((snapshot) => snapshot.id === request.snapshotId)
                      ?.rendered;
            if (!other)
              throw new Error(
                'Comparison source does not exist. Select a saved snapshot or existing origin.',
              );
            locked.current = true;
            setBusy('export');
            setNotice('MCP · comparing versions…');
            try {
              const edited = await renderMcpPreview(
                before.source.id,
                {
                  effects: before.effects,
                  masterSeed: before.masterSeed,
                },
                signal,
              );
              const comparison = await renderMcpPreview(
                other.id,
                {
                  effects: [],
                  masterSeed: before.masterSeed,
                },
                signal,
              );
              if (
                commands.getState() !== before ||
                signal.aborted ||
                Date.now() >= dispatch.deadline
              )
                throw new Error('Project changed or comparison expired.');
              value = {
                revision: adapter.state().revision,
                against: request.against,
                comparisonSource: other,
                images: [
                  { name: 'Edited', png: edited.slice(22) },
                  { name: request.against, png: comparison.slice(22) },
                ],
              };
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'export_batch' || request.action === 'batch') {
            const before = commands.getState();
            locked.current = true;
            setBusy('export');
            const results: Record<string, unknown>[] = [];
            try {
              unwrap(await window.gleech.preflightMcpBatch(dispatch.id));
              const recipe = request.presetId
                ? unwrap(await window.gleech.listPresets()).find(
                    (preset) => preset.id === request.presetId,
                  )
                : { effects: before.effects, masterSeed: before.masterSeed };
              if (!recipe) throw new Error('Batch preset does not exist. Use list_presets.');
              for (const [index, item] of request.items.entries()) {
                setNotice(`MCP · batch ${index + 1}/${request.items.length}`);
                try {
                  if (
                    commands.getState() !== before ||
                    mode !== 'full' ||
                    signal.aborted ||
                    Date.now() >= dispatch.deadline
                  )
                    throw new Error('Project changed or batch access expired.');
                  const image = unwrap(await window.gleech.readMcpBatch(dispatch.id, index));
                  const pixels = await originalPixels(image.source.id);
                  const rendered = await renderMcpImage(image.source.id, pixels, recipe, signal);
                  if (
                    commands.getState() !== before ||
                    mode !== 'full' ||
                    signal.aborted ||
                    Date.now() >= dispatch.deadline
                  )
                    throw new Error('Project changed or batch access expired.');
                  const saved = unwrap(
                    await window.gleech.writeMcpBatch(dispatch.id, index, rendered.pixels),
                  );
                  results.push({ index, inputPath: item.inputPath, ok: true, ...saved });
                } catch (failure) {
                  results.push({
                    index,
                    inputPath: item.inputPath,
                    outputPath: item.outputPath,
                    ok: false,
                    error: failure instanceof Error ? failure.message : 'Batch item failed.',
                  });
                  if (
                    !request.continueOnError ||
                    mode !== 'full' ||
                    signal.aborted ||
                    Date.now() >= dispatch.deadline
                  )
                    break;
                } finally {
                  await window.gleech.cleanupMcpBatch(dispatch.id);
                }
              }
              value = {
                revision: adapter.state().revision,
                results,
                completed: results.filter((result) => result.ok).length,
                failed: results.filter((result) => !result.ok).length,
                skipped: request.items.length - results.length,
                projectUnchanged: commands.getState() === before,
              };
            } finally {
              await window.gleech.cleanupMcpBatch(dispatch.id);
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'list_presets' || request.action === 'get_style_recipe') {
            const library = unwrap(await window.gleech.listPresets());
            if (request.action === 'get_style_recipe')
              value = adapter.execute(request, { presets: library });
            else
              value = {
                presets: library
                  .map((preset) => ({
                    id: preset.id,
                    name: preset.name,
                    builtIn: Boolean(preset.builtIn),
                    description: preset.description ?? '',
                    layerCount: preset.effects.length,
                    types: preset.effects.map((effect) => effect.type),
                    hasShaders: preset.effects.some((effect) => effect.type.startsWith('shader-')),
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name)),
              };
          } else if (
            request.action === 'apply_operations' &&
            request.operations.some(
              (operation) =>
                operation.action === 'apply_preset' || operation.action === 'apply_style_recipe',
            )
          ) {
            const before = commands.getState();
            locked.current = true;
            setBusy('preset');
            try {
              const library = unwrap(await window.gleech.listPresets());
              unwrap(await window.gleech.validateMcpRecipes(dispatch.id));
              if (
                commands.getState() !== before ||
                !['edit', 'full'].includes(mode) ||
                signal.aborted ||
                Date.now() >= dispatch.deadline
              )
                throw new Error('The project changed or this preset operation expired.');
              value = adapter.execute(request, { presets: library });
              setSelectedId(commands.getState().effects.at(-1)?.instanceId ?? null);
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (
            request.action === 'save_preset' ||
            request.action === 'duplicate_preset' ||
            request.action === 'import_preset' ||
            request.action === 'export_preset'
          ) {
            const before = commands.getState();
            locked.current = true;
            setBusy('preset');
            setNotice('MCP · preset library…');
            try {
              let result;
              if (request.action === 'save_preset') {
                if (!before.source || !before.effects.length)
                  throw new Error('Add effects to an image before saving a preset.');
                const recipe = { effects: before.effects, masterSeed: before.masterSeed };
                const thumbnails = await renderPresetThumbnails(
                  request.thumbnail === 'image' ? before.source.id : null,
                  recipe,
                );
                if (
                  commands.getState() !== before ||
                  !['edit', 'full'].includes(mode) ||
                  signal.aborted ||
                  Date.now() >= dispatch.deadline
                )
                  throw new Error('Project changed or preset thumbnail expired.');
                result = unwrap(
                  await window.gleech.mcpPresetOperation(dispatch.id, {
                    recipe,
                    thumbnail:
                      request.thumbnail === 'image'
                        ? (thumbnails.image ?? thumbnails.statue)
                        : thumbnails.statue,
                  }),
                );
              } else result = unwrap(await window.gleech.mcpPresetOperation(dispatch.id));
              setPresetReload((previous) => previous + 1);
              value = {
                ...(result.path ? { path: result.path } : {}),
                ...(result.preset
                  ? {
                      preset: {
                        id: result.preset.id,
                        name: result.preset.name,
                        createdAt: result.preset.createdAt,
                        thumbnailSource: result.preset.thumbnailSource,
                        layerCount: result.preset.effects.length,
                        hasShaders: result.preset.effects.some((effect) =>
                          effect.type.startsWith('shader-'),
                        ),
                      },
                    }
                  : {}),
              };
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'render_variation') {
            const candidate = adapter.variation(request.variationId);
            if (!candidate.project.source)
              throw new Error('Open an image before rendering a variation.');
            locked.current = true;
            setBusy('export');
            setNotice('MCP · rendering variation…');
            try {
              const png = await renderMcpPreview(
                candidate.project.source.id,
                {
                  effects: candidate.effects,
                  masterSeed: candidate.project.masterSeed,
                },
                signal,
              );
              adapter.variation(request.variationId);
              if (signal.aborted || Date.now() >= dispatch.deadline)
                throw new Error('Variation preview expired.');
              value = {
                variationId: candidate.id,
                similarity: candidate.similarity,
                revision: candidate.revision,
                png: png.replace(/^data:image\/png;base64,/, ''),
                mimeType: 'image/png',
              };
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (
            request.action === 'create_snapshot' ||
            request.action === 'bake_as_new_source' ||
            request.action === 'restore_snapshot' ||
            request.action === 'branch_from_snapshot'
          ) {
            const before = commands.getState();
            const guard = () => {
              if (
                !active ||
                !['edit', 'full'].includes(mode) ||
                signal.aborted ||
                Date.now() >= dispatch.deadline ||
                commands.getState() !== before
              )
                throw new Error('The project changed or snapshot operation expired.');
            };
            if (
              request.action === 'create_snapshot' ||
              (request.action === 'bake_as_new_source' && !request.snapshotId)
            ) {
              if (!before.source) throw new Error('Open an image before capturing a snapshot.');
              const id = await captureStage(
                request.name,
                request.action === 'bake_as_new_source' || request.bake,
                guard,
                signal,
              );
              if (!id) throw new Error('Could not capture this snapshot.');
              value = { ...adapter.state(), snapshotId: id };
            } else {
              if (
                !request.snapshotId ||
                !before.snapshots.some((snapshot) => snapshot.id === request.snapshotId)
              )
                throw new Error('Snapshot does not exist. Use list_snapshots.');
              if (
                !(await restoreStage(
                  request.snapshotId,
                  request.action === 'restore_snapshot' ? request.mode : 'source',
                  guard,
                ))
              )
                throw new Error('Could not restore this snapshot.');
              value = adapter.state();
            }
          } else if (
            request.action === 'request_folder_access' ||
            request.action === 'revoke_folder_access'
          ) {
            value = { ...(await window.gleech.mcpFolderOperation(dispatch.id)) };
          } else if (request.action === 'create_project') {
            const previous = commands.getState();
            documentHistory.current.set(previous, { ...documentState.current });
            commands.replaceProject(createProject(request.name, request.seed));
            viewport.current?.clearImage();
            setDocument(null);
            setSavedState(null);
            setSelectedId(null);
            setMaskTarget(null);
            documentState.current = { document: null, savedState: null };
            documentHistory.current.set(commands.getState(), { ...documentState.current });
            value = adapter.state();
          } else if (
            [
              'load_image',
              'load_image_data',
              'replace_source',
              'open_project',
              'save_project',
              'export_image',
              'render_full',
              'copy_to_clipboard',
            ].includes(request.action)
          ) {
            const previous = commands.getState();
            const previousContext = { ...documentState.current };
            locked.current = true;
            setBusy('project');
            setNotice(`MCP · ${request.action.replaceAll('_', ' ')}…`);
            let imported: ImportedImage[] = [];
            let renderWarning: string | null = null;
            try {
              if (
                request.action === 'load_image' ||
                request.action === 'load_image_data' ||
                request.action === 'replace_source' ||
                request.action === 'open_project'
              ) {
                const candidate = unwrap(
                  await (request.action === 'load_image_data'
                    ? window.gleech.readMcpImageData(dispatch.id)
                    : window.gleech.readMcpFile(dispatch.id)),
                );
                imported = candidate.kind === 'project' ? [...candidate.images] : [candidate.image];
                const next =
                  candidate.kind === 'project'
                    ? candidate.project
                    : {
                        ...previous,
                        source: candidate.image.source,
                        origin: candidate.image.source,
                        sourceSnapshotId: null,
                      };
                if (!viewport.current) throw new Error('The viewport is not ready.');
                try {
                  await viewport.current.showImage(candidate.image, next.effects, next.masterSeed);
                } catch (failure) {
                  if (
                    !next.effects.some((effect) => effect.type === 'shader-import') ||
                    !(failure instanceof Error) ||
                    !failure.message.includes('requires WebGPU')
                  )
                    throw failure;
                  await viewport.current.showImage(candidate.image, [], next.masterSeed);
                  renderWarning = failure.message;
                  setError(renderWarning);
                }
                unwrap(await window.gleech.checkMcpAccess(dispatch.id));
                if (
                  commands.getState() !== previous ||
                  signal.aborted ||
                  Date.now() >= dispatch.deadline
                )
                  throw new Error('The project changed or this file operation expired.');
                imported.forEach(rememberImage);
                documentHistory.current.set(previous, previousContext);
                if (candidate.kind === 'project') commands.replaceProject(next);
                else commands.setSource(candidate.image.source);
                const context =
                  candidate.kind === 'project'
                    ? { document: candidate.document, savedState: commands.getState() }
                    : { document: null, savedState: null };
                setDocument(context.document);
                setSavedState(context.savedState);
                documentState.current = context;
                documentHistory.current.set(commands.getState(), context);
                setSelectedId(null);
                setMaskTarget(null);
                value = { ...adapter.state(), ...(renderWarning ? { renderWarning } : {}) };
              } else if (request.action === 'save_project') {
                const saved = unwrap(
                  await window.gleech.writeMcpFile(dispatch.id, { project: previous }),
                );
                if (!saved.document) throw new Error('The project document was not saved.');
                if (commands.getState() !== previous)
                  throw new Error('Project changed while saving; the captured version was saved.');
                setDocument(saved.document);
                setSavedState(previous);
                documentState.current = { document: saved.document, savedState: previous };
                documentHistory.current.set(previous, { ...documentState.current });
                value = { ...adapter.state(), path: saved.path };
              } else if (
                request.action === 'export_image' ||
                request.action === 'render_full' ||
                request.action === 'copy_to_clipboard'
              ) {
                if (!previous.source || !viewport.current)
                  throw new Error('Open an image before exporting.');
                const still = atPlayhead(previous);
                const rendered = await viewport.current.exportPixels(
                  await stillPixels(previous.source.id),
                  still.effects,
                  still.masterSeed,
                  signal,
                );
                if (
                  commands.getState() !== previous ||
                  signal.aborted ||
                  Date.now() >= dispatch.deadline
                )
                  throw new Error('Project changed or export expired.');
                const exported =
                  request.action === 'copy_to_clipboard'
                    ? (unwrap(
                        await window.gleech.copyMcpImage(
                          dispatch.id,
                          previous.source.id,
                          rendered.pixels,
                        ),
                      ),
                      {
                        copied: true,
                        width: previous.source.width,
                        height: previous.source.height,
                        format: 'png',
                      })
                    : unwrap(
                        await window.gleech.writeMcpFile(dispatch.id, {
                          sourceId: previous.source.id,
                          pixels: rendered.pixels,
                        }),
                      );
                setExportBackend(rendered.backend);
                value = { ...exported, revision: adapter.state().revision };
              } else throw new Error('Unknown MCP file operation.');
            } catch (failure) {
              if (imported.length && commands.getState() === previous) {
                if (previous.source) {
                  const image = assets.current.get(previous.source.id);
                  if (image)
                    await viewport.current
                      ?.showImage(image, previous.effects, previous.masterSeed)
                      .catch(() => {});
                } else viewport.current?.clearImage();
                await Promise.all(
                  imported.map((image) => window.gleech.releaseImage(image.source.id)),
                );
              }
              throw failure;
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'render_preview') {
            const current = commands.getState();
            if (!current.source)
              throw new Error('Open an image in GLEECH before rendering a preview.');
            const revision = adapter.state().revision;
            locked.current = true;
            setBusy('export');
            setNotice('Rendering MCP preview…');
            try {
              const png = await renderMcpPreview(
                current.source.id,
                {
                  effects: current.effects,
                  masterSeed: current.masterSeed,
                },
                signal,
              );
              if (
                commands.getState() !== current ||
                signal.aborted ||
                Date.now() > dispatch.deadline
              )
                throw new Error(
                  'Project changed or preview expired. Inspect the state and request a new preview.',
                );
              value = {
                revision,
                mimeType: 'image/png',
                sourceWidth: current.source.width,
                sourceHeight: current.source.height,
                png: png.replace(/^data:image\/png;base64,/, ''),
              };
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (request.action === 'revert_to_operation') {
            const before = commands.getState();
            const target = adapter.operationTarget(request.operationId, request.point);
            locked.current = true;
            setBusy('history');
            try {
              if (target.source && target.source.id !== before.source?.id) {
                const image = assets.current.get(target.source.id);
                if (!image || !viewport.current)
                  throw new Error('This operation’s source is unavailable.');
                await viewport.current.showImage(image, target.effects, target.masterSeed);
              }
              signal.throwIfAborted();
              if (
                !['edit', 'full'].includes(mode) ||
                Date.now() >= dispatch.deadline ||
                commands.getState() !== before
              )
                throw new Error('Project changed or history operation expired.');
              commands.replaceProject(target);
              if (!target.source) viewport.current?.clearImage();
              const context = documentHistory.current.get(target);
              if (context) {
                setDocument(context.document);
                setSavedState(context.savedState);
                documentState.current = context;
                documentHistory.current.set(commands.getState(), context);
              }
              setSelectedId(null);
              setMaskTarget(null);
              value = adapter.state();
            } catch (failure) {
              if (commands.getState() === before && before.source) {
                const image = assets.current.get(before.source.id);
                if (image)
                  await viewport.current
                    ?.showImage(image, before.effects, before.masterSeed)
                    .catch(() => {});
              } else if (commands.getState() === before) viewport.current?.clearImage();
              throw failure;
            } finally {
              locked.current = false;
              setBusy(null);
            }
          } else if (TIMELINE_MCP_ACTIONS.includes(request.action)) {
            value = await runTimelineMcp(request, {
              dispatchId: dispatch.id,
              project: () => commands.getState(),
              revision: () => adapter.state().revision,
              playhead: () => frameContext.current.frame,
              setPlayhead: (target) => {
                // Playback would override a playhead set from MCP.
                setPlaying(false);
                setPlayhead(target);
              },
              videoMediaId: () => clipMediaId.current,
              signal,
              deadline: dispatch.deadline,
            });
          } else if (request.action === 'undo' || request.action === 'redo') {
            if (!(request.action === 'undo' ? commands.canUndo() : commands.canRedo()))
              throw new Error(`Nothing to ${request.action}.`);
            if (!(await restoreHistory(request.action, () => signal.throwIfAborted())))
              throw new Error('Could not restore this history step.');
            value = adapter.state();
          } else {
            value = adapter.execute(request);
            if (isMutation(request)) {
              const ids = new Set(commands.getState().effects.map((effect) => effect.instanceId));
              setSelectedId((previous) =>
                previous && ids.has(previous)
                  ? previous
                  : (commands.getState().effects.at(-1)?.instanceId ?? null),
              );
            }
          }
          signal.throwIfAborted();
          setNotice(`MCP · ${request.action.replaceAll('_', ' ')}`);
          window.gleech.replyMcp(dispatch.id, { ok: true, value });
        } catch (failure) {
          window.gleech.replyMcp(dispatch.id, {
            ok: false,
            error: failure instanceof Error ? failure.message : 'MCP operation failed.',
          });
        } finally {
          signal.removeEventListener('abort', abortViewport);
          controllers.delete(dispatch.id);
        }
      })();
    });
    return () => {
      active = false;
      unsubscribeStatus();
      unsubscribeRequest();
      unsubscribeCancel();
      unsubscribeDocuments();
      for (const controller of controllers.values()) controller.abort();
      adapter.dispose();
    };
  }, [
    restoreHistory,
    rememberImage,
    originalPixels,
    stillPixels,
    captureStage,
    restoreStage,
    atPlayhead,
  ]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        (event.target instanceof Element &&
          event.target.closest(
            'input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable="true"]',
          ))
      )
        return;
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void restoreHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (event.shiftKey) openImage();
        else void openProject();
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteImage();
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void copyImage();
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject(event.shiftKey);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        void saveImage();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [openImage, openProject, saveProject, pasteImage, copyImage, saveImage, restoreHistory]);

  return (
    <div
      className={`workspace${timelineMode ? ' timeline-mode' : ''}`}
      ref={setWorkspace}
      style={{ ...panelStyle, ['--dock-height' as string]: `${dockHeight}px` }}
      aria-busy={busy !== null}
      onContextMenu={(event) => {
        const element = event.target instanceof Element ? event.target : null;
        // Color entries also expose settings paste; keyboard text editing stays native.
        if (
          !element ||
          (!element.closest('.color-control') &&
            element.closest(
              'input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable="true"]',
            ))
        )
          return;
        const target = element.closest<HTMLElement>('[data-settings-kind]');
        const id = target?.closest<HTMLElement>('[data-effect-id]')?.dataset.effectId;
        if (!target || !id) return;
        event.preventDefault();
        if (busy !== null || locked.current) return;
        const kind = target.dataset.settingsKind;
        const setting: SettingsTarget =
          kind === 'parameter' || kind === 'color'
            ? { kind, key: target.dataset.settingsKey! }
            : kind === 'mask'
              ? { kind: 'mask' }
              : kind === 'direction-field'
                ? { kind: 'direction-field' }
                : { kind: 'effect' };
        commands.endHistoryGroup();
        if (id !== maskTarget) finishMask();
        setSelectedId(id);
        setFileMenu(false);
        const bounds = target.getBoundingClientRect();
        setSettingsMenu({
          x: event.clientX || bounds.left + 16,
          y: event.clientY || bounds.bottom,
          effectId: id,
          target: setting,
        });
      }}
    >
      {settingsMenu && (
        <SettingsContextMenu
          x={settingsMenu.x}
          y={settingsMenu.y}
          duplicate={settingsMenu.target.kind === 'effect'}
          reset={
            settingsMenu.target.kind === 'parameter' ||
            settingsMenu.target.kind === 'color' ||
            settingsMenu.target.kind === 'direction-field'
          }
          canCopy={
            settingsMenu.target.kind !== 'mask' ||
            Boolean(
              project.effects.find((e) => e.instanceId === settingsMenu.effectId)?.paintedMask,
            )
          }
          onAction={(action) => void clipboardAction(action)}
          onClose={closeSettingsMenu}
        />
      )}
      <header className={`toolbar${window.gleech.platform === 'win32' ? ' custom-titlebar' : ''}`}>
        {window.gleech.platform === 'win32' && (
          <WindowControls onClose={() => void exitGleech()} onError={setError} />
        )}
        <div
          className="file-menu"
          ref={fileMenuRef}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget)
            )
              setFileMenu(false);
          }}
        >
          <button
            className="file-menu-toggle"
            aria-label="File menu"
            title="File menu"
            aria-expanded={fileMenu}
            aria-controls="file-actions"
            disabled={busy !== null}
            onClick={() => {
              if (!fileMenu) setRecentLoading(true);
              setFileMenu(!fileMenu);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {fileMenu && (
            <div
              id="file-actions"
              className="file-menu-items"
              aria-label="File actions"
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    ':scope > button:not(:disabled), :scope > .file-menu-flyout > button:not(:disabled)',
                  ),
                ];
                const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              <MenuFlyoutProvider>
                <button onClick={openImage}>
                  Open image <span>Ctrl+Shift+O</span>
                </button>
                <button
                  onClick={() => void addVideo()}
                  title="Open a video clip in Timeline mode. Its first frame becomes the source image."
                >
                  Open video…
                </button>
                <button onClick={() => void openProject()}>
                  Open project <span>Ctrl+O</span>
                </button>
                <RecentProjectsMenu
                  projects={recentProjects}
                  loading={recentLoading}
                  error={recentError}
                  onOpen={(id) => void openProject(id)}
                  onRetry={() => {
                    setRecentLoading(true);
                    setRecentReload((value) => value + 1);
                  }}
                  onClear={() => void clearRecents()}
                />
                <hr />
                <MenuFlyout label="Save">
                  <button onClick={() => void saveProject()} disabled={!project.source}>
                    Save project <span>Ctrl+S</span>
                  </button>
                  <button onClick={() => void saveProject(true)} disabled={!project.source}>
                    Save project as… <span>Ctrl+Shift+S</span>
                  </button>
                </MenuFlyout>
                <MenuFlyout label="Edit">
                  <button
                    onClick={() => void copyImage()}
                    disabled={!project.source}
                    title="Copy the edited image at full resolution, including transparency."
                  >
                    Copy <span>Ctrl+C</span>
                  </button>
                  <button onClick={pasteImage} title="Open an image from the clipboard.">
                    Paste <span>Ctrl+V</span>
                  </button>
                </MenuFlyout>
                <MenuFlyout label="Export">
                  <button
                    disabled={!project.source}
                    onClick={() => {
                      setFileMenu(false);
                      setExportDialog(true);
                    }}
                  >
                    Export image…
                  </button>
                  <button disabled={!project.source} onClick={() => void saveImage()}>
                    Quick PNG Export <span>Ctrl+Shift+E</span>
                  </button>
                  <button
                    disabled={!timeline || !project.source}
                    title={timeline ? undefined : 'Open Timeline mode to animate first.'}
                    onClick={() => openRender('video')}
                  >
                    Render Video… <span>Ctrl+Shift+R</span>
                  </button>
                  <button
                    disabled={!timeline || !project.source}
                    title={timeline ? undefined : 'Open Timeline mode to animate first.'}
                    onClick={() => openRender('gif')}
                  >
                    Export GIF… <span>Ctrl+Shift+G</span>
                  </button>
                </MenuFlyout>
                <MenuFlyout label="Library">
                  <button
                    onClick={() => {
                      fileMenuRef.current?.querySelector('button')?.focus();
                      setFileMenu(false);
                      openPicker();
                    }}
                  >
                    Filters and Presets
                  </button>
                  <button
                    onClick={openSampleImage}
                    title="Open the unfiltered statue head bundled with GLEECH."
                  >
                    Open sample image
                  </button>
                  <button
                    onClick={() => beginPresetSave(true)}
                    disabled={!project.source || !project.effects.length}
                    title="Save the current effect stack, application masks and seed to your preset library."
                  >
                    Save Stack as Preset
                  </button>
                  <button onClick={() => void transferPreset()}>Import Preset</button>
                  <button onClick={showShaderImport}>Add Shader</button>
                </MenuFlyout>
                <hr />
                <button
                  onClick={() => {
                    setFileMenu(false);
                    setMcpDialog(true);
                  }}
                >
                  MCP · AI control
                  {mcpMode === 'off'
                    ? ''
                    : ` · ${mcpMode === 'full' ? 'Full Control' : mcpMode === 'edit' ? 'Edit' : 'Observe'}`}
                </button>
                <button
                  aria-label="UI Color"
                  title={`Current UI color: ${uiColor.name}`}
                  onClick={() => {
                    fileMenuRef.current?.querySelector('button')?.focus();
                    setFileMenu(false);
                    setUiColorDialog(true);
                  }}
                >
                  UI Color <span className="ui-color-menu-swatch" aria-hidden="true" />
                </button>
                <MenuFlyout label="Community">
                  <button onClick={showSupport}>Support GLEECH</button>
                  <button
                    onClick={() => {
                      setFileMenu(false);
                      void window.gleech
                        .openSupportLink('discord')
                        .then(unwrap)
                        .catch((failure) =>
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : 'Could not open Discord Community.',
                          ),
                        );
                    }}
                  >
                    Discord Community
                  </button>
                  <button onClick={() => showFeedback('bug')}>Bug Report</button>
                  <button onClick={() => showFeedback('feature')}>Feature Request</button>
                </MenuFlyout>
                <hr />
                <button onClick={() => void exitGleech()}>
                  Exit GLEECH <span>Alt+F4</span>
                </button>
                <hr />
                <button
                  className="app-version"
                  aria-label="Copy GLEECH version"
                  title="Copy GLEECH version"
                  onClick={() => {
                    setFileMenu(false);
                    void window.gleech
                      .copyAppVersion()
                      .then(unwrap)
                      .then(() => setNotice('Copied GLEECH version'))
                      .catch((failure) =>
                        setError(
                          failure instanceof Error ? failure.message : 'Could not copy version.',
                        ),
                      );
                  }}
                >
                  {APP_VERSION_LABEL}
                </button>
              </MenuFlyoutProvider>
            </div>
          )}
        </div>
        <div className="app-brand">
          <h1>
            GLEECH<span className="brand-dot">.</span>
          </h1>
          {APP_IS_BETA && (
            <span className="brand-beta" title="GLEECH is in beta">
              BETA
            </span>
          )}
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="project-summary">
          <ProjectName
            name={displayName}
            dirty={dirty}
            disabled={busy !== null}
            onRename={commands.renameProject}
          />
        </div>
        <div className="toolbar-spacer" />
        <div
          className="mode-switch"
          role="tablist"
          aria-label="Editor mode"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const toTimeline = event.key === 'ArrowRight' || event.key === 'End';
            if (toTimeline) openTimeline();
            else openImageMode();
            window.document
              .getElementById(toTimeline ? 'mode-tab-timeline' : 'mode-tab-image')
              ?.focus();
          }}
        >
          <button
            id="mode-tab-image"
            role="tab"
            aria-selected={!timelineMode}
            tabIndex={timelineMode ? -1 : 0}
            onClick={openImageMode}
          >
            <ImageModeIcon />
            Image
          </button>
          <button
            id="mode-tab-timeline"
            role="tab"
            aria-selected={timelineMode}
            tabIndex={timelineMode ? 0 : -1}
            disabled={!project.source || busy !== null}
            title={
              project.source
                ? 'Animate effects over time and render video or GIFs'
                : 'Open an image first'
            }
            onClick={openTimeline}
          >
            <TimelineModeIcon />
            Timeline
          </button>
        </div>
        {timelineMode ? (
          <span className="mode-chip" role="status" title="Playback preview quality">
            <span className="mode-chip-dot" aria-hidden="true" />
            {playing
              ? `Half-res preview${frameCache.fps ? ` · ${frameCache.fps.toFixed(1)} fps` : ''}`
              : 'Full-res preview'}
          </span>
        ) : (
          timeline &&
          (clip || effectsAnimate(project.effects)) && (
            <button
              className="mode-chip mode-chip-time"
              title="Image mode shows the frame at the playhead. Open Timeline to move it."
              onClick={openTimeline}
            >
              <DiamondIcon filled size={10} />
              {formatTimecode(frame, fps)}
            </button>
          )
        )}
        <div className="toolbar-spacer" />
        <div className="history-actions" aria-label="Edit history">
          <button
            className="toolbar-icon-button"
            aria-label="Undo"
            disabled={busy !== null || !commands.canUndo()}
            onClick={() => void restoreHistory('undo')}
            title="Undo (Ctrl+Z)"
          >
            <UndoIcon />
          </button>
          <button
            className="toolbar-icon-button"
            aria-label="Redo"
            disabled={busy !== null || !commands.canRedo()}
            onClick={() => void restoreHistory('redo')}
            title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
          >
            <RedoIcon />
          </button>
        </div>
        <div className="seed-group">
          <label className="seed-control">
            Seed
            <input
              aria-label="Master seed"
              type="number"
              min="0"
              max="4294967295"
              step="1"
              value={project.masterSeed}
              disabled={busy !== null}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
                  commands.setSeed(value);
              }}
            />
          </label>
          <button
            className="toolbar-icon-button seed-dice"
            aria-label="Random seed"
            title="Try a new random seed. Undo returns to the previous seed."
            disabled={busy !== null || !project.source}
            onClick={newSeed}
          >
            <DiceIcon />
          </button>
        </div>
        <div className="randomize-actions">
          <button
            disabled={
              busy !== null || !project.source || !project.effects.some((effect) => !effect.locked)
            }
            aria-label="Var"
            title="Preview nine variations of this stack. Locked effects stay untouched. Unlock an effect to vary it."
            onClick={() => {
              commands.endHistoryGroup();
              finishMask();
              const current = commands.getState();
              const image = current.source && assets.current.get(current.source.id);
              if (image) setVariationSession({ project: current, image });
            }}
          >
            Variation
          </button>
          <button
            className="gleech-button"
            disabled={busy !== null || !project.source}
            title="Randomize your stack: Simple, Complex or GLEECHED. Choose how to handle existing effects and locks."
            onClick={() => {
              commands.endHistoryGroup();
              finishMask();
              setGleechDialog(true);
            }}
          >
            <SparkleIcon />
            GLEECH
          </button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="support-toolbar-actions" aria-label="Support and feedback">
          <button
            className="toolbar-icon-button donate-button"
            aria-label="Support GLEECH"
            onClick={showSupport}
            title="Support GLEECH and follow its creator"
          >
            <HeartIcon />
          </button>
          <button
            className="toolbar-icon-button"
            aria-label="Feedback"
            aria-expanded={feedbackKind !== null}
            aria-haspopup="dialog"
            title="Report a bug or request a feature"
            onClick={() => showFeedback('bug')}
          >
            <FlagIcon />
          </button>
        </div>
      </header>
      {supportDialog && <SupportDialog onClose={() => setSupportDialog(false)} />}
      {uiColorDialog && (
        <UiColorDialog
          color={uiColor}
          onChange={(next) => {
            setUiColor(next);
            applyUiColor(next);
            saveUiColor(next);
          }}
          onClose={() => setUiColorDialog(false)}
        />
      )}
      {feedbackKind && feedbackDrafts[feedbackKind] && (
        <FeedbackDialog
          draft={feedbackDrafts[feedbackKind]!}
          project={project}
          onKind={showFeedback}
          onChange={(draft) =>
            setFeedbackDrafts((previous) => ({ ...previous, [draft.kind]: draft }))
          }
          onClose={() => setFeedbackKind(null)}
        />
      )}
      {!timelineMode && (
        <aside className="stack-panel" aria-label="Effect stack">
          <PanelResizeHandle {...panelHandle('left')} />
          <div className="stack-comparison" ref={setComparisonContainer} />
          <div className="panel-heading stack-heading">
            <strong>Effects</strong>
            <span>
              {project.effects.filter((effect) => effect.enabled).length} of{' '}
              {project.effects.length} on
            </span>
            <button
              className="stack-delete"
              aria-label="Delete selected effect"
              title={selected ? `Delete ${getEffectDefinition(selected).title}` : 'Delete effect'}
              disabled={busy !== null || !selected}
              onClick={() => {
                if (!selected) return;
                if (selected.instanceId === maskTarget) finishMask();
                commands.removeEffect(selected.instanceId);
              }}
            >
              <TrashIcon />
            </button>
            <button
              className="stack-heading-add"
              aria-label="Add effect"
              aria-expanded={addingEffect}
              aria-haspopup="dialog"
              aria-controls="effect-catalog"
              title="Add effect"
              disabled={!project.source || busy !== null}
              onClick={() => openPicker()}
            >
              <PlusIcon />
            </button>
          </div>
          <div className="stack-body">
            {project.effects.length === 0 && (
              <p className="quiet">
                {project.source
                  ? 'Add an effect to start shaping your image.'
                  : 'Open an image to start adding effects.'}
              </p>
            )}
            <EffectStack
              effects={project.effects}
              selectedId={selected?.instanceId}
              disabled={busy !== null}
              onSelect={(id) => {
                if (id !== maskTarget) finishMask();
                setSelectedId(id);
                setInspectorTab('controls');
              }}
              onToggle={(id, enabled) => commands.updateEffect(id, { enabled })}
              onToggleLock={commands.setEffectLocked}
              onMove={commands.moveEffectTo}
              onPaintMask={paintMask}
              onToggleMask={(id, enabled) => {
                const mask = commands
                  .getState()
                  .effects.find((e) => e.instanceId === id)?.paintedMask;
                if (mask) commands.setEffectMask(id, { ...mask, enabled });
                if (!enabled && id === maskTarget) {
                  setMaskGeometryDraft(null);
                  commands.endHistoryGroup();
                }
              }}
            />
            {maskEffect && editingMask && project.source && (
              <>
                <PaintedMaskControls
                  effectId={maskEffect.instanceId}
                  mask={editingMask}
                  onEnable={(enabled) => {
                    setMaskGeometryDraft(null);
                    commands.endHistoryGroup();
                    commitCanvasMask({ ...editingMask, enabled });
                  }}
                  beginGesture={commands.beginHistoryGroup}
                  endGesture={commands.endHistoryGroup}
                  onFill={() =>
                    commitCanvasMask({
                      ...editingMask,
                      base: 1,
                      inverted: false,
                      strokes: [],
                      paths: [],
                    })
                  }
                  brush={maskBrush}
                  shader={maskEffect.type.startsWith('shader-')}
                  onMask={commitCanvasMask}
                  onBrush={setMaskBrush}
                  overlay={maskOverlay}
                  onOverlay={setMaskOverlay}
                  disabled={busy !== null}
                  onDone={finishMask}
                  onClear={() => {
                    commitCanvasMask({
                      ...editingMask,
                      base: 0,
                      inverted: false,
                      strokes: [],
                      ...(editingMask.paths ? { paths: [] } : {}),
                    });
                  }}
                  onInvert={() =>
                    commitCanvasMask({
                      ...editingMask,
                      inverted: !editingMask.inverted,
                    })
                  }
                  onRemove={() => {
                    commands.setEffectMask(maskEffect.instanceId, null);
                    finishMask();
                  }}
                />
              </>
            )}
          </div>
        </aside>
      )}
      <div className="image-workspace">
        {timelineMode && <div className="canvas-comparison" ref={setComparisonContainer} />}
        {timelineMode &&
          (() => {
            const meters = project.effects.flatMap((effect) =>
              Object.entries(effect.animation ?? {}).flatMap(([key, lane]) => {
                const modulators = (lane.modulators ?? []).filter((entry) => entry.enabled);
                const definition = animationDefinition(effect, key);
                if (!modulators.length || !definition) return [];
                const value = evaluateParameter(
                  lane,
                  parameterBaseValue(effect, key),
                  frameT,
                  definition,
                  modulation,
                );
                return [
                  {
                    id: `${effect.instanceId}:${key}`,
                    label: definition.label,
                    level: normalizedValue(definition, value),
                    color: modulators.some((entry) => entry.kind === 'audio')
                      ? SIGNAL_COLORS.audio
                      : SIGNAL_COLORS.lfo,
                  },
                ];
              }),
            );
            return meters.length ? (
              <section className="live-modulation" aria-label="Live modulation">
                <h3>Live modulation</h3>
                {meters.slice(0, 6).map((meter) => (
                  <div key={meter.id} className="live-meter">
                    <span className="live-swatch" style={{ background: meter.color }} />
                    <span className="live-label">{meter.label}</span>
                    <span className="live-bar">
                      <span style={{ width: `${meter.level * 100}%`, background: meter.color }} />
                    </span>
                  </div>
                ))}
              </section>
            ) : null;
          })()}
        {mcpMode !== 'off' && (
          <button
            className="mcp-control-indicator"
            aria-label="MCP controls"
            title={
              mcpOperation ??
              'Open AI control settings. You can disable MCP here during an operation.'
            }
            onClick={() => setMcpDialog(true)}
          >
            MCP · {mcpMode === 'full' ? 'Full Control' : mcpMode === 'edit' ? 'Edit' : 'Observe'}
          </button>
        )}
        <div className="canvas-zoom" ref={setViewportControlsContainer} />
        <ImageViewport
          ref={viewport}
          controlsContainer={viewportControlsContainer}
          comparisonContainer={comparisonContainer}
          backdrop={selected?.type === 'cutout' ? cutoutBackdrop : DEFAULT_PREVIEW_BACKDROP}
          effects={frameEffects}
          masterSeed={frameMasterSeed}
          frameKey={frameKey}
          sourceFrame={clip ? (videoFrame?.image ?? null) : null}
          playback={playing && timelineMode}
          onFrameShown={onFrameShown}
          onFrameEvicted={onFrameEvicted}
          busy={busy !== null}
          onOpen={openImage}
          onOpenSample={openSampleImage}
          onDrop={(file) => {
            void importImage(() => window.gleech.importFile(file));
          }}
          onError={setError}
          onInfo={setInfo}
          originalPixels={originalPixels}
          feedback={clipboardFeedback}
          maskPainting={
            maskEffect && editingMask?.enabled && project.source
              ? {
                  effectId: maskEffect.instanceId,
                  mask: editingMask,
                  brush: maskBrush,
                  overlay: maskOverlay,
                  tool: 'brush',
                  feather: 0,
                  layer: false,
                  geometryDraft: maskGeometryDraft,
                  onGeometryDraft: setMaskGeometryDraft,
                  beginGesture: commands.beginHistoryGroup,
                  endGesture: commands.endHistoryGroup,
                  onMask: (mask) => {
                    setMaskGeometryDraft(null);
                    commitCanvasMask(mask);
                  },
                  onDone: finishMask,
                  onCommit: (stroke) => {
                    const effect = commands
                      .getState()
                      .effects.find((e) => e.instanceId === maskEffect.instanceId);
                    const mask = effect?.paintedMask;
                    if (mask) commitCanvasMask({ ...mask, strokes: [...mask.strokes, stroke] });
                  },
                }
              : null
          }
        />
        {!timelineMode && (
          <SnapshotPanel
            project={project}
            thumbnails={thumbnails}
            disabled={busy !== null}
            onCapture={(bake) =>
              setStageDialog({
                bake,
                name: 'Snapshot ' + String(project.snapshots.length + 1).padStart(2, '0'),
              })
            }
            onRestore={(id, mode) => void restoreStage(id, mode)}
            onRename={(id, name) => setStageDialog({ bake: false, renameId: id, name })}
          />
        )}
        <footer
          hidden={timelineMode}
          className="status-bar"
          data-render-backend={info?.backend}
          data-max-texture-size={info?.maxTextureSize}
          data-preview-ms={info?.previewMs}
          data-export-backend={exportBackend ?? undefined}
          title={
            info
              ? `${info.adapter} · Preview ${info.previewMs.toFixed(1)} ms${info.reason ? ` · ${info.reason}` : ''}${info.shaderReason ? ` · Shader fallback: ${info.shaderReason}` : ''}`
              : undefined
          }
        >
          <span role="status" title={notice}>
            <span className="status-dot" />
            {notice}
          </span>
          <span
            title={
              project.source
                ? `${project.source.width} × ${project.source.height} · ${info?.backend === 'webgpu' ? 'GPU preview' : 'Compatibility preview'}${info?.shaderBackend ? ` · ${info.shaderBackend === 'cpu' ? 'CPU shaders' : 'GPU shaders'}` : ''}`
                : 'No image loaded'
            }
          >
            {project.source
              ? `${project.source.width} × ${project.source.height} · ${info?.backend === 'webgpu' ? 'GPU preview' : 'Compatibility preview'}${info?.shaderBackend ? ` · ${info.shaderBackend === 'cpu' ? 'CPU shaders' : 'GPU shaders'}` : ''}`
              : 'No image loaded'}
          </span>
        </footer>
      </div>
      <InspectorSections endGesture={commands.endHistoryGroup}>
        <aside className="detail-panel" aria-label="Effect and image details">
          <PanelResizeHandle {...panelHandle('right')} />
          <div className="inspector-tabs" role="tablist" aria-label="Right panel">
            {(['controls', 'details'] as const).map((tab) => (
              <button
                key={tab}
                id={`inspector-tab-${tab}`}
                role="tab"
                aria-selected={inspectorTab === tab}
                aria-controls={`inspector-panel-${tab}`}
                tabIndex={inspectorTab === tab ? 0 : -1}
                onClick={() => setInspectorTab(tab)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'controls'
                      : event.key === 'End'
                        ? 'details'
                        : tab === 'controls'
                          ? 'details'
                          : 'controls';
                  setInspectorTab(next);
                  window.document.getElementById(`inspector-tab-${next}`)?.focus();
                }}
              >
                {tab === 'controls' ? 'Controls' : 'Image details'}
              </button>
            ))}
          </div>
          <InspectorSectionActions />
          <section
            className="inspector-panel"
            role="tabpanel"
            id="inspector-panel-controls"
            aria-labelledby="inspector-tab-controls"
            hidden={inspectorTab !== 'controls'}
            tabIndex={0}
          >
            {selected &&
              modulatorParam?.effectId === selected.instanceId &&
              animationDefinition(selected, modulatorParam.key) && (
                <ModulatorPanel
                  effect={selected}
                  paramKey={modulatorParam.key}
                  definition={animationDefinition(selected, modulatorParam.key)!}
                  animation={selected.animation?.[modulatorParam.key]}
                  t={frameT}
                  modulation={modulation}
                  audioName={timeline?.audio?.name ?? null}
                  hasAudio={Boolean(timeline?.audio)}
                  disabled={busy !== null}
                  onBack={() => setModulatorParam(null)}
                  onChange={(next) => {
                    try {
                      commands.updateEffect(selected.instanceId, {
                        animation: { [modulatorParam.key]: next },
                      });
                    } catch (failure) {
                      setError(
                        failure instanceof Error ? failure.message : 'Could not change modulators.',
                      );
                    }
                  }}
                  onBase={(value) =>
                    modulatorParam.key.startsWith('application.')
                      ? commands.updateEffect(selected.instanceId, {
                          application: {
                            [modulatorParam.key.slice(12)]: value,
                          } as Partial<EffectApplication>,
                        })
                      : commands.updateEffect(selected.instanceId, {
                          params: { [modulatorParam.key]: value },
                        })
                  }
                  onBake={() => bakeCurve(selected.instanceId, modulatorParam.key)}
                  onRestoreLink={() => void restoreLink(selected.instanceId, modulatorParam.key)}
                  beginGesture={commands.beginHistoryGroup}
                  endGesture={commands.endHistoryGroup}
                />
              )}
            {selected && modulatorParam?.effectId !== selected.instanceId && (
              <EffectEditor
                masterSeed={frameMasterSeed}
                backdrop={cutoutBackdrop}
                onBackdrop={setCutoutBackdrop}
                effect={
                  frameEffects.find((effect) => effect.instanceId === selected.instanceId) ??
                  selected
                }
                animation={animationUi(selected)}
                animationCard={animationCardFor(selected)}
                effects={project.effects}
                image={project.source ? fieldImages.get(project.source.id) : undefined}
                imageSize={project.source ?? { width: 1, height: 1 }}
                disabled={busy !== null}
                onChange={(params) => {
                  try {
                    const routed = routeChange(selected.instanceId, {
                      ...params,
                      ...(selected.type === 'solid' &&
                      ['color', 'gradient'].includes(String(params.content))
                        ? { fillColorMode: params.content === 'gradient' ? 'gradient' : 'solid' }
                        : {}),
                      ...(selected.type === 'solid' && params.fillColorMode
                        ? { content: params.fillColorMode === 'gradient' ? 'gradient' : 'color' }
                        : {}),
                    });
                    if (!routed) return;
                    commands.updateEffect(selected.instanceId, {
                      params: routed.staticParams,
                      ...(Object.keys(routed.animation).length
                        ? { animation: routed.animation }
                        : {}),
                    });
                  } catch (failure) {
                    setError(
                      failure instanceof Error ? failure.message : 'Could not change this control.',
                    );
                  }
                }}
                onVary={() => commands.varyEffect(selected.instanceId)}
                onGlyphFont={(atlas) => {
                  commands.endHistoryGroup();
                  commands.updateEffect(selected.instanceId, {
                    params: { fontSource: 'installed' },
                    glyphFont: atlas,
                  });
                  setNotice(`Applied glyph font ${atlas.family} · ${atlas.style}`);
                }}
                onDirectionChange={(params, directionImage) => {
                  commands.endHistoryGroup();
                  commands.updateEffect(selected.instanceId, { params, directionImage });
                  setNotice(
                    directionImage
                      ? `Added direction map ${directionImage.source.name}`
                      : 'Copied direction field',
                  );
                }}
                onFieldChange={(params, fieldImage) => {
                  commands.endHistoryGroup();
                  commands.updateEffect(selected.instanceId, { params, fieldImage });
                  setNotice(
                    fieldImage ? `Added depth map ${fieldImage.source.name}` : 'Copied field',
                  );
                }}
                snapshots={project.snapshots}
                onChooseSnapshotImage={(snapshotId) => {
                  if (locked.current || selected.type !== 'reference-mosh') return;
                  const snapshot = project.snapshots.find((stage) => stage.id === snapshotId);
                  if (!snapshot) return;
                  const id = selected.instanceId;
                  locked.current = true;
                  commands.endHistoryGroup();
                  setBusy('import');
                  setError(null);
                  setNotice('Copying saved stage…');
                  void (async () => {
                    try {
                      const image = unwrap(
                        await window.gleech.layerImageFromSource(snapshot.rendered.id),
                      );
                      commands.updateEffect(id, { image });
                      setNotice('Copied ' + snapshot.name);
                    } catch (failure) {
                      setError(
                        failure instanceof Error ? failure.message : 'Could not copy the stage.',
                      );
                      setNotice('Ready');
                    } finally {
                      locked.current = false;
                      setBusy(null);
                    }
                  })();
                }}
                onChooseLayerImage={() => {
                  if (locked.current || !supportsLayerImage(selected)) return;
                  const id = selected.instanceId;
                  locked.current = true;
                  commands.endHistoryGroup();
                  setBusy('import');
                  setError(null);
                  setNotice('Choosing layer image…');
                  void (async () => {
                    try {
                      const image = unwrap(
                        await window.gleech.openLayerImage(
                          selected.type === 'motion-transfer'
                            ? 'vector'
                            : selected.type === 'reference-mosh'
                              ? 'reference'
                              : 'solid',
                        ),
                      );
                      if (image) {
                        commands.updateEffect(id, {
                          image,
                          ...(selected.type === 'solid' ? { params: { content: 'image' } } : {}),
                        });
                        setNotice(`Added layer image ${image.source.name}`);
                      } else setNotice('Canceled');
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : 'Could not load the layer image.',
                      );
                      setNotice('Ready');
                    } finally {
                      locked.current = false;
                      setBusy(null);
                    }
                  })();
                }}
                onChooseVectorMap={(mapId) => {
                  if (locked.current || selected.type !== 'motion-transfer') return;
                  const id = selected.instanceId;
                  locked.current = true;
                  commands.endHistoryGroup();
                  setBusy('import');
                  setError(null);
                  setNotice('Loading vector map…');
                  void (async () => {
                    try {
                      const image = unwrap(await window.gleech.chooseVectorMap(mapId));
                      commands.updateEffect(id, {
                        image,
                        params: {
                          encoding: 'rg',
                          mapScale: 100,
                          mapX: 50,
                          mapY: 50,
                          mapRotation: 0,
                        },
                      });
                      setNotice(`Added vector map ${image.source.name}`);
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : 'Could not load the vector map.',
                      );
                      setNotice('Ready');
                    } finally {
                      locked.current = false;
                      setBusy(null);
                    }
                  })();
                }}
                onReset={() => {
                  const defaults = effectDefaults(selected);
                  commands.updateEffect(selected.instanceId, {
                    params: defaults.params,
                    application: defaults.application,
                    ...(selected.type === 'glyph' ? { glyphFont: null } : {}),
                  });
                }}
                onApplication={(application) => {
                  const animated: Record<string, ParameterAnimation> = {};
                  const rest: Record<string, unknown> = {};
                  const active = commands.getState().timeline;
                  for (const [key, value] of Object.entries(application)) {
                    const lane = selected.animation?.[`application.${key}`];
                    if (
                      lane?.keys.length &&
                      (typeof value === 'number' || typeof value === 'string')
                    )
                      animated[`application.${key}`] = upsertKey(
                        lane,
                        frameTime(frame, active?.fps ?? 30),
                        value,
                        active?.fps ?? 30,
                      );
                    else rest[key] = value;
                  }
                  commands.updateEffect(selected.instanceId, {
                    application: rest as Partial<EffectApplication>,
                    ...(Object.keys(animated).length ? { animation: animated } : {}),
                  });
                }}
                beginGesture={commands.beginHistoryGroup}
                endGesture={commands.endHistoryGroup}
              />
            )}
            {!selected && <p className="quiet">Select an effect to adjust its controls.</p>}
            <p className="quiet">
              Scroll to zoom. Drag to pan. Use Fit to return to the whole image.
            </p>
          </section>
          <section
            className="inspector-panel"
            role="tabpanel"
            id="inspector-panel-details"
            aria-labelledby="inspector-tab-details"
            hidden={inspectorTab !== 'details'}
            tabIndex={0}
          >
            <InspectorSection sectionId="image-details" title="Image">
              {project.source ? (
                <dl className="image-info">
                  <dt>Dimensions</dt>
                  <dd>
                    {project.source.width.toLocaleString()} ×{' '}
                    {project.source.height.toLocaleString()}
                  </dd>
                  <dt>Format</dt>
                  <dd>{project.source.format.toUpperCase()}</dd>
                  <dt>Alpha channel</dt>
                  <dd>{project.source.hasAlpha ? 'Preserved' : 'Opaque'}</dd>
                  <dt>Export</dt>
                  <dd>PNG, JPEG, WebP, TIFF · original resolution</dd>
                </dl>
              ) : (
                <p className="quiet">Image details will appear here.</p>
              )}
            </InspectorSection>
          </section>
        </aside>
      </InspectorSections>
      {timelineMode && timeline && (
        <>
          <div
            className="dock-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline"
            aria-valuenow={dockHeight}
            tabIndex={0}
            onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const next = Math.max(
                220,
                Math.min(
                  window.innerHeight - 260,
                  dockHeight + (event.key === 'ArrowUp' ? 24 : -24),
                ),
              );
              setDockHeight(next);
              try {
                localStorage.setItem(DOCK_HEIGHT_KEY, String(next));
              } catch {
                // The height still applies for this session.
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              const origin = event.clientY;
              const initial = dockHeight;
              const target = event.currentTarget;
              target.setPointerCapture(event.pointerId);
              let latest = initial;
              const move = (moveEvent: PointerEvent) => {
                latest = Math.max(
                  220,
                  Math.min(window.innerHeight - 260, initial + origin - moveEvent.clientY),
                );
                setDockHeight(latest);
              };
              const release = () => {
                try {
                  localStorage.setItem(DOCK_HEIGHT_KEY, String(latest));
                } catch {
                  // The height still applies for this session.
                }
              };
              trackPointer(event.pointerId, move, release);
            }}
          />
          <TimelineDock
            project={project}
            timeline={timeline}
            frame={frame}
            playing={playing}
            cachedFrames={cachedFrames}
            selectedEffectId={selected?.instanceId}
            selectedParam={selectedParam}
            disabled={busy !== null}
            modulation={modulation}
            stillThumbnail={project.source ? (thumbnails.get(project.source.id) ?? null) : null}
            filmstrip={
              filmstrip && media.video && filmstrip.mediaId === media.video.mediaId
                ? filmstrip.frames
                : []
            }
            laneView={laneView}
            onLaneView={setLaneView}
            onSeek={seek}
            onTogglePlay={() => setPlaying(!playing)}
            onTimeline={(change) => {
              try {
                commands.updateTimeline(change);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : 'Could not change the timeline.',
                );
              }
            }}
            onSelectEffect={(id) => {
              setSelectedId(id);
              setInspectorTab('controls');
            }}
            onSelectParam={(parameter, options) => {
              setSelectedParam(parameter);
              if (!parameter) return;
              setSelectedId(parameter.effectId);
              setInspectorTab('controls');
              if (!options?.reveal) return;
              // A click on a parameter's name shows its audio/LFO stack when it has
              // modulators, else its Animation card (ease, Add LFO, Link to audio).
              const lane = commands
                .getState()
                .effects.find((effect) => effect.instanceId === parameter.effectId)?.animation?.[
                parameter.key
              ];
              if (lane?.modulators?.length) {
                setModulatorParam(parameter);
                return;
              }
              setModulatorParam(null);
              revealAnimationCard();
            }}
            onToggleEffect={(id, enabled) => commands.updateEffect(id, { enabled })}
            onLock={commands.setEffectLocked}
            onMoveEffect={commands.moveEffectTo}
            onRemoveEffect={(id) => commands.removeEffect(id)}
            onAnimation={(effectId, key, animation) => {
              try {
                commands.updateEffect(effectId, { animation: { [key]: animation } });
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : 'Could not change keyframes.',
                );
              }
            }}
            onActiveRange={(effectId, range) => {
              try {
                commands.updateEffect(effectId, { activeRange: range });
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : 'Could not trim this effect.',
                );
              }
            }}
            onAddParameter={toggleKey}
            beginGesture={commands.beginHistoryGroup}
            endGesture={commands.endHistoryGroup}
            onRender={() => openRender(renderMemory.tab)}
            onAddEffect={() => openPicker()}
            onAddVideo={() => void addVideo()}
            onAddAudio={() => void addAudio()}
            onUseClipAudio={() => void addClipAudio()}
            onRemoveVideo={() =>
              // The clip's own sound goes with it; a separate audio track stays.
              commands.updateTimeline({
                video: undefined,
                ...(audioIsClipSound(timeline) ? { audio: undefined } : {}),
              })
            }
            onRemoveAudio={() => commands.updateTimeline({ audio: undefined })}
            onAddMarker={addMarker}
            onRemoveMarker={(id) =>
              commands.updateTimeline({
                markers: timeline.markers.filter((marker) => marker.id !== id),
              })
            }
            playbackVolume={playbackAudio.volume}
            playbackMuted={playbackAudio.muted}
            onPlaybackAudio={changePlaybackAudio}
          />
        </>
      )}

      {stageDialog && (
        <StageDialog
          name={stageDialog.name}
          bake={stageDialog.bake}
          rename={Boolean(stageDialog.renameId)}
          onClose={() => setStageDialog(null)}
          onSubmit={(name) => {
            setStageDialog(null);
            if (stageDialog.renameId) commands.renameSnapshot(stageDialog.renameId, name);
            else void captureStage(name, stageDialog.bake);
          }}
        />
      )}
      {shaderImportDialog && (
        <ShaderImportDialog
          busy={busy === 'import'}
          error={shaderImportError}
          preview={shaderImportPreview}
          onClose={() => setShaderImportDialog(false)}
          onBack={() => {
            setShaderImportPreview(null);
            setShaderImportError(null);
          }}
          onPrepare={(request) => void prepareShader(request)}
          onImport={(pkg) => void importShader(pkg)}
        />
      )}
      {gleechDialog && (
        <GleechDialog
          hasEffects={project.effects.length > 0}
          lockedCount={project.effects.filter((effect) => effect.locked).length}
          onClose={() => setGleechDialog(false)}
          onApply={applyGleech}
        />
      )}
      {variationSession && (
        <VariationDialog
          image={variationSession.image}
          effects={variationSession.project.effects}
          masterSeed={variationSession.project.masterSeed}
          onClose={() => setVariationSession(null)}
          onApply={applyVariation}
        />
      )}
      {addingEffect && (
        <EffectPicker
          shaders={shaders}
          onImportShader={showShaderImport}
          onDeleteShader={(shader) => void deleteShader(shader)}
          onChooseShader={(shader) => {
            if (locked.current || !commands.getState().source) return;
            const id = crypto.randomUUID();
            commands.addShader(shader.package, id);
            setSelectedId(id);
            setInspectorTab('controls');
            setAddingEffect(false);
          }}
          presets={presets}
          initialTab={pickerTab}
          returnFocus={pickerOpener}
          libraryError={presetLibraryError}
          loading={presetLoading}
          operationError={error}
          onDismissError={() => setError(null)}
          canSave={Boolean(project.source && project.effects.length)}
          canApply={Boolean(project.source)}
          onRetry={() => {
            setPresetLoading(true);
            setPresetReload((value) => value + 1);
          }}
          onSave={() => beginPresetSave()}
          onRename={(preset) => {
            setAddingEffect(false);
            setError(null);
            setPresetDialog({
              id: preset.id,
              name: preset.name,
              preset,
              recipe: { effects: preset.effects, masterSeed: preset.masterSeed },
            });
          }}
          onDelete={(preset) => {
            void deletePreset(preset);
          }}
          onImport={() => {
            void transferPreset();
          }}
          onExport={(preset) => {
            void transferPreset(preset);
          }}
          onApply={applyPreset}
          onChoose={(type) => {
            if (locked.current || !commands.getState().source) return;
            const id = crypto.randomUUID();
            commands.addEffect(type, id);
            setSelectedId(id);
            setInspectorTab('controls');
            setAddingEffect(false);
          }}
          onClose={() => setAddingEffect(false)}
        />
      )}
      {presetDialog && (
        <PresetNameDialog
          name={presetDialog.name}
          preset={presetDialog.preset}
          recipe={presetDialog.recipe}
          sourceId={project.source?.id ?? null}
          saving={busy === 'preset'}
          saveError={error}
          onClose={() => {
            setPresetDialog(null);
            if (presetDialog.fromMenu)
              requestAnimationFrame(() => fileMenuRef.current?.querySelector('button')?.focus());
            else openPicker('presets');
          }}
          onSubmit={(name, thumbnail, choice, recipe) => {
            void editPreset(name, thumbnail, choice, { ...presetDialog, recipe });
          }}
        />
      )}
      {exportDialog && (
        <ExportDialog
          onClose={() => setExportDialog(false)}
          onExport={(options) => {
            setExportDialog(false);
            void saveImage(options);
          }}
        />
      )}
      {mcpDialog && <McpDialog onClose={() => setMcpDialog(false)} />}
      {renderDialog && project.timeline && project.source && (
        <RenderDialog
          initialTab={renderDialog}
          project={project}
          timeline={project.timeline}
          frame={frame}
          preview={renderPreview}
          memory={renderMemory}
          videoMediaId={activeVideo(project) ? (media.video?.mediaId ?? null) : null}
          onMemory={setRenderMemory}
          onClose={() => setRenderDialog(null)}
          onQueue={(request, close) => {
            renderQueue.enqueue(request);
            setNotice(`Queued ${request.label}`);
            if (close) setRenderDialog(null);
          }}
        />
      )}
      <RenderQueuePanel onError={setError} />
      {busy && (
        <div className="operation-banner" role="status">
          <span className="spinner" />
          {busy === 'import'
            ? 'Opening image…'
            : busy === 'history'
              ? 'Restoring edit…'
              : busy === 'project' || busy === 'snapshot' || busy === 'preset'
                ? notice
                : notice}
        </div>
      )}
      {error && !addingEffect && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
