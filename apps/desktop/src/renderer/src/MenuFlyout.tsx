import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const FlyoutContext = createContext<{
  active: string | null;
  setActive(id: string | null): void;
} | null>(null);

export function MenuFlyoutProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <FlyoutContext.Provider value={{ active, setActive }}>{children}</FlyoutContext.Provider>;
}

export function MenuFlyout({
  label,
  children,
  menu = false,
  className = '',
  popupLabel = label,
}: {
  label: string;
  children: ReactNode;
  menu?: boolean;
  className?: string;
  popupLabel?: string;
}) {
  const context = useContext(FlyoutContext);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFirst = useRef(false);
  const [localActive, setLocalActive] = useState<string | null>(null);
  const active = context?.active ?? localActive;
  const setActive = context?.setActive ?? setLocalActive;
  const expanded = active === id;
  const cancelClose = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const close = (focus = false) => {
    cancelClose();
    if (expanded) setActive(null);
    if (focus) trigger.current?.focus();
  };
  const show = (focus = false) => {
    cancelClose();
    focusFirst.current = focus;
    if (expanded && focus)
      popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    setActive(id);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const panel = popup.current!;
    if (!expanded) {
      if (timer.current) clearTimeout(timer.current);
      panel.hidePopover();
      return;
    }
    panel.showPopover();
    const position = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      const left =
        anchor.right + 6 + bounds.width <= innerWidth - 12
          ? anchor.right + 6
          : anchor.left - bounds.width - 6;
      panel.style.left = `${Math.max(12, Math.min(left, innerWidth - bounds.width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(anchor.top, innerHeight - bounds.height - 12))}px`;
    };
    position();
    if (focusFirst.current) {
      const first = panel.querySelector<HTMLButtonElement>('button:not(:disabled)');
      first?.focus();
      focusFirst.current = !first;
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) position();
    };
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', scroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [expanded, children]);
  return (
    <div
      className={`file-menu-flyout ${className}`}
      onPointerEnter={cancelClose}
      onPointerLeave={() => {
        cancelClose();
        timer.current = setTimeout(() => {
          if (!popup.current?.contains(document.activeElement)) close();
        }, 220);
      }}
      onKeyDown={(event) => {
        if (expanded && ['Escape', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        } else if (
          event.target === trigger.current &&
          ['ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          show(true);
        } else if (expanded && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const buttons = [
            ...popup.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={expanded}
        aria-controls={id}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') show();
        }}
        onClick={() => show(true)}
      >
        {label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
      <div
        ref={popup}
        id={id}
        popover="manual"
        className={`file-menu-popup ${menu ? 'recent-projects-flyout' : ''}`}
        role={menu ? 'menu' : 'group'}
        aria-label={popupLabel}
      >
        {children}
      </div>
    </div>
  );
}
