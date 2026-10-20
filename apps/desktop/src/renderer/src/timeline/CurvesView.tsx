import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  animationDefinition,
  defaultHandles,
  evaluateKeys,
  evaluateParameter,
  frameCount,
  getEffectDefinition,
  INTERPOLATIONS,
  moveKeys,
  parameterBaseValue,
  roundParameter,
  setKeysInterpolation,
  timeFrame,
  type EffectInstance,
  type Keyframe,
  type ModulationContext,
  type ParameterAnimation,
  type ProjectState,
  type Timeline,
} from '@gleech/project-model';
import { EASE_LABELS, SIGNAL_COLORS, curveColor } from '../animation-ui';
import { formatParameterValue, normalizedValue } from '../animation-format';
import { ChevronIcon, EyeIcon } from '../Icons';
import { trackPointer } from './pointer';
import { PopoverMenu, type MenuItem } from './PopoverMenu';
import { TRACK_HEADER_WIDTH, frameToX, shortTime, xToFrame, type LaneView } from './timeline-math';
import type { SelectedParameter } from './TimelineDock';

interface CurveEntry {
  readonly effect: EffectInstance;
  readonly key: string;
  readonly animation: ParameterAnimation;
  readonly parameter: NonNullable<ReturnType<typeof animationDefinition>>;
  readonly color: string;
}

const GRAPH_PAD = 18;

/** Every animated parameter on one graph, normalized to 0–100% of its range. */
export function CurvesView({
  project,
  timeline,
  frame,
  view,
  laneWidth,
  modulation,
  selectedEffectId,
  selectedParam,
  disabled,
  tracksRef,
  snapTo,
  onSeek,
  onSelectParam,
  onAnimation,
  beginGesture,
  endGesture,
  ruler,
}: {
  project: ProjectState;
  timeline: Timeline;
  frame: number;
  view: LaneView;
  laneWidth: number;
  modulation: ModulationContext;
  selectedEffectId: string | undefined;
  selectedParam: SelectedParameter | null;
  disabled: boolean;
  tracksRef: RefObject<HTMLDivElement | null>;
  snapTo(frame: number, exclude?: ReadonlySet<number>): { frame: number; snapped: boolean };
  onSeek(frame: number): void;
  onSelectParam(parameter: SelectedParameter | null): void;
  onAnimation(effectId: string, key: string, animation: ParameterAnimation | null): void;
  beginGesture(): void;
  endGesture(): void;
  ruler: ReactNode;
}) {
  const fps = timeline.fps;
  const lastFrame = frameCount(timeline) - 1;
  const [filter, setFilter] = useState<'selected' | 'all'>('selected');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<{ id: string; index: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: readonly MenuItem[] } | null>(
    null,
  );
  const [graphHeight, setGraphHeight] = useState(240);
  const graph = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = graph.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setGraphHeight(Math.max(120, element.clientHeight)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo(() => {
    let colorIndex = 0;
    return [...project.effects]
      .reverse()
      .filter((effect) => filter === 'all' || effect.instanceId === selectedEffectId)
      .map((effect) => ({
        effect,
        entries: Object.entries(effect.animation ?? {}).flatMap(([key, animation]) => {
          const parameter = animationDefinition(effect, key);
          return parameter
            ? [{ effect, key, animation, parameter, color: curveColor(colorIndex++) } as CurveEntry]
            : [];
        }),
      }));
  }, [project.effects, filter, selectedEffectId]);
  const entries = groups.flatMap((group) =>
    collapsed.has(group.effect.instanceId) ? [] : group.entries,
  );
  const visibleEntries = entries.filter(
    (entry) => !hidden.has(`${entry.effect.instanceId}:${entry.key}`),
  );

  const y = (normalized: number) => GRAPH_PAD + (1 - normalized) * (graphHeight - GRAPH_PAD * 2);
  const valueAtY = (pixel: number) =>
    Math.min(1, Math.max(0, 1 - (pixel - GRAPH_PAD) / (graphHeight - GRAPH_PAD * 2)));

  const paths = useMemo(() => {
    return visibleEntries.map((entry) => {
      const base = parameterBaseValue(entry.effect, entry.key);
      const keyed: string[] = [];
      const live: string[] = [];
      const modulated = Boolean(entry.animation.modulators?.some((modulator) => modulator.enabled));
      for (let x = 0; x <= laneWidth; x += 3) {
        const at = xToFrame(x, view);
        if (at < 0) continue;
        const t = at / fps;
        if (entry.animation.keys.length) {
          const value = evaluateKeys(entry.animation.keys, t, entry.parameter) ?? base;
          keyed.push(`${x},${y(normalizedValue(entry.parameter, value)).toFixed(1)}`);
        }
        if (modulated) {
          const value = evaluateParameter(entry.animation, base, t, entry.parameter, modulation);
          live.push(`${x},${y(normalizedValue(entry.parameter, value)).toFixed(1)}`);
        }
      }
      return { entry, keyed: keyed.join(' '), live: live.join(' ') };
    });
    // y depends on graphHeight.
  }, [visibleEntries, laneWidth, view, fps, modulation, graphHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  const entryId = (entry: CurveEntry) => `${entry.effect.instanceId}:${entry.key}`;
  const selectedEntry = selectedKey
    ? visibleEntries.find((entry) => entryId(entry) === selectedKey.id)
    : undefined;

  const replaceKey = (animation: ParameterAnimation, index: number, key: Keyframe) => {
    const keys = [...animation.keys];
    keys[index] = key;
    return { ...animation, keys };
  };

  const dragKey = (event: React.PointerEvent<SVGElement>, entry: CurveEntry, index: number) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedKey({ id: entryId(entry), index });
    onSelectParam({ effectId: entry.effect.instanceId, key: entry.key });
    const svg = event.currentTarget.ownerSVGElement!;
    const bounds = svg.getBoundingClientRect();
    const origin = entry.animation;
    const key = origin.keys[index]!;
    const at = timeFrame(key.t, fps);
    const startX = event.clientX;
    const startY = event.clientY;
    const startValue = normalizedValue(entry.parameter, key.value);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let started = false;
    let currentIndex = index;
    const move = (moveEvent: PointerEvent) => {
      if (!started && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3)
        return;
      if (!started) {
        started = true;
        beginGesture();
      }
      const others = new Set(
        origin.keys.filter((_, i) => i !== index).map((k) => timeFrame(k.t, fps)),
      );
      const targetFrame = Math.min(
        lastFrame,
        Math.max(0, snapTo(xToFrame(moveEvent.clientX - bounds.left, view), new Set([at])).frame),
      );
      const nextFrame = others.has(targetFrame) ? at : targetFrame;
      let next: ParameterAnimation = moveKeys(origin, [index], nextFrame - at, fps, lastFrame);
      currentIndex = next.keys.findIndex((k) => timeFrame(k.t, fps) === nextFrame);
      if (entry.parameter.kind === 'number' && currentIndex >= 0) {
        // Relative to the grab point, so a sideways drag keeps the value.
        const normalized = Math.min(
          1,
          Math.max(0, startValue - (moveEvent.clientY - startY) / (graphHeight - GRAPH_PAD * 2)),
        );
        const value = roundParameter(
          entry.parameter.min + normalized * (entry.parameter.max - entry.parameter.min),
          entry.parameter,
        );
        next = replaceKey(next, currentIndex, { ...next.keys[currentIndex]!, value });
      }
      setSelectedKey({ id: entryId(entry), index: currentIndex });
      onAnimation(entry.effect.instanceId, entry.key, next);
    };
    const release = () => {
      if (started) endGesture();
      else onSeek(at);
    };
    trackPointer(event.pointerId, move, release);
  };

  const dragHandle = (
    event: React.PointerEvent<SVGElement>,
    entry: CurveEntry,
    index: number,
    side: 'in' | 'out',
  ) => {
    if (disabled || event.button !== 0 || entry.parameter.kind !== 'number') return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement!;
    const bounds = svg.getBoundingClientRect();
    const origin = entry.animation;
    const key = origin.keys[index]!;
    const neighbor = origin.keys[side === 'out' ? index + 1 : index - 1];
    if (!neighbor) return;
    const segment = Math.abs(neighbor.t - key.t);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    beginGesture();
    const keyNormalized = normalizedValue(entry.parameter, key.value);
    const move = (moveEvent: PointerEvent) => {
      const t = xToFrame(moveEvent.clientX - bounds.left, view) / fps;
      const dt =
        side === 'out'
          ? Math.min(segment, Math.max(0, t - key.t))
          : Math.max(-segment, Math.min(0, t - key.t));
      const dv = valueAtY(moveEvent.clientY - bounds.top) - keyNormalized;
      let next = origin;
      // Dragging a handle makes the segment it shapes a custom bezier.
      if (side === 'out') {
        next = replaceKey(next, index, {
          ...key,
          interpolation: 'bezier',
          outHandle: { dt, dv },
        });
      } else {
        const previous = next.keys[index - 1]!;
        next = replaceKey(next, index - 1, { ...previous, interpolation: 'bezier' });
        next = replaceKey(next, index, { ...next.keys[index]!, inHandle: { dt, dv } });
      }
      onAnimation(entry.effect.instanceId, entry.key, next);
    };
    const release = () => {
      endGesture();
    };
    trackPointer(event.pointerId, move, release);
  };

  const keyMenu = (event: React.MouseEvent, entry: CurveEntry, index: number) => {
    event.preventDefault();
    setSelectedKey({ id: entryId(entry), index });
    const key = entry.animation.keys[index]!;
    const at = timeFrame(key.t, fps);
    const beats = (timeline.audio?.analysis?.beats ?? []).map((beat) => timeFrame(beat, fps));
    const nearestBeat = beats.length
      ? beats.reduce((best, beat) => (Math.abs(beat - at) < Math.abs(best - at) ? beat : best))
      : null;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: 'Interpolation', heading: true },
        ...INTERPOLATIONS.map((option) => ({
          label: option.label,
          checked: key.interpolation === option.value,
          onSelect: () => {
            endGesture();
            let next = setKeysInterpolation(entry.animation, [index], option.value);
            const following = next.keys[index + 1];
            if (
              option.value === 'bezier' &&
              following &&
              entry.parameter.kind === 'number' &&
              !key.outHandle
            ) {
              const handles = defaultHandles(
                'ease-in-out',
                following.t - key.t,
                normalizedValue(entry.parameter, following.value) -
                  normalizedValue(entry.parameter, key.value),
              );
              next = replaceKey(next, index, {
                ...next.keys[index]!,
                outHandle: handles.outHandle,
              });
              next = replaceKey(next, index + 1, {
                ...next.keys[index + 1]!,
                inHandle: next.keys[index + 1]!.inHandle ?? handles.inHandle,
              });
            }
            onAnimation(entry.effect.instanceId, entry.key, next);
          },
        })),
        { label: '', separator: true },
        {
          label: 'Snap to nearest beat',
          disabled: nearestBeat === null || nearestBeat === at,
          onSelect: () => {
            endGesture();
            onAnimation(
              entry.effect.instanceId,
              entry.key,
              moveKeys(
                entry.animation,
                [index],
                Math.min(lastFrame, nearestBeat ?? at) - at,
                fps,
                lastFrame,
              ),
            );
          },
        },
        {
          label: 'Copy value',
          onSelect: () => void navigator.clipboard?.writeText(String(key.value)).catch(() => {}),
        },
        {
          label: 'Delete',
          onSelect: () => {
            endGesture();
            const keys = entry.animation.keys.filter((_, i) => i !== index);
            onAnimation(
              entry.effect.instanceId,
              entry.key,
              keys.length || entry.animation.modulators?.length
                ? { ...entry.animation, keys }
                : null,
            );
            setSelectedKey(null);
          },
        },
      ],
    });
  };

  const handlePoints = (entry: CurveEntry, index: number) => {
    if (entry.parameter.kind !== 'number') return [];
    const keys = entry.animation.keys;
    const key = keys[index]!;
    const points: { side: 'in' | 'out'; x: number; y: number }[] = [];
    const n = normalizedValue(entry.parameter, key.value);
    const next = keys[index + 1];
    if (next && key.interpolation === 'bezier') {
      const fallback = defaultHandles(
        'ease-in-out',
        next.t - key.t,
        normalizedValue(entry.parameter, next.value) - n,
      );
      const handle = key.outHandle ?? fallback.outHandle;
      points.push({
        side: 'out',
        x: frameToX((key.t + handle.dt) * fps, view),
        y: y(n + handle.dv),
      });
    }
    const previous = keys[index - 1];
    if (previous && previous.interpolation === 'bezier') {
      const fallback = defaultHandles(
        'ease-in-out',
        key.t - previous.t,
        n - normalizedValue(entry.parameter, previous.value),
      );
      const handle = key.inHandle ?? fallback.inHandle;
      points.push({
        side: 'in',
        x: frameToX((key.t + handle.dt) * fps, view),
        y: y(n + handle.dv),
      });
    }
    return points;
  };

  return (
    <div className="timeline-tracks curves-view" ref={tracksRef}>
      <div className="timeline-row ruler-row">
        <div className="track-header ruler-header">
          <span>Animated parameters</span>
          <div className="segmented small" role="group" aria-label="Parameter filter">
            {(['selected', 'all'] as const).map((option) => (
              <button
                key={option}
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {option === 'selected' ? 'Selected' : 'All'}
              </button>
            ))}
          </div>
        </div>
        {ruler}
      </div>
      <div className="curves-body">
        <div className="curves-list" style={{ width: TRACK_HEADER_WIDTH }}>
          {groups.map((group) => (
            <div key={group.effect.instanceId} className="curves-group">
              <button
                className="curves-group-heading"
                aria-expanded={!collapsed.has(group.effect.instanceId)}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.effect.instanceId)) next.delete(group.effect.instanceId);
                    else next.add(group.effect.instanceId);
                    return next;
                  })
                }
              >
                <ChevronIcon open={!collapsed.has(group.effect.instanceId)} />
                <span className="track-name">{getEffectDefinition(group.effect).title}</span>
                <span className="track-meta">{group.entries.length}</span>
              </button>
              {!collapsed.has(group.effect.instanceId) &&
                group.entries.map((entry) => {
                  const id = entryId(entry);
                  const modulators = (entry.animation.modulators ?? []).filter((m) => m.enabled);
                  const isSelected =
                    selectedParam?.effectId === entry.effect.instanceId &&
                    selectedParam.key === entry.key;
                  return (
                    <div key={id} className={`curves-item${isSelected ? ' selected' : ''}`}>
                      <span
                        className="curve-swatch"
                        style={{ background: entry.color }}
                        aria-hidden="true"
                      />
                      <button
                        className="track-name"
                        onClick={() =>
                          onSelectParam({ effectId: entry.effect.instanceId, key: entry.key })
                        }
                      >
                        {entry.parameter.label}
                      </button>
                      <span
                        className={`track-meta${modulators.some((m) => m.kind === 'audio') ? ' audio' : modulators.length ? ' lfo' : ''}`}
                      >
                        {modulators.length
                          ? modulators
                              .map((m) => (m.kind === 'audio' ? 'Audio' : 'LFO'))
                              .filter((value, i, all) => all.indexOf(value) === i)
                              .join(' + ')
                          : `${entry.animation.keys.length} keys · ${
                              entry.animation.keys[0]
                                ? EASE_LABELS[entry.animation.keys[0].interpolation]
                                : ''
                            }`}
                      </span>
                      <button
                        className="ib"
                        aria-label={`${hidden.has(id) ? 'Show' : 'Hide'} ${entry.parameter.label} curve`}
                        aria-pressed={!hidden.has(id)}
                        onClick={() =>
                          setHidden((previous) => {
                            const next = new Set(previous);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                      >
                        <EyeIcon open={!hidden.has(id)} />
                      </button>
                    </div>
                  );
                })}
            </div>
          ))}
          {!entries.length && (
            <p className="quiet curves-empty">
              {filter === 'selected'
                ? 'The selected effect has no animated parameters. Click a slider’s diamond to animate it.'
                : 'Nothing is animated yet.'}
            </p>
          )}
          <p className="curves-hint">
            Curves are shown normalized to each parameter&apos;s range. Dashed lines are live
            modulation (not editable keys).
          </p>
        </div>
        <div
          className="curves-graph"
          ref={graph}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              (event.target as Element).closest('.curve-key, .curve-handle')
            )
              return;
            setSelectedKey(null);
            const bounds = event.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, Math.round(xToFrame(event.clientX - bounds.left, view))));
          }}
        >
          <svg width={laneWidth} height={graphHeight} role="img" aria-label="Animation curves">
            {[1, 0.75, 0.5, 0.25, 0].map((level) => (
              <g key={level}>
                <line className="curves-grid" x1={0} x2={laneWidth} y1={y(level)} y2={y(level)} />
                {/* Right-aligned: most animations start with a key at 0:00 on the left. */}
                <text className="curves-axis" x={laneWidth - 4} y={y(level) - 3} textAnchor="end">
                  {Math.round(level * 100)}%
                </text>
              </g>
            ))}
            {timeline.workArea && (
              <rect
                className="curves-work-area"
                x={frameToX(timeline.workArea.start * fps, view)}
                width={(timeline.workArea.end - timeline.workArea.start) * fps * view.pxPerFrame}
                y={0}
                height={graphHeight}
              />
            )}
            {paths.map(({ entry, keyed, live }) => (
              <g key={entryId(entry)} style={{ color: entry.color }}>
                {live && (
                  <polyline
                    className="curve-live"
                    points={live}
                    stroke={
                      entry.animation.modulators?.some((m) => m.enabled && m.kind === 'audio')
                        ? SIGNAL_COLORS.audio
                        : SIGNAL_COLORS.lfo
                    }
                  />
                )}
                {keyed && <polyline className="curve-line" points={keyed} />}
                {entry.animation.keys.map((key, index) => {
                  const x = frameToX(key.t * fps, view);
                  if (x < -10 || x > laneWidth + 10) return null;
                  const ky = y(normalizedValue(entry.parameter, key.value));
                  const isSelected =
                    selectedKey?.id === entryId(entry) && selectedKey.index === index;
                  return (
                    <rect
                      key={`${index}:${key.t}`}
                      className={`curve-key${isSelected ? ' selected' : ''}`}
                      x={x - 5}
                      y={ky - 5}
                      width={10}
                      height={10}
                      transform={`rotate(45 ${x} ${ky})`}
                      role="button"
                      aria-label={`${entry.parameter.label} key at ${shortTime(key.t)}`}
                      onPointerDown={(event) => dragKey(event, entry, index)}
                      onContextMenu={(event) => keyMenu(event, entry, index)}
                    />
                  );
                })}
              </g>
            ))}
            {selectedEntry &&
              selectedKey &&
              selectedEntry.animation.keys[selectedKey.index] &&
              (() => {
                const key = selectedEntry.animation.keys[selectedKey.index]!;
                const x = frameToX(key.t * fps, view);
                const ky = y(normalizedValue(selectedEntry.parameter, key.value));
                return (
                  <g>
                    {handlePoints(selectedEntry, selectedKey.index).map((point) => (
                      <g key={point.side}>
                        <line
                          className="curve-handle-line"
                          x1={x}
                          y1={ky}
                          x2={point.x}
                          y2={point.y}
                        />
                        <circle
                          className="curve-handle"
                          cx={point.x}
                          cy={point.y}
                          r={4.5}
                          role="button"
                          aria-label={`${point.side === 'in' ? 'Incoming' : 'Outgoing'} bezier handle`}
                          onPointerDown={(event) =>
                            dragHandle(event, selectedEntry, selectedKey.index, point.side)
                          }
                        />
                      </g>
                    ))}
                    <foreignObject
                      x={Math.min(laneWidth - 120, x + 10)}
                      y={Math.max(0, ky - 30)}
                      width={120}
                      height={22}
                    >
                      <span className="curve-tooltip">
                        {shortTime(key.t).replace(/^0:/, '')} s ·{' '}
                        {formatParameterValue(selectedEntry.parameter, key.value)}
                      </span>
                    </foreignObject>
                  </g>
                );
              })()}
            <line
              className="curves-playhead"
              x1={frameToX(frame, view)}
              x2={frameToX(frame, view)}
              y1={0}
              y2={graphHeight}
            />
          </svg>
        </div>
      </div>
      {menu && (
        <PopoverMenu
          x={menu.x}
          y={menu.y}
          label="Keyframe"
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
