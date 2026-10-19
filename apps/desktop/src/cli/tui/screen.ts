import { bgCode, charWidth, fgCode, type ColorLevel, type Rgb } from '../style';

export interface Style {
  fg?: Rgb;
  bg?: Rgb;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface Cell {
  ch: string; // '' marks the right half of a wide character
  fg: Rgb;
  bg: Rgb;
  attrs: number; // 1 bold, 2 dim, 4 italic, 8 underline
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const attrsOf = (style: Style) =>
  (style.bold ? 1 : 0) | (style.dim ? 2 : 0) | (style.italic ? 4 : 0) | (style.underline ? 8 : 0);
const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Double-buffered cell grid that writes only changed cells. */
export class Screen {
  width = 0;
  height = 0;
  private cells: Cell[] = [];
  private previous: Cell[] = [];
  private clip: Rect | null = null;

  constructor(
    private readonly level: ColorLevel,
    private readonly base: Rgb,
    private readonly ink: Rgb,
  ) {}

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: width * height }, () => this.blank());
    this.previous = [];
  }

  private blank(): Cell {
    return { ch: ' ', fg: this.ink, bg: this.base, attrs: 0 };
  }

  clear(bg: Rgb = this.base): void {
    for (const cell of this.cells) {
      cell.ch = ' ';
      cell.fg = this.ink;
      cell.bg = bg;
      cell.attrs = 0;
    }
  }

  withClip<T>(rect: Rect, draw: () => T): T {
    const saved = this.clip;
    this.clip = rect;
    try {
      return draw();
    } finally {
      this.clip = saved;
    }
  }

  private inside(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const c = this.clip;
    return !c || (x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h);
  }

  set(x: number, y: number, ch: string, style: Style): void {
    if (!this.inside(x, y)) return;
    const cell = this.cells[y * this.width + x]!;
    cell.ch = ch;
    if (style.fg) cell.fg = style.fg;
    if (style.bg) cell.bg = style.bg;
    cell.attrs = attrsOf(style);
  }

  /** Background color under a cell, for blending overlays. */
  bgAt(x: number, y: number): Rgb {
    return this.cells[y * this.width + x]?.bg ?? this.base;
  }

  fill(rect: Rect, bg: Rgb, ch = ' ', fg?: Rgb): void {
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) this.set(x, y, ch, { bg, fg: fg ?? this.ink });
  }

  /** Draw text, returning the column after it. Respects wide characters and maxWidth. */
  text(x: number, y: number, text: string, style: Style = {}, maxWidth = Infinity): number {
    let col = x;
    const limit = x + maxWidth;
    for (const ch of text) {
      const w = charWidth(ch.codePointAt(0)!);
      if (w === 0) continue;
      if (col + w > limit) break;
      if (w === 2) {
        if (!this.inside(col + 1, y)) break;
        this.set(col, y, ch, style);
        this.set(col + 1, y, '', style);
      } else this.set(col, y, ch, style);
      col += w;
    }
    return col;
  }

  /** Force cells in a rect to be written on the next flush (e.g. over an inline image). */
  invalidateRect(rect: Rect): void {
    for (let y = Math.max(0, rect.y); y < Math.min(this.height, rect.y + rect.h); y++)
      for (let x = Math.max(0, rect.x); x < Math.min(this.width, rect.x + rect.w); x++)
        delete this.previous[y * this.width + x];
  }

  /** Forget what the terminal shows, so the next flush repaints every cell. */
  invalidate(): void {
    this.previous = [];
  }

  /**
   * Write the frame, emitting only cells that changed since the last flush.
   * Returns whether any written cell fell inside `watch` (an inline image area).
   */
  flush(write: (data: string) => void, watch?: Rect | null): boolean {
    let touched = false;
    let out = '';
    let cursorX = -1,
      cursorY = -1;
    let fg: Rgb | null = null,
      bg: Rgb | null = null,
      attrs = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = y * this.width + x;
        const cell = this.cells[index]!;
        const old = this.previous[index];
        if (
          old &&
          old.ch === cell.ch &&
          old.attrs === cell.attrs &&
          same(old.fg, cell.fg) &&
          same(old.bg, cell.bg)
        )
          continue;
        if (cell.ch === '') continue; // the wide character to its left covers it
        if (watch && x >= watch.x && y >= watch.y && x < watch.x + watch.w && y < watch.y + watch.h)
          touched = true;
        if (cursorX !== x || cursorY !== y) out += `\x1b[${y + 1};${x + 1}H`;
        if (attrs !== cell.attrs) {
          out += `\x1b[22;23;24${cell.attrs & 1 ? ';1' : ''}${cell.attrs & 2 ? ';2' : ''}${cell.attrs & 4 ? ';3' : ''}${cell.attrs & 8 ? ';4' : ''}m`;
          attrs = cell.attrs;
        }
        if (this.level) {
          if (!fg || !same(fg, cell.fg)) {
            out += `\x1b[${fgCode(cell.fg, this.level)}m`;
            fg = cell.fg;
          }
          if (!bg || !same(bg, cell.bg)) {
            out += `\x1b[${bgCode(cell.bg, this.level)}m`;
            bg = cell.bg;
          }
        }
        out += cell.ch;
        const w = charWidth(cell.ch.codePointAt(0) ?? 32);
        cursorX = x + Math.max(1, w);
        cursorY = y;
        // A wide glyph also repaints its continuation cell.
        if (w === 2 && x + 1 < this.width) {
          const next = this.cells[index + 1]!;
          this.previous[index + 1] = { ...next };
        }
      }
    }
    this.previous = this.cells.map((cell) => ({ ...cell }));
    if (out) write(`${out}\x1b[0m`);
    return touched;
  }
}
