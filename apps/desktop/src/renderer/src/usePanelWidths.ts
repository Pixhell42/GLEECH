import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  fitPanelGrowth,
  PANEL_WIDTH_KEY,
  readPanelGrowth,
  type PanelGrowth,
} from './inspector-layout';

export function usePanelWidths() {
  const ref = useRef<HTMLDivElement>(null);
  const setWorkspace = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
  }, []);
  const [growth, setGrowth] = useState(() => {
    try {
      return readPanelGrowth(localStorage.getItem(PANEL_WIDTH_KEY));
    } catch {
      return { left: 0, right: 0 };
    }
  });
  const requested = useRef(growth);
  const [bounds, setBounds] = useState({ left: 256, right: 300, available: 0 });
  useLayoutEffect(() => {
    const workspace = ref.current!;
    const measure = () => {
      const css = getComputedStyle(workspace);
      const left = parseFloat(css.getPropertyValue('--left-panel-min'));
      const right = parseFloat(css.getPropertyValue('--right-panel-min'));
      const available =
        workspace.clientWidth -
        parseFloat(css.paddingLeft) -
        parseFloat(css.paddingRight) -
        2 * parseFloat(css.columnGap) -
        left -
        right -
        280;
      setBounds((previous) =>
        previous.left === left && previous.right === right && previous.available === available
          ? previous
          : { left, right, available },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const actual = fitPanelGrowth(growth, bounds.available);
  const save = useCallback(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, JSON.stringify(requested.current));
    } catch {
      /* Width remains usable in this session. */
    }
  }, []);
  const resize = (side: keyof PanelGrowth, width: number) => {
    const other = side === 'left' ? 'right' : 'left';
    const next = {
      ...actual,
      [side]: Math.max(
        0,
        Math.min(width - bounds[side], Math.max(0, bounds.available) - actual[other]),
      ),
    };
    requested.current = next;
    setGrowth(next);
  };
  return {
    setWorkspace,
    style: {
      '--left-panel-width': `${bounds.left + actual.left}px`,
      '--right-panel-width': `${bounds.right + actual.right}px`,
    } as CSSProperties,
    handle: (side: keyof PanelGrowth) => ({
      side,
      width: bounds[side] + actual[side],
      min: bounds[side],
      max:
        bounds[side] + Math.max(0, bounds.available) - actual[side === 'left' ? 'right' : 'left'],
      onResize: (width: number) => resize(side, width),
      onFinish: save,
    }),
  };
}
