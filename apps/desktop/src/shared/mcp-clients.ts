export const MCP_CLIENTS = [
  {
    id: 'codex',
    name: 'Codex',
    format: 'TOML',
    destination: '%USERPROFILE%\\.codex\\config.toml',
    instructions:
      'Merge the copied block into your config.toml, replacing an existing gleech entry. Restart Codex to reconnect.',
  },
  {
    id: 'chatgpt-desktop',
    name: 'ChatGPT Desktop',
    format: 'TOML',
    destination: '%USERPROFILE%\\.codex\\config.toml · Settings → MCP servers',
    instructions:
      'For local desktop tasks on a Codex host, merge the copied gleech block into config.toml. ChatGPT Desktop shares this file with Codex, so replace an existing gleech block rather than adding it twice. Restart the server in Settings → MCP servers and check /mcp. Hosted ChatGPT conversations do not read this local configuration.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    format: 'JSON',
    destination: '%USERPROFILE%\\.cursor\\mcp.json',
    instructions:
      'Merge gleech into mcpServers in your global .cursor/mcp.json, or use .cursor/mcp.json in a project for project-only access. Enable the server in Cursor’s Customize → MCP settings and refresh or restart Cursor. Use a local Windows agent; cloud agents cannot use this launcher.',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'JSON',
    destination: 'Settings → Developer → Edit Config',
    instructions:
      'Merge the gleech entry into mcpServers in claude_desktop_config.json. On Windows, the usual location is %APPDATA%\\Claude\\claude_desktop_config.json. Fully quit and reopen Claude Desktop.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    format: 'JSON',
    destination: '.mcp.json in your Claude Code project',
    instructions:
      'Merge the gleech entry into mcpServers in your project’s .mcp.json. Start Claude Code in that folder and approve the project MCP server. Check its status with /mcp. The configuration includes a five-minute tool timeout.',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    format: 'YAML',
    destination: '%USERPROFILE%\\.hermes\\config.yaml',
    instructions:
      'For Hermes running natively on Windows, merge gleech into mcp_servers in config.yaml. Use /reload-mcp or restart Hermes, then run hermes mcp test gleech. A WSL installation needs a Windows launcher; this configuration targets native Windows.',
  },
  {
    id: 'grok-build',
    name: 'Grok Build',
    format: 'TOML',
    destination: '%USERPROFILE%\\.grok\\config.toml',
    instructions:
      'Merge the copied block into config.toml, replacing an existing gleech entry. Restart Grok Build or refresh /mcps. Run grok mcp doctor gleech to check the connection.',
  },
  {
    id: 'json',
    name: 'Other (JSON)',
    format: 'JSON',
    destination: 'Your local MCP client’s configuration',
    instructions:
      'Merge the gleech entry into your client’s mcpServers settings. The client must support local stdio servers on Windows. Set its tool timeout to at least 305 seconds for long renders or batches.',
  },
] as const;
export type McpClientId = (typeof MCP_CLIENTS)[number]['id'];
export function isMcpClient(value: unknown): value is McpClientId {
  return MCP_CLIENTS.some((client) => client.id === value);
}
export function mcpClient(id: McpClientId, platform = 'win32') {
  const client = MCP_CLIENTS.find((entry) => entry.id === id)!;
  if (platform === 'win32') return client;
  let destination = client.destination.replace('%USERPROFILE%', '~').replaceAll('\\', '/');
  let instructions: string = client.instructions;
  if (id === 'claude-desktop') {
    destination = '~/Library/Application Support/Claude/claude_desktop_config.json';
    instructions =
      'Merge the gleech entry into mcpServers in this file. Fully quit and reopen Claude Desktop.';
  } else if (id === 'cursor') {
    instructions = instructions.replace('local Windows agent', 'local desktop agent');
  } else if (id === 'hermes') {
    instructions =
      'Merge gleech into mcp_servers in config.yaml. Use /reload-mcp or restart Hermes, then run hermes mcp test gleech. Run the client locally on the same Mac as GLEECH.';
  } else if (id === 'json') {
    instructions = instructions.replace('on Windows', 'on this computer');
  }
  return { ...client, destination, instructions };
}
