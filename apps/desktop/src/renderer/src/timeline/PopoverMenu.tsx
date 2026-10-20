import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  readonly label: string;
  readonly onSelect?: () => void;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** A non-interactive section label. */
  readonly heading?: boolean;
  readonly separator?: boolean;
  readonly shortcut?: string;
  readonly title?: string;
}

/** A small keyboard-navigable menu at a screen point (context menus and pop-ups). */
export function PopoverMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: readonly MenuItem[];
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    const original = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (
      element.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') ??
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')
    )?.focus({ preventScroll: true });
    const close = (event: Event) => {
      if (!element.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      if (element.contains(document.activeElement)) original?.focus({ preventScroll: true });
    };
  }, [x, y, onClose]);
  return createPortal(
    <div
      ref={menu}
      className="settings-context-menu timeline-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          onClose();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus({ preventScroll: true });
        }
      }}
    >
      {items.map((item, index) =>
        item.separator ? (
          <hr key={index} />
        ) : item.heading ? (
          <div key={index} className="timeline-menu-heading" role="presentation">
            {item.label}
          </div>
        ) : (
          <button
            key={index}
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            <span className="timeline-menu-check" aria-hidden="true">
              {item.checked && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m5 12.5 4.5 4.5L19 7"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {item.label}
            {item.shortcut && <span className="timeline-menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.querySelector('dialog[open]') ?? document.body,
  );
}
