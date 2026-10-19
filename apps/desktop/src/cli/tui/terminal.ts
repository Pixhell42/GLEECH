// Raw terminal I/O: alternate screen, key and SGR mouse decoding.

export interface KeyEvent {
  kind: 'key';
  /** Named key ("up", "enter", "tab"…) or the typed character. */
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  /** Printable text, when the key types something. */
  text?: string;
}

export interface MouseEvent {
  kind: 'mouse';
  x: number;
  y: number;
  button: 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down' | 'none';
  action: 'press' | 'release' | 'drag';
  shift: boolean;
}

export interface PasteEvent {
  kind: 'paste';
  text: string;
}

export type InputEvent = KeyEvent | MouseEvent | PasteEvent;

const CSI_KEYS: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  Z: 'tab',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};
const TILDE_KEYS: Record<string, string> = {
  '1': 'home',
  '2': 'insert',
  '3': 'delete',
  '4': 'end',
  '5': 'pageup',
  '6': 'pagedown',
  '7': 'home',
  '8': 'end',
  '15': 'f5',
};

const key = (name: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
  kind: 'key',
  name,
  ctrl: false,
  shift: false,
  meta: false,
  ...mods,
});

function modifiers(code: number): Pick<KeyEvent, 'shift' | 'meta' | 'ctrl'> {
  const bits = Math.max(0, code - 1);
  return { shift: !!(bits & 1), meta: !!(bits & 2), ctrl: !!(bits & 4) };
}

/** Decode one chunk of raw stdin into events. Exported for tests. */
export function decodeInput(data: string): InputEvent[] {
  const events: InputEvent[] = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    if (rest.startsWith('\x1b[200~')) {
      const end = rest.indexOf('\x1b[201~');
      const text = rest.slice(6, end < 0 ? undefined : end);
      events.push({ kind: 'paste', text });
      i += end < 0 ? rest.length : end + 6;
      continue;
    }
    // eslint-disable-next-line no-control-regex -- terminal escape sequences
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
    if (mouse) {
      const code = Number(mouse[1]);
      const base = code & 0b11000011;
      const button =
        base === 64
          ? 'wheel-up'
          : base === 65
            ? 'wheel-down'
            : base === 0
              ? 'left'
              : base === 1
                ? 'middle'
                : base === 2
                  ? 'right'
                  : 'none';
      events.push({
        kind: 'mouse',
        x: Number(mouse[2]) - 1,
        y: Number(mouse[3]) - 1,
        button,
        action: mouse[4] === 'm' ? 'release' : code & 32 ? 'drag' : 'press',
        shift: !!(code & 4),
      });
      i += mouse[0].length;
      continue;
    }
    // eslint-disable-next-line no-control-regex -- terminal escape sequences
    const csi = /^\x1b\[(\d*)(?:;(\d+))?([A-Za-z~])/.exec(rest);
    if (csi) {
      const [, first, mod, final] = csi;
      const mods = mod ? modifiers(Number(mod)) : {};
      if (final === '~') events.push(key(TILDE_KEYS[first!] ?? `unknown`, mods));
      else if (final === 'Z') events.push(key('tab', { shift: true }));
      else events.push(key(CSI_KEYS[final!] ?? 'unknown', mods));
      i += csi[0].length;
      continue;
    }
    // eslint-disable-next-line no-control-regex -- terminal escape sequences
    const ss3 = /^\x1bO([A-DHFPQRS])/.exec(rest);
    if (ss3) {
      events.push(key(CSI_KEYS[ss3[1]!]!));
      i += 3;
      continue;
    }
    const ch = rest.codePointAt(0)!;
    const char = String.fromCodePoint(ch);
    if (ch === 0x1b) {
      // Alt+key arrives as ESC followed by the key; a lone ESC is Escape.
      const next = rest[1];
      if (next && next !== '\x1b' && next !== '[' && next !== 'O') {
        events.push(
          key(next.toLowerCase(), { meta: true, shift: next !== next.toLowerCase(), text: next }),
        );
        i += 2;
      } else {
        events.push(key('escape'));
        i += 1;
      }
      continue;
    }
    i += char.length;
    if (ch === 13 || ch === 10) events.push(key('enter'));
    else if (ch === 9) events.push(key('tab'));
    else if (ch === 127 || ch === 8) events.push(key('backspace'));
    else if (ch === 0) events.push(key('space', { ctrl: true }));
    else if (ch < 27) events.push(key(String.fromCharCode(ch + 96), { ctrl: true }));
    else if (ch === 32) events.push(key('space', { text: ' ' }));
    else
      events.push(
        key(char.length === 1 ? char.toLowerCase() : char, {
          shift: char !== char.toLowerCase(),
          text: char,
        }),
      );
  }
  return events;
}

export class Terminal {
  private listeners = new Set<(event: InputEvent) => void>();
  private resizeListeners = new Set<() => void>();
  private active = false;
  private probing: ((data: string) => void) | null = null;
  private readonly onData = (data: Buffer) => {
    if (this.probing) return this.probing(data.toString('latin1'));
    for (const event of decodeInput(data.toString('utf8')))
      for (const fn of this.listeners) fn(event);
  };
  private readonly onResize = () => {
    for (const fn of this.resizeListeners) fn();
  };

  constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {}

  get columns(): number {
    return this.output.columns || 80;
  }
  get rows(): number {
    return this.output.rows || 24;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on('data', this.onData);
    this.output.on('resize', this.onResize);
    // Alt screen, hide cursor, SGR mouse with drag, bracketed paste, no wrap.
    this.output.write(
      '\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h\x1b[?7l\x1b[2J',
    );
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.output.write(
      '\x1b[0m\x1b[?7h\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l',
    );
    this.input.off('data', this.onData);
    this.output.off('resize', this.onResize);
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  write(data: string): void {
    this.output.write(data);
  }

  /**
   * Send capability queries and collect the replies until the terminal answers
   * DA1 (which every terminal does) or the timeout passes. Call after enter().
   */
  probe(query: string, timeoutMs = 500): Promise<string> {
    return new Promise((resolve) => {
      let reply = '';
      const done = () => {
        clearTimeout(timer);
        this.probing = null;
        resolve(reply);
      };
      this.probing = (data) => {
        reply += data;
        // eslint-disable-next-line no-control-regex -- DA1 reply
        if (/\x1b\[\?[\d;]*c/.test(reply)) done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.output.write(query);
    });
  }

  onInput(fn: (event: InputEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onResizeEvent(fn: () => void): () => void {
    this.resizeListeners.add(fn);
    return () => this.resizeListeners.delete(fn);
  }
}
