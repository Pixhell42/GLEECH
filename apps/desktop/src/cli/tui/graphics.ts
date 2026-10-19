import { deflateSync } from 'node:zlib';
import { encodePng, type RgbaImage } from '../png';
import type { Rgb } from '../style';

/**
 * Inline images for the TUI preview. Terminals differ in which protocol they
 * speak, so GLEECH asks the terminal (kitty graphics query, DA1 for sixel,
 * XTWINOPS for cell size) and combines the answer with known terminal IDs.
 * Anything unknown keeps the universal truecolor half-block preview.
 */
export type GraphicsProtocol = 'kitty' | 'iterm' | 'sixel' | 'blocks';

export interface TerminalCaps {
  protocol: GraphicsProtocol;
  /** Pixel size of one cell; sixel needs it exactly, the others use it for render size. */
  cellWidth: number;
  cellHeight: number;
  /** A readable terminal name for `gleech info` and the TUI help screen. */
  terminal: string;
}

const PROTOCOLS: readonly GraphicsProtocol[] = ['kitty', 'iterm', 'sixel', 'blocks'];

export function terminalName(env: NodeJS.ProcessEnv = process.env): string {
  const program = env['TERM_PROGRAM'] ?? '';
  if (env['WT_SESSION']) return 'Windows Terminal';
  if (program === 'WarpTerminal') return 'Warp';
  if (program === 'Apple_Terminal') return 'Terminal.app';
  if (program === 'iTerm.app' || env['LC_TERMINAL'] === 'iTerm2') return 'iTerm2';
  if (program === 'WezTerm') return 'WezTerm';
  if (program === 'ghostty' || env['GHOSTTY_RESOURCES_DIR']) return 'Ghostty';
  if (program === 'vscode') return 'VS Code';
  if (env['KITTY_WINDOW_ID'] || env['TERM'] === 'xterm-kitty') return 'kitty';
  if (env['ALACRITTY_WINDOW_ID'] || env['TERM'] === 'alacritty') return 'Alacritty';
  if (env['KONSOLE_VERSION']) return 'Konsole';
  if ((env['TERM'] ?? '').startsWith('foot')) return 'foot';
  if (env['VTE_VERSION']) return 'GNOME Terminal (VTE)';
  return env['TERM'] ?? 'terminal';
}

/** What the environment alone tells us. `null` means: ask the terminal. */
export function protocolFromEnv(env: NodeJS.ProcessEnv = process.env): GraphicsProtocol | null {
  const forced = (env['GLEECH_GRAPHICS'] ?? '').toLowerCase();
  if (PROTOCOLS.includes(forced as GraphicsProtocol)) return forced as GraphicsProtocol;
  if (forced === 'none' || forced === 'off') return 'blocks';
  // Multiplexers swallow or misplace image escapes unless configured for passthrough.
  if (env['TMUX'] || env['STY'] || env['ZELLIJ']) return 'blocks';
  const name = terminalName(env);
  if (name === 'kitty' || name === 'Ghostty') return 'kitty';
  if (name === 'iTerm2' || name === 'WezTerm') return 'iterm';
  // Warp documents iTerm2 inline images on macOS and Linux.
  if (name === 'Warp') return process.platform === 'win32' ? null : 'iterm';
  if (name === 'Terminal.app' || name === 'Alacritty') return 'blocks';
  return null;
}

export interface ProbeReply {
  kitty: boolean;
  sixel: boolean;
  cell?: { width: number; height: number };
}

/** Parse replies to the kitty query, CSI 16 t and DA1. Exported for tests. */
export function parseProbe(reply: string): ProbeReply {
  // eslint-disable-next-line no-control-regex -- terminal replies are escape sequences
  const da1 = /\x1b\[\?([\d;]*)c/.exec(reply);
  // eslint-disable-next-line no-control-regex -- terminal replies are escape sequences
  const cell = /\x1b\[6;(\d+);(\d+)t/.exec(reply);
  const width = cell ? Number(cell[2]) : 0;
  const height = cell ? Number(cell[1]) : 0;
  return {
    kitty: /_Gi=31;OK/.test(reply),
    sixel: !!da1 && da1[1]!.split(';').includes('4'),
    ...(width >= 4 && height >= 6 && width <= 200 && height <= 400
      ? { cell: { width, height } }
      : {}),
  };
}

/** Kitty graphics query, cell size request, then DA1 — every terminal answers DA1 last. */
export const PROBE_QUERY = '\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[16t\x1b[c';

export function resolveCaps(env: NodeJS.ProcessEnv, probe: ProbeReply | null): TerminalCaps {
  const fromEnv = protocolFromEnv(env);
  const protocol: GraphicsProtocol =
    fromEnv ?? (probe?.kitty ? 'kitty' : probe?.sixel ? 'sixel' : 'blocks');
  const forced = /^(\d+)x(\d+)$/.exec(env['GLEECH_CELL'] ?? '');
  // VT340-compatible terminals (Windows Terminal among them) scale sixel from a
  // 10×20 virtual cell, so it is the right default when the size is unknown.
  const cell = forced
    ? { width: Number(forced[1]), height: Number(forced[2]) }
    : (probe?.cell ?? { width: 10, height: 20 });
  return {
    protocol,
    cellWidth: cell.width,
    cellHeight: cell.height,
    terminal: terminalName(env),
  };
}

// ─── emitters ─────────────────────────────────────────────────────────────

export const KITTY_IMAGE_ID = 4242;

/**
 * Transmit and place RGBA pixels with kitty graphics (zlib-compressed).
 * `stay` keeps the cursor in place, as the TUI positions every write itself.
 */
export function kittyImage(image: RgbaImage, cols: number, rows: number, stay = true): string {
  const data = deflateSync(Buffer.from(image.pixels), { level: 1 }).toString('base64');
  let out = '';
  for (let i = 0; i < data.length; i += 4096) {
    const chunk = data.slice(i, i + 4096);
    const more = i + 4096 < data.length ? 1 : 0;
    out +=
      i === 0
        ? `\x1b_Ga=T,f=32,o=z,s=${image.width},v=${image.height},i=${KITTY_IMAGE_ID},p=1,c=${cols},r=${rows},C=${stay ? 1 : 0},q=2,m=${more};${chunk}\x1b\\`
        : `\x1b_Gm=${more};${chunk}\x1b\\`;
  }
  return out;
}

export const kittyDelete = () => `\x1b_Ga=d,d=I,i=${KITTY_IMAGE_ID},q=2\x1b\\`;

/** iTerm2 inline image (also WezTerm, Warp), stretched exactly over cols × rows. */
export function itermImage(image: RgbaImage, cols: number, rows: number, stay = true): string {
  const png = encodePng(image, {}, { fast: true });
  return `\x1b]1337;File=inline=1;size=${png.length};width=${cols};height=${rows};preserveAspectRatio=0${stay ? ';doNotMoveCursor=1' : ''}:${png.toString('base64')}\x07`;
}

// ─── sixel ───────────────────────────────────────────────────────────────

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

interface Box {
  bins: number[];
  count: number;
  /** Widest channel and its spread × √count, cached when the box is made. */
  channel: number;
  score: number;
}

const channelOf = (bin: number, c: number) => (bin >> (10 - c * 5)) & 31;

function makeBox(bins: number[], hist: Uint32Array): Box {
  let count = 0;
  const lo = [31, 31, 31];
  const hi = [0, 0, 0];
  for (const bin of bins) {
    count += hist[bin]!;
    for (let c = 0; c < 3; c++) {
      const v = channelOf(bin, c);
      if (v < lo[c]!) lo[c] = v;
      if (v > hi[c]!) hi[c] = v;
    }
  }
  let channel = 0;
  for (let c = 1; c < 3; c++) if (hi[c]! - lo[c]! > hi[channel]! - lo[channel]!) channel = c;
  const spread = hi[channel]! - lo[channel]!;
  return { bins, count, channel, score: bins.length < 2 ? 0 : spread * Math.sqrt(count) };
}

/**
 * Median-cut palette over a 15-bit histogram with light ordered dithering.
 * Returns the palette and each pixel's palette index.
 */
export function quantize(
  image: RgbaImage,
  background: Rgb,
  maxColors = 255,
): { palette: Rgb[]; indices: Uint8Array } {
  const px = new Uint8Array(image.pixels);
  const n = image.width * image.height;
  const bins = new Uint16Array(n);
  const hist = new Uint32Array(32768);
  for (let i = 0, y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++, i++) {
      const o = i * 4;
      const a = px[o + 3]! / 255;
      const d = (BAYER[(y & 3) * 4 + (x & 3)]! - 7.5) * 0.5;
      // Composite over the canvas, dither, and reduce each channel to 5 bits.
      const r = Math.round((px[o]! * a + background[0] * (1 - a) + d) / 8.2258);
      const g = Math.round((px[o + 1]! * a + background[1] * (1 - a) + d) / 8.2258);
      const b = Math.round((px[o + 2]! * a + background[2] * (1 - a) + d) / 8.2258);
      const bin =
        ((r < 0 ? 0 : r > 31 ? 31 : r) << 10) |
        ((g < 0 ? 0 : g > 31 ? 31 : g) << 5) |
        (b < 0 ? 0 : b > 31 ? 31 : b);
      bins[i] = bin;
      hist[bin]!++;
    }
  const used: number[] = [];
  for (let bin = 0; bin < 32768; bin++) if (hist[bin]) used.push(bin);
  const boxes: Box[] = [makeBox(used, hist)];
  while (boxes.length < maxColors) {
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i]!.score > boxes[best]!.score) best = i;
    const box = boxes[best]!;
    if (box.score <= 0) break;
    const c = box.channel;
    box.bins.sort((a, b) => channelOf(a, c) - channelOf(b, c));
    let half = 0;
    let split = 0;
    for (; split < box.bins.length - 2; split++) {
      half += hist[box.bins[split]!]!;
      if (half >= box.count / 2) break;
    }
    boxes.splice(
      best,
      1,
      makeBox(box.bins.slice(0, split + 1), hist),
      makeBox(box.bins.slice(split + 1), hist),
    );
  }
  const channel = channelOf;
  const lookup = new Uint8Array(32768);
  const palette: Rgb[] = boxes.map((box, index) => {
    let r = 0,
      g = 0,
      b = 0;
    for (const bin of box.bins) {
      const w = hist[bin]!;
      r += channel(bin, 0) * w;
      g += channel(bin, 1) * w;
      b += channel(bin, 2) * w;
      lookup[bin] = index;
    }
    const k = 8.2258 / Math.max(1, box.count);
    return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
  });
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) indices[i] = lookup[bins[i]!]!;
  return { palette, indices };
}

/** Encode a sixel image (DECSIXEL) with run-length compression. */
export function sixelImage(image: RgbaImage, background: Rgb): string {
  const { width, height } = image;
  const { palette, indices } = quantize(image, background);
  const parts: string[] = [`\x1bP0;1q"1;1;${width};${height}`];
  palette.forEach(([r, g, b], i) =>
    parts.push(
      `#${i};2;${Math.round((r * 100) / 255)};${Math.round((g * 100) / 255)};${Math.round((b * 100) / 255)}`,
    ),
  );
  const row = new Uint8Array(width);
  for (let top = 0; top < height; top += 6) {
    const bands = new Map<number, Uint8Array>();
    const last = new Int32Array(256);
    const rows = Math.min(6, height - top);
    for (let dy = 0; dy < rows; dy++) {
      const base = (top + dy) * width;
      for (let x = 0; x < width; x++) {
        const color = indices[base + x]!;
        let bits = bands.get(color);
        if (!bits) bands.set(color, (bits = new Uint8Array(width)));
        bits[x]! |= 1 << dy;
        if (x > last[color]!) last[color] = x;
      }
    }
    let first = true;
    for (const [color, bits] of bands) {
      if (!first) parts.push('$');
      first = false;
      parts.push(`#${color}`);
      row.set(bits);
      // Trailing empty sixels are implied by the carriage return.
      const end = last[color]! + 1;
      let x = 0;
      let line = '';
      while (x < end) {
        const value = row[x]!;
        let run = 1;
        while (x + run < end && row[x + run] === value) run++;
        const ch = String.fromCharCode(63 + value);
        line += run > 3 ? `!${run}${ch}` : ch.repeat(run);
        x += run;
      }
      parts.push(line);
    }
    parts.push('-');
  }
  parts.push('\x1b\\');
  return parts.join('');
}

/** Decode the subset of sixel GLEECH writes. For tests: returns palette indices per pixel. */
export function decodeSixel(data: string): { width: number; height: number; indices: Int16Array } {
  const header = /"1;1;(\d+);(\d+)/.exec(data);
  if (!header) throw new Error('Missing sixel raster attributes.');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const indices = new Int16Array(width * height).fill(-1);
  const body = data.slice(header.index + header[0].length).replace(/#\d+;2;\d+;\d+;\d+/g, '');
  let x = 0,
    band = 0,
    color = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '#') {
      const m = /^#(\d+)/.exec(body.slice(i))!;
      color = Number(m[1]);
      i += m[0].length - 1;
    } else if (ch === '$') x = 0;
    else if (ch === '-') {
      x = 0;
      band++;
    } else if (ch === '!') {
      const m = /^!(\d+)(.)/.exec(body.slice(i))!;
      for (let k = 0; k < Number(m[1]); k++) paint(m[2]!.charCodeAt(0) - 63);
      i += m[0].length - 1;
    } else if (ch >= '?' && ch <= '~') paint(ch.charCodeAt(0) - 63);
  }
  function paint(bits: number) {
    for (let dy = 0; dy < 6; dy++)
      if (bits & (1 << dy) && band * 6 + dy < height) indices[(band * 6 + dy) * width + x] = color;
    x++;
  }
  return { width, height, indices };
}
