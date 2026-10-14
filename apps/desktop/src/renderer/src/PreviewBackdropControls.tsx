import { InfoTooltip } from './InfoTooltip';
import { ColorControl } from './ColorControl';
import type { PreviewBackdrop } from './preview-backdrop';
export function PreviewBackdropControls({
  value,
  onChange,
  disabled,
}: {
  value: PreviewBackdrop;
  onChange(value: PreviewBackdrop): void;
  disabled: boolean;
}) {
  return (
    <div className="effect-control">
      <span className="control-title">
        Preview backdrop{' '}
        <InfoTooltip
          label="Preview backdrop"
          text="Inspect transparency against a checkerboard, solid color, or the stage source with removed areas tinted pink. This changes only the preview, never exported pixels or the saved effect."
        />
      </span>
      <select
        aria-label="Preview backdrop"
        value={value.mode}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, mode: event.target.value as PreviewBackdrop['mode'] })
        }
      >
        <option value="checkerboard">Checkerboard</option>
        <option value="black">Black</option>
        <option value="white">White</option>
        <option value="overlay">Source overlay</option>
        <option value="custom">Custom Color</option>
      </select>
      {value.mode === 'custom' && (
        <ColorControl
          label="Backdrop color"
          value={value.color}
          disabled={disabled}
          onChange={(color) => onChange({ ...value, color })}
          beginGesture={() => {}}
          endGesture={() => {}}
        />
      )}
    </div>
  );
}
