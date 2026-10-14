import { useRef, useState } from 'react';

function hexColor(text: string): string | null {
  const hex = text.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[\da-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((digit) => digit + digit)
      .join('')
      .toLowerCase()}`;
  return null;
}

interface Props {
  label: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  beginGesture(): void;
  endGesture(): void;
}

export function ColorControl({
  label,
  value,
  disabled,
  onChange,
  beginGesture,
  endGesture,
}: Props) {
  const [edit, setEdit] = useState<{ value: string; text: string } | null>(null);
  const original = useRef(value);
  const cancelled = useRef(false);
  const text = edit?.value === value ? edit.text : value.toUpperCase();
  return (
    <div className="color-control">
      <input
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onFocus={beginGesture}
        onBlur={endGesture}
        onChange={(event) => {
          setEdit(null);
          onChange(event.target.value);
        }}
      />
      <input
        className="color-hex"
        type="text"
        aria-label={`${label} hex`}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={text}
        aria-invalid={hexColor(text) === null}
        title="Type or paste a 3- or 6-digit hex color, with or without #. Valid 6-digit colors update live; Enter or leaving the field also accepts shorthand."
        onFocus={() => {
          cancelled.current = false;
          original.current = value;
          beginGesture();
        }}
        onChange={(event) => {
          const draft = event.target.value;
          const color = /^[\da-f]{6}$/i.test(draft.trim().replace(/^#/, ''))
            ? hexColor(draft)
            : null;
          setEdit({ value: color ?? value, text: draft });
          if (color && !cancelled.current) onChange(color);
        }}
        onBlur={() => {
          const color = hexColor(text);
          if (color && !cancelled.current) onChange(color);
          setEdit(null);
          endGesture();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            onChange(original.current);
            setEdit(null);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
