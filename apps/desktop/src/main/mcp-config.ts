import { mcpClient, type McpClientId } from '../shared/mcp-clients';

export interface McpLauncherPaths {
  command: string;
  script: string;
  connectionPath: string;
}

/** All profiles launch the bundled server directly, with no shell or extra Node install. */
export function mcpLauncher(client: McpClientId, paths: McpLauncherPaths) {
  return {
    command: paths.command,
    args: [paths.script],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      GLEECH_MCP_CONNECTION: paths.connectionPath,
      GLEECH_MCP_CLIENT: client === 'json' ? 'MCP client' : mcpClient(client).name,
    },
  };
}

export function mcpConfiguration(client: McpClientId, paths: McpLauncherPaths) {
  const launch = mcpLauncher(client, paths);
  if (['json', 'cursor', 'claude-desktop', 'claude-code'].includes(client))
    return (
      JSON.stringify(
        {
          mcpServers: {
            gleech: {
              ...(client === 'cursor' ? { type: 'stdio' } : {}),
              ...(client === 'claude-code' ? { type: 'stdio', timeout: 305000 } : {}),
              ...launch,
            },
          },
        },
        null,
        2,
      ) + '\n'
    );
  if (client === 'hermes')
    return [
      'mcp_servers:',
      '  gleech:',
      `    command: ${JSON.stringify(launch.command)}`,
      `    args: ${JSON.stringify(launch.args)}`,
      '    enabled: true',
      '    timeout: 305',
      '    connect_timeout: 20',
      '    supports_parallel_tool_calls: false',
      '    env:',
      ...Object.entries(launch.env).map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`),
      '',
    ].join('\n');
  return [
    '[mcp_servers.gleech]',
    `command = ${JSON.stringify(launch.command)}`,
    `args = ${JSON.stringify(launch.args)}`,
    ...(client === 'grok-build' ? ['enabled = true'] : []),
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 305',
    '',
    '[mcp_servers.gleech.env]',
    ...Object.entries(launch.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    '',
  ].join('\n');
}

/** The prompt contains launcher paths only; the connection token stays in GLEECH. */
export function mcpSetupPrompt(client: McpClientId, paths: McpLauncherPaths) {
  const selected = mcpClient(client);
  const target =
    client === 'claude-desktop'
      ? '%APPDATA%\\Claude\\claude_desktop_config.json'
      : client === 'chatgpt-desktop'
        ? '%USERPROFILE%\\.codex\\config.toml'
        : selected.destination;
  return [
    `Connect ${selected.name} to my open GLEECH app on Windows using local stdio MCP.`,
    'GLEECH must stay open with Observe, Edit or Full Control enabled. Tell me if I need to enable MCP before connecting.',
    `Configuration destination: ${target}. Expand environment variables for the current user.`,
    'If you have local file access, back up the existing file, then merge only the gleech server entry below. Preserve other servers and settings; replace an existing gleech entry without duplicating it. If the file is invalid or the destination is unknown, stop and explain what needs fixing.',
    'If you cannot edit local files, give me the exact manual steps instead. Keep these command, args and env values unchanged. No extra Node install, API key or HTTP endpoint is needed. Do not change GLEECH permissions.',
    selected.instructions,
    'Tell me if I need to refresh/restart the client. Once connected, call get_project_state and render_preview to verify it; do not change my image or effects. If tools are unavailable until the next session, say so instead of claiming success.',
    '',
    'GLEECH configuration:',
    '```' + selected.format.toLowerCase(),
    mcpConfiguration(client, paths).trimEnd(),
    '```',
    '',
  ].join('\n');
}
