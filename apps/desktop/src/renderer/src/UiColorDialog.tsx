import { useEffect, useRef } from 'react';
import { UI_COLORS, type UiColor } from './ui-color';

export function UiColorDialog({
  color,
  onChange,
  onClose,
}: {
  color: UiColor;
  onChange(color: UiColor): void;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog ui-color-dialog"
      aria-labelledby="ui-color-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="support-heading">
        <h2 id="ui-color-title">UI Color</h2>
        <button type="button" aria-label="Close UI Color" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="quiet">Choose an accent color. Your choice is saved for next time.</p>
      <div className="ui-color-grid" role="group" aria-label="UI accent colors">
        {UI_COLORS.map((item) => (
          <button
            type="button"
            key={item.value}
            title={item.name}
            aria-label={item.name}
            aria-pressed={item.value === color.value}
            onClick={() => onChange(item)}
          >
            <span
              className="ui-color-swatch"
              style={{ backgroundColor: item.value }}
              aria-hidden="true"
            >
              {item.value === color.value ? '✓' : ''}
            </span>
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <div className="ui-color-footer">
        <span className="quiet">{color.name}</span>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
