import { release } from 'node:os';

// Terminal styling shared by the CLI and TUI. Colors follow the desktop app:
// near-black panels and the gold accent, with RGB-split glitch highlights.

export type Rgb = readonly [number, number, number];

export const THEME = {
  window: [11, 11, 12],
  panel: [22, 22, 24],
  elevated: [30, 30, 32],
  canvas: [16, 16, 17],
  line: [44, 44, 48],
  text: [232, 230, 225],
  muted: [138, 136, 132],
  faint: [84, 83, 82],
  accent: [233, 196, 106],
  accentHot: [255, 222, 140],
  accentInk: [26, 20, 6],
  red: [255, 70, 96],
  cyan: [64, 224, 255],
  magenta: [224, 92, 255],
  green: [120, 220, 140],
  warn: [255, 176, 72],
} as const satisfies Record<string, Rgb>;

export type ColorLevel = 0 | 1 | 2 | 3; // none, 16, 256, truecolor

export function detectColorLevel(stream: NodeJS.WriteStream = process.stdout): ColorLevel {
  const env = process.env;
  if ('NO_COLOR' in env && env['NO_COLOR'] !== '') return 0;
  if (env['FORCE_COLOR'] !== undefined) {
    const forced = Number(env['FORCE_COLOR']);
    if (env['FORCE_COLOR'] === 'false' || forced === 0) return 0;
    return (Number.isFinite(forced) ? Math.min(3, Math.max(1, forced)) : 3) as ColorLevel;
  }
  if (!stream.isTTY || env['TERM'] === 'dumb') return 0;
  if (env['COLORTERM'] === 'truecolor' || env['COLORTERM'] === '24bit') return 3;
  if (env['WT_SESSION'] || env['TERM_PROGRAM'] === 'iTerm.app' || env['TERM_PROGRAM'] === 'WezTerm')
    return 3;
  if (process.platform === 'win32') return 3; // Windows 10+ conhost/Terminal support 24-bit.
  // Apple's Terminal gained 24-bit color in macOS 26 (Darwin 25); earlier versions have 256.
  if (env['TERM_PROGRAM'] === 'Apple_Terminal')
    return process.platform === 'darwin' && Number(release().split('.')[0]) >= 25 ? 3 : 2;
  if (/-256(color)?$/i.test(env['TERM'] ?? '')) return 2;
  if (env['TERM_PROGRAM'] === 'vscode' || env['TERM'] === 'xterm-kitty') return 3;
  return stream.getColorDepth?.() >= 24 ? 3 : stream.getColorDepth?.() >= 8 ? 2 : 1;
}

function to256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const q = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function to16(r: number, g: number, b: number, background: boolean): number {
  const bright = Math.max(r, g, b) > 170;
  const code = (b > 110 ? 4 : 0) | (g > 110 ? 2 : 0) | (r > 110 ? 1 : 0);
  return (background ? 40 : 30) + code + (bright ? 60 : 0);
}

export function fgCode([r, g, b]: Rgb, level: ColorLevel): string {
  if (level === 3) return `38;2;${r};${g};${b}`;
  if (level === 2) return `38;5;${to256(r, g, b)}`;
  if (level === 1) return `${to16(r, g, b, false)}`;
  return '';
}

export function bgCode([r, g, b]: Rgb, level: ColorLevel): string {
  if (level === 3) return `48;2;${r};${g};${b}`;
  if (level === 2) return `48;5;${to256(r, g, b)}`;
  if (level === 1) return `${to16(r, g, b, true)}`;
  return '';
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Inline styling for line-oriented CLI output (stdout or stderr). */
export function createPaint(stream: NodeJS.WriteStream = process.stdout) {
  const level = detectColorLevel(stream);
  const wrap = (open: string, close: string) => (text: string | number) =>
    level && open ? `\x1b[${open}m${text}\x1b[${close}m` : String(text);
  const rgb = (color: Rgb) => wrap(fgCode(color, level), '39');
  return {
    level,
    rgb,
    bg: (color: Rgb) => wrap(bgCode(color, level), '49'),
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    italic: wrap('3', '23'),
    underline: wrap('4', '24'),
    accent: rgb(THEME.accent),
    hot: rgb(THEME.accentHot),
    muted: rgb(THEME.muted),
    faint: rgb(THEME.faint),
    text: rgb(THEME.text),
    red: rgb(THEME.red),
    cyan: rgb(THEME.cyan),
    green: rgb(THEME.green),
    warn: rgb(THEME.warn),
    magenta: rgb(THEME.magenta),
    /** Horizontal gradient across visible characters. */
    gradient(text: string, from: Rgb, to: Rgb): string {
      if (!level) return text;
      const chars = Array.from(text);
      return (
        chars
          .map((ch, i) =>
            ch === ' '
              ? ch
              : `\x1b[${fgCode(mix(from, to, i / Math.max(1, chars.length - 1)), level)}m${ch}`,
          )
          .join('') + '\x1b[39m'
      );
    },
  };
}
export type Paint = ReturnType<typeof createPaint>;

// Three-row block wordmark. Each glyph is 3 columns plus a gap.
const LETTERS: Record<string, readonly [string, string, string]> = {
  G: ['█▀▀', '█ █', '▀▀▀'],
  L: ['█  ', '█  ', '▀▀▀'],
  E: ['█▀▀', '█▀▀', '▀▀▀'],
  C: ['█▀▀', '█  ', '▀▀▀'],
  H: ['█ █', '█▀█', '▀ ▀'],
};

export function wordmarkRows(word = 'GLEECH'): string[] {
  const rows = ['', '', ''];
  for (const letter of word) {
    const glyph = LETTERS[letter]!;
    for (let r = 0; r < 3; r++) rows[r] += `${glyph[r]} `;
  }
  return rows.map((row) => row.trimEnd());
}

/**
 * The wordmark with a chromatic-aberration glitch: a red ghost on the left
 * and a cyan ghost on the right of the gold letters, one row displaced.
 */
export function glitchWordmark(paint: Paint, seed = Date.now()): string[] {
  const rows = wordmarkRows();
  if (!paint.level) return rows;
  let state = seed >>> 0 || 1;
  const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const slip = Math.floor(rand() * 3);
  return rows.map((row, index) => {
    const shift = index === slip ? 1 : 0;
    const body = paint.gradient(row, THEME.accentHot, THEME.accent);
    const ghostL = paint.red('▌');
    const ghostR = paint.cyan('▐');
    return `${' '.repeat(shift)}${ghostL}${body}${ghostR}`;
  });
}

// eslint-disable-next-line no-control-regex -- matching terminal escape sequences
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, '');

/** Display width that treats East Asian wide characters and emoji as two cells. */
export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += charWidth(ch.codePointAt(0)!);
  return width;
}

export function charWidth(code: number): number {
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if ((code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f))
    return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 2;
  return 1;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cellWidth(text)));
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (cellWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out.trimEnd()}…`;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (cellWidth(line) + 1 + cellWidth(word) <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}
