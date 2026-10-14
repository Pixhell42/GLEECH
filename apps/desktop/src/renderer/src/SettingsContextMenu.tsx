import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function SettingsContextMenu({
  x,
  y,
  canCopy,
  duplicate,
  reset,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  canCopy: boolean;
  duplicate: boolean;
  reset: boolean;
  onAction(action: 'copy' | 'paste' | 'duplicate' | 'reset'): void;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    const original = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element
      .querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true });
    const close = (event: Event) => {
      if (!element.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    const positions = new Map(
      [...document.querySelectorAll('*')].map(
        (node) => [node, [node.scrollLeft, node.scrollTop]] as const,
      ),
    );
    const scroll = (e: Event) => {
      if (element.contains(e.target as Node)) return;
      const node = e.target instanceof Element ? e.target : document.documentElement;
      const previous = positions.get(node);
      // Right-click can queue an already completed scroll-to-field notification.
      if (!previous || node.scrollLeft !== previous[0] || node.scrollTop !== previous[1]) onClose();
    };
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', scroll, true);
      // A pointer dismissal may focus another control; do not take that focus back.
      if (element.contains(document.activeElement)) original?.focus({ preventScroll: true });
    };
  }, [x, y, onClose]);
  return createPortal(
    <div
      ref={menu}
      className="settings-context-menu"
      role="menu"
      aria-label="Copy and paste settings"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          onClose();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus({ preventScroll: true });
        }
      }}
    >
      <button role="menuitem" disabled={!canCopy} onClick={() => onAction('copy')}>
        Copy
      </button>
      <button role="menuitem" onClick={() => onAction('paste')}>
        Paste
      </button>
      {duplicate && (
        <button role="menuitem" onClick={() => onAction('duplicate')}>
          Duplicate
        </button>
      )}
      {reset && (
        <button role="menuitem" onClick={() => onAction('reset')}>
          Reset
        </button>
      )}
    </div>,
    document.querySelector('dialog[open]') ?? document.body,
  );
}
