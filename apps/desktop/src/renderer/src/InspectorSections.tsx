import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { readSectionState, SECTION_STATE_KEY } from './inspector-layout';

const SectionContext = createContext<{
  collapsed: Record<string, boolean>;
  toggle(id: string): void;
  all(value: boolean): void;
  register(id: string): () => void;
} | null>(null);

export function InspectorSections({
  children,
  endGesture,
}: {
  children: ReactNode;
  endGesture(): void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return readSectionState(localStorage.getItem(SECTION_STATE_KEY));
    } catch {
      return {};
    }
  });
  const mounted = useRef(new Map<string, number>());
  const register = useCallback((id: string) => {
    mounted.current.set(id, (mounted.current.get(id) ?? 0) + 1);
    return () => {
      const count = (mounted.current.get(id) ?? 1) - 1;
      if (count) mounted.current.set(id, count);
      else mounted.current.delete(id);
    };
  }, []);
  const toggle = useCallback(
    (id: string) => {
      endGesture();
      setCollapsed((previous) => ({ ...previous, [id]: !previous[id] }));
    },
    [endGesture],
  );
  const all = useCallback(
    (value: boolean) => {
      endGesture();
      setCollapsed((previous) => ({
        ...previous,
        ...Object.fromEntries([...mounted.current.keys()].map((id) => [id, value])),
      }));
    },
    [endGesture],
  );
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(collapsed));
    } catch {
      /* Session layout still works without storage. */
    }
  }, [collapsed]);
  const context = useMemo(
    () => ({ collapsed, toggle, all, register }),
    [collapsed, toggle, all, register],
  );
  return <SectionContext.Provider value={context}>{children}</SectionContext.Provider>;
}

export function InspectorSectionActions() {
  const context = useContext(SectionContext)!;
  return (
    <div className="inspector-section-actions" aria-label="Control section visibility">
      <button onClick={() => context.all(false)} title="Open all sections in the right panel.">
        Open All
      </button>
      <button onClick={() => context.all(true)} title="Collapse all sections in the right panel.">
        Collapse All
      </button>
    </div>
  );
}

export function InspectorSection({
  sectionId,
  title,
  help,
  children,
  className = '',
  headingClassName = '',
}: {
  sectionId: string;
  title: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  headingClassName?: string;
}) {
  const context = useContext(SectionContext);
  const register = context?.register;
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = context ? context.collapsed[sectionId] === true : localCollapsed;
  const id = useId();
  useEffect(() => register?.(sectionId), [register, sectionId]);
  return (
    <section
      className={`control-section collapsible-section ${className}`}
      aria-label={title}
      data-section-id={sectionId}
    >
      <h3 className={`collapsible-section-heading ${headingClassName}`}>
        <button
          className="section-toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={() => (context ? context.toggle(sectionId) : setLocalCollapsed(!localCollapsed))}
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d={collapsed ? 'm6 3 5 5-5 5' : 'm3 6 5 5 5-5'} />
          </svg>
          {title}
        </button>
        {help}
      </h3>
      <div className="section-content" id={id} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
