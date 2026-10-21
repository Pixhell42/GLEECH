import { useRef, useState } from 'react';
import { getEffectDefinition, isShaderEffect, type EffectInstance } from '@gleech/project-model';
import { MaskThumbnail } from './PaintedMaskControls';
import { ShaderName } from './ShaderName';
import { DiamondIcon, EyeIcon, MaskIcon } from './Icons';

interface Props {
  effects: readonly EffectInstance[];
  selectedId: string | undefined;
  disabled: boolean;
  onSelect(id: string): void;
  onToggle(id: string, enabled: boolean): void;
  onToggleLock(id: string, locked: boolean): void;
  onMove(id: string, index: number): void;
  onPaintMask(id: string): void;
  onToggleMask(id: string, enabled: boolean): void;
}

export function EffectStack({
  effects,
  selectedId,
  disabled,
  onSelect,
  onToggle,
  onToggleLock,
  onMove,
  onPaintMask,
  onToggleMask,
}: Props) {
  const dragged = useRef<string | null>(null);
  const dropSlot = useRef<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const displayed = [...effects].reverse();
  const reset = () => {
    dragged.current = null;
    dropSlot.current = null;
    setDragging(null);
    setTarget(null);
  };
  function insertionAt(container: HTMLElement, y: number) {
    const rows = [...container.querySelectorAll<HTMLElement>('.effect-row')];
    const index = rows.findIndex((row) => {
      const bounds = row.getBoundingClientRect();
      return y < bounds.top + bounds.height / 2;
    });
    return index < 0 ? rows.length : index;
  }
  function move(id: string, index: number) {
    onMove(id, index);
    onSelect(id);
    setAnnouncement(
      `${getEffectDefinition(effects.find((effect) => effect.instanceId === id)!).title} moved to position ${effects.length - index}.`,
    );
  }
  return (
    <div
      className="effect-drop-zone"
      onDragOver={(event) => {
        if (disabled || !dragged.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const insertion = insertionAt(event.currentTarget, event.clientY);
        dropSlot.current = insertion;
        setTarget(insertion);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        dropSlot.current = null;
        setTarget(null);
      }}
      onDrop={(event) => {
        if (disabled || !dragged.current) return;
        event.preventDefault();
        const id = dragged.current;
        const from = displayed.findIndex((candidate) => candidate.instanceId === id);
        // Commit the slot that drew the marker, including tile gaps and the
        // padded space at either end. Removing the source shifts later slots.
        const insertion = dropSlot.current ?? insertionAt(event.currentTarget, event.clientY);
        const next = insertion - (from < insertion ? 1 : 0);
        if (from >= 0 && next !== from) move(id, effects.length - 1 - next);
        reset();
      }}
    >
      <ol className="effect-list" aria-label="Effect stack">
        {displayed.map((effect, index) => {
          const title = getEffectDefinition(effect).title;
          const drop =
            target === index
              ? ' drop-before'
              : target === displayed.length && index === displayed.length - 1
                ? ' drop-after'
                : '';
          return (
            <li
              key={effect.instanceId}
              data-effect-id={effect.instanceId}
              data-settings-kind="effect"
              className={`effect-row${selectedId === effect.instanceId ? ' selected' : ''}${dragging === effect.instanceId ? ' dragging' : ''}${drop}`}
              draggable={!disabled}
              onDragStart={(event) => {
                if (
                  disabled ||
                  (event.target instanceof Element &&
                    event.target.closest(
                      'input, .effect-visibility, .effect-lock, .effect-mask-row',
                    ))
                ) {
                  event.preventDefault();
                  return;
                }
                dragged.current = effect.instanceId;
                dropSlot.current = null;
                setTarget(null);
                setDragging(effect.instanceId);
                onSelect(effect.instanceId);
                event.dataTransfer.setData('application/x-gleech-effect', effect.instanceId);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={reset}
            >
              <div className="effect-row-main">
                <button
                  className="effect-grip"
                  aria-label={`Reorder ${title} ${index + 1}`}
                  disabled={disabled}
                  title="Drag to reorder. Alt + Up/Down when focused."
                  onKeyDown={(event) => {
                    if (disabled || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
                      return;
                    event.preventDefault();
                    const next = index + (event.key === 'ArrowUp' ? -1 : 1);
                    if (next >= 0 && next < effects.length)
                      move(effect.instanceId, effects.length - 1 - next);
                  }}
                >
                  <svg viewBox="0 0 16 20" width="12" height="16" aria-hidden="true">
                    {[5, 10, 15].map((y) => (
                      <g key={y}>
                        <circle cx="5" cy={y} r="1" />
                        <circle cx="11" cy={y} r="1" />
                      </g>
                    ))}
                  </svg>
                </button>
                <button
                  className="effect-visibility"
                  aria-label={`Enable ${title} ${index + 1}`}
                  aria-pressed={effect.enabled}
                  title={effect.enabled ? `Hide ${title}` : `Show ${title}`}
                  disabled={disabled}
                  onClick={() => onToggle(effect.instanceId, !effect.enabled)}
                >
                  <EyeIcon open={effect.enabled} />
                </button>
                <button
                  className="effect-select"
                  aria-pressed={selectedId === effect.instanceId}
                  aria-description={isShaderEffect(effect) ? 'Shader effect' : undefined}
                  onClick={() => onSelect(effect.instanceId)}
                >
                  <ShaderName name={title} shader={isShaderEffect(effect)} />
                </button>
                {effect.animation && Object.keys(effect.animation).length > 0 && (
                  <span
                    className="effect-animation-badge"
                    title={`${Object.keys(effect.animation).length} animated`}
                  >
                    <DiamondIcon filled size={9} />
                    {Object.keys(effect.animation).length}
                  </span>
                )}
                <div className="effect-mask-row" draggable={false} data-settings-kind="mask">
                  <button
                    className={`paint-mask-button${effect.paintedMask ? ' has-mask' : ''}${effect.paintedMask && !effect.paintedMask.enabled ? ' mask-disabled' : ''}`}
                    aria-label="Mask"
                    aria-description={`Paint mask for ${title}`}
                    disabled={disabled}
                    onClick={(event) => {
                      if (event.altKey && effect.paintedMask)
                        onToggleMask(effect.instanceId, !effect.paintedMask.enabled);
                      else onPaintMask(effect.instanceId);
                    }}
                    title={`Paint where this effect applies. Alt-click toggles an existing mask.${effect.paintedMask && !effect.paintedMask.enabled ? ' Mask disabled.' : ''}`}
                  >
                    {effect.paintedMask ? (
                      <MaskThumbnail mask={effect.paintedMask} />
                    ) : (
                      <MaskIcon />
                    )}
                  </button>
                </div>
                <div className="effect-row-actions">
                  <button
                    className="effect-lock"
                    aria-label={`Lock ${title} ${index + 1}`}
                    aria-pressed={Boolean(effect.locked)}
                    title={
                      effect.locked
                        ? 'Locked: GLEECH and Var keep these settings, mask and pattern. Manual edits are allowed. Click to unlock.'
                        : 'Lock this effect to protect its settings, mask and pattern from GLEECH and Var.'
                    }
                    disabled={disabled}
                    onClick={() => onToggleLock(effect.instanceId, !effect.locked)}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="5" y="10" width="14" height="11" rx="2" />
                      <path
                        d={effect.locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'}
                      />
                      <path d="M12 14v3" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
