import { useEffect, useRef, useState } from 'react';
import type { GleechComplexity, GleechMode } from '@gleech/command-service';

const levels: readonly { value: GleechComplexity; label: string; detail: string }[] = [
  { value: 'simple', label: 'Simple', detail: 'A few effects with lighter changes.' },
  { value: 'complex', label: 'Complex', detail: 'More effects and stronger variation.' },
  {
    value: 'gleeched',
    label: 'GLEECHED',
    detail: 'A large stack with bold, unpredictable changes.',
  },
];
const modes: readonly { value: GleechMode; label: string; detail: string; summary?: string }[] = [
  {
    value: 'replace-all',
    label: 'Replace All',
    detail:
      'Replace every effect, including locked effects, with a new randomized stack. Undo restores the original.',
  },
  {
    value: 'keep-locked',
    label: 'Keep Locked Only',
    detail:
      'Keep locked effects untouched. Unlocked effects may be modified, removed, replaced or added.',
  },
  {
    value: 'keep-all-add',
    label: 'Preserve All and Add',
    summary: 'Keep all effects and settings unchanged. Add new randomized effects above the stack.',
    detail:
      'Keep every current effect, its settings and stack position unchanged. Add new randomized effects above the stack. The chosen complexity controls how many are added. Undo removes the additions.',
  },
  {
    value: 'randomize-add',
    label: 'Randomize and Add',
    summary:
      'Randomize unlocked effects, keep locked effects intact, then add new randomized effects above the stack.',
    detail:
      'Randomize the settings and patterns of existing unlocked effects, keeping every effect and its stack position. Locked effects remain untouched. Add new randomized effects above the stack based on the chosen complexity. Undo restores the original stack.',
  },
  {
    value: 'existing-only',
    label: 'Use Existing Only',
    detail:
      'Randomize settings and patterns of existing unlocked effects. Keep every effect and its stack position.',
  },
];
export function GleechDialog({
  hasEffects,
  lockedCount,
  onApply,
  onClose,
}: {
  hasEffects: boolean;
  lockedCount: number;
  onApply(complexity: GleechComplexity, mode: GleechMode): void;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [complexity, setComplexity] = useState<GleechComplexity | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = modal.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog gleech-dialog"
      aria-labelledby="gleech-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="random-dialog-heading">
        <h2 id="gleech-title">GLEECH</h2>
        <button onClick={onClose} aria-label="Close GLEECH">
          ✕
        </button>
      </div>
      <p>
        {complexity ? 'Choose how to use your current stack.' : 'How far do you want to take it?'}
      </p>
      <div className={`gleech-options${complexity ? ' gleech-mode-options' : ''}`}>
        {(complexity ? modes : levels).map((option) => (
          <button
            key={option.value}
            title={option.detail}
            onClick={() => {
              if (complexity) onApply(complexity, option.value as GleechMode);
              else if (hasEffects) setComplexity(option.value as GleechComplexity);
              else onApply(option.value as GleechComplexity, 'replace-all');
            }}
          >
            <strong>{option.label}</strong>
            <span>{'summary' in option ? (option.summary ?? option.detail) : option.detail}</span>
          </button>
        ))}
      </div>
      {complexity && (
        <div className="stage-dialog-actions">
          <span className="quiet">
            {lockedCount} locked · {levels.find((x) => x.value === complexity)!.label}
          </span>
          <button onClick={() => setComplexity(null)}>Back</button>
        </div>
      )}
    </dialog>
  );
}
