import { useId } from 'react';

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-icon"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        i
      </button>
      <span id={id} role="tooltip" className="info-tooltip-copy">
        {text}
      </span>
    </span>
  );
}
