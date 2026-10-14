import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_MASK_FRAME,
  MAX_MASK_PATHS,
  maskFrameAffine,
  invertMaskAffine,
  transformMaskPoint,
  type PaintedMask,
  type MaskPath,
  type MaskNode,
  type MaskPoint,
} from '@gleech/project-model';

export type MaskTool = 'brush' | 'polygon' | 'curve' | 'edit';
export function VectorMaskSurface({
  mask,
  tool,
  width,
  height,
  disabled,
  opacity,
  feather,
  onDraft,
  onCommit,
  beginGesture,
  endGesture,
}: {
  mask: PaintedMask;
  tool: Exclude<MaskTool, 'brush'>;
  width: number;
  height: number;
  disabled: boolean;
  opacity: number;
  feather: number;
  onDraft(mask: PaintedMask | null): void;
  onCommit(mask: PaintedMask): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<MaskNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaintedMask | null>(null);
  const drag = useRef<{
    pointer: number;
    start: MaskPoint;
    mask: PaintedMask;
    path: string;
    node?: number | undefined;
    handle?: 'incoming' | 'outgoing' | undefined;
    newNode?: number;
  } | null>(null);
  const current = draft ?? mask;
  const matrix = maskFrameAffine(mask.frame ?? DEFAULT_MASK_FRAME, mask.width, mask.height);
  const inverse = invertMaskAffine(matrix);
  const point = (clientX: number, clientY: number) => {
    const rect = svg.current!.getBoundingClientRect();
    const local = transformMaskPoint(inverse, {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    });
    return { x: Math.max(-2, Math.min(3, local.x)), y: Math.max(-2, Math.min(3, local.y)) };
  };
  const display = (p: MaskPoint) => {
    const q = transformMaskPoint(matrix, p);
    return { x: q.x * width, y: q.y * height };
  };
  const pathData = (pathNodes: readonly MaskNode[], curve: boolean, closed: boolean) => {
    if (!pathNodes.length) return '';
    const a = display(pathNodes[0]!);
    let value = `M${a.x},${a.y}`;
    for (let i = 1; i < pathNodes.length + (closed ? 1 : 0); i++) {
      const previous = pathNodes[(i - 1) % pathNodes.length]!,
        node = pathNodes[i % pathNodes.length]!;
      const end = display(node);
      if (curve && (previous.outgoing || node.incoming)) {
        const c1 = display(previous.outgoing ?? previous),
          c2 = display(node.incoming ?? node);
        value += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
      } else value += ` L${end.x},${end.y}`;
    }
    return value + (closed ? ' Z' : '');
  };
  const commitPath = () => {
    if (disabled || nodes.length < 3 || (mask.paths?.length ?? 0) >= MAX_MASK_PATHS) return;
    const path: MaskPath = {
      id: crypto.randomUUID(),
      kind: tool === 'curve' ? 'curve' : 'polygon',
      nodes,
      mode: 'paint',
      opacity,
      feather,
    };
    onCommit({ ...mask, paths: [...(mask.paths ?? []), path] });
    setSelected(path.id);
    setNodes([]);
  };
  const update = (next: PaintedMask) => {
    setDraft(next);
    onDraft(next);
  };
  const startDrag = (
    e: React.PointerEvent<SVGElement>,
    path: string,
    node?: number,
    handle?: 'incoming' | 'outgoing',
  ) => {
    if (disabled || e.button !== 0 || tool !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(path);
    drag.current = {
      pointer: e.pointerId,
      start: point(e.clientX, e.clientY),
      mask,
      path,
      node,
      handle,
    };
    svg.current!.setPointerCapture(e.pointerId);
    svg.current!.focus();
  };
  const selectedPath = current.paths?.find((p) => p.id === selected);
  const editSelected = (patch: Partial<MaskPath>) => {
    onCommit({
      ...mask,
      paths: (mask.paths ?? []).map((p) => (p.id === selected ? { ...p, ...patch } : p)),
    });
  };
  return (
    <div className="vector-mask-editor">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="application"
        aria-label="Edit mask shapes"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitPath();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            drag.current = null;
            setNodes([]);
            setDraft(null);
            onDraft(null);
          }
          if ((e.key === 'Delete' || e.key === 'Backspace') && selected && tool === 'edit') {
            e.preventDefault();
            onCommit({ ...mask, paths: (mask.paths ?? []).filter((p) => p.id !== selected) });
            setSelected(null);
          }
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0 || tool === 'edit') return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.focus();
          const p = point(e.clientX, e.clientY);
          const first = nodes[0];
          if (first && nodes.length >= 3) {
            const a = display(first),
              b = display(p);
            if (Math.hypot(a.x - b.x, a.y - b.y) < Math.min(width, height) * 0.025) {
              commitPath();
              return;
            }
          }
          if (nodes.length >= 256) return;
          setNodes([...nodes, p]);
          drag.current = { pointer: e.pointerId, start: p, mask, path: '', newNode: nodes.length };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const active = drag.current;
          if (!active || active.pointer !== e.pointerId || disabled) return;
          e.stopPropagation();
          const p = point(e.clientX, e.clientY);
          if (active.newNode !== undefined) {
            if (tool === 'curve')
              setNodes((previous) =>
                previous.map((node, i) =>
                  i === active.newNode
                    ? {
                        ...node,
                        outgoing: p,
                        incoming: {
                          x: Math.max(-2, Math.min(3, 2 * node.x - p.x)),
                          y: Math.max(-2, Math.min(3, 2 * node.y - p.y)),
                        },
                      }
                    : node,
                ),
              );
            return;
          }
          const dx = p.x - active.start.x,
            dy = p.y - active.start.y;
          const shift = (q: MaskPoint) => ({
            x: Math.max(-2, Math.min(3, q.x + dx)),
            y: Math.max(-2, Math.min(3, q.y + dy)),
          });
          update({
            ...active.mask,
            paths: (active.mask.paths ?? []).map((path) =>
              path.id !== active.path
                ? path
                : {
                    ...path,
                    nodes: path.nodes.map((node, i) => {
                      if (active.node !== undefined && active.node !== i) return node;
                      if (active.handle) return { ...node, [active.handle]: p };
                      return {
                        ...shift(node),
                        ...(node.incoming ? { incoming: shift(node.incoming) } : {}),
                        ...(node.outgoing ? { outgoing: shift(node.outgoing) } : {}),
                      };
                    }),
                  },
            ),
          });
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointer !== e.pointerId) return;
          e.stopPropagation();
          drag.current = null;
          if (draft) onCommit(draft);
          setDraft(null);
          onDraft(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
          onDraft(null);
        }}
      >
        {(current.paths ?? []).map((path) => (
          <g key={path.id}>
            <path
              className="mask-vector-path"
              data-selected={path.id === selected}
              d={pathData(path.nodes, path.kind === 'curve', true)}
              onPointerDown={(e) => startDrag(e, path.id)}
              vectorEffect="non-scaling-stroke"
            />
            {tool === 'edit' &&
              path.id === selected &&
              path.nodes.map((node, i) => {
                const p = display(node);
                const radius = Math.min(width, height) * 0.012;
                return (
                  <g key={i}>
                    {(['incoming', 'outgoing'] as const).map((handle) => {
                      const value = node[handle];
                      if (!value) return null;
                      const q = display(value);
                      return (
                        <g key={handle}>
                          <line
                            x1={p.x}
                            y1={p.y}
                            x2={q.x}
                            y2={q.y}
                            className="mask-vector-handle"
                            vectorEffect="non-scaling-stroke"
                          />
                          <circle
                            cx={q.x}
                            cy={q.y}
                            r={radius * 0.8}
                            className="mask-vector-node"
                            aria-label={`Curve handle ${i + 1} ${handle}`}
                            onPointerDown={(e) => startDrag(e, path.id, i, handle)}
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      );
                    })}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={radius}
                      className="mask-vector-node"
                      aria-label={`Mask point ${i + 1}`}
                      onPointerDown={(e) => startDrag(e, path.id, i)}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
          </g>
        ))}
        {nodes.length > 0 && (
          <g>
            <path
              className="mask-vector-path"
              data-selected="true"
              d={pathData(nodes, tool === 'curve', false)}
              vectorEffect="non-scaling-stroke"
            />
            {nodes.map((node, i) => {
              const p = display(node);
              return (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={Math.min(width, height) * 0.012}
                  className="mask-vector-node"
                />
              );
            })}
          </g>
        )}
      </svg>
      {document.getElementById('mask-shape-tools') &&
        createPortal(
          <div
            className="mask-shape-toolbar"
            onPointerDownCapture={(e) => {
              if (e.target instanceof HTMLInputElement && e.target.type === 'range') beginGesture();
            }}
            onPointerUpCapture={endGesture}
            onPointerCancelCapture={endGesture}
            onKeyDownCapture={(e) => {
              if (
                e.target instanceof HTMLInputElement &&
                e.target.type === 'range' &&
                [
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowUp',
                  'ArrowDown',
                  'Home',
                  'End',
                  'PageUp',
                  'PageDown',
                ].includes(e.key)
              )
                beginGesture();
            }}
            onKeyUpCapture={endGesture}
            onBlurCapture={endGesture}
          >
            {tool !== 'edit' ? (
              <>
                <span>
                  Click points{tool === 'curve' ? ' · drag for curves' : ''} · Enter to close
                </span>
                <button disabled={nodes.length < 3 || disabled} onClick={commitPath}>
                  Finish shape
                </button>
                <button disabled={!nodes.length} onClick={() => setNodes([])}>
                  Cancel shape
                </button>
              </>
            ) : (
              <>
                <label>
                  Shape{' '}
                  <select
                    aria-label="Selected mask shape"
                    value={selected ?? ''}
                    onChange={(e) => setSelected(e.target.value || null)}
                  >
                    <option value="">Choose a shape</option>
                    {(mask.paths ?? []).map((p, i) => (
                      <option key={p.id} value={p.id}>
                        {p.kind === 'curve' ? 'Curve' : 'Polygon'} {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedPath && (
                  <>
                    <label>
                      Feather{' '}
                      <input
                        aria-label="Selected shape feather"
                        type="range"
                        min={0}
                        max={20}
                        step={0.1}
                        value={selectedPath.feather}
                        disabled={disabled}
                        onChange={(e) => editSelected({ feather: e.target.valueAsNumber })}
                      />
                    </label>
                    <label>
                      Opacity{' '}
                      <input
                        aria-label="Selected shape opacity"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={selectedPath.opacity}
                        disabled={disabled}
                        onChange={(e) => editSelected({ opacity: e.target.valueAsNumber })}
                      />
                    </label>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        editSelected({ mode: selectedPath.mode === 'paint' ? 'erase' : 'paint' })
                      }
                      aria-pressed={selectedPath.mode === 'erase'}
                    >
                      Cut hole
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => {
                        onCommit({
                          ...mask,
                          paths: (mask.paths ?? []).filter((p) => p.id !== selected),
                        });
                        setSelected(null);
                      }}
                    >
                      Delete shape
                    </button>
                  </>
                )}
              </>
            )}
          </div>,
          document.getElementById('mask-shape-tools')!,
        )}
    </div>
  );
}
