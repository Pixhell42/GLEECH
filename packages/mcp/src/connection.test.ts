import { describe, expect, it } from 'vitest';
import { isMcpEndpoint } from './connection';

describe('local MCP endpoint validation', () => {
  it('accepts macOS sockets and preserves Windows named pipes', () => {
    expect(isMcpEndpoint('/tmp/gleech-mcp-Ab123z/ipc.sock', 'darwin')).toBe(true);
    expect(isMcpEndpoint('\\\\.\\pipe\\gleech-mcp-42-abc', 'win32')).toBe(true);
    expect(isMcpEndpoint('\\\\.\\pipe\\gleech-mcp-42-abc', 'darwin')).toBe(false);
    expect(isMcpEndpoint('/tmp/gleech-mcp-Ab123z/ipc.sock', 'win32')).toBe(false);
  });

  it.each([
    undefined,
    123,
    'localhost:3000',
    'gleech-mcp-Ab123z/ipc.sock',
    '/tmp/other/ipc.sock',
    '/tmp/gleech-mcp-Ab123z/other.sock',
    '/tmp/gleech-mcp-Ab123z/ipc.sock\0',
    `/${'x'.repeat(104)}/gleech-mcp-Ab123z/ipc.sock`,
  ])('rejects unrelated or invalid socket addresses: %s', (value) => {
    expect(isMcpEndpoint(value, 'darwin')).toBe(false);
  });
});
