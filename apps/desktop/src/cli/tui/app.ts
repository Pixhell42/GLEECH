import { configureRendering, renderingSettings } from '../gpu';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import type { GleechComplexity, GleechMode } from '@gleech/command-service';
import {
  EFFECT_DEFINITIONS,
  createEffect,
  createImportedShader,
  createTimeline,
  type EffectInstance,
  type EffectType,
  type PresetPlacement,
  type ProjectState,
} from '@gleech/project-model';
import {
  EFFECT_CATEGORIES,
  EFFECT_CATEGORY,
  filterEffectCatalog,
} from '@gleech/project-model/effect-catalog';
import { APP_VERSION } from '../../shared/branding';
import { renderSourceSize } from '../../shared/render-request';
import { blockCells, blockSize, type BlockCell } from '../blocks';
import { decodeImageBytes, encodeImage, formatFromPath, type RgbaImage } from '../codec';
import { RenderCancelledError, draftFor } from '../engine';
import { listPresets, findShader, type CliPreset } from '../library';
import {
  GROUP_ORDER,
  effectCategory,
  effectTitle,
  formatValue,
  paramEntries,
  parseParamValue,
  setParams,
  stepParam,
  type ParamEntry,
} from '../params';
import { Session } from '../session';
import { prepareTerminalUpdate } from '../update-install';
import { exportTimeline } from '../timeline';
import { cliTimelinePlan } from '../timeline-plan';
import { previewTimeline, type TimelinePreviewFrame } from '../timeline-preview';
import {
  THEME,
  createPaint,
  detectColorLevel,
  mix,
  truncate,
  wrapText,
  cellWidth,
  type Rgb,
} from '../style';
import {
  PROBE_QUERY,
  itermImage,
  kittyDelete,
  kittyImage,
  parseProbe,
  protocolFromEnv,
  resolveCaps,
  sixelImage,
  terminalName,
  type TerminalCaps,
} from './graphics';
import { Screen, type Rect } from './screen';
import {
  createTuiSettings,
  SETTINGS_SECTIONS,
  terminalSettingsText,
  type TuiSettings,
} from './settings';
import { ZOOMS, clampView, viewportImage, type View } from './viewport';
import { Terminal, type InputEvent, type KeyEvent, type MouseEvent } from './terminal';
import {
  TimelineTransport,
  timelineExportModal,
  timelineOutputPath,
  timelineRanges,
  type TimelineExportModal,
} from './timeline';

// ─── palette ──────────────────────────────────────────────────────────────

const C = {
  window: THEME.window as Rgb,
  panel: THEME.panel as Rgb,
  elevated: THEME.elevated as Rgb,
  canvas: THEME.canvas as Rgb,
  line: THEME.line as Rgb,
  text: THEME.text as Rgb,
  muted: THEME.muted as Rgb,
  faint: THEME.faint as Rgb,
  accent: THEME.accent as Rgb,
  hot: THEME.accentHot as Rgb,
  ink: THEME.accentInk as Rgb,
  red: THEME.red as Rgb,
  cyan: THEME.cyan as Rgb,
  green: THEME.green as Rgb,
  warn: THEME.warn as Rgb,
  select: mix(THEME.panel, THEME.accent, 0.13),
  selectDim: mix(THEME.panel, THEME.text, 0.06),
  track: mix(THEME.panel, THEME.text, 0.14),
};

const PROTOCOL_LABEL = {
  kitty: 'kitty graphics',
  iterm: 'iTerm2 images',
  sixel: 'sixel',
  blocks: 'half-blocks',
} as const;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const COMPLEXITIES: GleechComplexity[] = ['simple', 'complex', 'gleeched'];
const MODES: GleechMode[] = [
  'keep-locked',
  'replace-all',
  'keep-all-add',
  'randomize-add',
  'existing-only',
];
const PLACEMENTS: PresetPlacement[] = ['replace', 'above', 'below', 'merge'];

// ─── modal state ──────────────────────────────────────────────────────────

interface PromptModal {
  kind: 'prompt';
  title: string;
  label: string;
  value: string;
  cursor: number;
  hint?: string;
  error?: string | undefined;
  submit(value: string): Promise<void> | void;
  cancel?(): void;
}
interface EffectModal {
  kind: 'effects';
  query: string;
  category: number;
  index: number;
  scroll: number;
}
interface PresetModal {
  kind: 'presets';
  query: string;
  index: number;
  scroll: number;
  placement: number;
  presets: CliPreset[];
}
interface GleechModal {
  kind: 'gleech';
  row: number;
}
interface HelpModal {
  kind: 'help';
  scroll: number;
}
interface SettingsModal {
  kind: 'settings';
  section: number;
  row: number;
  focus: 'navigation' | 'actions';
  scroll: number;
  notes: boolean;
}
interface ConfirmModal {
  kind: 'confirm';
  title: string;
  message: string;
  options: { key: string; label: string; run(): Promise<void> | void }[];
}
interface BusyModal {
  kind: 'busy';
  title: string;
  started: number;
  cancel?: () => void;
  detail?: string;
}
type Modal =
  | PromptModal
  | EffectModal
  | PresetModal
  | GleechModal
  | HelpModal
  | SettingsModal
  | ConfirmModal
  | BusyModal
  | TimelineExportModal;
type Focus = 'stack' | 'inspector' | 'timeline';

type Row =
  | { kind: 'group'; group: ParamEntry['group']; count: number }
  | { kind: 'param'; entry: ParamEntry };

interface Hit {
  rect: Rect;
  press(event: MouseEvent): void;
  drag?(event: MouseEvent): void;
  wheel?(direction: -1 | 1): void;
}

// ─── app ─────────────────────────────────────────────────────────────────

export async function runTui(
  initial: Session,
  isSample: boolean,
  term = new Terminal(),
  options: { settings?: TuiSettings | false; prepareUpdate?: typeof prepareTerminalUpdate } = {},
): Promise<number> {
  const level = detectColorLevel(process.stdout);
  const screen = new Screen(level || 3, C.window, C.text);
  let session = initial;
  let unsubscribe = session.service.subscribe(onChange);

  // UI state
  let focus: Focus = initial.state.timeline ? 'timeline' : 'stack';
  const transport = new TimelineTransport(initial.state.timeline);
  let timelineMode = !!initial.state.timeline;
  let timelineDrag = false;
  let stackIndex = 0;
  let stackScroll = 0;
  let inspectorIndex = 0;
  let inspectorScroll = 0;
  const collapsed = new Set<ParamEntry['group']>(['Color', 'Direction', 'Application', 'Field']);
  let compare = false;
  let focusMode = false;
  let modal: Modal | null = null;
  let toast: { text: string; color: Rgb; until: number } | null = null;
  let toastTimer: NodeJS.Timeout | null = null;
  let gleechComplexity: GleechComplexity = 'complex';
  let gleechMode: GleechMode = 'keep-locked';
  let lastGleechSeed: number | null = null;
  let hits: Hit[] = [];
  let modalHitStart = 0;
  let helpMaxScroll = 0;
  let spinner = 0;
  let quitting = false;
  let updateExitMessage: string | null = null;
  const settings = options.settings === false ? null : (options.settings ?? createTuiSettings());
  let settingsMaxScroll = 0;
  let settingsVisibleRows = 1;
  let busyTask: Promise<void> | null = null;
  let busyAbort: AbortController | null = null;

  // Preview state. A fast draft renders first; terminals with inline images
  // then get a sharper render at the pane's real pixel size, and zoomed views
  // a full-resolution render.
  let caps: TerminalCaps = {
    protocol: 'blocks',
    cellWidth: 10,
    cellHeight: 20,
    terminal: terminalName(),
  };
  let view: View = { zoom: 0, cx: 0.5, cy: 0.5 };
  let sourceFull: RgbaImage | null = null;
  let previewState: ProjectState | null = null;
  let hires: { image: RgbaImage; state: ProjectState; target: number } | null = null;
  let fullRes: { image: RgbaImage; state: ProjectState } | null = null;
  let refining = '';
  let vpCache: { key: string; src: RgbaImage; image: RgbaImage } | null = null;
  let imageArea: Rect | null = null;
  let pendingImage: RgbaImage | null = null;
  let placed: { image: RgbaImage; rect: Rect } | null = null;
  let lastEmit = { at: 0, cost: 0 };
  let modalRect: Rect | null = null;
  let emitTimer: NodeJS.Timeout | null = null;
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  let preview: { image: RgbaImage; ms: number; warnings: string[]; backend: string } | null = null;
  let original: RgbaImage | null = null;
  let renderError: string | null = null;
  let busy = false;
  let renderToken = { cancelled: true, abort: new AbortController() };
  let renderTask: Promise<void> = Promise.resolve();
  let renderVersion = 0;
  let previewTime: number | null = null;
  let sourceId: string | undefined;
  let renderTimer: NodeJS.Timeout | null = null;
  let renderedFor = 0;
  let cellCache: { image: RgbaImage; cols: number; rows: number; cells: BlockCell[][] } | null =
    null;
  const thumbnails = new Map<string, Promise<RgbaImage | null>>();
  const thumbnailImages = new Map<string, RgbaImage | null>();

  // Slider gestures group into one Undo step, like dragging in the app.
  let gesture: { key: string; timer: NodeJS.Timeout } | null = null;
  const endGesture = () => {
    if (!gesture) return;
    clearTimeout(gesture.timer);
    gesture = null;
    session.service.endHistoryGroup();
  };

  const effects = () => session.state.effects;
  const displayed = () => [...effects()].reverse();
  const selected = (): EffectInstance | undefined => displayed()[stackIndex];

  function flash(text: string, color: Rgb = C.green, ms = 2600) {
    toast = { text, color, until: Date.now() + ms };
    schedule();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(schedule, ms + 20).unref();
  }

  function onChange() {
    const hadTimeline = !!transport.timeline;
    transport.sync(session.state.timeline);
    if (!transport.timeline) {
      timelineMode = false;
      if (focus === 'timeline') focus = 'stack';
    } else if (!hadTimeline) timelineMode = true;
    const count = effects().length;
    stackIndex = Math.max(0, Math.min(stackIndex, count - 1));
    requestRender();
    schedule();
  }

  // ─── preview rendering ──────────────────────────────────────────────

  function layout() {
    const W = screen.width;
    const H = screen.height;
    const body: Rect = { x: 0, y: 1, w: W, h: H - 2 };
    const timelineHeight = timelineActive() ? 3 : 0;
    const timeline: Rect | null = timelineHeight ? { x: 1, y: H - 4, w: W - 2, h: 3 } : null;
    if (focusMode)
      return {
        W,
        H,
        body,
        timeline,
        stack: null,
        inspector: null,
        preview: { x: 1, y: 2, w: W - 2, h: H - 4 - timelineHeight },
      };
    const left = Math.max(22, Math.min(34, Math.round(W * 0.21)));
    const right = Math.max(32, Math.min(46, Math.round(W * 0.29)));
    const stack: Rect = { x: 1, y: 2, w: left, h: H - 4 - timelineHeight };
    const inspector: Rect = { x: W - right - 1, y: 2, w: right, h: H - 4 - timelineHeight };
    const previewRect: Rect = {
      x: left + 2,
      y: 2,
      w: W - left - right - 4,
      h: H - 4 - timelineHeight,
    };
    return { W, H, body, stack, inspector, preview: previewRect, timeline };
  }

  const timelineActive = () => timelineMode && !!session.state.timeline;
  const displayDimensions = () =>
    timelineActive() ? renderSourceSize(session.state) : session.state.source;

  function invalidatePreview() {
    previewState = null;
    previewTime = null;
    hires = null;
    fullRes = null;
    sourceFull = null;
    original = null;
    vpCache = null;
  }

  function cancelPreview() {
    renderToken.cancelled = true;
    renderToken.abort.abort();
  }

  function pausePlayback() {
    transport.playing = false;
    cancelPreview();
  }

  const graphicsOn = () => caps.protocol !== 'blocks';

  /** Where the image sits inside the preview panel. */
  function imageAreaOf(rect: Rect): Rect {
    return { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 3 };
  }

  /** Pixel size of the image area: real pixels with inline images, 1×2 per cell otherwise. */
  function viewportPixels(area: Rect, blocks: boolean) {
    return blocks
      ? { w: area.w, h: area.h * 2 }
      : { w: area.w * caps.cellWidth, h: area.h * caps.cellHeight };
  }

  function fitTarget(blocks: boolean): number {
    const area = imageAreaOf(layout().preview);
    const source = displayDimensions();
    if (!source || area.w < 2 || area.h < 2) return 64;
    const px = viewportPixels(area, blocks);
    const scale = Math.min(px.w / source.width, px.h / source.height);
    const longest = Math.max(source.width, source.height) * scale;
    // Half-blocks oversample a little so area-averaging stays crisp.
    return Math.min(blocks ? 1024 : 2048, Math.max(64, Math.ceil(longest * (blocks ? 1.5 : 1))));
  }

  function requestRender(delay = 24) {
    cancelPreview();
    const version = ++renderVersion;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderTask = renderTask.then(async () => {
        if (quitting || version !== renderVersion || modal?.kind === 'busy') return;
        await startRender();
      });
    }, delay);
  }

  const pause = (ms: number) => new Promise((resolveFn) => setTimeout(resolveFn, ms));

  async function startRender() {
    cancelPreview();
    const token = { cancelled: false, abort: new AbortController() };
    renderToken = token;
    const cancelled = () => token.cancelled;
    const state = session.state;
    const target = fitTarget(true);
    busy = true;
    refining = '';
    schedule();
    try {
      if (sourceId !== state.source?.id) {
        invalidatePreview();
        sourceId = state.source?.id;
      }
      if (timelineActive()) {
        await renderTimeline(state, target, token);
        return;
      }
      sourceFull ??= await session.sourceImage();
      if (!original || renderedFor !== target) original = await draftFor(sourceFull, target);
      if (previewState !== state || renderedFor !== target) {
        const result = await session.preview(target, cancelled);
        if (token.cancelled) return;
        preview = {
          image: result.image,
          ms: result.milliseconds,
          warnings: result.warnings,
          backend: result.backend,
        };
        previewState = state;
        renderedFor = target;
      }
      renderError = null;
      schedule();
      // Refine once edits pause: a sharper fit for inline images, full pixels when zoomed.
      if (view.zoom) {
        if (fullRes?.state !== state) {
          await pause(160);
          if (token.cancelled) return;
          refining = 'full resolution';
          schedule();
          const result = await session.render(cancelled);
          if (token.cancelled) return;
          fullRes = { image: result.image, state };
        }
      } else if (graphicsOn()) {
        const hiTarget = fitTarget(false);
        if (hiTarget > target && !(hires?.state === state && hires.target === hiTarget)) {
          await pause(160);
          if (token.cancelled) return;
          refining = 'sharpening';
          schedule();
          const result = await session.preview(hiTarget, cancelled);
          if (token.cancelled) return;
          hires = { image: result.image, state, target: hiTarget };
        }
      }
    } catch (error) {
      if (error instanceof RenderCancelledError || token.cancelled) return;
      renderError = error instanceof Error ? error.message : String(error);
      transport.playing = false;
    } finally {
      if (token === renderToken) {
        busy = false;
        refining = '';
      }
      schedule();
    }
  }

  async function renderTimeline(state: ProjectState, target: number, token: typeof renderToken) {
    const playing = transport.playing;
    const time = transport.time;
    const plan = playing ? transport.schedule() : { times: [time], fps: state.timeline!.fps };
    if (playing || previewState !== state || previewTime !== time || renderedFor !== target) {
      await previewTimeline(session, state, plan.times, {
        signal: token.abort.signal,
        maxDimension: target,
        fps: plan.fps,
        paced: playing,
        ...(playing ? { endTime: transport.range.end } : {}),
        onFrame(frame) {
          if (token.cancelled) throw new RenderCancelledError();
          if (playing) transport.displayed(frame.time);
          sourceFull = frame.original;
          original = null;
          preview = {
            image: frame.image,
            ms: frame.milliseconds,
            warnings: frame.warnings,
            backend: frame.backend,
          };
          previewState = state;
          previewTime = frame.time;
          renderedFor = target;
          hires = null;
          fullRes = null;
          busy = false;
          renderError = null;
          schedule();
        },
      });
    }
    if (token.cancelled) return;
    if (playing) {
      transport.completed();
      requestRender(0);
      return;
    }
    const highTarget = view.zoom ? undefined : fitTarget(false);
    if (
      view.zoom
        ? fullRes?.state === state
        : !graphicsOn() ||
          highTarget! <= target ||
          (hires?.state === state && hires.target === highTarget)
    )
      return;
    await pause(160);
    if (token.cancelled) return;
    refining = view.zoom ? 'full resolution' : 'sharpening';
    schedule();
    await previewTimeline(session, state, [time], {
      signal: token.abort.signal,
      ...(highTarget ? { maxDimension: highTarget } : {}),
      ...(sourceFull ? { sourceFrame: sourceFull } : {}),
      onFrame(frame) {
        if (token.cancelled) throw new RenderCancelledError();
        if (view.zoom) fullRes = { image: frame.image, state };
        else hires = { image: frame.image, state, target: highTarget! };
      },
    });
  }

  /** The best available image of the current edit (or the original, when comparing). */
  function displaySource(): RgbaImage | null {
    if (compare) return sourceFull ?? original;
    if (view.zoom && fullRes && fullRes.state === previewState) return fullRes.image;
    if (hires && hires.state === previewState && (graphicsOn() || view.zoom)) return hires.image;
    return preview?.image ?? null;
  }

  /** Whether the preview shows a quick draft that a sharper render will replace. */
  function showingDraft(): boolean {
    if (compare || !preview || displaySource() !== preview.image) return false;
    return view.zoom ? true : graphicsOn() && fitTarget(false) > renderedFor;
  }

  /**
   * Compose the visible image for the preview area. `small` keeps a draft at
   * its own resolution so kitty/iTerm2 terminals scale it up themselves:
   * sending a 940-pixel frame per slider step costs ~60–80 ms, a draft-sized
   * frame a few milliseconds.
   */
  function viewportFor(area: Rect, blocks: boolean, small = false): RgbaImage | null {
    const src = displaySource();
    const source = displayDimensions();
    if (!src || !source) return null;
    let px = viewportPixels(area, blocks);
    view = clampView(view, source, px.w, px.h);
    if (small) {
      const fit = Math.min(px.w / source.width, px.h / source.height);
      const scale = Math.min(1, src.width / source.width / (view.zoom || fit));
      // Same aspect as the area, so the terminal's stretch to cols × rows is exact.
      px = { w: Math.max(8, Math.round(px.w * scale)), h: Math.max(8, Math.round(px.h * scale)) };
    }
    const key = `${blocks}:${px.w}x${px.h}:${view.zoom}:${view.cx.toFixed(5)}:${view.cy.toFixed(5)}`;
    if (vpCache && vpCache.src === src && vpCache.key === key) return vpCache.image;
    const image = viewportImage(src, source, view, px.w, px.h, C.canvas);
    vpCache = { key, src, image };
    return image;
  }

  function setZoom(zoom: View['zoom']) {
    if (zoom === view.zoom) return;
    view = { ...view, zoom };
    flash(
      zoom ? `Zoom ${zoom}:1 — drag or use the arrow keys in focus mode (f) to pan` : 'Fit to view',
      C.muted,
    );
    requestRender(0);
  }

  function pan(dxCells: number, dyCells: number) {
    const source = displayDimensions();
    if (!source || !view.zoom) return;
    const pxPerCellX = graphicsOn() ? caps.cellWidth : 1;
    const pxPerCellY = graphicsOn() ? caps.cellHeight : 2;
    view = {
      ...view,
      cx: view.cx + (dxCells * pxPerCellX) / view.zoom / source.width,
      cy: view.cy + (dyCells * pxPerCellY) / view.zoom / source.height,
    };
    schedule();
  }

  function emitImage(image: RgbaImage, rect: Rect): string {
    const at = `\x1b[${rect.y + 1};${rect.x + 1}H`;
    if (caps.protocol === 'kitty') return at + kittyImage(image, rect.w, rect.h);
    if (caps.protocol === 'iterm') return at + itermImage(image, rect.w, rect.h);
    return at + sixelImage(image, C.canvas);
  }

  function hideImage() {
    if (!placed) return;
    if (caps.protocol === 'kitty') term.write(kittyDelete());
    placed = null;
  }

  async function openInViewer() {
    await runBusy('OPENING', async (isCancelled, signal) => {
      try {
        const result = await renderCurrentPicture(isCancelled, signal);
        const directory = await mkdtemp(join(tmpdir(), 'gleech-viewer-'));
        const path = join(directory, 'preview.png');
        await writeFile(path, await encodeImage(result.image, 'png'), { flag: 'wx', mode: 0o600 });
        const [command, args] =
          process.platform === 'win32'
            ? ['explorer.exe', [path]]
            : process.platform === 'darwin'
              ? ['open', [path]]
              : ['xdg-open', [path]];
        const viewer = spawn(command as string, args as string[], {
          detached: true,
          stdio: 'ignore',
        });
        viewer.on('error', (error) => flash(error.message, C.red, 5000));
        viewer.unref();
        flash(`Opened full resolution ${result.image.width}×${result.image.height} in your viewer`);
      } catch (error) {
        if (error instanceof RenderCancelledError) flash('Cancelled.', C.warn);
        else flash(error instanceof Error ? error.message : String(error), C.red, 5000);
      }
    });
  }

  // ─── drawing ───────────────────────────────────────────────────────

  let drawPending = false;
  function schedule() {
    if (drawPending || quitting) return;
    drawPending = true;
    setImmediate(() => {
      drawPending = false;
      draw();
    });
  }

  function key(x: number, y: number, k: string, label: string, bg: Rgb): number {
    x = screen.text(x, y, k, { fg: C.hot, bg, bold: true });
    x = screen.text(x + 1, y, label, { fg: C.muted, bg });
    return x + 2;
  }

  function panel(rect: Rect, title: string, focused: boolean, right = '') {
    screen.fill(rect, C.panel);
    screen.text(rect.x, rect.y, '▍', { fg: focused ? C.accent : C.line, bg: C.panel });
    screen.text(rect.x + 2, rect.y, title, {
      fg: focused ? C.text : C.muted,
      bg: C.panel,
      bold: true,
    });
    if (right)
      screen.text(rect.x + rect.w - 1 - cellWidth(right), rect.y, right, {
        fg: C.faint,
        bg: C.panel,
      });
  }

  function drawHeader(W: number) {
    screen.fill({ x: 0, y: 0, w: W, h: 1 }, C.window);
    let x = 1;
    x = screen.text(x, 0, '▌', { fg: C.red, bg: C.window });
    x = screen.text(x, 0, 'GLEECH', { fg: C.accent, bg: C.window, bold: true });
    x = screen.text(x, 0, '▐', { fg: C.cyan, bg: C.window });
    const source = session.state.source;
    const name = session.path ? basename(session.path) : (source?.name ?? 'Untitled');
    x = screen.text(x + 2, 0, truncate(name, W < 120 ? 16 : 28), {
      fg: C.text,
      bg: C.window,
      bold: true,
    });
    if (source && W >= 120)
      x = screen.text(x + 2, 0, `${source.width}×${source.height}`, { fg: C.muted, bg: C.window });
    if (W >= 120)
      x = screen.text(x + 2, 0, `seed ${session.state.masterSeed}`, { fg: C.muted, bg: C.window });
    if (session.dirty)
      screen.text(x + 2, 0, W < 120 ? '●' : '● edited', { fg: C.accent, bg: C.window });
    let status: string;
    let color = C.faint;
    if (busy) {
      status = `${SPINNER[spinner % SPINNER.length]} rendering`;
      color = C.accent;
    } else if (renderError) {
      status = '✕ render failed';
      color = C.red;
    } else
      status = preview
        ? `${renderingSettings().renderer}/${preview.backend} · ${Math.round(preview.ms)} ms · ${PROTOCOL_LABEL[caps.protocol]}`
        : '';
    const right = `${status}   v${APP_VERSION}`;
    const rx = W - 1 - cellWidth(right);
    screen.text(rx, 0, status, { fg: color, bg: C.window });
    screen.text(W - 1 - cellWidth(`v${APP_VERSION}`), 0, `v${APP_VERSION}`, {
      fg: C.faint,
      bg: C.window,
    });
  }

  function drawStack(rect: Rect) {
    const list = displayed();
    panel(
      rect,
      'STACK',
      focus === 'stack' && !modal,
      `${list.length} layer${list.length === 1 ? '' : 's'}`,
    );
    const top = rect.y + 2;
    const footer = 3;
    const visible = Math.max(1, rect.h - 2 - footer);
    if (stackIndex < stackScroll) stackScroll = stackIndex;
    if (stackIndex >= stackScroll + visible) stackScroll = stackIndex - visible + 1;
    stackScroll = Math.max(0, Math.min(stackScroll, Math.max(0, list.length - visible)));
    if (!list.length) {
      screen.text(rect.x + 2, top, 'No layers yet.', { fg: C.muted, bg: C.panel });
      let y = top + 2;
      for (const [k, label] of [
        ['a', 'add an effect'],
        ['p', 'apply a preset'],
        ['g', 'roll a GLEECH'],
      ] as const) {
        key(rect.x + 2, y++, k, label, C.panel);
      }
    }
    for (let row = 0; row < visible; row++) {
      const index = stackScroll + row;
      const effect = list[index];
      if (!effect) break;
      const y = top + row;
      const isSelected = index === stackIndex;
      const bg = isSelected ? (focus === 'stack' && !modal ? C.select : C.selectDim) : C.panel;
      screen.fill({ x: rect.x, y, w: rect.w, h: 1 }, bg);
      if (isSelected)
        screen.text(rect.x, y, '▌', { fg: focus === 'stack' ? C.accent : C.faint, bg });
      screen.text(rect.x + 2, y, effect.enabled ? '●' : '○', {
        fg: effect.enabled ? C.accent : C.faint,
        bg,
      });
      const title = effectTitle(effect);
      const tag = effect.locked ? 'locked' : effect.paintedMask?.enabled ? 'mask' : '';
      const room = rect.w - 6 - (tag ? tag.length + 1 : 0);
      screen.text(rect.x + 4, y, truncate(title, room), {
        fg: effect.enabled ? (isSelected ? C.text : C.text) : C.faint,
        bg,
        bold: isSelected,
      });
      if (tag) screen.text(rect.x + rect.w - 1 - tag.length, y, tag, { fg: C.faint, bg });
      hits.push({
        rect: { x: rect.x, y, w: rect.w, h: 1 },
        press(event) {
          focus = 'stack';
          stackIndex = index;
          inspectorIndex = 0;
          inspectorScroll = 0;
          if (event.x <= rect.x + 3)
            session.service.updateEffect(effect.instanceId, { enabled: !effect.enabled });
          schedule();
        },
        wheel: (d) => moveStack(d),
      });
    }
    if (list.length > visible) {
      const thumbH = Math.max(1, Math.round((visible * visible) / list.length));
      const thumbY = Math.round((stackScroll / (list.length - visible)) * (visible - thumbH));
      for (let i = 0; i < visible; i++)
        screen.text(rect.x + rect.w - 1, top + i, i >= thumbY && i < thumbY + thumbH ? '┃' : '│', {
          fg: i >= thumbY && i < thumbY + thumbH ? C.muted : C.line,
          bg: C.panel,
        });
    }
    // Source image, beneath the stack like the app's base layer.
    const sy = rect.y + rect.h - 2;
    screen.text(rect.x + 1, sy - 1, '─'.repeat(rect.w - 2), { fg: C.line, bg: C.panel });
    const source = session.state.source;
    screen.text(rect.x + 2, sy, '▣', { fg: C.muted, bg: C.panel });
    screen.text(rect.x + 4, sy, truncate(source?.name ?? 'No image', rect.w - 6), {
      fg: C.muted,
      bg: C.panel,
    });
  }

  function rows(effect: EffectInstance): Row[] {
    const entries = paramEntries(effect);
    const out: Row[] = [];
    for (const group of GROUP_ORDER) {
      const members = entries.filter((entry) => entry.group === group);
      if (!members.length) continue;
      out.push({ kind: 'group', group, count: members.length });
      if (!collapsed.has(group)) for (const entry of members) out.push({ kind: 'param', entry });
    }
    return out;
  }

  function sliderFraction(entry: ParamEntry): number {
    const d = entry.definition;
    if (d.kind !== 'number') return 0;
    return Math.max(0, Math.min(1, (Number(entry.value) - d.min) / (d.max - d.min || 1)));
  }

  function hexRgb(hex: string): Rgb {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function drawInspector(rect: Rect) {
    const effect = selected();
    panel(rect, 'INSPECTOR', focus === 'inspector' && !modal, effect ? effectCategory(effect) : '');
    if (!effect) {
      screen.text(rect.x + 2, rect.y + 2, 'Select a layer to edit it.', {
        fg: C.muted,
        bg: C.panel,
      });
      return;
    }
    const inner = rect.w - 4;
    let y = rect.y + 2;
    screen.text(rect.x + 2, y, truncate(effectTitle(effect), inner), {
      fg: C.hot,
      bg: C.panel,
      bold: true,
    });
    const state = effect.enabled ? (effect.locked ? 'on · locked' : 'on') : 'off';
    screen.text(rect.x + rect.w - 2 - state.length, y, state, {
      fg: effect.enabled ? C.green : C.faint,
      bg: C.panel,
    });
    y += 1;
    const description =
      effect.type === 'shader-import'
        ? `Imported ${effect.shader.language.toUpperCase()} shader — rendered using the desktop GPU engine.`
        : EFFECT_DEFINITIONS[effect.type].description;
    for (const line of wrapText(description, inner).slice(0, 2)) {
      screen.text(rect.x + 2, y++, line, { fg: C.faint, bg: C.panel, italic: true });
    }
    y += 1;
    const list = rows(effect);
    inspectorIndex = Math.max(0, Math.min(inspectorIndex, list.length - 1));
    const helpLines = 4;
    const visible = Math.max(1, rect.y + rect.h - y - helpLines);
    if (inspectorIndex < inspectorScroll) inspectorScroll = inspectorIndex;
    if (inspectorIndex >= inspectorScroll + visible) inspectorScroll = inspectorIndex - visible + 1;
    inspectorScroll = Math.max(0, Math.min(inspectorScroll, Math.max(0, list.length - visible)));
    const labelW = Math.min(16, Math.floor(inner * 0.4));
    const valueW = 9;
    const sliderW = Math.max(4, inner - labelW - valueW - 2);
    const focused = focus === 'inspector' && !modal;
    for (let i = 0; i < visible; i++) {
      const index = inspectorScroll + i;
      const row = list[index];
      if (!row) break;
      const ry = y + i;
      const isSelected = index === inspectorIndex;
      const bg = isSelected ? (focused ? C.select : C.selectDim) : C.panel;
      screen.fill({ x: rect.x, y: ry, w: rect.w, h: 1 }, bg);
      if (isSelected) screen.text(rect.x, ry, '▌', { fg: focused ? C.accent : C.faint, bg });
      if (row.kind === 'group') {
        const open = !collapsed.has(row.group);
        screen.text(rect.x + 2, ry, `${open ? '▾' : '▸'} ${row.group.toUpperCase()}`, {
          fg: open ? C.accent : C.muted,
          bg,
          bold: true,
        });
        screen.text(rect.x + rect.w - 2 - String(row.count).length, ry, String(row.count), {
          fg: C.faint,
          bg,
        });
        hits.push({
          rect: { x: rect.x, y: ry, w: rect.w, h: 1 },
          press() {
            focus = 'inspector';
            inspectorIndex = index;
            toggleGroup(row.group);
          },
          wheel: (d) => moveInspector(d),
        });
        continue;
      }
      const { entry } = row;
      const d = entry.definition;
      const isDefault = String(entry.value) === String(d.default);
      screen.text(rect.x + 2, ry, truncate(d.label, labelW), {
        fg: isSelected ? C.text : C.muted,
        bg,
      });
      const vx = rect.x + 2 + labelW + 1;
      const value = formatValue(d, entry.value);
      if (d.kind === 'number') {
        const fraction = sliderFraction(entry);
        const filled = Math.round(fraction * (sliderW - 1));
        for (let s = 0; s < sliderW; s++) {
          const ch = s === filled ? '●' : s < filled ? '━' : '─';
          const fg =
            s === filled ? (isSelected ? C.hot : C.accent) : s < filled ? C.accent : C.track;
          screen.text(vx + s, ry, ch, { fg, bg });
        }
        const text = truncate(value, valueW);
        screen.text(rect.x + rect.w - 2 - cellWidth(text), ry, text, {
          fg: isDefault ? C.muted : C.hot,
          bg,
        });
      } else if (d.kind === 'choice') {
        const text = truncate(value, sliderW + valueW - 3);
        const x = screen.text(vx, ry, '‹ ', { fg: C.faint, bg });
        const after = screen.text(x, ry, text, { fg: isDefault ? C.text : C.hot, bg });
        screen.text(after, ry, ' ›', { fg: C.faint, bg });
      } else if (d.kind === 'color') {
        screen.text(vx, ry, '██', { fg: hexRgb(String(entry.value)), bg });
        screen.text(vx + 3, ry, value, { fg: isDefault ? C.text : C.hot, bg });
      } else {
        screen.text(vx, ry, truncate(value, sliderW + valueW), {
          fg: isDefault ? C.text : C.hot,
          bg,
        });
      }
      const sliderRect = { x: vx, y: ry, w: sliderW, h: 1 };
      const slide = (event: MouseEvent) => {
        if (d.kind !== 'number') return;
        const t = Math.max(
          0,
          Math.min(1, (event.x - sliderRect.x) / Math.max(1, sliderRect.w - 1)),
        );
        setValue(entry, d.min + t * (d.max - d.min), true);
      };
      hits.push({
        rect: { x: rect.x, y: ry, w: rect.w, h: 1 },
        press(event) {
          focus = 'inspector';
          inspectorIndex = index;
          if (
            d.kind === 'number' &&
            event.x >= sliderRect.x &&
            event.x < sliderRect.x + sliderRect.w
          )
            slide(event);
          else if (d.kind === 'choice') setValue(entry, stepParam(d, entry.value, 1, false), false);
          schedule();
        },
        ...(d.kind === 'number' ? { drag: slide } : {}),
        wheel: (direction) => moveInspector(direction),
      });
    }
    if (list.length > visible) {
      const thumbH = Math.max(1, Math.round((visible * visible) / list.length));
      const thumbY = Math.round((inspectorScroll / (list.length - visible)) * (visible - thumbH));
      for (let i = 0; i < visible; i++)
        screen.text(rect.x + rect.w - 1, y + i, i >= thumbY && i < thumbY + thumbH ? '┃' : '│', {
          fg: i >= thumbY && i < thumbY + thumbH ? C.muted : C.line,
          bg: C.panel,
        });
    }
    // Parameter help, as the app's info tooltips.
    const current = list[inspectorIndex];
    const hy = rect.y + rect.h - helpLines;
    screen.text(rect.x + 1, hy, '─'.repeat(rect.w - 2), { fg: C.line, bg: C.panel });
    const help =
      current?.kind === 'param'
        ? current.entry.definition.description
        : current
          ? `${collapsed.has(current.group) ? 'Enter to expand' : 'Enter to collapse'} ${current.group.toLowerCase()} controls.`
          : '';
    wrapText(help, inner)
      .slice(0, helpLines - 1)
      .forEach((line, i) =>
        screen.text(rect.x + 2, hy + 1 + i, line, { fg: C.muted, bg: C.panel }),
      );
  }

  function drawBlocks(area: Rect, image: RgbaImage) {
    if (
      !cellCache ||
      cellCache.image !== image ||
      cellCache.cols !== area.w ||
      cellCache.rows !== area.h
    )
      cellCache = { image, cols: area.w, rows: area.h, cells: blockCells(image, area.w, area.h) };
    const cells = cellCache.cells;
    for (let y = 0; y < area.h; y++)
      for (let x = 0; x < area.w; x++) {
        const cell = cells[y]![x]!;
        screen.set(area.x + x, area.y + y, '▀', { fg: cell.top, bg: cell.bottom });
      }
  }

  function drawPreview(rect: Rect) {
    screen.fill(rect, C.canvas);
    const area = imageAreaOf(rect);
    // Inline images sit over plain canvas cells. Sixel and iTerm2 images let a
    // dialog's text cover them; kitty images float above text, so with a
    // dialog open kitty falls back to half-blocks.
    // While a draft is showing (edits in progress), sixel would re-encode a
    // full-size frame per step, so it shows half-blocks until the sharp render
    // lands; kitty and iTerm2 receive the small draft and scale it.
    const draft = showingDraft();
    const inline =
      graphicsOn() &&
      !renderError &&
      !(modal && caps.protocol === 'kitty') &&
      !(draft && caps.protocol === 'sixel');
    const image = renderError ? null : viewportFor(area, !inline, inline && draft);
    if (image && inline) {
      imageArea = area;
      pendingImage = image;
    } else if (image) drawBlocks(area, image);
    else if (!renderError) {
      const msg = `${SPINNER[spinner % SPINNER.length]} rendering preview`;
      screen.text(
        rect.x + Math.floor((rect.w - cellWidth(msg)) / 2),
        rect.y + Math.floor(rect.h / 2),
        msg,
        {
          fg: C.accent,
          bg: C.canvas,
        },
      );
    }
    if (renderError) {
      const lines = wrapText(renderError, Math.max(10, rect.w - 8)).slice(0, 4);
      const by = rect.y + Math.floor(rect.h / 2) - Math.floor(lines.length / 2);
      const w = Math.min(rect.w - 4, Math.max(...lines.map(cellWidth)) + 4);
      const bx = rect.x + Math.floor((rect.w - w) / 2);
      screen.fill({ x: bx, y: by - 1, w, h: lines.length + 2 }, mix(C.canvas, C.red, 0.18));
      lines.forEach((line, i) =>
        screen.text(bx + 2, by + i, line, { fg: C.text, bg: mix(C.canvas, C.red, 0.18) }),
      );
    }
    // Caption row: badges live here so inline images never cover them.
    const cy = rect.y + rect.h - 1;
    const source = session.state.source;
    let x = rect.x + 1;
    if (compare) x = screen.text(x, cy, ' ORIGINAL ', { fg: C.ink, bg: C.accent, bold: true }) + 1;
    if (view.zoom)
      x = screen.text(x, cy, ` ${view.zoom}:1 `, { fg: C.ink, bg: C.cyan, bold: true }) + 1;
    const parts: string[] = [];
    if (refining) parts.push(`${SPINNER[spinner % SPINNER.length]} ${refining}`);
    else if (preview) {
      const shown = displaySource();
      if (shown && !compare) parts.push(`preview ${shown.width}×${shown.height}`);
    }
    if (source) parts.push(`export ${source.width}×${source.height}`);
    if (preview?.warnings.length) parts.push(`▲ ${preview.warnings.length} warnings`);
    const caption = parts.join('  ·  ');
    screen.text(
      Math.max(x + 1, rect.x + Math.floor((rect.w - cellWidth(caption)) / 2)),
      cy,
      caption,
      { fg: preview?.warnings.length ? C.warn : refining ? C.accent : C.faint, bg: C.canvas },
      rect.x + rect.w - x - 2,
    );
    hits.push({
      rect,
      press(event) {
        drag = { x: event.x, y: event.y, cx: view.cx, cy: view.cy };
      },
      drag(event) {
        if (!drag || !view.zoom) return;
        const start = drag;
        view = { ...view, cx: start.cx, cy: start.cy };
        pan(start.x - event.x, start.y - event.y);
      },
      wheel(direction) {
        const index = ZOOMS.indexOf(view.zoom);
        setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index - direction))]!);
      },
    });
  }

  function drawFooter(W: number, H: number) {
    const y = H - 1;
    screen.fill({ x: 0, y, w: W, h: 1 }, C.window);
    if (toast && toast.until > Date.now()) {
      screen.text(1, y, truncate(toast.text, W - 2), { fg: toast.color, bg: C.window });
      return;
    }
    const hints: [string, string][] =
      focus === 'timeline' && timelineActive()
        ? [
            ['␣', transport.playing ? 'pause' : 'play'],
            ['←→', 'frame'],
            ['⇧←→', '1 second'],
            ['g', 'go to'],
            ['r', 'range'],
            ['e', 'export'],
            ['tab', 'stack'],
            ['?', 'help'],
          ]
        : focusMode
          ? [
              ['z', view.zoom ? `zoom ${view.zoom}:1` : 'zoom'],
              ['Z', 'fit'],
              ['←→↑↓', view.zoom ? 'pan' : 'pan when zoomed'],
              ['drag', 'pan'],
              ['v', 'compare'],
              ['O', 'open full res'],
              ['f', 'exit focus'],
              ['g', 'gleech'],
              ['u', 'undo'],
              ['?', 'help'],
            ]
          : focus === 'stack'
            ? [
                ['↑↓', 'select'],
                ['␣', 'on/off'],
                ['⏎', 'edit'],
                ['⇧↑↓', 'move'],
                ['a', 'add'],
                ['p', 'presets'],
                ['t', 'timeline'],
                ['g', 'gleech'],
                ['r', 'reseed'],
                ['d', 'delete'],
                ['u', 'undo'],
                ['e', 'export'],
                ['s', 'save'],
                ['?', 'help'],
                ['q', 'quit'],
              ]
            : [
                ['↑↓', 'param'],
                ['←→', 'adjust'],
                ['⇧←→', 'big steps'],
                ['⏎', 'type value'],
                ['⌫', 'reset'],
                ['esc', 'stack'],
                ['v', 'compare'],
                ['z', 'zoom'],
                ['u', 'undo'],
                ['?', 'help'],
              ];
    let x = 1;
    hints.unshift([',', 'settings']);
    for (const [k, label] of hints) {
      const need = cellWidth(k) + cellWidth(label) + 3;
      if (x + need > W - 1) break;
      x = key(x, y, k, label, C.window);
    }
  }

  function seekTimeline(frame: number, delay = 0) {
    transport.seek(frame);
    invalidatePreview();
    requestRender(delay);
  }

  function scrubTimeline(x: number, delay = 0) {
    const r = layout().timeline;
    if (!r) return;
    const fraction = Math.max(0, Math.min(1, (x - r.x - 1) / Math.max(1, r.w - 3)));
    focus = 'timeline';
    seekTimeline(Math.round(fraction * (transport.count - 1)), delay);
  }

  function drawTimeline(rect: Rect) {
    const timeline = session.state.timeline!;
    screen.fill(rect, C.panel);
    const status = transport.playing ? 'PLAY' : 'PAUSED';
    screen.text(rect.x + 1, rect.y, 'TIMELINE', {
      fg: focus === 'timeline' ? C.accent : C.muted,
      bg: C.panel,
      bold: true,
    });
    screen.text(
      rect.x + 11,
      rect.y,
      `${status}  ${transport.time.toFixed(3)}s  frame ${transport.frame + 1}/${transport.count}  ${timeline.fps}fps  ${transport.rangeKind}  · silent preview`,
      { fg: C.text, bg: C.panel },
      rect.w - 12,
    );
    const width = Math.max(2, rect.w - 2);
    const at = (t: number) =>
      rect.x +
      1 +
      Math.max(
        0,
        Math.min(
          width - 1,
          Math.round(((t * timeline.fps) / Math.max(1, transport.count - 1)) * (width - 1)),
        ),
      );
    const range = transport.range;
    for (let i = 0; i < width; i++) {
      const time = ((i / (width - 1)) * (transport.count - 1)) / timeline.fps;
      screen.set(rect.x + 1 + i, rect.y + 1, '─', {
        fg: time >= range.start && time < range.end ? C.accent : C.faint,
        bg: C.panel,
      });
    }
    for (const marker of timeline.markers)
      screen.set(at(marker.t), rect.y + 1, '│', { fg: C.cyan, bg: C.panel });
    for (const lane of Object.values(selected()?.animation ?? {}))
      for (const keyframe of lane.keys)
        screen.set(at(keyframe.t), rect.y + 1, '◆', { fg: C.hot, bg: C.panel });
    screen.set(at(transport.time), rect.y + 1, '┃', { fg: C.text, bg: C.accent });
    screen.text(
      rect.x + 1,
      rect.y + 2,
      `t image/timeline · tab focus · space play/pause · ←→ frame · i/o In/Out · r range · e export`,
      { fg: C.muted, bg: C.panel },
      rect.w - 2,
    );
    hits.push({
      rect,
      press(event) {
        timelineDrag = true;
        scrubTimeline(event.x);
      },
      drag: (event) => scrubTimeline(event.x, 60),
      wheel: (direction) => seekTimeline(transport.frame + direction),
    });
  }

  // ─── modals ─────────────────────────────────────────────────────────

  function box(w: number, h: number, title: string): Rect {
    const W = screen.width;
    const H = screen.height;
    w = Math.min(w, W - 4);
    h = Math.min(h, H - 2);
    const rect = { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
    modalRect = { x: rect.x, y: rect.y, w: w + 2, h: h + 1 };
    // Soft shadow on the canvas beneath.
    for (let y = rect.y + 1; y <= rect.y + h && y < H; y++)
      for (let x = rect.x + 2; x <= rect.x + w + 1 && x < W; x++)
        if (x >= rect.x + w || y >= rect.y + h)
          screen.set(x, y, ' ', { bg: mix(screen.bgAt(x, y), [0, 0, 0], 0.55) });
    screen.fill(rect, C.elevated);
    screen.fill({ x: rect.x, y: rect.y, w, h: 1 }, mix(C.elevated, C.accent, 0.1));
    screen.text(rect.x + 2, rect.y, title, {
      fg: C.hot,
      bg: mix(C.elevated, C.accent, 0.1),
      bold: true,
    });
    hits.push({ rect: { x: 0, y: 0, w: W, h: H }, press: () => {} }); // modal captures the mouse
    return rect;
  }

  function input(x: number, y: number, w: number, value: string, cursor: number, placeholder = '') {
    const bg = mix(C.elevated, C.window, 0.6);
    screen.fill({ x, y, w, h: 1 }, bg);
    // Keep the cursor in view for long values.
    const start = Math.max(0, cursor - (w - 3));
    const shown = value.slice(start, start + w - 2);
    if (!value && placeholder)
      screen.text(x + 1, y, truncate(placeholder, w - 2), { fg: C.faint, bg });
    else screen.text(x + 1, y, shown, { fg: C.text, bg });
    const cx = x + 1 + cellWidth(value.slice(start, cursor));
    if (cx < x + w) screen.set(cx, y, value[cursor] ?? ' ', { fg: C.ink, bg: C.accent });
  }

  function effectMatches(m: EffectModal): EffectType[] {
    return filterEffectCatalog(m.query, EFFECT_CATEGORIES[m.category]!);
  }

  function drawEffectModal(m: EffectModal) {
    const r = box(78, 30, 'ADD EFFECT');
    input(
      r.x + 2,
      r.y + 2,
      r.w - 4,
      m.query,
      m.query.length,
      'Search 109 effects — try “sort”, “crt”, “depth”…',
    );
    let x = r.x + 2;
    EFFECT_CATEGORIES.forEach((category, i) => {
      const active = i === m.category;
      const label = ` ${category} `;
      if (x + cellWidth(label) > r.x + r.w - 2) return;
      screen.text(x, r.y + 4, label, {
        fg: active ? C.ink : C.muted,
        bg: active ? C.accent : C.elevated,
        bold: active,
      });
      x += cellWidth(label);
    });
    const items = effectMatches(m);
    m.index = Math.max(0, Math.min(m.index, items.length - 1));
    const top = r.y + 6;
    const visible = r.h - 11;
    if (m.index < m.scroll) m.scroll = m.index;
    if (m.index >= m.scroll + visible) m.scroll = m.index - visible + 1;
    for (let i = 0; i < visible; i++) {
      const type = items[m.scroll + i];
      if (!type) break;
      const y = top + i;
      const active = m.scroll + i === m.index;
      const bg = active ? mix(C.elevated, C.accent, 0.16) : C.elevated;
      screen.fill({ x: r.x + 1, y, w: r.w - 2, h: 1 }, bg);
      if (active) screen.text(r.x + 1, y, '▌', { fg: C.accent, bg });
      screen.text(r.x + 3, y, EFFECT_DEFINITIONS[type].title, {
        fg: active ? C.text : C.text,
        bg,
        bold: active,
      });
      const cat = EFFECT_CATEGORY[type];
      screen.text(r.x + r.w - 3 - cat.length, y, cat, { fg: C.faint, bg });
    }
    if (!items.length)
      screen.text(r.x + 3, top, 'No effects match.', { fg: C.muted, bg: C.elevated });
    const current = items[m.index];
    const dy = r.y + r.h - 5;
    screen.text(r.x + 1, dy, '─'.repeat(r.w - 2), { fg: C.line, bg: C.elevated });
    if (current)
      wrapText(EFFECT_DEFINITIONS[current].description, r.w - 6)
        .slice(0, 3)
        .forEach((line, i) =>
          screen.text(r.x + 3, dy + 1 + i, line, { fg: C.muted, bg: C.elevated }),
        );
    const hint = `${items.length} effects  ·  ⇥ category  ·  ⏎ add above selection  ·  esc close`;
    screen.text(r.x + 2, r.y + r.h - 1, truncate(hint, r.w - 4), { fg: C.faint, bg: C.elevated });
  }

  function presetMatches(m: PresetModal): CliPreset[] {
    const q = m.query.toLowerCase();
    return m.presets.filter(
      (p) =>
        !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    );
  }

  function presetThumb(preset: CliPreset): RgbaImage | null | undefined {
    if (thumbnailImages.has(preset.id)) return thumbnailImages.get(preset.id);
    if (!thumbnails.has(preset.id)) {
      const pending = decodeImageBytes(Buffer.from(preset.thumbnail.split(',')[1] ?? '', 'base64'))
        .then((decoded) => decoded.image)
        .catch(() => null);
      thumbnails.set(preset.id, pending);
      void pending.then((image) => {
        thumbnailImages.set(preset.id, image);
        schedule();
      });
    }
    return undefined;
  }

  function drawPresetModal(m: PresetModal) {
    const r = box(92, 30, 'PRESETS');
    const listW = Math.floor((r.w - 4) * 0.5);
    input(r.x + 2, r.y + 2, r.w - 4, m.query, m.query.length, `Search ${m.presets.length} presets`);
    const items = presetMatches(m);
    m.index = Math.max(0, Math.min(m.index, items.length - 1));
    const top = r.y + 4;
    const visible = r.h - 7;
    if (m.index < m.scroll) m.scroll = m.index;
    if (m.index >= m.scroll + visible) m.scroll = m.index - visible + 1;
    for (let i = 0; i < visible; i++) {
      const preset = items[m.scroll + i];
      if (!preset) break;
      const y = top + i;
      const active = m.scroll + i === m.index;
      const bg = active ? mix(C.elevated, C.accent, 0.16) : C.elevated;
      screen.fill({ x: r.x + 1, y, w: listW, h: 1 }, bg);
      if (active) screen.text(r.x + 1, y, '▌', { fg: C.accent, bg });
      screen.text(r.x + 3, y, truncate(preset.name, listW - 8), { fg: C.text, bg, bold: active });
      const tag = preset.origin === 'built-in' ? `${preset.effects.length}L` : 'mine';
      screen.text(r.x + listW - tag.length - 1, y, tag, {
        fg: preset.origin === 'built-in' ? C.faint : C.cyan,
        bg,
      });
    }
    if (!items.length)
      screen.text(r.x + 3, top, 'No presets match.', { fg: C.muted, bg: C.elevated });
    // Detail column with thumbnail
    const current = items[m.index];
    const dx = r.x + listW + 3;
    const dw = r.w - listW - 5;
    if (current) {
      const thumb = presetThumb(current);
      const area = { x: dx, y: top, w: dw, h: Math.max(4, visible - 8) };
      screen.fill(area, C.canvas);
      if (thumb) drawImageInto(area, thumb);
      else if (thumb === undefined)
        screen.text(dx + 2, top + 1, '…', { fg: C.faint, bg: C.canvas });
      let y = top + area.h + 1;
      screen.text(dx, y++, truncate(current.name, dw), { fg: C.hot, bg: C.elevated, bold: true });
      for (const line of wrapText(current.description ?? '', dw).slice(0, 3))
        screen.text(dx, y++, line, { fg: C.muted, bg: C.elevated });
      const stack = [...current.effects].reverse().map(effectTitle).join(' › ');
      for (const line of wrapText(stack, dw).slice(0, 2))
        screen.text(dx, y++, line, { fg: C.faint, bg: C.elevated });
    }
    const placement = PLACEMENTS[m.placement]!;
    const fy = r.y + r.h - 1;
    let x = screen.text(r.x + 2, fy, 'placement ', { fg: C.faint, bg: C.elevated });
    x = screen.text(x, fy, ` ${placement} `, { fg: C.ink, bg: C.accent, bold: true });
    screen.text(x + 2, fy, truncate('⇥ change  ·  ⏎ apply  ·  esc close', r.x + r.w - x - 4), {
      fg: C.faint,
      bg: C.elevated,
    });
  }

  function drawImageInto(area: Rect, image: RgbaImage) {
    const size = blockSize(image.width, image.height, area.w, area.h);
    const cells = blockCells(image, size.cols, size.rows);
    const ox = area.x + Math.floor((area.w - size.cols) / 2);
    const oy = area.y + Math.floor((area.h - size.rows) / 2);
    for (let y = 0; y < size.rows; y++)
      for (let x = 0; x < size.cols; x++) {
        const c = cells[y]![x]!;
        screen.set(ox + x, oy + y, '▀', { fg: c.top, bg: c.bottom });
      }
  }

  function drawGleechModal(m: GleechModal) {
    const r = box(66, 13, 'GLEECH');
    screen.text(
      r.x + 2,
      r.y + 2,
      'Roll a random stack. Every roll is reproducible by seed.',
      { fg: C.muted, bg: C.elevated },
      r.w - 4,
    );
    const fields: [string, string][] = [
      ['Complexity', gleechComplexity],
      ['Mode', gleechMode],
    ];
    fields.forEach(([label, value], i) => {
      const y = r.y + 4 + i * 2;
      const active = m.row === i;
      const bg = active ? mix(C.elevated, C.accent, 0.16) : C.elevated;
      screen.fill({ x: r.x + 1, y, w: r.w - 2, h: 1 }, bg);
      if (active) screen.text(r.x + 1, y, '▌', { fg: C.accent, bg });
      screen.text(r.x + 3, y, label, { fg: C.muted, bg });
      const x = screen.text(r.x + 17, y, '‹ ', { fg: C.faint, bg });
      const after = screen.text(x, y, value, { fg: C.hot, bg, bold: true });
      screen.text(after, y, ' ›', { fg: C.faint, bg });
    });
    const modeHelp: Record<GleechMode, string> = {
      'keep-locked': 'Keep locked layers in place; replace or drop the rest.',
      'replace-all': 'Discard the stack and roll a fresh one.',
      'keep-all-add': 'Keep every layer and add new ones on top.',
      'randomize-add': 'Vary existing layers and add new ones.',
      'existing-only': 'Only vary the settings of existing layers.',
    };
    screen.text(r.x + 3, r.y + 8, modeHelp[gleechMode], { fg: C.faint, bg: C.elevated }, r.w - 5);
    if (lastGleechSeed !== null)
      screen.text(r.x + 3, r.y + 10, `last seed ${lastGleechSeed}`, {
        fg: C.faint,
        bg: C.elevated,
      });
    screen.text(
      r.x + 2,
      r.y + r.h - 1,
      '↑↓ field  ·  ←→ change  ·  ⏎ roll  ·  esc close',
      { fg: C.faint, bg: C.elevated },
      r.w - 4,
    );
  }

  function drawPrompt(m: PromptModal) {
    const r = box(70, m.error ? 9 : 8, m.title);
    screen.text(r.x + 2, r.y + 2, m.label, { fg: C.muted, bg: C.elevated }, r.w - 4);
    input(r.x + 2, r.y + 3, r.w - 4, m.value, m.cursor);
    if (m.hint)
      screen.text(r.x + 2, r.y + 5, truncate(m.hint, r.w - 4), { fg: C.faint, bg: C.elevated });
    if (m.error)
      screen.text(r.x + 2, r.y + 6, truncate(`✕ ${m.error}`, r.w - 4), {
        fg: C.red,
        bg: C.elevated,
      });
    screen.text(r.x + 2, r.y + r.h - 1, '⏎ confirm  ·  esc cancel', {
      fg: C.faint,
      bg: C.elevated,
    });
  }

  function drawConfirm(m: ConfirmModal) {
    const lines = wrapText(m.message, 50);
    const r = box(58, lines.length + 6, m.title);
    lines.forEach((line, i) =>
      screen.text(r.x + 2, r.y + 2 + i, line, { fg: C.text, bg: C.elevated }),
    );
    let x = r.x + 2;
    const y = r.y + r.h - 2;
    for (const option of m.options) x = key(x, y, option.key, option.label, C.elevated) + 1;
  }

  function drawBusy(m: BusyModal) {
    const r = box(48, 7, m.title);
    const seconds = ((performance.now() - m.started) / 1000).toFixed(1);
    screen.text(
      r.x + 2,
      r.y + 2,
      `${SPINNER[spinner % SPINNER.length]} ${m.detail ?? 'working at full resolution'}`,
      { fg: C.accent, bg: C.elevated },
    );
    screen.text(r.x + 2, r.y + 3, `${seconds}s`, { fg: C.faint, bg: C.elevated });
    if (m.cancel)
      screen.text(r.x + 2, r.y + r.h - 1, 'esc cancel', { fg: C.faint, bg: C.elevated });
  }

  function drawTimelineExport(m: TimelineExportModal) {
    const r = box(82, 15, 'EXPORT TIMELINE');
    const rows = [
      ['Format', m.format === 'png' ? 'PNG sequence' : m.format.toUpperCase()],
      [
        'Range',
        m.range === 'whole' ? 'Whole timeline' : m.range === 'work' ? 'Work area' : 'In / Out',
      ],
      ['FPS', m.fps],
      ['Width', `${m.width} px · preserve aspect ratio`],
      [
        'Audio',
        m.format === 'mp4' ? (m.audio ? 'On · saved track and clip sound' : 'Off') : 'Silent',
      ],
      [m.format === 'png' ? 'Folder' : 'File', m.path],
      ['Render', 'Enter to export'],
    ];
    rows.forEach(([label, value], index) => {
      const y = r.y + 2 + index;
      const bg = m.row === index ? C.select : C.elevated;
      screen.fill({ x: r.x + 1, y, w: r.w - 2, h: 1 }, bg);
      screen.text(r.x + 2, y, label!, { fg: m.row === index ? C.hot : C.muted, bg }, 8);
      screen.text(r.x + 12, y, value!, { fg: C.text, bg }, r.w - 14);
      hits.push({
        rect: { x: r.x + 1, y, w: r.w - 2, h: 1 },
        press() {
          m.row = index;
          if (index === 6) void startTimelineExport(m);
          else editTimelineExport(m);
          schedule();
        },
      });
    });
    screen.text(
      r.x + 2,
      r.y + 10,
      m.error ?? 'Existing output needs a second Enter to replace.',
      { fg: m.error ? C.warn : C.faint, bg: C.elevated },
      r.w - 4,
    );
    screen.text(
      r.x + 2,
      r.y + r.h - 2,
      '↑↓/tab field · ←→ change · enter edit/render · esc close',
      { fg: C.muted, bg: C.elevated },
      r.w - 4,
    );
  }

  function changeTimelineExport(m: TimelineExportModal, direction: number) {
    m.error = undefined;
    m.overwritePath = undefined;
    if (m.row === 0) {
      const formats = ['mp4', 'gif', 'png'] as const;
      m.format =
        formats[(formats.indexOf(m.format) + direction + formats.length) % formats.length]!;
      if (!m.pathEdited) m.path = timelineOutputPath(session, m.format);
      if (!m.fpsEdited) m.fps = String(m.format === 'gif' ? 15 : session.state.timeline!.fps);
      if (!m.widthEdited)
        m.width = String(
          m.format === 'gif'
            ? Math.max(16, Math.min(480, renderSourceSize(session.state).width))
            : renderSourceSize(session.state).width,
        );
    } else if (m.row === 1) {
      const ranges = timelineRanges(session.state.timeline!);
      m.range = ranges[(ranges.indexOf(m.range) + direction + ranges.length) % ranges.length]!;
    } else if (m.row === 2) {
      if (m.format === 'gif') {
        const rates = [10, 12, 15, 24, 30];
        const index = Math.max(0, rates.indexOf(Number(m.fps)));
        m.fps = String(rates[(index + direction + rates.length) % rates.length]);
      } else m.fps = String(Math.max(1, Math.min(240, (Number(m.fps) || 30) + direction)));
      m.fpsEdited = true;
    } else if (m.row === 3) {
      m.width = String(
        Math.max(
          m.format === 'gif' ? 16 : 2,
          Math.min(m.format === 'gif' ? 4096 : 8192, (Number(m.width) || 480) + direction * 32),
        ),
      );
      m.widthEdited = true;
    } else if (m.row === 4 && m.format === 'mp4') m.audio = !m.audio;
  }

  function editTimelineExport(m: TimelineExportModal) {
    if ([0, 1, 4].includes(m.row)) return changeTimelineExport(m, 1);
    if (![2, 3, 5].includes(m.row)) return;
    const field = m.row === 2 ? 'fps' : m.row === 3 ? 'width' : 'path';
    prompt({
      title:
        field === 'path'
          ? 'TIMELINE OUTPUT'
          : field === 'fps'
            ? 'OUTPUT FRAME RATE'
            : 'OUTPUT WIDTH',
      label:
        field === 'path'
          ? m.format === 'png'
            ? 'Dedicated folder for numbered PNG frames'
            : `Output .${m.format} file`
          : field === 'fps'
            ? 'Frames per second'
            : 'Width in pixels; height follows the source aspect ratio',
      value: m[field],
      cancel: () => {
        modal = m;
      },
      submit(value) {
        if (!value.trim()) throw new Error('Enter a value.');
        m[field] = value.trim();
        m.error = undefined;
        m.overwritePath = undefined;
        if (field === 'path') m.pathEdited = true;
        else if (field === 'fps') m.fpsEdited = true;
        else m.widthEdited = true;
        modal = m;
      },
    });
  }

  async function startTimelineExport(m: TimelineExportModal) {
    try {
      if (!m.path.trim()) throw new Error('Choose an output file or frame folder.');
      const values = {
        timeline: true,
        format: m.format,
        range: m.range,
        fps: m.fps,
        width: m.width,
        'no-audio': !m.audio,
        output: resolve(m.path.trim()),
      };
      const plan = cliTimelinePlan(
        session.state,
        session.path ?? resolve(`${defaultStem()}.gleech`),
        values,
      );
      if (existsSync(plan.outputPath) && m.overwritePath !== plan.outputPath) {
        m.overwritePath = plan.outputPath;
        m.error = 'Output exists. Press Enter on Render again to replace it.';
        schedule();
        return;
      }
      await runBusy('EXPORTING TIMELINE', async (_isCancelled, signal, report) => {
        try {
          const result = await exportTimeline(
            session,
            { ...values, overwrite: m.overwritePath === plan.outputPath },
            {
              signal,
              onProgress: ({ phase, done, total }) =>
                report(
                  `${phase === 'encoding' ? 'Encoding' : 'Rendering'} ${done}/${total} frames`,
                ),
            },
          );
          flash(
            `Exported ${result.frames} frames · ${basename(result.output)} · ${(result.milliseconds / 1000).toFixed(1)}s`,
            result.warnings.length ? C.warn : C.green,
            5000,
          );
        } catch (error) {
          if (signal.aborted || error instanceof RenderCancelledError)
            flash('Timeline export cancelled.', C.warn);
          else {
            m.error = error instanceof Error ? error.message : String(error);
            modal = m;
          }
        }
      });
    } catch (error) {
      m.error = error instanceof Error ? error.message : String(error);
      schedule();
    }
  }

  function openSettings(notes = false) {
    if (!settings) return;
    endGesture();
    pausePlayback();
    modal = { kind: 'settings', section: 0, row: 0, focus: 'navigation', scroll: 0, notes };
    requestRender(0);
  }

  function settingsActions(m: SettingsModal) {
    const actions = settings!.actions(SETTINGS_SECTIONS[m.section]!);
    if (m.section === 0)
      actions.push({
        label: 'What’s new in this version',
        async run() {
          m.notes = true;
          m.scroll = 0;
        },
      });
    if (m.section === 0) actions.push({ label: 'Install & Update…', run: beginTerminalUpdate });
    return actions;
  }

  async function beginTerminalUpdate() {
    await settings!.check();
    const state = settings!.snapshot();
    if (!state.release) {
      flash(state.error ?? 'GLEECH is up to date.', state.error ? C.red : C.accent, 5000);
      return;
    }
    const version = state.release.version;
    modal = {
      kind: 'confirm',
      title: 'UPDATE GLEECH',
      message: `Download and install GLEECH ${version}? Close other GLEECH sessions first. This TUI exits before installation. macOS opens the ZIP in Finder.`,
      options: [
        {
          key: 'u',
          label: 'update',
          run: () =>
            guardUnsaved(() => {
              void installTerminalUpdate(version);
            }, 'installing the update'),
        },
        { key: 'esc', label: 'cancel', run: () => void (modal = null) },
      ],
    };
    schedule();
  }

  async function installTerminalUpdate(version: string) {
    let prepared: Awaited<ReturnType<typeof prepareTerminalUpdate>> | undefined;
    try {
      await runBusy('UPDATE GLEECH', async (_cancelled, signal, report) => {
        report('Downloading and verifying…');
        prepared = await (options.prepareUpdate ?? prepareTerminalUpdate)(
          version,
          signal,
          (progress) => {
            report(`Downloading ${Math.floor(progress.percent)}% · Escape cancels`);
          },
        );
        signal.throwIfAborted();
        await prepared.installOnExit();
        updateExitMessage =
          prepared.mode === 'finder'
            ? 'Update verified. The ZIP opens in Finder after GLEECH exits. Replace the app at its existing location, then run gleech again.'
            : 'Update verified. Installation starts after GLEECH exits. Run gleech again when installation finishes.';
        finish();
      });
    } catch (error) {
      prepared?.cancel();
      flash(
        terminalSettingsText(error instanceof Error ? error.message : String(error)),
        C.red,
        7000,
      );
    }
  }

  function drawSettings(m: SettingsModal) {
    const r = box(104, 28, 'SETTINGS');
    const x = r.x + 20,
      w = r.w - 22;
    SETTINGS_SECTIONS.forEach((section, index) => {
      const active = m.section === index && !m.notes;
      const y = r.y + 2 + index * 2;
      screen.text(
        r.x + 2,
        y,
        `${index + 1} ${section}`,
        { fg: active ? C.hot : C.muted, bg: C.elevated, bold: active && m.focus === 'navigation' },
        16,
      );
      hits.push({
        rect: { x: r.x + 1, y, w: 17, h: 1 },
        press() {
          m.section = index;
          m.row = 0;
          m.focus = 'navigation';
          m.scroll = 0;
          m.notes = false;
        },
      });
    });
    const section = SETTINGS_SECTIONS[m.section]!;
    screen.text(
      x,
      r.y + 2,
      m.notes ? `WHAT’S NEW · v${settings!.snapshot().version}` : section.toUpperCase(),
      { fg: C.accent, bg: C.elevated, bold: true },
      w,
    );
    const actions = m.notes ? [] : settingsActions(m);
    const description = terminalSettingsText(
      m.notes ? settings!.notes() : settings!.description(section),
    );
    const lines = [
      ...actions.map((action) => action.label),
      ...(actions.length ? [''] : []),
      ...description.split('\n').flatMap((line) => (line ? wrapText(line, w) : [''])),
    ];
    settingsVisibleRows = Math.max(1, r.h - 7);
    settingsMaxScroll = Math.max(0, lines.length - settingsVisibleRows);
    m.scroll = Math.max(0, Math.min(settingsMaxScroll, m.scroll));
    lines.slice(m.scroll, m.scroll + settingsVisibleRows).forEach((line, index) => {
      const row = index + m.scroll;
      const y = r.y + 4 + index;
      const selected = row < actions.length && row === m.row && m.focus === 'actions';
      if (selected) screen.fill({ x: x - 1, y, w: w + 1, h: 1 }, C.select);
      screen.text(
        x,
        y,
        terminalSettingsText(line),
        {
          fg: row < actions.length ? (selected ? C.hot : C.text) : C.muted,
          bg: selected ? C.select : C.elevated,
        },
        w,
      );
      if (row < actions.length)
        hits.push({
          rect: { x, y, w, h: 1 },
          press() {
            m.row = row;
            m.focus = 'actions';
            void actions[row]!.run()
              .then(schedule)
              .catch((error: unknown) =>
                flash(error instanceof Error ? error.message : String(error), C.red),
              );
          },
        });
    });
    hits.push({
      rect: { x, y: r.y + 4, w, h: settingsVisibleRows },
      press() {},
      wheel(direction) {
        m.scroll += direction * 3;
      },
    });
    // Action hit regions take precedence over the scroll region.
    const scrollHit = hits.pop()!;
    hits.splice(modalHitStart + 1, 0, scrollHit);
    screen.text(
      r.x + 2,
      r.y + r.h - 2,
      m.notes
        ? '↑↓ / PgUp PgDn scroll · enter / esc back'
        : '1–5 section · tab / ←→ focus · ↑↓ select · enter open · PgUp PgDn scroll · esc close',
      { fg: C.faint, bg: C.elevated },
      r.w - 4,
    );
  }

  function drawHelp(m: HelpModal) {
    const sections: [string, [string, string][]][] = [
      [
        timelineActive() ? 'TIMELINE' : 'STACK',
        timelineActive()
          ? [
              ['t', 'image / timeline'],
              ['tab', 'focus timeline'],
              ['space', 'play / pause'],
              ['←→', 'step one frame'],
              ['⇧←→', 'step one second'],
              ['home end', 'first / last frame'],
              ['g', 'go to time (seconds)'],
              ['i o', 'set In / Out'],
              ['r', 'cycle render range'],
              ['w W', 'set / clear work area'],
              ['L', 'toggle loop'],
              ['e E', 'export timeline / frame'],
            ]
          : [
              ['↑↓ jk', 'select layer'],
              ['space', 'toggle layer'],
              ['⇧↑↓ JK', 'move layer'],
              ['⏎ →', 'edit parameters'],
              ['r', 'reseed layer'],
              ['l', 'lock / unlock'],
              ['D', 'duplicate'],
              ['d del', 'delete'],
            ],
      ],
      [
        'PARAMETERS',
        [
          ['←→ hl', 'adjust'],
          ['⇧←→', 'big steps'],
          ['⏎', 'type a value'],
          ['⌫', 'reset to default'],
          ['esc tab', 'back to stack'],
          ['mouse', 'click/drag slider'],
        ],
      ],
      [
        'PROJECT',
        [
          ['a', 'add effect'],
          ['p', 'presets'],
          ['g', 'roll a GLEECH'],
          ['G', 'GLEECH options'],
          ['n [ ]', 'new/prev/next seed'],
          ['u ^z', 'undo'],
          ['U ^y', 'redo'],
          ['v', 'compare original'],
          ['z Z', 'zoom 1:1/2:1/4:1 · fit'],
          ['f', 'focus preview'],
          ['O', 'open full res'],
          ['e', timelineActive() ? 'export timeline' : 'export image'],
          ['t', 'image / timeline mode'],
          ['b', 'cycle renderer: Auto / GPU / CPU'],
          ['⇧T', 'add local/library shader'],
          ['s S', 'save · save as'],
          ['o', 'open file'],
          [', F2', 'settings / updates / support'],
          ['q', 'quit'],
        ],
      ],
    ];
    const r = box(100, 25, 'KEYS');
    helpMaxScroll = Math.max(
      0,
      Math.max(...sections.map(([, keys]) => keys.length)) - Math.max(1, r.h - 7),
    );
    const colW = Math.floor((r.w - 4) / 3);
    sections.forEach(([title, keys], col) => {
      const x = r.x + 2 + col * colW;
      screen.text(x, r.y + 2, title, { fg: C.accent, bg: C.elevated, bold: true });
      keys.slice(m.scroll, m.scroll + Math.max(1, r.h - 7)).forEach(([k, label], i) => {
        screen.text(x, r.y + 4 + i, k, { fg: C.hot, bg: C.elevated }, 9);
        screen.text(x + 10, r.y + 4 + i, truncate(label, colW - 11), {
          fg: C.muted,
          bg: C.elevated,
        });
      });
    });
    screen.text(
      r.x + 2,
      r.y + r.h - 2,
      `↑↓ scroll · any other key closes · ${caps.terminal} · ${caps.protocol} · v${APP_VERSION}`,
      { fg: C.faint, bg: C.elevated },
      r.w - 4,
    );
  }

  function draw() {
    if (quitting) return;
    const W = term.columns;
    const H = term.rows;
    if (screen.width !== W || screen.height !== H) screen.resize(W, H);
    screen.clear(C.window);
    hits = [];
    imageArea = null;
    pendingImage = null;
    modalRect = null;
    if (W < 72 || H < 20) {
      const msg = `Make the terminal at least 72×20 (now ${W}×${H})`;
      screen.text(Math.max(0, Math.floor((W - cellWidth(msg)) / 2)), Math.floor(H / 2), msg, {
        fg: C.accent,
        bg: C.window,
      });
      hideImage();
      screen.flush((d) => term.write(d));
      return;
    }
    const l = layout();
    drawHeader(W);
    if (l.stack) drawStack(l.stack);
    if (l.inspector) drawInspector(l.inspector);
    drawPreview(l.preview);
    if (l.timeline) drawTimeline(l.timeline);
    drawFooter(W, H);
    modalHitStart = hits.length;
    if (modal) {
      if (modal.kind === 'effects') drawEffectModal(modal);
      else if (modal.kind === 'presets') drawPresetModal(modal);
      else if (modal.kind === 'gleech') drawGleechModal(modal);
      else if (modal.kind === 'prompt') drawPrompt(modal);
      else if (modal.kind === 'confirm') drawConfirm(modal);
      else if (modal.kind === 'busy') drawBusy(modal);
      else if (modal.kind === 'timeline-export') drawTimelineExport(modal);
      else if (modal.kind === 'settings') drawSettings(modal);
      else drawHelp(modal);
    }
    // A dialog's cells may equal the plain canvas cells beneath an inline
    // image; write them anyway so the dialog actually covers the image.
    const cover = modalRect as Rect | null;
    if (placed && cover && caps.protocol !== 'kitty') screen.invalidateRect(cover);
    // drawPreview sets these during this frame.
    const area = imageArea as Rect | null;
    const image = pendingImage as RgbaImage | null;
    const touched = screen.flush((d) => term.write(d), placed?.rect ?? area);
    // A dialog drawn over a sixel/iTerm2 image erases only the cells it covers;
    // the image is sent again once the dialog closes.
    if (modal && area && image) return;
    if (area && image) {
      const moved =
        !placed ||
        placed.image !== image ||
        placed.rect.x !== area.x ||
        placed.rect.y !== area.y ||
        placed.rect.w !== area.w ||
        placed.rect.h !== area.h;
      // Sixel and iTerm2 images are erased by text written over them; kitty
      // images float above the cells and only need sending when they change.
      const erased = touched && caps.protocol !== 'kitty';
      // Encoding a large image takes a moment; while a slider is moving, send
      // at most a few frames a second unless the old image was erased.
      const wait = lastEmit.at + Math.max(90, lastEmit.cost * 1.5) - performance.now();
      if (moved && !erased && placed && wait > 0) {
        if (!emitTimer) emitTimer = setTimeout(() => ((emitTimer = null), schedule()), wait);
      } else if (moved || erased) {
        const started = performance.now();
        term.write(emitImage(image, area));
        lastEmit = { at: performance.now(), cost: performance.now() - started };
        placed = { image, rect: area };
      }
    } else hideImage();
  }

  // ─── actions ───────────────────────────────────────────────────────

  function attempt(action: () => void) {
    try {
      action();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), C.red, 4000);
    }
  }

  function moveStack(delta: number) {
    const count = effects().length;
    if (!count) return;
    stackIndex = Math.max(0, Math.min(count - 1, stackIndex + delta));
    inspectorIndex = 0;
    inspectorScroll = 0;
    schedule();
  }

  function moveInspector(delta: number) {
    const effect = selected();
    if (!effect) return;
    const count = rows(effect).length;
    inspectorIndex = Math.max(0, Math.min(count - 1, inspectorIndex + delta));
    schedule();
  }

  function toggleGroup(group: ParamEntry['group']) {
    if (collapsed.has(group)) collapsed.delete(group);
    else collapsed.add(group);
    schedule();
  }

  function setValue(entry: ParamEntry, raw: number | string, grouped: boolean) {
    const effect = selected();
    if (!effect) return;
    if (effect.locked) {
      flash('This layer is locked. Press l in the stack to unlock it.', C.warn);
      return;
    }
    const d = entry.definition;
    const value =
      d.kind === 'number'
        ? parseParamValue(d, String(Math.min(d.max, Math.max(d.min, Number(raw)))))
        : raw;
    attempt(() => {
      if (grouped) {
        if (!gesture || gesture.key !== `${effect.instanceId}:${entry.key}`) {
          endGesture();
          session.service.beginHistoryGroup();
          gesture = {
            key: `${effect.instanceId}:${entry.key}`,
            timer: setTimeout(endGesture, 700).unref(),
          };
        } else {
          clearTimeout(gesture.timer);
          gesture.timer = setTimeout(endGesture, 700).unref();
        }
      } else endGesture();
      setParams(session.service, effect.instanceId, { [entry.key]: value });
    });
  }

  function insertEffect(type: EffectType) {
    insertLayer(createEffect(type, randomUUID()));
  }
  function insertLayer(effect: EffectInstance) {
    const list = effects();
    const recipeIndex = list.length - 1 - stackIndex; // selected layer, render order
    const next = list.length
      ? [...list.slice(0, recipeIndex + 1), effect, ...list.slice(recipeIndex + 1)]
      : [effect];
    attempt(() => {
      session.service.applyStackRecipe({ effects: next, masterSeed: session.state.masterSeed });
      stackIndex = next.length - 1 - next.indexOf(effect);
      inspectorIndex = 1;
      inspectorScroll = 0;
      flash(`Added ${effectTitle(effect)}`);
    });
  }

  function rollGleech(seed = randomInt(0, 0xffffffff)) {
    attempt(() => {
      session.service.gleech({ complexity: gleechComplexity, mode: gleechMode, seed });
      session.service.setSeed(seed);
      lastGleechSeed = seed;
      stackIndex = 0;
      inspectorIndex = 0;
      flash(`GLEECH ${gleechComplexity} · seed ${seed}`, C.accent);
    });
  }

  function prompt(options: Omit<PromptModal, 'kind' | 'cursor'>) {
    if (transport.playing) {
      pausePlayback();
      requestRender(0);
    }
    modal = { kind: 'prompt', cursor: options.value.length, ...options };
    schedule();
  }

  function defaultStem(): string {
    const source = session.state.source;
    if (session.path) return basename(session.path, extname(session.path));
    return source ? basename(source.name, extname(source.name)) : 'gleech';
  }

  async function runBusy(
    title: string,
    work: (
      isCancelled: () => boolean,
      signal: AbortSignal,
      report: (text: string) => void,
    ) => Promise<void>,
  ) {
    pausePlayback();
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderVersion++;
    const controller = new AbortController();
    busyAbort = controller;
    const busyModal: BusyModal = {
      kind: 'busy',
      title,
      started: performance.now(),
      cancel: () => controller.abort(),
    };
    modal = busyModal;
    schedule();
    const pending = (async () => {
      await renderTask;
      await work(
        () => controller.signal.aborted,
        controller.signal,
        (detail) => {
          busyModal.detail = detail;
          schedule();
        },
      );
    })();
    busyTask = pending;
    try {
      await pending;
    } finally {
      if (busyTask === pending) {
        busyTask = null;
        busyAbort = null;
      }
      if (modal === busyModal) modal = null;
      if (!quitting) requestRender(0);
      schedule();
    }
  }

  async function renderCurrentPicture(isCancelled: () => boolean, signal?: AbortSignal) {
    if (!timelineActive()) return session.render(isCancelled);
    let result: TimelinePreviewFrame | null = null;
    await previewTimeline(session, session.state, [transport.time], {
      ...(signal ? { signal } : {}),
      onFrame: (frame) => {
        result = frame;
      },
    });
    if (isCancelled()) throw new RenderCancelledError();
    if (!result) throw new Error('No timeline frame could be rendered.');
    return result as TimelinePreviewFrame;
  }

  function exportImage() {
    let confirmedPath: string | null = null;
    prompt({
      title: 'EXPORT IMAGE',
      label: 'Path — the extension picks the format (.png .jpg .webp .tiff)',
      value: resolve(`${defaultStem()}-gleech.png`),
      hint: 'Exports render the full-resolution image, exactly like the desktop app.',
      async submit(value) {
        const path = resolve(value.trim());
        const format = formatFromPath(path);
        if (!format) throw new Error('Use a .png, .jpg, .webp or .tiff file name.');
        if (existsSync(path) && confirmedPath !== path) {
          confirmedPath = path;
          (modal as PromptModal).hint = 'Press enter again to overwrite.';
          throw new Error(`${basename(path)} exists.`);
        }
        modal = null;
        await runBusy('EXPORTING', async (isCancelled, signal) => {
          try {
            const result = await renderCurrentPicture(isCancelled, signal);
            const bytes = await encodeImage(result.image, format);
            if (isCancelled()) throw new RenderCancelledError();
            await writeFile(path, bytes);
            flash(
              `Exported ${basename(path)} · ${result.image.width}×${result.image.height} · ${(result.milliseconds / 1000).toFixed(1)}s`,
            );
          } catch (error) {
            if (error instanceof RenderCancelledError) flash('Export cancelled.', C.warn);
            else
              flash(
                `Export failed: ${error instanceof Error ? error.message : error}`,
                C.red,
                5000,
              );
          }
        });
      },
    });
  }

  async function saveTo(path: string) {
    await session.save(path, path === session.path);
    flash(`Saved ${basename(path)}`);
  }

  function saveProject(ask: boolean, afterSave?: () => void) {
    let confirmedPath: string | null = null;
    if (!ask && session.path) {
      void saveTo(session.path)
        .then(() => afterSave?.())
        .catch((error: Error) => flash(error.message, C.red, 5000));
      return;
    }
    prompt({
      title: 'SAVE PROJECT',
      label: 'Save an editable .gleech project (opens in the desktop app)',
      value: session.path ?? resolve(`${defaultStem()}.gleech`),
      async submit(value) {
        let path = resolve(value.trim());
        if (!/\.gleech$/i.test(path)) path += '.gleech';
        if (existsSync(path) && path !== session.path && confirmedPath !== path) {
          confirmedPath = path;
          (modal as PromptModal).hint = 'Press enter again to overwrite.';
          throw new Error(basename(path) + ' exists.');
        }
        await session.save(path, path === session.path || confirmedPath === path);
        modal = null;
        flash('Saved ' + basename(path));
        afterSave?.();
      },
    });
  }

  function openFile() {
    guardUnsaved(openFilePrompt, 'opening another file');
  }
  function openFilePrompt() {
    prompt({
      title: 'OPEN',
      label: 'Image (.png .jpg .webp) or GLEECH project (.gleech)',
      value: '',
      async submit(value) {
        const path = resolve(value.trim().replace(/^['"]|['"]$/g, ''));
        if (!existsSync(path)) throw new Error('No such file.');
        const next = await Session.open(path);
        pausePlayback();
        unsubscribe();
        session = next;
        unsubscribe = session.service.subscribe(onChange);
        invalidatePreview();
        sourceId = undefined;
        timelineMode = !!next.state.timeline;
        transport.sync(next.state.timeline);
        transport.seek(0);
        focus = timelineMode ? 'timeline' : 'stack';
        preview = null;
        renderError = null;
        stackIndex = 0;
        inspectorIndex = 0;
        modal = null;
        flash(`Opened ${basename(path)}`);
        requestRender(0);
      },
    });
  }

  function editValue(entry: ParamEntry) {
    const d = entry.definition;
    if (d.kind === 'choice') {
      setValue(entry, stepParam(d, entry.value, 1, false), false);
      return;
    }
    const hint =
      d.kind === 'number'
        ? `${formatValue(d, d.min)} … ${formatValue(d, d.max)}  ·  step ${d.step}`
        : d.kind === 'color'
          ? 'Hex color, e.g. #ff3366'
          : d.kind === 'stops'
            ? 'JSON gradient stops, or [] for none'
            : `Up to ${d.maxLength} characters`;
    prompt({
      title: d.label.toUpperCase(),
      label: d.description,
      value:
        d.kind === 'number' && d.unit === 'percent'
          ? `${Math.round(Number(entry.value) * 100)}%`
          : String(entry.value),
      hint,
      submit(value) {
        const typed = parseParamValue(d, value, d.label);
        modal = null;
        setValue(entry, typed, false);
      },
    });
  }

  function guardUnsaved(next: () => void, operation: string) {
    if (!session.dirty) {
      next();
      return;
    }
    modal = {
      kind: 'confirm',
      title: 'UNSAVED CHANGES',
      message:
        'Save ' +
        (session.path ? basename(session.path) : 'this project') +
        ' before ' +
        operation +
        '?',
      options: [
        { key: 's', label: 'save', run: () => saveProject(false, next) },
        {
          key: 'd',
          label: 'discard',
          run: () => {
            modal = null;
            next();
          },
        },
        { key: 'esc', label: 'cancel', run: () => void (modal = null) },
      ],
    };
    schedule();
  }
  function quit() {
    guardUnsaved(finish, 'quitting');
  }

  let resolveExit: (code: number) => void = () => {};
  const exitPromise = new Promise<number>((resolveFn) => (resolveExit = resolveFn));
  function finish(code = 0) {
    pausePlayback();
    busyAbort?.abort();
    renderVersion++;
    quitting = true;
    resolveExit(code);
  }

  // ─── input ─────────────────────────────────────────────────────────

  function editText(
    m: { value: string; cursor: number },
    event: KeyEvent | { kind: 'paste'; text: string },
  ): boolean {
    if (event.kind === 'paste') {
      const text = event.text.replace(/[\r\n]+/g, ' ');
      m.value = m.value.slice(0, m.cursor) + text + m.value.slice(m.cursor);
      m.cursor += text.length;
      return true;
    }
    if (event.name === 'backspace') {
      if (m.cursor > 0) {
        m.value = m.value.slice(0, m.cursor - 1) + m.value.slice(m.cursor);
        m.cursor--;
      }
      return true;
    }
    if (event.name === 'delete') {
      m.value = m.value.slice(0, m.cursor) + m.value.slice(m.cursor + 1);
      return true;
    }
    if (event.name === 'left') return ((m.cursor = Math.max(0, m.cursor - 1)), true);
    if (event.name === 'right') return ((m.cursor = Math.min(m.value.length, m.cursor + 1)), true);
    if (event.name === 'home' || (event.ctrl && event.name === 'a')) return ((m.cursor = 0), true);
    if (event.name === 'end' || (event.ctrl && event.name === 'e'))
      return ((m.cursor = m.value.length), true);
    if (event.ctrl && event.name === 'u')
      return (((m.value = m.value.slice(m.cursor)), (m.cursor = 0)), true);
    if (event.text && !event.ctrl && !event.meta) {
      m.value = m.value.slice(0, m.cursor) + event.text + m.value.slice(m.cursor);
      m.cursor += event.text.length;
      return true;
    }
    return false;
  }

  function searchText(
    m: { query: string },
    event: KeyEvent | { kind: 'paste'; text: string },
  ): boolean {
    if (event.kind === 'paste') return ((m.query += event.text.trim()), true);
    if (event.name === 'backspace') return ((m.query = m.query.slice(0, -1)), true);
    if (event.ctrl && event.name === 'u') return ((m.query = ''), true);
    if (event.text && !event.ctrl && !event.meta && event.name !== 'space')
      return ((m.query += event.text), true);
    if (event.name === 'space' && m.query) return ((m.query += ' '), true);
    return false;
  }

  async function onModalKey(m: Modal, event: KeyEvent | { kind: 'paste'; text: string }) {
    const k = event.kind === 'key' ? event : null;
    if (m.kind === 'settings') {
      if (!k || !settings) return;
      if (m.notes) {
        if (k.name === 'escape' || k.name === 'enter') {
          m.notes = false;
          m.scroll = 0;
          await settings.acknowledgeNotes();
        } else if (['up', 'down', 'pageup', 'pagedown'].includes(k.name))
          m.scroll +=
            k.name === 'up'
              ? -1
              : k.name === 'down'
                ? 1
                : k.name === 'pageup'
                  ? -settingsVisibleRows
                  : settingsVisibleRows;
        return;
      }
      if (k.name === 'escape') {
        modal = null;
        return;
      }
      if (['1', '2', '3', '4', '5'].includes(k.name)) {
        m.section = Number(k.name) - 1;
        m.row = 0;
        m.scroll = 0;
        m.focus = 'navigation';
        return;
      }
      if (k.name === 'tab') m.focus = m.focus === 'navigation' ? 'actions' : 'navigation';
      else if (k.name === 'left') m.focus = 'navigation';
      else if (k.name === 'right') m.focus = 'actions';
      else if (k.name === 'pageup' || k.name === 'pagedown')
        m.scroll += (k.name === 'pageup' ? -1 : 1) * settingsVisibleRows;
      else if (k.name === 'up' || k.name === 'down') {
        const direction = k.name === 'up' ? -1 : 1;
        if (m.focus === 'navigation') {
          m.section = (m.section + direction + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
          m.row = 0;
          m.scroll = 0;
        } else {
          const actions = settingsActions(m);
          m.row = (m.row + direction + actions.length) % actions.length;
          m.scroll = Math.max(0, m.row - settingsVisibleRows + 1);
        }
      } else if (k.name === 'enter' || k.name === 'space') {
        if (m.focus === 'navigation') m.focus = 'actions';
        else await settingsActions(m)[m.row]!.run();
      }
      return;
    }
    if (m.kind === 'busy') {
      if (k?.name === 'escape') m.cancel?.();
      return;
    }
    if (k?.name === 'escape' && m.kind !== 'confirm') {
      if (m.kind === 'prompt' && m.cancel) m.cancel();
      else modal = null;
      return;
    }
    if (m.kind === 'help') {
      if (k && ['up', 'down', 'pageup', 'pagedown'].includes(k.name))
        m.scroll = Math.max(
          0,
          Math.min(
            helpMaxScroll,
            m.scroll +
              (k.name === 'up' ? -1 : k.name === 'down' ? 1 : k.name === 'pageup' ? -5 : 5),
          ),
        );
      else modal = null;
      return;
    }
    if (m.kind === 'timeline-export') {
      if (k?.name === 'up' || k?.name === 'down' || k?.name === 'tab') {
        const direction = k.name === 'up' || (k.name === 'tab' && k.shift) ? -1 : 1;
        m.row = (m.row + direction + 7) % 7;
      } else if (k?.name === 'left' || k?.name === 'right' || k?.name === 'space')
        changeTimelineExport(m, k.name === 'left' ? -1 : 1);
      else if (k?.name === 'enter') {
        if (m.row === 6) await startTimelineExport(m);
        else editTimelineExport(m);
      }
      return;
    }
    if (m.kind === 'confirm') {
      const option = m.options.find(
        (o) => o.key === k?.name || (o.key === 'esc' && k?.name === 'escape'),
      );
      if (option) await option.run();
      return;
    }
    if (m.kind === 'prompt') {
      if (k?.name === 'enter') {
        try {
          await m.submit(m.value);
        } catch (error) {
          m.error = error instanceof Error ? error.message : String(error);
        }
        return;
      }
      if (editText(m, event)) m.error = undefined;
      return;
    }
    if (m.kind === 'gleech') {
      if (!k) return;
      if (k.name === 'up' || k.name === 'down') m.row = m.row ? 0 : 1;
      else if (k.name === 'left' || k.name === 'right' || k.name === 'space') {
        const d = k.name === 'left' ? -1 : 1;
        if (m.row === 0)
          gleechComplexity = COMPLEXITIES[(COMPLEXITIES.indexOf(gleechComplexity) + d + 3) % 3]!;
        else gleechMode = MODES[(MODES.indexOf(gleechMode) + d + MODES.length) % MODES.length]!;
      } else if (k.name === '1' || k.name === '2' || k.name === '3')
        gleechComplexity = COMPLEXITIES[Number(k.name) - 1]!;
      else if (k.name === 'enter' || k.name === 'g') {
        modal = null;
        rollGleech();
      }
      return;
    }
    if (m.kind === 'effects') {
      const items = effectMatches(m);
      if (k?.name === 'up') m.index = Math.max(0, m.index - 1);
      else if (k?.name === 'down') m.index = Math.min(items.length - 1, m.index + 1);
      else if (k?.name === 'pageup') m.index = Math.max(0, m.index - 10);
      else if (k?.name === 'pagedown') m.index = Math.min(items.length - 1, m.index + 10);
      else if (k?.name === 'tab' || k?.name === 'right' || k?.name === 'left') {
        const d = k.shift || k.name === 'left' ? -1 : 1;
        m.category = (m.category + d + EFFECT_CATEGORIES.length) % EFFECT_CATEGORIES.length;
        m.index = 0;
        m.scroll = 0;
      } else if (k?.name === 'enter') {
        const type = items[m.index];
        if (type) {
          modal = null;
          insertEffect(type);
          focus = 'inspector';
        }
      } else if (searchText(m, event)) {
        m.index = 0;
        m.scroll = 0;
      }
      return;
    }
    if (m.kind === 'presets') {
      const items = presetMatches(m);
      if (k?.name === 'up') m.index = Math.max(0, m.index - 1);
      else if (k?.name === 'down') m.index = Math.min(items.length - 1, m.index + 1);
      else if (k?.name === 'pageup') m.index = Math.max(0, m.index - 10);
      else if (k?.name === 'pagedown') m.index = Math.min(items.length - 1, m.index + 10);
      else if (k?.name === 'tab') m.placement = (m.placement + (k.shift ? 3 : 1)) % 4;
      else if (k?.name === 'enter') {
        const preset = items[m.index];
        if (preset) {
          modal = null;
          attempt(() => {
            const placement = PLACEMENTS[m.placement]!;
            session.service.applyPreset(
              preset,
              placement,
              preset.effects.map(() => randomUUID()),
            );
            stackIndex = 0;
            inspectorIndex = 0;
            flash(`Applied ${preset.name} (${placement})`, C.accent);
          });
        }
      } else if (searchText(m, event)) {
        m.index = 0;
        m.scroll = 0;
      }
    }
  }

  async function onKey(event: KeyEvent) {
    if (event.ctrl && event.name === 'c') {
      if (modal?.kind === 'busy') modal.cancel?.();
      else quit();
      return;
    }
    if (event.ctrl && event.name === 'l') {
      hideImage();
      screen.invalidate();
      term.write('\x1b[2J');
      return;
    }
    if (modal) return onModalKey(modal, event);
    const effect = selected();
    const n = event.name;

    // Global keys
    if ((n === 'u' && !event.shift) || (event.ctrl && n === 'z')) {
      endGesture();
      if (!session.service.canUndo()) return flash('Nothing to undo.', C.muted);
      session.service.undo();
      return flash('Undo', C.muted);
    }
    if ((n === 'u' && event.shift) || (event.ctrl && (n === 'y' || n === 'r'))) {
      endGesture();
      if (!session.service.canRedo()) return flash('Nothing to redo.', C.muted);
      session.service.redo();
      return flash('Redo', C.muted);
    }
    if (event.ctrl) return;
    if (n === ',' || n === 'f2') return openSettings();
    if (n === 't' && !event.shift) {
      endGesture();
      pausePlayback();
      if (!session.state.timeline) {
        timelineMode = true;
        session.service.setTimeline(createTimeline());
      } else timelineMode = !timelineMode;
      focus = timelineMode ? 'timeline' : 'stack';
      invalidatePreview();
      requestRender(0);
      flash(
        timelineMode ? 'Timeline · tab to focus · space play · e export' : 'Image mode',
        C.muted,
      );
      return;
    }
    if (focus === 'timeline' && timelineActive() && timelineKey(event)) return;
    if (n === 't' && event.shift) {
      prompt({
        title: 'ADD SHADER',
        label: 'Shader name/ID or local .gleech-shader / .wgsl / .isf file',
        value: '',
        async submit(value) {
          const shader = await findShader(value.trim().replace(/^['"]|['"]$/g, ''));
          modal = null;
          insertLayer(createImportedShader(shader, randomUUID()));
        },
      });
      return;
    }
    if (n === 'q') return quit();
    if (n === '?') return void (modal = { kind: 'help', scroll: 0 });
    if (n === 'tab') {
      const order: Focus[] = [
        'stack',
        ...(effect ? ['inspector' as const] : []),
        ...(timelineActive() ? ['timeline' as const] : []),
      ];
      focus = order[(order.indexOf(focus) + (event.shift ? -1 : 1) + order.length) % order.length]!;
      return;
    }
    if (n === 'a')
      return void (modal = { kind: 'effects', query: '', category: 0, index: 0, scroll: 0 });
    if (n === 'p') {
      const presets = await listPresets().catch(() => []);
      modal = { kind: 'presets', query: '', index: 0, scroll: 0, placement: 0, presets };
      return;
    }
    if (n === 'g' && event.shift) return void (modal = { kind: 'gleech', row: 0 });
    if (n === 'g') return rollGleech();
    if (n === 'v' || n === 'c') return void (compare = !compare);
    if (n === 'z') {
      const index = ZOOMS.indexOf(view.zoom);
      return setZoom(event.shift ? 0 : ZOOMS[(index + 1) % ZOOMS.length]!);
    }
    if (n === 'o' && event.shift) return void openInViewer();
    if (focusMode && view.zoom && ['up', 'down', 'left', 'right'].includes(n)) {
      const step = event.shift ? 12 : 3;
      return pan(
        n === 'left' ? -step : n === 'right' ? step : 0,
        n === 'up' ? -step / 2 : n === 'down' ? step / 2 : 0,
      );
    }
    if (n === 'f') return void ((focusMode = !focusMode), requestRender());
    if (n === 'b') {
      const modes = ['auto', 'gpu', 'cpu'] as const;
      const renderer = modes[(modes.indexOf(renderingSettings().renderer) + 1) % modes.length]!;
      cancelPreview();
      configureRendering({ renderer });
      previewState = null;
      hires = null;
      fullRes = null;
      flash('Renderer: ' + renderer + ' · imported shaders require GPU');
      requestRender(0);
      return;
    }
    if (n === 'e') {
      if (timelineActive() && !event.shift) {
        pausePlayback();
        requestRender(0);
        modal = timelineExportModal(session, transport.rangeKind);
        return;
      }
      return exportImage();
    }
    if (n === 's') return saveProject(event.shift);
    if (n === 'o') return openFile();
    if (n === 'n') return attempt(() => session.service.setSeed(randomInt(0, 0xffffffff)));
    if (n === '[' || n === ']') {
      const seed = (session.state.masterSeed + (n === ']' ? 1 : 0xffffffff)) >>> 0;
      return attempt(() => session.service.setSeed(seed));
    }

    if (focus === 'stack') {
      if ((n === 'up' && event.shift) || (n === 'k' && event.shift)) {
        if (!effect) return;
        const index = effects().indexOf(effect);
        if (index < effects().length - 1)
          attempt(() => session.service.moveEffect(effect.instanceId, 1));
        stackIndex = Math.max(0, stackIndex - 1);
        return;
      }
      if ((n === 'down' && event.shift) || (n === 'j' && event.shift)) {
        if (!effect) return;
        const index = effects().indexOf(effect);
        if (index > 0) attempt(() => session.service.moveEffect(effect.instanceId, -1));
        stackIndex = Math.min(effects().length - 1, stackIndex + 1);
        return;
      }
      if (n === 'up' || n === 'k') return moveStack(-1);
      if (n === 'down' || n === 'j') return moveStack(1);
      if (n === 'pageup') return moveStack(-10);
      if (n === 'pagedown') return moveStack(10);
      if (n === 'home') return moveStack(-1e6);
      if (n === 'end') return moveStack(1e6);
      if (!effect) return;
      if (n === 'enter' || n === 'right') {
        focus = 'inspector';
        return;
      }
      if (n === 'space')
        return attempt(() =>
          session.service.updateEffect(effect.instanceId, { enabled: !effect.enabled }),
        );
      if (n === 'r') return attempt(() => session.service.varyEffect(effect.instanceId));
      if (n === 'l') {
        attempt(() => session.service.setEffectLocked(effect.instanceId, !effect.locked));
        return flash(
          effect.locked ? 'Unlocked' : 'Locked — GLEECH keep-locked rolls keep this layer',
          C.muted,
        );
      }
      if (n === 'd' && event.shift) {
        return attempt(() => session.service.duplicateEffect(effect.instanceId, randomUUID()));
      }
      if (n === 'd' || n === 'delete' || n === 'backspace') {
        if (effect.locked) return flash('Unlock the layer before deleting it.', C.warn);
        return attempt(() => {
          session.service.removeEffect(effect.instanceId);
          flash(`Deleted ${effectTitle(effect)} — u to undo`, C.muted);
        });
      }
      return;
    }

    // Inspector
    if (!effect) {
      focus = 'stack';
      return;
    }
    const list = rows(effect);
    const row = list[inspectorIndex];
    if (n === 'escape') return void (focus = 'stack');
    if (n === 'up' || n === 'k') return moveInspector(-1);
    if (n === 'down' || n === 'j') return moveInspector(1);
    if (n === 'pageup') return moveInspector(-10);
    if (n === 'pagedown') return moveInspector(10);
    if (n === 'home') return moveInspector(-1e6);
    if (n === 'end') return moveInspector(1e6);
    if (!row) return;
    if (row.kind === 'group') {
      if (n === 'enter' || n === 'space' || n === 'right' || n === 'left' || n === 'l' || n === 'h')
        toggleGroup(row.group);
      return;
    }
    const entry = row.entry;
    if (n === 'left' || n === 'right' || n === 'h' || n === 'l') {
      const direction = n === 'left' || n === 'h' ? -1 : 1;
      setValue(
        entry,
        stepParam(entry.definition, entry.value, direction, event.shift),
        entry.definition.kind === 'number',
      );
      return;
    }
    if (n === 'enter') return editValue(entry);
    if (n === 'backspace' || n === '0' || n === 'delete')
      return setValue(entry, entry.definition.default, false);
  }

  function timelineKey(event: KeyEvent): boolean {
    const n = event.name;
    const timeline = session.state.timeline!;
    if (n === 'space') {
      if (transport.playing) pausePlayback();
      else transport.play();
      requestRender(0);
      return true;
    }
    if (['left', 'right', 'h', 'l'].includes(n) && !(n === 'l' && event.shift)) {
      const delta = event.shift ? Math.max(1, Math.round(timeline.fps)) : 1;
      seekTimeline(transport.frame + (n === 'left' || n === 'h' ? -delta : delta));
      return true;
    }
    if (n === 'home' || n === 'end') {
      seekTimeline(n === 'home' ? 0 : transport.count - 1);
      return true;
    }
    if (n === 'escape') {
      pausePlayback();
      focus = 'stack';
      requestRender(0);
      return true;
    }
    if (n === 'g' && !event.shift) {
      prompt({
        title: 'GO TO TIME',
        label: 'Timeline time in seconds',
        value: transport.time.toFixed(3),
        submit(value) {
          const time = Number(value);
          if (
            !value.trim() ||
            !Number.isFinite(time) ||
            time < 0 ||
            time > transport.count / timeline.fps
          )
            throw new Error('Enter a time inside this timeline.');
          modal = null;
          seekTimeline(Math.round(time * timeline.fps));
        },
      });
      return true;
    }
    if (n === 'r') {
      pausePlayback();
      transport.cycleRange();
      requestRender(0);
      return true;
    }
    if (n === 'l' && event.shift) {
      session.service.updateTimeline({ loop: !timeline.loop });
      return true;
    }
    if (n === 'i' || (n === 'o' && !event.shift)) {
      pausePlayback();
      const end = transport.count / timeline.fps;
      const range =
        n === 'i'
          ? {
              start: transport.time,
              end: Math.max(timeline.inOut?.end ?? end, transport.time + 1 / timeline.fps),
            }
          : {
              start: Math.min(timeline.inOut?.start ?? 0, transport.time),
              end: Math.min(end, transport.time + 1 / timeline.fps),
            };
      session.service.updateTimeline({ inOut: range });
      transport.rangeKind = 'inout';
      return true;
    }
    if (n === 'w') {
      pausePlayback();
      session.service.updateTimeline({
        workArea: event.shift
          ? null
          : (timeline.inOut ?? { start: transport.range.start, end: transport.range.end }),
      });
      transport.rangeKind = event.shift ? 'whole' : 'work';
      return true;
    }
    return false;
  }

  function onMouse(event: MouseEvent) {
    if (modal?.kind === 'busy') return;
    if (!modal && timelineDrag && event.action === 'drag') {
      scrubTimeline(event.x, 60);
      return;
    }
    const firstHit = modal ? modalHitStart : 0;
    if (event.button === 'wheel-up' || event.button === 'wheel-down') {
      const direction = event.button === 'wheel-up' ? -1 : 1;
      if (modal?.kind === 'effects' || modal?.kind === 'presets') {
        modal.index = Math.max(0, modal.index + direction);
        schedule();
        return;
      }
      for (let i = hits.length - 1; i >= firstHit; i--) {
        const hit = hits[i]!;
        const r = hit.rect;
        if (event.x >= r.x && event.x < r.x + r.w && event.y >= r.y && event.y < r.y + r.h) {
          hit.wheel?.(direction);
          return;
        }
      }
      return;
    }
    if (event.action === 'release') {
      timelineDrag = false;
      drag = null;
      return;
    }
    if (event.button !== 'left') return;
    for (let i = hits.length - 1; i >= firstHit; i--) {
      const hit = hits[i]!;
      const r = hit.rect;
      if (event.x >= r.x && event.x < r.x + r.w && event.y >= r.y && event.y < r.y + r.h) {
        if (event.action === 'drag') hit.drag?.(event);
        else hit.press(event);
        return;
      }
    }
  }

  async function onInput(event: InputEvent) {
    try {
      if (event.kind === 'mouse') onMouse(event);
      else if (event.kind === 'paste') {
        if (modal) await onModalKey(modal, event);
      } else await onKey(event);
      if (modal && transport.playing) {
        pausePlayback();
        requestRender(0);
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), C.red, 5000);
    }
    schedule();
  }

  // ─── lifecycle ─────────────────────────────────────────────────────

  const restore = () => term.leave();
  const crash = (error: unknown) => {
    restore();
    process.stderr.write(
      `GLEECH TUI crashed: ${error instanceof Error ? (error.stack ?? error.message) : error}\n`,
    );
    process.exit(1);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  const interrupt = () => finish(130);
  const terminate = () => finish(143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  term.enter();
  // Ask the terminal what it can draw. Known image-less terminals skip the query.
  const fromEnv = protocolFromEnv();
  const probe =
    fromEnv === 'blocks'
      ? null
      : parseProbe(await term.probe(fromEnv ? '\x1b[16t\x1b[c' : PROBE_QUERY));
  caps = resolveCaps(process.env, probe);
  const offInput = term.onInput((event) => void onInput(event));
  const offResize = term.onResizeEvent(() => {
    hideImage();
    screen.resize(term.columns, term.rows);
    term.write('\x1b[2J');
    requestRender(120);
    schedule();
  });
  const ticker = setInterval(() => {
    if (busy || modal?.kind === 'busy') {
      spinner++;
      schedule();
    }
  }, 90);
  let notifiedVersion: string | null = null;
  const offSettings = settings?.subscribe(() => {
    const state = settings.snapshot();
    if (
      state.phase === 'available' &&
      state.automatic &&
      state.release &&
      state.dismissedVersion !== state.release.version &&
      notifiedVersion !== state.release.version
    ) {
      notifiedVersion = state.release.version;
      flash(
        `GLEECH ${state.release.version} is available · , Settings · open Updates to dismiss`,
        C.accent,
        12000,
      );
    }
    if (state.release?.version === state.dismissedVersion && toast?.text.startsWith('GLEECH '))
      toast = null;
    schedule();
  });
  void settings?.ready
    .then(() => {
      if (settings.snapshot().whatsNew && !modal) openSettings(true);
      schedule();
    })
    .catch(schedule);
  const checkUpdates = () => {
    void settings?.check(false).catch(() => {});
  };
  const updateStartup = setTimeout(checkUpdates, 15000);
  const updateInterval = setInterval(checkUpdates, 6 * 60 * 60 * 1000);
  updateStartup.unref();
  updateInterval.unref();
  if (isSample)
    flash(
      'Sample image loaded · a add effect · p presets · g roll a GLEECH · o open your image · ? keys',
      C.accent,
      8000,
    );
  requestRender(0);
  schedule();
  const code = await exitPromise;
  clearInterval(ticker);
  clearTimeout(updateStartup);
  clearInterval(updateInterval);
  offSettings?.();
  settings?.dispose();
  if (renderTimer) clearTimeout(renderTimer);
  endGesture();
  if (emitTimer) clearTimeout(emitTimer);
  if (toastTimer) clearTimeout(toastTimer);
  cancelPreview();
  await Promise.allSettled([renderTask, ...(busyTask ? [busyTask] : [])]);
  unsubscribe();
  offInput();
  offResize();
  hideImage();
  restore();
  process.off('uncaughtException', crash);
  process.off('unhandledRejection', crash);
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  const saved = session.path && !session.dirty ? ` · ${session.path}` : '';
  const paint = createPaint(process.stdout);
  process.stdout.write(`${paint.accent('▍')}${paint.bold('GLEECH')}${paint.muted(saved)}\n`);
  if (updateExitMessage) process.stdout.write(`${updateExitMessage}\n`);
  return code;
}
