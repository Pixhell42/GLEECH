export const PANEL_WIDTH_KEY = 'gleech.ui.panel-growth';
export const SECTION_STATE_KEY = 'gleech.ui.sections';
export interface PanelGrowth {
  left: number;
  right: number;
}

export function readPanelGrowth(raw: string | null): PanelGrowth {
  try {
    const value = JSON.parse(raw ?? '{}');
    return Object.fromEntries(
      ['left', 'right'].map((side) => [
        side,
        typeof value?.[side] === 'number' && Number.isFinite(value[side])
          ? Math.max(0, Math.min(2000, value[side]))
          : 0,
      ]),
    ) as unknown as PanelGrowth;
  } catch {
    return { left: 0, right: 0 };
  }
}

export function fitPanelGrowth(growth: PanelGrowth, available: number): PanelGrowth {
  const budget = Math.max(0, available);
  const total = growth.left + growth.right;
  const scale = total > budget && total > 0 ? budget / total : 1;
  return { left: growth.left * scale, right: growth.right * scale };
}

export function readSectionState(raw: string | null): Record<string, boolean> {
  try {
    const value = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, boolean] =>
          entry[0].length <= 160 && typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}
