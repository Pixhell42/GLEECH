import type { UpdateProgress } from './updates';

export type TerminalUpdateRequest =
  { type: 'start'; version: string } | { type: 'install' } | { type: 'cancel' };

export type TerminalUpdateEvent =
  | { type: 'listening' }
  | { type: 'progress'; progress: UpdateProgress }
  | { type: 'ready'; version: string; mode: 'native' | 'finder' }
  | { type: 'armed' }
  | { type: 'error'; error: string };

/** Release text and errors must never introduce terminal escape commands. */
export function terminalUpdateText(value: string): string {
  // eslint-disable-next-line no-control-regex -- untrusted release and error text
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replaceAll('\t', ' ');
}
