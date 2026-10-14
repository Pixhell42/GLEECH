import { useEffect, useRef, useState } from 'react';

export function ProjectName({
  name,
  dirty,
  disabled,
  onRename,
}: {
  name: string;
  dirty: boolean;
  disabled: boolean;
  onRename(name: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const canceled = useRef(false);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const finish = () => {
    if (!canceled.current && value.trim()) onRename(value.trim());
    setEditing(false);
  };
  return editing ? (
    <input
      ref={input}
      className="project-name-input"
      aria-label="Project name"
      maxLength={120}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        }
        if (event.key === 'Escape') {
          canceled.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      className="project-name"
      aria-label="Rename project"
      title="Click to rename project"
      disabled={disabled}
      onClick={() => {
        canceled.current = false;
        setValue(name.replace(/\.gleech$/i, '').slice(0, 120));
        setEditing(true);
      }}
    >
      {dirty ? '• ' : ''}
      {name}
    </button>
  );
}
