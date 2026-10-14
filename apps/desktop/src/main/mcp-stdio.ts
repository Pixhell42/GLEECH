import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGleechMcpServer } from '@gleech/mcp/server';
import { connectGleech } from '@gleech/mcp/connection';

async function start() {
  const path = process.env['GLEECH_MCP_CONNECTION'];
  if (!path) throw new Error('Enable MCP in GLEECH and copy its client configuration.');
  const connection = await connectGleech(path, process.env['GLEECH_MCP_CLIENT'] ?? 'MCP client');
  const server = createGleechMcpServer(connection.call);
  const transport = new StdioServerTransport();
  server.server.onclose = () => {
    connection.close();
    process.exit(0);
  };
  process.stdin.on('end', () => {
    connection.close();
    void server.close();
  });
  await server.connect(transport);
}
void start().catch((failure) => {
  process.stderr.write(
    `GLEECH MCP: ${failure instanceof Error ? failure.message : 'Could not start.'}\n`,
  );
  process.exit(1);
});
