import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { MCP_CLIENTS, isMcpClient } from '../shared/mcp-clients';
import { mcpConfiguration, mcpLauncher, mcpSetupPrompt } from './mcp-config';

const yaml = createRequire(import.meta.url)('js-yaml') as { load(value: string): unknown };
const paths = {
  command: 'C:\\Program Files\\GLEECH\\GLEECH.exe',
  script: "C:\\Code Projects\\O'Connor 🎨\\resources\\mcp\\server.cjs",
  connectionPath: 'C:\\Users\\pixhe\\AppData\\Roaming\\GLEECH\\mcp-connection.json',
};
interface Entry {
  command: string;
  args: string[];
  env: Record<string, string>;
  type?: string;
  timeout?: number;
  connect_timeout?: number;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled?: boolean;
  supports_parallel_tool_calls?: boolean;
}
type Root = { mcpServers?: Record<string, Entry>; mcp_servers?: Record<string, Entry> };

describe('local MCP client configuration profiles', () => {
  it.each(MCP_CLIENTS)(
    'exports parseable $format for $name with exact Windows paths and client identity',
    (client) => {
      const text = mcpConfiguration(client.id, paths);
      const root = (
        client.format === 'JSON'
          ? JSON.parse(text)
          : client.format === 'YAML'
            ? yaml.load(text)
            : parseToml(text)
      ) as Root;
      const servers = root.mcpServers ?? root.mcp_servers!;
      expect(Object.keys(servers)).toEqual(['gleech']);
      const entry = servers.gleech!;
      expect(entry.command).toBe(paths.command);
      expect(entry.args).toEqual([paths.script]);
      expect(entry.env).toEqual(mcpLauncher(client.id, paths).env);
      expect(entry.env.GLEECH_MCP_CLIENT).toBe(client.id === 'json' ? 'MCP client' : client.name);
      expect(entry).not.toHaveProperty('url');
      expect(entry.env).not.toHaveProperty('GLEECH_MCP_TOKEN');
      if (client.id === 'hermes') {
        expect(entry.timeout).toBe(305);
        expect(entry.connect_timeout).toBe(20);
        expect(entry.supports_parallel_tool_calls).toBe(false);
        expect(entry.enabled).toBe(true);
      } else if (client.format === 'TOML') {
        expect(entry.tool_timeout_sec).toBe(305);
        expect(entry.startup_timeout_sec).toBe(20);
      } else if (client.id === 'claude-code') {
        expect(entry.type).toBe('stdio');
        expect(entry.timeout).toBe(305000);
      } else if (client.id === 'cursor') {
        expect(entry.type).toBe('stdio');
        expect(Object.keys(entry).sort()).toEqual(['args', 'command', 'env', 'type']);
      } else {
        expect(Object.keys(entry).sort()).toEqual(['args', 'command', 'env']);
      }
    },
  );

  it.each(MCP_CLIENTS)('includes the actual launcher and safe setup scope for $name', (client) => {
    const prompt = mcpSetupPrompt(client.id, paths, 'win32');
    expect(prompt).toContain(client.name);
    expect(prompt).toContain(mcpConfiguration(client.id, paths).trimEnd());
    expect(prompt).toContain('Preserve other servers and settings');
    expect(prompt).toContain('back up the existing file');
    expect(prompt).toContain('If you cannot edit local files');
    expect(prompt).toContain('get_project_state and render_preview');
    expect(prompt).toContain('do not change my image or effects');
    expect(prompt).not.toContain('GLEECH_MCP_TOKEN');
    expect(prompt).not.toContain('"url"');
    if (client.id === 'claude-desktop')
      expect(prompt).toContain('%APPDATA%\\Claude\\claude_desktop_config.json');
    if (client.id === 'chatgpt-desktop')
      expect(prompt).toContain('%USERPROFILE%\\.codex\\config.toml');
  });

  it.each(MCP_CLIENTS)(
    'quotes configuration metacharacters without creating extra entries in $name',
    (client) => {
      const unusual = {
        ...paths,
        script: 'C:\\quoted"\n[mcp_servers.injection]\n#path\\server.cjs',
      };
      const text = mcpConfiguration(client.id, unusual);
      const root = (
        client.format === 'JSON'
          ? JSON.parse(text)
          : client.format === 'YAML'
            ? yaml.load(text)
            : parseToml(text)
      ) as Root;
      const servers = root.mcpServers ?? root.mcp_servers!;
      expect(Object.keys(servers)).toEqual(['gleech']);
      expect(servers.gleech!.args).toEqual([unusual.script]);
    },
  );

  it('accepts only advertised local clients at the IPC boundary', () => {
    for (const client of MCP_CLIENTS) expect(isMcpClient(client.id)).toBe(true);
    for (const value of ['grokbot', 'dots', 'http', '__proto__', {}, null, undefined])
      expect(isMcpClient(value)).toBe(false);
  });

  it.each(MCP_CLIENTS)(
    'uses macOS destinations and intact app bundle paths for $name',
    (client) => {
      const macPaths = {
        command: '/Applications/GLEECH.app/Contents/MacOS/GLEECH',
        script: '/Applications/GLEECH.app/Contents/Resources/mcp/server.cjs',
        connectionPath: '/Users/artist/Library/Application Support/GLEECH/mcp-connection.json',
      };
      const prompt = mcpSetupPrompt(client.id, macPaths, 'darwin');
      expect(prompt).toContain('on macOS');
      expect(prompt).not.toContain('%USERPROFILE%');
      expect(prompt).not.toContain('%APPDATA%');
      expect(prompt).not.toContain('Windows');
      expect(prompt).toContain(mcpConfiguration(client.id, macPaths).trimEnd());
      if (client.id === 'claude-desktop')
        expect(prompt).toContain('~/Library/Application Support/Claude/claude_desktop_config.json');
    },
  );
});
