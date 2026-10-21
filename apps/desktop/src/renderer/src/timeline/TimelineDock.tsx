import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ANIMATABLE_APPLICATION_KEYS,
  animationDefinition,
  audioIsClipSound,
  evaluateKeys,
  evaluateParameter,
  formatTimecode,
  frameCount,
  frameTime,
  getEffectDefinition,
  INTERPOLATIONS,
  moveKeys,
  parameterBaseValue,
  seedChangeFrames,
  setKeysInterpolation,
  timeFrame,
  upsertKey,
  FRAME_RATES,
  type ActiveRange,
  type EffectInstance,
  type Interpolation,
  type ModulationContext,
  type ParameterAnimation,
  type ProjectState,
  type Timeline,
} from '@gleech/project-model';
import type { TimelineChange } from '@gleech/command-service';
import { EASE_LABELS, SIGNAL_COLORS, curveColor } from '../animation-ui';
import { formatParameterValue, normalizedValue } from '../animation-format';
import {
  ChevronIcon,
  DiamondIcon,
  EaseHoldIcon,
  EaseInOutIcon,
  EaseLinearIcon,
  EyeIcon,
  FitWidthIcon,
  GoToEndIcon,
  GoToStartIcon,
  LockIcon,
  LoopIcon,
  NextKeyIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PopupChevronIcon,
  PreviousKeyIcon,
  RenderIcon,
  SeedIcon,
  SineIcon,
  SnapIcon,
  SpeakerIcon,
  TrashIcon,
  VideoIcon,
  WaveformIcon,
  ImageModeIcon,
} from '../Icons';
import { trackPointer } from './pointer';
import { PopoverMenu, type MenuItem } from './PopoverMenu';
import { CurvesView } from './CurvesView';
import {
  MAX_PX_PER_FRAME,
  TRACK_HEADER_WIDTH,
  clampView,
  fitView,
  frameToX,
  rulerLabel,
  rulerStep,
  shortTime,
  snapFrame,
  visibleFrames,
  xToFrame,
  zoomView,
  type LaneView,
} from './timeline-math';

export interface SelectedParameter {
  readonly effectId: string;
  readonly key: string;
}
export interface FilmstripFrame {
  readonly frame: number;
  readonly url: string;
}

export interface TimelineDockProps {
  project: ProjectState;
  timeline: Timeline;
  frame: number;
  playing: boolean;
  cachedFrames: ReadonlySet<number>;
  selectedEffectId: string | undefined;
  selectedParam: SelectedParameter | null;
  disabled: boolean;
  modulation: ModulationContext;
  stillThumbnail: string | null;
  filmstrip: readonly FilmstripFrame[];
  laneView: 'keys' | 'curves';
  onLaneView(view: 'keys' | 'curves'): void;
  onSeek(frame: number): void;
  onTogglePlay(): void;
  onTimeline(change: TimelineChange): void;
  onSelectEffect(id: string): void;
  /** `reveal` (a click on the name) also shows its modulators or Animation card. */
  onSelectParam(parameter: SelectedParameter | null, options?: { reveal?: boolean }): void;
  onToggleEffect(id: string, enabled: boolean): void;
  onLock(id: string, locked: boolean): void;
  onMoveEffect(id: string, index: number): void;
  onRemoveEffect(id: string): void;
  onAnimation(effectId: string, key: string, animation: ParameterAnimation | null): void;
  onActiveRange(effectId: string, range: ActiveRange | null): void;
  onAddParameter(effectId: string, key: string): void;
  beginGesture(): void;
  endGesture(): void;
  onRender(): void;
  onAddEffect(): void;
  onAddVideo(): void;
  onAddAudio(): void;
  /** Make the video clip's own sound the audio track. */
  onUseClipAudio(): void;
  onRemoveVideo(): void;
  onRemoveAudio(): void;
  onAddMarker(): void;
  onRemoveMarker(id: string): void;
  /** Listening level for playback only: not saved in the project or rendered. */
  playbackVolume: number;
  playbackMuted: boolean;
  onPlaybackAudio(change: { volume?: number; muted?: boolean }): void;
}

interface KeySelection {
  readonly effectId: string;
  readonly key: string;
  /** Selected keys by frame, stable across re-sorting while dragging. */
  readonly frames: readonly number[];
}
interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly MenuItem[];
}

const SEED_MODES: readonly { label: string; mode: Timeline['seed']['mode']; every: number }[] = [
  { label: 'Fixed', mode: 'fixed', every: 2 },
  { label: 'Every frame', mode: 'every-frame', every: 1 },
  { label: 'Every 2 frames', mode: 'every-n', every: 2 },
  { label: 'Every 3 frames', mode: 'every-n', every: 3 },
  { label: 'Every 4 frames', mode: 'every-n', every: 4 },
  { label: 'Every 6 frames', mode: 'every-n', every: 6 },
  { label: 'Every 8 frames', mode: 'every-n', every: 8 },
  { label: 'Every 12 frames', mode: 'every-n', every: 12 },
  { label: 'Every 24 frames', mode: 'every-n', every: 24 },
];
function seedLabel(seed: Timeline['seed']): string {
  return seed.mode === 'fixed'
    ? 'Fixed'
    : seed.mode === 'every-frame'
      ? 'Every frame'
      : `Every ${seed.every} frames`;
}

/** Keys | Curves lane dock for Timeline mode. */
export function TimelineDock(props: TimelineDockProps) {
  const {
    project,
    timeline,
    frame,
    playing,
    cachedFrames,
    selectedEffectId,
    selectedParam,
    disabled,
    laneView,
    onSeek,
    onTimeline,
    beginGesture,
    endGesture,
  } = props;
  const fps = timeline.fps;
  const frames = frameCount(timeline);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(800);
  const [zoom, setZoom] = useState<LaneView | null>(null);
  const view = clampView(zoom ?? fitView(frames, laneWidth), frames, laneWidth);
  const [snap, setSnap] = useState(true);
  // Animated and selected effects start expanded until the user toggles them.
  const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const isExpanded = (effect: EffectInstance) =>
    expandedOverrides.get(effect.instanceId) ??
    Boolean(effect.animation || effect.instanceId === selectedEffectId);
  const [keySelection, setKeySelection] = useState<KeySelection | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragHint, setDragHint] = useState<{ x: number; text: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const element = tracksRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setLaneWidth(Math.max(120, element.clientWidth - TRACK_HEADER_WIDTH)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [laneView]);

  // Keep the playhead in view while playing (zoomed in).
  useEffect(() => {
    if (!playing || zoom === null) return;
    const x = frameToX(frame, view);
    if (x >= 0 && x <= laneWidth - 8) return;
    const request = requestAnimationFrame(() =>
      setZoom({ ...view, start: Math.max(0, frame - 2 / view.pxPerFrame) }),
    );
    return () => cancelAnimationFrame(request);
  }, [frame, playing, zoom, view, laneWidth]);

  const setView = (next: LaneView | null) =>
    setZoom(next ? clampView(next, frames, laneWidth) : null);

  // Control/Command + wheel zooms around the pointer; Shift + wheel pans.
  useEffect(() => {
    const element = tracksRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left - TRACK_HEADER_WIDTH;
      const current = clampView(zoom ?? fitView(frames, laneWidth), frames, laneWidth);
      if (event.ctrlKey || event.metaKey) {
        const next = Math.min(
          MAX_PX_PER_FRAME,
          current.pxPerFrame * Math.exp(-(event.deltaY || event.deltaX) * 0.002),
        );
        setZoom(clampView(zoomView(current, next, Math.max(0, x)), frames, laneWidth));
      } else {
        const delta = (event.deltaY || event.deltaX) / current.pxPerFrame;
        setZoom(clampView({ ...current, start: current.start + delta }, frames, laneWidth));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom, frames, laneWidth, laneView]);

  const keyFrames = useMemo(() => {
    const result: number[] = [];
    for (const effect of project.effects)
      for (const animation of Object.values(effect.animation ?? {}))
        for (const key of animation.keys) result.push(timeFrame(key.t, fps));
    return [...new Set(result)].sort((a, b) => a - b);
  }, [project.effects, fps]);
  const beatFrames = useMemo(
    () => (timeline.audio?.analysis?.beats ?? []).map((beat) => timeFrame(beat, fps)),
    [timeline.audio, fps],
  );
  const markerFrames = useMemo(
    () => timeline.markers.map((marker) => timeFrame(marker.t, fps)),
    [timeline.markers, fps],
  );
  const snapTargets = useCallback(
    (exclude: ReadonlySet<number> = new Set()) => {
      const targets = new Set<number>([0, frames - 1, frame, ...markerFrames, ...beatFrames]);
      for (const value of keyFrames) if (!exclude.has(value)) targets.add(value);
      if (timeline.workArea) {
        targets.add(timeFrame(timeline.workArea.start, fps));
        targets.add(timeFrame(timeline.workArea.end, fps));
      }
      return [...targets];
    },
    [frames, frame, markerFrames, beatFrames, keyFrames, timeline.workArea, fps],
  );
  const snapTo = useCallback(
    (target: number, exclude?: ReadonlySet<number>) =>
      snap
        ? snapFrame(target, snapTargets(exclude), 6 / view.pxPerFrame)
        : { frame: Math.round(target), snapped: false },
    [snap, snapTargets, view.pxPerFrame],
  );

  const selectedEffect = project.effects.find((effect) => effect.instanceId === selectedEffectId);
  const jumpKey = (direction: -1 | 1) => {
    const candidates = (
      selectedEffect?.animation
        ? Object.values(selectedEffect.animation)
        : project.effects.flatMap((effect) => Object.values(effect.animation ?? {}))
    )
      .flatMap((animation) => animation.keys.map((key) => timeFrame(key.t, fps)))
      .filter((value) => (direction < 0 ? value < frame : value > frame));
    if (!candidates.length) return;
    onSeek(direction < 0 ? Math.max(...candidates) : Math.min(...candidates));
  };

  const removeSelectedKeys = () => {
    if (!keySelection) return;
    const effect = project.effects.find((entry) => entry.instanceId === keySelection.effectId);
    const animation = effect?.animation?.[keySelection.key];
    if (!animation) return;
    const remove = new Set(keySelection.frames);
    const keys = animation.keys.filter((key) => !remove.has(timeFrame(key.t, fps)));
    endGesture();
    props.onAnimation(
      keySelection.effectId,
      keySelection.key,
      keys.length || animation.modulators?.length ? { ...animation, keys } : null,
    );
    setKeySelection(null);
  };
  const easeSelection = (interpolation: Interpolation) => {
    const target = keySelection ?? (selectedParam ? { ...selectedParam, frames: [] } : null);
    if (!target) return;
    const effect = project.effects.find((entry) => entry.instanceId === target.effectId);
    const animation = effect?.animation?.[target.key];
    if (!animation) return;
    const wanted = new Set(target.frames);
    const indices = target.frames.length
      ? animation.keys.flatMap((key, index) => (wanted.has(timeFrame(key.t, fps)) ? [index] : []))
      : 'all';
    endGesture();
    props.onAnimation(
      target.effectId,
      target.key,
      setKeysInterpolation(animation, indices, interpolation),
    );
  };

  const displayed = [...project.effects].reverse();
  const visible = visibleFrames(view, laneWidth);
  const workArea = timeline.workArea;
  const timecodeFrames = frames;
  const spanSeconds = laneWidth / view.pxPerFrame / fps;
  const zoomFraction =
    Math.log(view.pxPerFrame / fitView(frames, laneWidth).pxPerFrame) /
    Math.log(MAX_PX_PER_FRAME / fitView(frames, laneWidth).pxPerFrame || 1);

  const seekFromLane = (event: React.PointerEvent<HTMLElement>, lane: HTMLElement) => {
    const bounds = lane.getBoundingClientRect();
    const move = (clientX: number) =>
      onSeek(Math.min(frames - 1, Math.max(0, Math.round(xToFrame(clientX - bounds.left, view)))));
    move(event.clientX);
    lane.setPointerCapture(event.pointerId);
    const pointerMove = (moveEvent: PointerEvent) => move(moveEvent.clientX);
    const release = () => {};
    trackPointer(event.pointerId, pointerMove, release);
  };

  // The audio track row (waveform, tempo, the track's mute and volume) shows in
  // both the Keys and Curves views.
  const audioRow = timeline.audio ? (
    <TrackRow
      className={`audio-row${timeline.audio.muted ? ' muted' : ''}`}
      header={
        <>
          <div className="track-header-line">
            <WaveformIcon />
            <span
              className="track-name"
              title={
                audioIsClipSound(timeline)
                  ? `${timeline.audio.name} (the clip’s own sound)`
                  : timeline.audio.name
              }
            >
              Audio · {timeline.audio.name}
            </span>
            <span className="track-meta">
              {timeline.audio.analysis
                ? timeline.audio.analysis.bpm
                  ? `${timeline.audio.analysis.bpm} BPM`
                  : 'No steady beat'
                : 'Analyzing…'}
            </span>
          </div>
          <AudioTrackLevel
            audio={timeline.audio}
            disabled={disabled}
            onChange={(change) => onTimeline({ audio: { ...timeline.audio!, ...change } })}
            beginGesture={beginGesture}
            endGesture={endGesture}
          />
        </>
      }
      onLanePointerDown={seekFromLane}
    >
      <Waveform timeline={timeline} view={view} laneWidth={laneWidth} />
    </TrackRow>
  ) : null;

  return (
    <section
      className="timeline-dock"
      aria-label="Timeline"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
          return;
        // Leave application commands (especially Cmd+Z on Mac) to the history
        // handler. Selection zoom, fit and deletion use unmodified keys.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if ((event.key === 'Delete' || event.key === 'Backspace') && keySelection) {
          event.preventDefault();
          removeSelectedKeys();
        } else if (event.key === '\\') {
          event.preventDefault();
          setView(null);
        } else if (event.key.toLowerCase() === 'z' && keySelection) {
          event.preventDefault();
          const low = Math.min(...keySelection.frames);
          const high = Math.max(...keySelection.frames);
          const span = Math.max(8, high - low + 8);
          setView({ start: low - 4, pxPerFrame: laneWidth / span });
        } else if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          setView(
            zoomView(
              view,
              Math.min(MAX_PX_PER_FRAME, view.pxPerFrame * 1.5),
              frameToX(frame, view),
            ),
          );
        } else if (event.key === '-') {
          event.preventDefault();
          setView(zoomView(view, view.pxPerFrame / 1.5, frameToX(frame, view)));
        }
      }}
    >
      <div className="transport-bar" role="toolbar" aria-label="Transport">
        <div className="transport-buttons">
          <button
            className="ib"
            aria-label="Go to start"
            title="Go to start (Home)"
            onClick={() => onSeek(workArea ? timeFrame(workArea.start, fps) : 0)}
          >
            <GoToStartIcon />
          </button>
          <button
            className="ib"
            aria-label="Previous keyframe"
            title="Previous keyframe (,)"
            onClick={() => jumpKey(-1)}
          >
            <PreviousKeyIcon />
          </button>
          <button
            className="transport-play"
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={props.onTogglePlay}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            className="ib"
            aria-label="Next keyframe"
            title="Next keyframe (.)"
            onClick={() => jumpKey(1)}
          >
            <NextKeyIcon />
          </button>
          <button
            className="ib"
            aria-label="Go to end"
            title="Go to end (End)"
            onClick={() =>
              onSeek(workArea ? Math.max(0, timeFrame(workArea.end, fps) - 1) : frames - 1)
            }
          >
            <GoToEndIcon />
          </button>
          <button
            className="ib transport-toggle"
            aria-label="Loop work area"
            aria-pressed={timeline.loop}
            title="Loop playback (work area when set)"
            onClick={() => onTimeline({ loop: !timeline.loop })}
          >
            <LoopIcon />
          </button>
        </div>
        <div className="transport-volume" role="group" aria-label="Playback volume">
          <button
            className="ib transport-toggle"
            aria-label="Mute playback"
            aria-pressed={props.playbackMuted}
            title="Mute playback. Listening only: renders and the project are not affected."
            onClick={() => props.onPlaybackAudio({ muted: !props.playbackMuted })}
          >
            <SpeakerIcon muted={props.playbackMuted || props.playbackVolume === 0} size={16} />
          </button>
          <input
            type="range"
            aria-label="Playback volume"
            title={`Playback volume ${Math.round(props.playbackVolume * 100)}%. Listening only: renders and the project are not affected.`}
            min={0}
            max={1}
            step={0.01}
            value={props.playbackVolume}
            onChange={(event) =>
              props.onPlaybackAudio({
                volume: event.target.valueAsNumber,
                ...(props.playbackMuted && event.target.valueAsNumber > 0 ? { muted: false } : {}),
              })
            }
          />
        </div>
        <div className="transport-time">
          <output className="timecode" aria-label="Current time">
            {formatTimecode(frame, fps)}
          </output>
          {view.pxPerFrame >= 12 && <span className="frame-chip">frame {frame}</span>}
          <button
            className="duration-button"
            aria-label="Timeline duration"
            title="Change the timeline length"
            disabled={disabled}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: bounds.left,
                y: bounds.bottom + 6,
                label: 'Timeline length',
                items: [
                  { label: 'Length', heading: true },
                  ...[2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600].map(
                    (seconds) => ({
                      label: seconds < 60 ? `${seconds} s` : `${seconds / 60} min`,
                      checked: Math.abs(timeline.duration - seconds) < 1e-6,
                      onSelect: () => onTimeline({ duration: seconds }),
                    }),
                  ),
                  ...(timeline.video
                    ? [
                        { label: '', separator: true },
                        {
                          label: `Match clip (${timeline.video.duration.toFixed(1)} s)`,
                          onSelect: () =>
                            onTimeline({ duration: Math.min(3600, timeline.video!.duration) }),
                        },
                      ]
                    : []),
                  ...(timeline.audio
                    ? [
                        {
                          label: `Match audio (${timeline.audio.duration.toFixed(1)} s)`,
                          onSelect: () =>
                            onTimeline({ duration: Math.min(3600, timeline.audio!.duration) }),
                        },
                      ]
                    : []),
                ],
              });
            }}
          >
            / {formatTimecode(timecodeFrames, fps)}
          </button>
        </div>
        <button
          className="pill"
          aria-label="Frame rate"
          disabled={disabled}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({
              x: bounds.left,
              y: bounds.bottom + 6,
              label: 'Frame rate',
              items: FRAME_RATES.map((rate) => ({
                label: `${rate} fps`,
                checked: Math.abs(rate - fps) < 1e-6,
                onSelect: () => onTimeline({ fps: rate }),
              })),
            });
          }}
        >
          {Number(fps.toFixed(3))} fps <PopupChevronIcon />
        </button>
        {(timeline.audio || timeline.bpm) && (
          <button
            className="pill tempo-chip"
            aria-label="Tempo"
            title="Tempo for synced LFOs and beat snapping"
            disabled={disabled}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const detected = timeline.audio?.analysis?.bpm;
              setMenu({
                x: bounds.left,
                y: bounds.bottom + 6,
                label: 'Tempo',
                items: [
                  ...(detected
                    ? [
                        {
                          label: `Detected · ${detected} BPM`,
                          checked: timeline.bpm === undefined,
                          onSelect: () => onTimeline({ bpm: undefined }),
                        },
                      ]
                    : []),
                  ...[60, 80, 90, 100, 110, 120, 128, 140, 150, 160, 174].map((bpm) => ({
                    label: `${bpm} BPM`,
                    checked: timeline.bpm === bpm,
                    onSelect: () => onTimeline({ bpm }),
                  })),
                ],
              });
            }}
          >
            <SineIcon size={12} />
            {props.modulation.bpm} BPM ·{' '}
            {timeline.bpm === undefined && timeline.audio?.analysis?.bpm ? 'detected' : 'set'}
          </button>
        )}
        <div className="transport-spacer" />
        <div className="segmented" role="group" aria-label="Lane view">
          {(['keys', 'curves'] as const).map((option) => (
            <button
              key={option}
              aria-pressed={laneView === option}
              onClick={() => props.onLaneView(option)}
            >
              {option === 'keys' ? 'Keys' : 'Curves'}
            </button>
          ))}
        </div>
        <div className="ease-presets" role="group" aria-label="Easing for selected keys">
          {(
            [
              ['linear', <EaseLinearIcon key="l" />, 'Linear'],
              ['ease-in-out', <EaseInOutIcon key="e" />, 'Ease in-out'],
              ['hold', <EaseHoldIcon key="h" />, 'Hold'],
            ] as const
          ).map(([interpolation, icon, label]) => (
            <button
              key={interpolation}
              className="ib"
              aria-label={`${label} for selected keys`}
              title={`${label} for selected keys`}
              disabled={disabled || (!keySelection && !selectedParam)}
              onClick={() => easeSelection(interpolation)}
            >
              {icon}
            </button>
          ))}
        </div>
        <button
          className="ib transport-toggle"
          aria-label="Snap to frames, keys and beats"
          aria-pressed={snap}
          title="Snap to frames, keys, markers and beats"
          onClick={() => setSnap(!snap)}
        >
          <SnapIcon />
        </button>
        <div className="timeline-zoom" role="group" aria-label="Timeline zoom">
          <button
            className="ib"
            aria-label="Zoom out timeline"
            title="Zoom out (−)"
            onClick={() => setView(zoomView(view, view.pxPerFrame / 1.5, frameToX(frame, view)))}
          >
            <svg className="ui-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <input
            type="range"
            aria-label="Timeline zoom level"
            min={0}
            max={1}
            step={0.001}
            value={Number.isFinite(zoomFraction) ? Math.max(0, Math.min(1, zoomFraction)) : 0}
            onChange={(event) => {
              const fit = fitView(frames, laneWidth).pxPerFrame;
              const next = fit * (MAX_PX_PER_FRAME / fit) ** event.target.valueAsNumber;
              setView(zoomView(view, next, Math.max(0, frameToX(frame, view))));
            }}
          />
          <button
            className="ib"
            aria-label="Zoom in timeline"
            title="Zoom in (=)"
            onClick={() =>
              setView(
                zoomView(
                  view,
                  Math.min(MAX_PX_PER_FRAME, view.pxPerFrame * 1.5),
                  frameToX(frame, view),
                ),
              )
            }
          >
            <PlusIcon />
          </button>
          <span className="zoom-span" title="Visible time span">
            {spanSeconds >= 1
              ? `${Number(spanSeconds.toFixed(spanSeconds < 10 ? 1 : 0))} s`
              : `${Math.round(spanSeconds * fps)} f`}
          </span>
          <button
            className="ib"
            aria-label="Fit timeline to window"
            title="Fit whole timeline (\)"
            onClick={() => setView(null)}
          >
            <FitWidthIcon />
          </button>
        </div>
        <button className="render-button" disabled={disabled} onClick={props.onRender}>
          <RenderIcon />
          Render Video
        </button>
      </div>

      {laneView === 'curves' ? (
        <CurvesView
          project={project}
          timeline={timeline}
          frame={frame}
          view={view}
          laneWidth={laneWidth}
          modulation={props.modulation}
          selectedEffectId={selectedEffectId}
          selectedParam={selectedParam}
          disabled={disabled}
          tracksRef={tracksRef}
          snapTo={snapTo}
          onSeek={onSeek}
          onSelectParam={props.onSelectParam}
          onAnimation={props.onAnimation}
          beginGesture={beginGesture}
          endGesture={endGesture}
          audioRow={audioRow}
          ruler={
            <Ruler
              timeline={timeline}
              frames={frames}
              frame={frame}
              view={view}
              laneWidth={laneWidth}
              cachedFrames={cachedFrames}
              beatFrames={beatFrames}
              disabled={disabled}
              snapTo={snapTo}
              onSeek={seekFromLane}
              onTimeline={onTimeline}
              beginGesture={beginGesture}
              endGesture={endGesture}
              onMarkerMenu={(marker, x, y) =>
                setMenu({
                  x,
                  y,
                  label: 'Marker',
                  items: [
                    { label: 'Go to marker', onSelect: () => onSeek(timeFrame(marker.t, fps)) },
                    { label: 'Remove marker', onSelect: () => props.onRemoveMarker(marker.id) },
                  ],
                })
              }
            />
          }
        />
      ) : (
        <div className="timeline-viewport">
          <div className="timeline-tracks" ref={tracksRef}>
            <div className="timeline-row ruler-row">
              <div className="track-header ruler-header">
                <span>Tracks</span>
                <button
                  className="ib"
                  aria-label="Add track"
                  title="Add an effect, video clip, audio track or marker"
                  disabled={disabled}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      x: bounds.left,
                      y: bounds.bottom + 4,
                      label: 'Add track',
                      items: [
                        { label: 'Effect…', onSelect: props.onAddEffect },
                        {
                          label: timeline.video ? 'Replace video clip…' : 'Video clip…',
                          onSelect: props.onAddVideo,
                        },
                        {
                          label: timeline.audio ? 'Replace audio track…' : 'Audio track…',
                          onSelect: props.onAddAudio,
                        },
                        ...(timeline.video?.hasAudio && !audioIsClipSound(timeline)
                          ? [
                              {
                                label: timeline.audio ? 'Use clip audio instead' : 'Use clip audio',
                                onSelect: props.onUseClipAudio,
                              },
                            ]
                          : []),
                        { label: 'Marker at playhead', shortcut: 'M', onSelect: props.onAddMarker },
                        ...(timeline.video || timeline.audio
                          ? [{ label: '', separator: true }]
                          : []),
                        ...(timeline.video
                          ? [{ label: 'Remove video clip', onSelect: props.onRemoveVideo }]
                          : []),
                        ...(timeline.audio
                          ? [{ label: 'Remove audio track', onSelect: props.onRemoveAudio }]
                          : []),
                      ],
                    });
                  }}
                >
                  <PlusIcon />
                </button>
              </div>
              <Ruler
                timeline={timeline}
                frames={frames}
                frame={frame}
                view={view}
                laneWidth={laneWidth}
                cachedFrames={cachedFrames}
                beatFrames={beatFrames}
                disabled={disabled}
                snapTo={snapTo}
                onSeek={seekFromLane}
                onTimeline={onTimeline}
                beginGesture={beginGesture}
                endGesture={endGesture}
                onMarkerMenu={(marker, x, y) =>
                  setMenu({
                    x,
                    y,
                    label: 'Marker',
                    items: [
                      { label: 'Go to marker', onSelect: () => onSeek(timeFrame(marker.t, fps)) },
                      { label: 'Remove marker', onSelect: () => props.onRemoveMarker(marker.id) },
                    ],
                  })
                }
              />
            </div>

            <div className="timeline-rows">
              <TrackRow
                className="source-row"
                header={
                  <>
                    {timeline.video ? <VideoIcon /> : <ImageModeIcon />}
                    <span
                      className="track-name"
                      title={timeline.video?.name ?? project.source?.name}
                    >
                      Source · {timeline.video?.name ?? project.source?.name ?? 'No image'}
                    </span>
                    <span className="track-meta">{timeline.video ? 'Video' : 'Still'}</span>
                  </>
                }
                onLanePointerDown={seekFromLane}
              >
                <Filmstrip
                  view={view}
                  laneWidth={laneWidth}
                  frames={frames}
                  still={timeline.video ? null : props.stillThumbnail}
                  filmstrip={props.filmstrip}
                />
              </TrackRow>
              {audioRow}
              {displayed.map((effect, index) => (
                <EffectTracks
                  key={effect.instanceId}
                  effect={effect}
                  index={index}
                  count={displayed.length}
                  timeline={timeline}
                  frame={frame}
                  frames={frames}
                  view={view}
                  laneWidth={laneWidth}
                  modulation={props.modulation}
                  expanded={isExpanded(effect)}
                  selected={effect.instanceId === selectedEffectId}
                  selectedParam={selectedParam}
                  keySelection={keySelection}
                  disabled={disabled}
                  snapTo={snapTo}
                  onExpand={(open) =>
                    setExpandedOverrides((previous) =>
                      new Map(previous).set(effect.instanceId, open),
                    )
                  }
                  onSelect={() => props.onSelectEffect(effect.instanceId)}
                  onSelectParam={props.onSelectParam}
                  onKeySelection={setKeySelection}
                  onToggle={() => props.onToggleEffect(effect.instanceId, !effect.enabled)}
                  onLock={() => props.onLock(effect.instanceId, !effect.locked)}
                  onMove={(direction) => {
                    const target = index + direction;
                    if (target >= 0 && target < displayed.length)
                      props.onMoveEffect(effect.instanceId, displayed.length - 1 - target);
                  }}
                  onRemove={() => props.onRemoveEffect(effect.instanceId)}
                  onAnimation={props.onAnimation}
                  onActiveRange={props.onActiveRange}
                  onSeekLane={seekFromLane}
                  onSeek={onSeek}
                  onMenu={setMenu}
                  onDragHint={setDragHint}
                  onAddParameter={props.onAddParameter}
                  beginGesture={beginGesture}
                  endGesture={endGesture}
                />
              ))}
              <TrackRow
                className="seed-row"
                header={
                  <>
                    <SeedIcon />
                    <span className="track-name">Seed</span>
                    <button
                      className="pill seed-mode"
                      aria-label="Seed mode"
                      title="Fixed keeps a steady pattern; changing seeds make glitches flicker and boil."
                      disabled={disabled}
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setMenu({
                          x: bounds.left,
                          y: bounds.bottom + 4,
                          label: 'Seed mode',
                          items: SEED_MODES.map((option) => ({
                            label: option.label,
                            checked:
                              option.mode === timeline.seed.mode &&
                              (option.mode !== 'every-n' || option.every === timeline.seed.every),
                            onSelect: () =>
                              onTimeline({ seed: { mode: option.mode, every: option.every } }),
                          })),
                        });
                      }}
                    >
                      {seedLabel(timeline.seed)} <PopupChevronIcon />
                    </button>
                  </>
                }
                onLanePointerDown={seekFromLane}
              >
                <SeedTicks timeline={timeline} frames={frames} view={view} visible={visible} />
              </TrackRow>
            </div>
          </div>
          <div
            className="timeline-playhead"
            aria-hidden="true"
            style={{ left: TRACK_HEADER_WIDTH + frameToX(frame, view) }}
            hidden={frameToX(frame, view) < -1 || frameToX(frame, view) > laneWidth + 1}
          />
          {dragHint && (
            <div className="key-drag-hint" style={{ left: TRACK_HEADER_WIDTH + dragHint.x }}>
              {dragHint.text}
            </div>
          )}
        </div>
      )}
      <div className="timeline-scrollbar">
        <span className="timeline-hint">
          {window.gleech.platform === 'darwin' ? 'Cmd' : 'Ctrl'} + scroll to zoom · Shift + scroll
          to pan · \ fit · Z zoom to selection
        </span>
        <HorizontalScroll view={view} frames={frames} laneWidth={laneWidth} onView={setView} />
      </div>
      {menu && (
        <PopoverMenu
          x={menu.x}
          y={menu.y}
          label={menu.label}
          items={menu.items}
          onClose={closeMenu}
        />
      )}
    </section>
  );
}

/** The audio track's own mute and volume: saved in the project, used by playback and renders. */
function AudioTrackLevel({
  audio,
  disabled,
  onChange,
  beginGesture,
  endGesture,
}: {
  audio: NonNullable<Timeline['audio']>;
  disabled: boolean;
  onChange(change: { volume?: number; muted?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const volume = audio.volume ?? 1;
  const muted = audio.muted ?? false;
  return (
    <div className="track-header-line audio-level">
      <button
        className="ib transport-toggle"
        aria-label="Mute audio track"
        aria-pressed={muted}
        title="Mute this track in playback and renders"
        disabled={disabled}
        onClick={() => onChange({ muted: !muted })}
      >
        <SpeakerIcon muted={muted || volume === 0} />
      </button>
      <input
        type="range"
        aria-label="Audio track volume"
        title="Track volume, used by playback and renders"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        disabled={disabled}
        onPointerDown={beginGesture}
        onPointerUp={endGesture}
        onBlur={endGesture}
        onChange={(event) => {
          const next = Math.round(event.target.valueAsNumber * 100) / 100;
          onChange({ volume: next, ...(muted && next > 0 ? { muted: false } : {}) });
        }}
      />
      <output className="track-value" aria-label="Audio track level">
        {muted ? 'Muted' : `${Math.round(volume * 100)}%`}
      </output>
    </div>
  );
}

function TrackRow({
  className,
  header,
  children,
  onLanePointerDown,
  selected,
  headerProps,
}: {
  className: string;
  header: ReactNode;
  children?: ReactNode;
  onLanePointerDown?(event: React.PointerEvent<HTMLElement>, lane: HTMLElement): void;
  selected?: boolean;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div className={`timeline-row ${className}${selected ? ' selected' : ''}`}>
      <div className="track-header" {...headerProps}>
        {header}
      </div>
      <div
        className="track-lane"
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target !== event.currentTarget) return;
          onLanePointerDown?.(event, event.currentTarget);
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Ruler({
  timeline,
  frames,
  frame,
  view,
  laneWidth,
  cachedFrames,
  beatFrames,
  disabled,
  snapTo,
  onSeek,
  onTimeline,
  beginGesture,
  endGesture,
  onMarkerMenu,
}: {
  timeline: Timeline;
  frames: number;
  frame: number;
  view: LaneView;
  laneWidth: number;
  cachedFrames: ReadonlySet<number>;
  beatFrames: readonly number[];
  disabled: boolean;
  snapTo(frame: number): { frame: number; snapped: boolean };
  onSeek(event: React.PointerEvent<HTMLElement>, lane: HTMLElement): void;
  onTimeline(change: TimelineChange): void;
  beginGesture(): void;
  endGesture(): void;
  onMarkerMenu(marker: Timeline['markers'][number], x: number, y: number): void;
}) {
  const fps = timeline.fps;
  const step = rulerStep(view.pxPerFrame, fps);
  const visible = visibleFrames(view, laneWidth);
  const ticks: number[] = [];
  for (
    let tick = Math.floor(visible.first / step) * step;
    tick <= Math.min(frames, visible.last);
    tick += step
  )
    ticks.push(tick);
  const minor = step >= 4 ? step / (step % 5 === 0 ? 5 : 4) : 0;
  // Cached frames as runs, drawn as one thin green line per run.
  const runs = useMemo(() => {
    const sorted = [...cachedFrames].sort((a, b) => a - b);
    const result: [number, number][] = [];
    for (const value of sorted) {
      const last = result[result.length - 1];
      if (last && value === last[1] + 1) last[1] = value;
      else result.push([value, value]);
    }
    return result;
  }, [cachedFrames]);
  const area = timeline.workArea;
  const areaStart = area ? timeFrame(area.start, fps) : 0;
  const areaEnd = area ? timeFrame(area.end, fps) : frames;
  const dragArea = (event: React.PointerEvent<HTMLElement>, edge: 'start' | 'end' | 'move') => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = event.currentTarget.closest<HTMLElement>('.ruler-lane')!;
    const bounds = lane.getBoundingClientRect();
    const origin = xToFrame(event.clientX - bounds.left, view);
    const initial = { start: areaStart, end: areaEnd };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    beginGesture();
    const move = (moveEvent: PointerEvent) => {
      const at = xToFrame(moveEvent.clientX - bounds.left, view);
      let start = initial.start;
      let end = initial.end;
      if (edge === 'start') start = snapTo(at).frame;
      else if (edge === 'end') end = snapTo(at).frame;
      else {
        const delta = Math.round(at - origin);
        const length = initial.end - initial.start;
        start = Math.min(frames - length, Math.max(0, initial.start + delta));
        end = start + length;
      }
      start = Math.max(0, Math.min(frames - 1, start));
      end = Math.max(start + 1, Math.min(frames, end));
      onTimeline({
        workArea:
          start <= 0 && end >= frames
            ? null
            : { start: frameTime(start, fps), end: frameTime(end, fps) },
      });
    };
    const release = () => {
      endGesture();
    };
    trackPointer(event.pointerId, move, release);
  };
  return (
    <div
      className="track-lane ruler-lane"
      title="Drag to scrub"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        onSeek(event, event.currentTarget);
      }}
    >
      <div
        className={`work-area${area ? ' set' : ''}`}
        style={{ left: frameToX(areaStart, view), width: (areaEnd - areaStart) * view.pxPerFrame }}
        title={
          area
            ? `Work area ${shortTime(area.start)} – ${shortTime(area.end)}. Drag the ends to change it; double-click to clear.`
            : 'Drag the ends to set a work area for looping and rendering.'
        }
        onPointerDown={(event) => dragArea(event, 'move')}
        onDoubleClick={() => onTimeline({ workArea: null })}
      >
        <span
          className="work-area-handle start"
          onPointerDown={(event) => dragArea(event, 'start')}
        />
        <span className="work-area-handle end" onPointerDown={(event) => dragArea(event, 'end')} />
      </div>
      {timeline.inOut && (
        <div
          className="in-out-range"
          style={{
            left: frameToX(timeFrame(timeline.inOut.start, fps), view),
            width:
              (timeFrame(timeline.inOut.end, fps) - timeFrame(timeline.inOut.start, fps)) *
              view.pxPerFrame,
          }}
          title={`In ${shortTime(timeline.inOut.start)} · Out ${shortTime(timeline.inOut.end)}`}
        />
      )}
      {ticks.map((tick) => (
        <span key={tick} className="ruler-tick" style={{ left: frameToX(tick, view) }}>
          {rulerLabel(tick, fps, step)}
        </span>
      ))}
      {minor > 0 &&
        ticks.flatMap((tick) =>
          [1, 2, 3, 4]
            .map((part) => tick + part * minor)
            .filter((value) => value < tick + step && value <= frames)
            .map((value) => (
              <span
                key={`m${value}`}
                className="ruler-minor"
                style={{ left: frameToX(value, view) }}
              />
            )),
        )}
      {beatFrames
        .filter((beat) => beat >= visible.first && beat <= visible.last)
        .map((beat, index) => (
          <span key={`b${index}`} className="beat-tick" style={{ left: frameToX(beat, view) }} />
        ))}
      {runs.map(([start, end]) => (
        <span
          key={`c${start}`}
          className="cache-run"
          title="Frames cached for instant playback"
          style={{ left: frameToX(start, view), width: (end - start + 1) * view.pxPerFrame }}
        />
      ))}
      {timeline.markers.map((marker) => (
        <button
          key={marker.id}
          className={`timeline-marker${marker.snapshotId ? ' snapshot' : ''}`}
          style={{ left: frameToX(timeFrame(marker.t, fps), view) }}
          aria-label={`Marker ${marker.name || shortTime(marker.t)}`}
          title={marker.name || shortTime(marker.t)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => onMarkerMenu(marker, event.clientX, event.clientY + 8)}
        >
          {marker.name}
        </button>
      ))}
      <span className="ruler-playhead" style={{ left: frameToX(frame, view) }} aria-hidden="true" />
    </div>
  );
}

function Filmstrip({
  view,
  laneWidth,
  frames,
  still,
  filmstrip,
}: {
  view: LaneView;
  laneWidth: number;
  frames: number;
  still: string | null;
  filmstrip: readonly FilmstripFrame[];
}) {
  if (still)
    return (
      <div
        className="filmstrip still"
        style={{
          left: Math.max(0, frameToX(0, view)),
          width: Math.min(laneWidth, frameToX(frames, view)) - Math.max(0, frameToX(0, view)),
          backgroundImage: `url("${still}")`,
          backgroundPositionX: `${-view.start * view.pxPerFrame}px`,
        }}
      />
    );
  const visible = visibleFrames(view, laneWidth);
  const thumbWidth = 64;
  const stride = Math.max(1, Math.round(thumbWidth / view.pxPerFrame));
  const tiles: { frame: number; url: string }[] = [];
  if (filmstrip.length)
    for (
      let at = Math.floor(visible.first / stride) * stride;
      at <= Math.min(frames - 1, visible.last);
      at += stride
    ) {
      let nearest = filmstrip[0]!;
      for (const candidate of filmstrip)
        if (Math.abs(candidate.frame - at) < Math.abs(nearest.frame - at)) nearest = candidate;
      tiles.push({ frame: at, url: nearest.url });
    }
  return (
    <div className="filmstrip">
      {tiles.map((tile) => (
        <img
          key={tile.frame}
          src={tile.url}
          alt=""
          style={{ left: frameToX(tile.frame, view), width: stride * view.pxPerFrame }}
        />
      ))}
    </div>
  );
}

function Waveform({
  timeline,
  view,
  laneWidth,
}: {
  timeline: Timeline;
  view: LaneView;
  laneWidth: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const analysis = timeline.audio?.analysis;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const height = element.clientHeight || 40;
    element.width = Math.max(1, Math.round(laneWidth * ratio));
    element.height = Math.max(1, Math.round(height * ratio));
    const context = element.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    if (!analysis) return;
    const binary = atob(analysis.peaks);
    const columns = Math.floor(laneWidth / 3);
    context.fillStyle = SIGNAL_COLORS.audio;
    for (let column = 0; column < columns; column++) {
      const startFrame = xToFrame(column * 3, view);
      const endFrame = xToFrame(column * 3 + 3, view);
      // The lane's left padding sits before 0:00; there is no audio there.
      if (endFrame <= 0) continue;
      const from = Math.max(0, Math.floor((startFrame / timeline.fps) * analysis.rate));
      const to = Math.min(binary.length, Math.ceil((endFrame / timeline.fps) * analysis.rate));
      let peak = 0;
      for (let index = from; index < Math.max(from + 1, to) && index < binary.length; index++)
        peak = Math.max(peak, binary.charCodeAt(index));
      if (from >= binary.length) break;
      const bar = Math.max(1, (peak / 255) * (height - 6)) * ratio;
      context.fillRect(column * 3 * ratio, (element.height - bar) / 2, 2 * ratio, bar);
    }
  }, [analysis, view, laneWidth, timeline.fps]);
  return <canvas ref={canvas} className="waveform" aria-hidden="true" />;
}

function SeedTicks({
  timeline,
  frames,
  view,
  visible,
}: {
  timeline: Timeline;
  frames: number;
  view: LaneView;
  visible: { first: number; last: number };
}) {
  if (timeline.seed.mode === 'fixed') return <div className="seed-fixed-line" />;
  const every = timeline.seed.mode === 'every-frame' ? 1 : timeline.seed.every;
  if (every * view.pxPerFrame < 4)
    return (
      <div
        className="seed-ticks dense"
        style={{
          left: Math.max(0, frameToX(0, view)),
          right: 0,
          backgroundSize: `${every * view.pxPerFrame}px 100%`,
          backgroundPositionX: `${-view.start * view.pxPerFrame}px`,
        }}
      />
    );
  const ticks = seedChangeFrames(timeline.seed, Math.min(frames, visible.last + 1)).filter(
    (value) => value >= visible.first,
  );
  return (
    <div className="seed-ticks">
      {ticks.map((tick) => (
        <span key={tick} style={{ left: frameToX(tick, view) }} />
      ))}
    </div>
  );
}

function HorizontalScroll({
  view,
  frames,
  laneWidth,
  onView,
}: {
  view: LaneView;
  frames: number;
  laneWidth: number;
  onView(view: LaneView): void;
}) {
  const total = frames * view.pxPerFrame;
  if (total <= laneWidth + 1) return <div className="timeline-hscroll" aria-hidden="true" />;
  const thumb = Math.max(32, (laneWidth / total) * laneWidth);
  const left = Math.min(
    laneWidth - thumb,
    Math.max(
      0,
      ((view.start * view.pxPerFrame) / Math.max(1, total - laneWidth)) * (laneWidth - thumb),
    ),
  );
  return (
    <div className="timeline-hscroll">
      <span
        className="timeline-hscroll-thumb"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={frames}
        aria-valuenow={Math.round(view.start)}
        aria-label="Scroll timeline"
        style={{ left, width: thumb }}
        onPointerDown={(event) => {
          event.preventDefault();
          const origin = event.clientX;
          const initial = view.start;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (moveEvent: PointerEvent) => {
            const delta =
              ((moveEvent.clientX - origin) / (laneWidth - thumb)) * (total - laneWidth);
            onView({ ...view, start: initial + delta / view.pxPerFrame });
          };
          const release = () => {};
          trackPointer(event.pointerId, move, release);
        }}
      />
    </div>
  );
}

function EffectTracks({
  effect,
  index,
  count,
  timeline,
  frame,
  frames,
  view,
  laneWidth,
  modulation,
  expanded,
  selected,
  selectedParam,
  keySelection,
  disabled,
  snapTo,
  onExpand,
  onSelect,
  onSelectParam,
  onKeySelection,
  onToggle,
  onLock,
  onMove,
  onRemove,
  onAnimation,
  onActiveRange,
  onSeekLane,
  onSeek,
  onMenu,
  onDragHint,
  onAddParameter,
  beginGesture,
  endGesture,
}: {
  effect: EffectInstance;
  index: number;
  count: number;
  timeline: Timeline;
  frame: number;
  frames: number;
  view: LaneView;
  laneWidth: number;
  modulation: ModulationContext;
  expanded: boolean;
  selected: boolean;
  selectedParam: SelectedParameter | null;
  keySelection: KeySelection | null;
  disabled: boolean;
  snapTo(frame: number, exclude?: ReadonlySet<number>): { frame: number; snapped: boolean };
  onExpand(open: boolean): void;
  onSelect(): void;
  /** `reveal` (a click on the name) also shows its modulators or Animation card. */
  onSelectParam(parameter: SelectedParameter | null, options?: { reveal?: boolean }): void;
  onKeySelection(selection: KeySelection | null): void;
  onToggle(): void;
  onLock(): void;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
  onAnimation(effectId: string, key: string, animation: ParameterAnimation | null): void;
  onActiveRange(effectId: string, range: ActiveRange | null): void;
  onSeekLane(event: React.PointerEvent<HTMLElement>, lane: HTMLElement): void;
  onSeek(frame: number): void;
  onMenu(menu: MenuState): void;
  onDragHint(hint: { x: number; text: string } | null): void;
  onAddParameter(effectId: string, key: string): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const definition = getEffectDefinition(effect);
  const fps = timeline.fps;
  const animated = Object.entries(effect.animation ?? {});
  const range = effect.activeRange;
  const rangeStart = range ? timeFrame(range.start, fps) : 0;
  const rangeEnd = range ? timeFrame(range.end, fps) : frames;
  const allKeyFrames = [
    ...new Set(
      animated.flatMap(([, animation]) => animation.keys.map((key) => timeFrame(key.t, fps))),
    ),
  ];
  const dragRange = (event: React.PointerEvent<HTMLElement>, edge: 'start' | 'end') => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = event.currentTarget.closest<HTMLElement>('.track-lane')!;
    const bounds = lane.getBoundingClientRect();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    beginGesture();
    const move = (moveEvent: PointerEvent) => {
      const at = snapTo(xToFrame(moveEvent.clientX - bounds.left, view)).frame;
      let start = rangeStart;
      let end = rangeEnd;
      if (edge === 'start') start = Math.max(0, Math.min(end - 1, at));
      else end = Math.min(frames, Math.max(start + 1, at));
      onActiveRange(
        effect.instanceId,
        start <= 0 && end >= frames
          ? null
          : { start: frameTime(start, fps), end: frameTime(end, fps) },
      );
      onDragHint({
        x: frameToX(edge === 'start' ? start : end, view),
        text: shortTime(frameTime(edge === 'start' ? start : end, fps)),
      });
    };
    const release = () => {
      onDragHint(null);
      endGesture();
    };
    trackPointer(event.pointerId, move, release);
  };
  // Effect controls first, then the Application settings that can animate.
  const candidates = [
    ...Object.keys(definition.parameters),
    ...ANIMATABLE_APPLICATION_KEYS,
  ].flatMap((key) => {
    const parameter = animationDefinition(effect, key);
    return parameter && !effect.animation?.[key] ? [[key, parameter] as const] : [];
  });
  return (
    <>
      <div
        className={`timeline-row effect-track${selected ? ' selected' : ''}${effect.enabled ? '' : ' hidden-effect'}`}
        data-effect-id={effect.instanceId}
        data-settings-kind="effect"
      >
        <div
          className="track-header effect-track-header"
          onClick={(event) => {
            if (event.target === event.currentTarget) onSelect();
          }}
        >
          <button
            className="ib track-chevron"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${definition.title}`}
            aria-expanded={expanded}
            onClick={() => onExpand(!expanded)}
          >
            <ChevronIcon open={expanded} />
          </button>
          <button
            className="ib track-eye"
            aria-label={`Enable ${definition.title} track`}
            aria-pressed={effect.enabled}
            title={effect.enabled ? `Hide ${definition.title}` : `Show ${definition.title}`}
            disabled={disabled}
            onClick={onToggle}
          >
            <EyeIcon open={effect.enabled} />
          </button>
          <button
            className="track-name effect-track-name"
            title={`${definition.title} · Alt + Up/Down to reorder`}
            onClick={onSelect}
            onKeyDown={(event) => {
              if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              onMove(event.key === 'ArrowUp' ? -1 : 1);
            }}
          >
            {definition.title}
          </button>
          {animated.length > 0 && (
            <span className="track-animated" title={`${animated.length} animated`}>
              {animated.length}
            </span>
          )}
          <button
            className="ib track-delete"
            aria-label={`Delete ${definition.title}`}
            title={`Delete ${definition.title}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
          <button
            className="ib track-lock"
            aria-label={`Lock ${definition.title} track`}
            aria-pressed={Boolean(effect.locked)}
            title={
              effect.locked ? 'Locked: GLEECH and Variation keep this effect.' : 'Lock this effect'
            }
            disabled={disabled}
            onClick={onLock}
          >
            <LockIcon locked={Boolean(effect.locked)} />
          </button>
          <span className="visually-hidden">
            Track {index + 1} of {count}
          </span>
        </div>
        <div
          className="track-lane"
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return;
            onSeekLane(event, event.currentTarget);
          }}
        >
          <div
            className={`range-bar${range ? ' trimmed' : ''}`}
            style={{
              left: frameToX(rangeStart, view),
              width: (rangeEnd - rangeStart) * view.pxPerFrame,
            }}
            title={
              range
                ? `On ${shortTime(range.start)} – ${shortTime(range.end)}. Double-click to use the whole timeline.`
                : 'Drag the ends to choose when this effect is on.'
            }
            onPointerDown={(event) => {
              if (event.target === event.currentTarget)
                onSeekLane(event, event.currentTarget.parentElement!);
            }}
            onDoubleClick={() => onActiveRange(effect.instanceId, null)}
          >
            <span
              className="range-handle start"
              aria-label={`${definition.title} start`}
              onPointerDown={(event) => dragRange(event, 'start')}
            />
            {range &&
              rangeEnd - rangeStart > 0 &&
              (rangeEnd - rangeStart) * view.pxPerFrame > 90 && (
                <span className="range-label">
                  {shortTime(range.start)} – {shortTime(range.end)}
                </span>
              )}
            {!expanded &&
              allKeyFrames.map((value) => (
                <span
                  key={value}
                  className="range-key"
                  style={{ left: (value - rangeStart) * view.pxPerFrame }}
                />
              ))}
            <span
              className="range-handle end"
              aria-label={`${definition.title} end`}
              onPointerDown={(event) => dragRange(event, 'end')}
            />
          </div>
        </div>
      </div>
      {expanded &&
        animated.map(([key, animation], laneIndex) => {
          const parameter = animationDefinition(effect, key);
          if (!parameter) return null;
          const isSelected =
            selectedParam?.effectId === effect.instanceId && selectedParam.key === key;
          const value = evaluateParameter(
            animation,
            parameterBaseValue(effect, key),
            frameTime(frame, fps),
            parameter,
            modulation,
          );
          // Disabled modulators still show, so their stack stays reachable.
          const modulators = animation.modulators ?? [];
          const audio = modulators.some((modulator) => modulator.kind === 'audio');
          const lfo = modulators.some((modulator) => modulator.kind === 'lfo');
          const ease = animation.keys.length
            ? new Set(animation.keys.slice(0, -1).map((k) => k.interpolation)).size > 1
              ? 'Mixed'
              : EASE_LABELS[animation.keys[0]!.interpolation]
            : '';
          return (
            <div
              key={key}
              className={`timeline-row parameter-track${isSelected ? ' selected' : ''}`}
              data-parameter-key={key}
            >
              <div
                className="track-header parameter-track-header"
                onClick={() =>
                  onSelectParam({ effectId: effect.instanceId, key }, { reveal: true })
                }
              >
                <span className={`parameter-icon${audio ? ' audio' : lfo ? ' lfo' : ''}`}>
                  {audio ? (
                    <WaveformIcon size={12} />
                  ) : lfo ? (
                    <SineIcon size={12} />
                  ) : (
                    <DiamondIcon
                      filled={animation.keys.some((k) => timeFrame(k.t, fps) === frame)}
                      size={10}
                    />
                  )}
                </span>
                <button
                  className="track-name"
                  aria-pressed={isSelected}
                  title={parameter.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectParam({ effectId: effect.instanceId, key }, { reveal: true });
                  }}
                >
                  {parameter.label}
                </button>
                <span className={`track-meta${audio ? ' audio' : lfo ? ' lfo' : ''}`}>
                  {audio && lfo ? 'Audio + LFO' : audio ? 'Audio' : lfo ? 'LFO' : ease}
                </span>
                <span className="track-value">{formatParameterValue(parameter, value)}</span>
              </div>
              <KeyLane
                effect={effect}
                paramKey={key}
                animation={animation}
                parameter={parameter}
                timeline={timeline}
                frames={frames}
                frame={frame}
                view={view}
                laneWidth={laneWidth}
                modulation={modulation}
                color={curveColor(laneIndex)}
                selected={isSelected}
                keySelection={
                  keySelection?.effectId === effect.instanceId && keySelection.key === key
                    ? keySelection
                    : null
                }
                disabled={disabled}
                snapTo={snapTo}
                onKeySelection={onKeySelection}
                onSelectParam={() => onSelectParam({ effectId: effect.instanceId, key })}
                onAnimation={(next) => onAnimation(effect.instanceId, key, next)}
                onSeekLane={onSeekLane}
                onSeek={onSeek}
                onMenu={onMenu}
                onDragHint={onDragHint}
                beginGesture={beginGesture}
                endGesture={endGesture}
              />
            </div>
          );
        })}
      {expanded && (
        <div className="timeline-row add-parameter-row">
          <div className="track-header">
            <button
              className="add-parameter"
              disabled={disabled || candidates.length === 0}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onMenu({
                  x: bounds.left,
                  y: bounds.bottom + 4,
                  label: 'Animate parameter',
                  items: candidates.map(([key, parameter]) => ({
                    label: key.startsWith('application.')
                      ? `${parameter.label} (Application)`
                      : parameter.label,
                    onSelect: () => onAddParameter(effect.instanceId, key),
                  })),
                });
              }}
            >
              <PlusIcon /> Animate parameter
            </button>
          </div>
          <div className="track-lane" />
        </div>
      )}
    </>
  );
}

function KeyLane({
  effect,
  paramKey,
  animation,
  parameter,
  timeline,
  frames,
  frame,
  view,
  laneWidth,
  modulation,
  color,
  selected,
  keySelection,
  disabled,
  snapTo,
  onKeySelection,
  onSelectParam,
  onAnimation,
  onSeekLane,
  onSeek,
  onMenu,
  onDragHint,
  beginGesture,
  endGesture,
}: {
  effect: EffectInstance;
  paramKey: string;
  animation: ParameterAnimation;
  parameter: NonNullable<ReturnType<typeof animationDefinition>>;
  timeline: Timeline;
  frames: number;
  frame: number;
  view: LaneView;
  laneWidth: number;
  modulation: ModulationContext;
  color: string;
  selected: boolean;
  keySelection: KeySelection | null;
  disabled: boolean;
  snapTo(frame: number, exclude?: ReadonlySet<number>): { frame: number; snapped: boolean };
  onKeySelection(selection: KeySelection | null): void;
  onSelectParam(): void;
  onAnimation(animation: ParameterAnimation | null): void;
  onSeekLane(event: React.PointerEvent<HTMLElement>, lane: HTMLElement): void;
  onSeek(frame: number): void;
  onMenu(menu: MenuState): void;
  onDragHint(hint: { x: number; text: string } | null): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const fps = timeline.fps;
  const visible = visibleFrames(view, laneWidth);
  const base = parameterBaseValue(effect, paramKey);
  const modulated = Boolean(animation.modulators?.some((modulator) => modulator.enabled));
  // Live modulation is drawn dashed in its signal color: audio green, else LFO pink.
  const liveColor = animation.modulators?.some(
    (modulator) => modulator.enabled && modulator.kind === 'audio',
  )
    ? SIGNAL_COLORS.audio
    : SIGNAL_COLORS.lfo;
  const height = selected ? 52 : 38;
  const curve = useMemo(() => {
    if (!selected && !modulated) return null;
    if (parameter.kind !== 'number') return null;
    const points: string[] = [];
    const modulatedPoints: string[] = [];
    const stepPx = 3;
    for (let x = 0; x <= laneWidth; x += stepPx) {
      const at = xToFrame(x, view);
      if (at < 0 || at > frames) continue;
      const t = at / fps;
      const keyed = evaluateKeys(animation.keys, t, parameter) ?? base;
      const y = (1 - normalizedValue(parameter, keyed)) * (height - 10) + 5;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (modulated) {
        const live = evaluateParameter(animation, base, t, parameter, modulation);
        modulatedPoints.push(
          `${x.toFixed(1)},${((1 - normalizedValue(parameter, live)) * (height - 10) + 5).toFixed(1)}`,
        );
      }
    }
    return { keyed: points.join(' '), live: modulatedPoints.join(' ') };
  }, [
    selected,
    modulated,
    parameter,
    laneWidth,
    view,
    frames,
    fps,
    animation,
    base,
    height,
    modulation,
  ]);

  const keys = animation.keys
    .map((key, index) => ({ key, index, at: timeFrame(key.t, fps) }))
    .filter((entry) => entry.at >= visible.first - 1 && entry.at <= visible.last + 1);
  const selectedFrames = new Set(keySelection?.frames ?? []);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, at: number) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectParam();
    let framesSelected: number[];
    if (event.shiftKey)
      framesSelected = selectedFrames.has(at)
        ? [...selectedFrames].filter((value) => value !== at)
        : [...selectedFrames, at];
    else framesSelected = selectedFrames.has(at) ? [...selectedFrames] : [at];
    if (!framesSelected.length) {
      onKeySelection(null);
      return;
    }
    onKeySelection({ effectId: effect.instanceId, key: paramKey, frames: framesSelected });
    const origin = animation;
    const startX = event.clientX;
    const moving = new Set(framesSelected);
    const indices = origin.keys.flatMap((key, index) =>
      moving.has(timeFrame(key.t, fps)) ? [index] : [],
    );
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let delta = 0;
    let started = false;
    const move = (moveEvent: PointerEvent) => {
      const raw = (moveEvent.clientX - startX) / view.pxPerFrame;
      if (!started && Math.abs(moveEvent.clientX - startX) < 3) return;
      if (!started) {
        started = true;
        beginGesture();
      }
      const snapped = snapTo(at + raw, moving);
      // Clamp the group so no selected key is pushed past either end and merged.
      const low = Math.min(...framesSelected);
      const high = Math.max(...framesSelected);
      const next = Math.max(-low, Math.min(frames - 1 - high, snapped.frame - at));
      if (next === delta) return;
      delta = next;
      onAnimation(moveKeys(origin, indices, delta, fps, frames - 1));
      onDragHint({
        x: frameToX(at + delta, view),
        text: `${delta >= 0 ? '+' : ''}${delta} f → f${at + delta}${snapped.snapped ? ' · snapped' : ''}`,
      });
    };
    const release = () => {
      onDragHint(null);
      if (started) {
        endGesture();
        onKeySelection({
          effectId: effect.instanceId,
          key: paramKey,
          frames: framesSelected.map((value) => Math.max(0, Math.min(frames - 1, value + delta))),
        });
      } else if (!event.shiftKey) onSeek(at);
    };
    trackPointer(event.pointerId, move, release);
  };

  const keyMenu = (event: React.MouseEvent, index: number, at: number) => {
    event.preventDefault();
    const current = animation.keys[index]!;
    const beats = (timeline.audio?.analysis?.beats ?? []).map((beat) => timeFrame(beat, fps));
    const nearestBeat = beats.length
      ? beats.reduce((best, beat) => (Math.abs(beat - at) < Math.abs(best - at) ? beat : best))
      : null;
    const targetFrames = selectedFrames.has(at) ? [...selectedFrames] : [at];
    const targetIndices = animation.keys.flatMap((key, keyIndex) =>
      targetFrames.includes(timeFrame(key.t, fps)) ? [keyIndex] : [],
    );
    onKeySelection({ effectId: effect.instanceId, key: paramKey, frames: targetFrames });
    onMenu({
      x: event.clientX,
      y: event.clientY,
      label: 'Keyframe',
      items: [
        { label: 'Interpolation', heading: true },
        ...INTERPOLATIONS.map((option) => ({
          label: option.label,
          checked: current.interpolation === option.value,
          onSelect: () => {
            endGesture();
            onAnimation(setKeysInterpolation(animation, targetIndices, option.value));
          },
        })),
        { label: '', separator: true },
        {
          label: 'Snap to nearest beat',
          disabled: nearestBeat === null || nearestBeat === at,
          onSelect: () => {
            endGesture();
            onAnimation(moveKeys(animation, [index], (nearestBeat ?? at) - at, fps, frames - 1));
          },
        },
        {
          label: 'Delete',
          shortcut: 'Del',
          onSelect: () => {
            endGesture();
            const remove = new Set(targetFrames);
            const keysLeft = animation.keys.filter((key) => !remove.has(timeFrame(key.t, fps)));
            onAnimation(
              keysLeft.length || animation.modulators?.length
                ? { ...animation, keys: keysLeft }
                : null,
            );
            onKeySelection(null);
          },
        },
      ],
    });
  };

  return (
    <div
      className={`track-lane key-lane${selected ? ' selected' : ''}`}
      style={{ height, ['--lane-color' as string]: color }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest('.lane-key')) return;
        onKeySelection(null);
        onSeekLane(event, event.currentTarget);
      }}
      onDoubleClick={(event) => {
        if (disabled || (event.target as Element).closest('.lane-key')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const at = Math.max(
          0,
          Math.min(frames - 1, Math.round(xToFrame(event.clientX - bounds.left, view))),
        );
        const t = frameTime(at, fps);
        const value = evaluateKeys(animation.keys, t, parameter) ?? base;
        endGesture();
        onAnimation(upsertKey(animation, t, value, fps));
      }}
    >
      <span className="key-lane-line" />
      {curve && (
        <svg className="key-lane-curve" width={laneWidth} height={height} aria-hidden="true">
          {selected && curve.keyed && (
            <>
              <polygon
                className="curve-fill"
                points={`${curve.keyed.split(' ')[0]!.split(',')[0]},${height} ${curve.keyed} ${curve.keyed.split(' ').at(-1)!.split(',')[0]},${height}`}
              />
              <polyline className="curve-line" points={curve.keyed} />
            </>
          )}
          {curve.live && (
            <polyline
              className={`curve-live${modulated ? ' modulated' : ''}`}
              style={{ stroke: liveColor }}
              points={curve.live}
            />
          )}
        </svg>
      )}
      {keys.map(({ key, index, at }) => (
        <button
          key={`${index}:${key.t}`}
          className={`lane-key${selectedFrames.has(at) ? ' selected' : ''}${at === frame ? ' at-playhead' : ''}`}
          style={{ left: frameToX(at, view) }}
          aria-label={`${parameter.label} keyframe at ${formatTimecode(at, fps)}, ${formatParameterValue(parameter, key.value)}, ${EASE_LABELS[key.interpolation]}`}
          title={`${formatTimecode(at, fps)} · ${formatParameterValue(parameter, key.value)} · ${EASE_LABELS[key.interpolation]}`}
          disabled={disabled}
          onPointerDown={(event) => startDrag(event, at)}
          onContextMenu={(event) => keyMenu(event, index, at)}
        />
      ))}
    </div>
  );
}
