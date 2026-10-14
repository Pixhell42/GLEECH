export const UI_COLORS = [
  { name: 'GLEECH Yellow', value: '#e9c46a' },
  { name: 'Amber', value: '#ffc247' },
  { name: 'Orange', value: '#ffab58' },
  { name: 'Coral', value: '#ff947c' },
  { name: 'Red', value: '#ff8087' },
  { name: 'Pink', value: '#ff91bd' },
  { name: 'Magenta', value: '#f58de5' },
  { name: 'Purple', value: '#d5a0ff' },
  { name: 'Violet', value: '#b8a0ff' },
  { name: 'Indigo', value: '#9dafff' },
  { name: 'Blue', value: '#80baff' },
  { name: 'Sky', value: '#67cbff' },
  { name: 'Cyan', value: '#62dfef' },
  { name: 'Teal', value: '#62d5bd' },
  { name: 'Mint', value: '#83dfa4' },
  { name: 'Lime', value: '#b9df65' },
] as const;

export type UiColor = (typeof UI_COLORS)[number];
export const UI_COLOR_STORAGE_KEY = 'gleech.ui.color';

export function readUiColor(): UiColor {
  try {
    return (
      UI_COLORS.find((color) => color.value === localStorage.getItem(UI_COLOR_STORAGE_KEY)) ??
      UI_COLORS[0]
    );
  } catch {
    return UI_COLORS[0];
  }
}

export function applyUiColor(color: UiColor): void {
  const style = document.documentElement.style;
  style.setProperty('--color-accent', color.value);
  style.setProperty('--accent-tint', `color-mix(in srgb, ${color.value} 14%, transparent)`);
  style.setProperty('--accent-ink', '#111114');
}

export function saveUiColor(color: UiColor): void {
  try {
    localStorage.setItem(UI_COLOR_STORAGE_KEY, color.value);
  } catch {
    // The current session still uses the chosen color if storage is unavailable.
  }
}
