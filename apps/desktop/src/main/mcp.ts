import { app, clipboard, dialog, ipcMain, type BrowserWindow } from 'electron';
import type { McpAccess, McpFolderKind } from './mcp-access';
import { createServer, type Socket } from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, unlink, mkdtemp, chmod, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { isMcpClient } from '../shared/mcp-clients';
import { mcpConfiguration, mcpLauncher, mcpSetupPrompt } from './mcp-config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  isMutation,
  requiresFullControl,
  requestSchema,
  type McpMode,
  type McpReply,
  type McpStatus,
  type McpRequest,
} from '@gleech/mcp/protocol';

export function registerMcp(window: BrowserWindow, access: McpAccess) {
  let mode: McpMode = 'off';
  let recent: string[] = [];
  let error: string | null = null;
  let operation: McpStatus['operation'] = null;
  let ready = false;
  let generation = 0;
  let queue = Promise.resolve();
  let queued = 0;
  const sockets = new Map<Socket, string>();
  const pending = new Map<
    string,
    { resolve(value: McpReply): void; timer: ReturnType<typeof setTimeout>; cancelled?: boolean }
  >();
  const jobs = new Map<string, { socket: Socket; cancelled: boolean; dispatchId?: string }>();
  const token = randomBytes(32).toString('hex');
  let socketDirectory: string | null = null;
  let pipe = `\\\\.\\pipe\\gleech-mcp-${process.pid}-${randomUUID()}`;
  const connectionPath = join(app.getPath('userData'), 'mcp-connection.json');
  const serverScript = () =>
    app.isPackaged
      ? join(process.resourcesPath, 'mcp/server.cjs')
      : join(__dirname, '../mcp/server.cjs');
  const status = (): McpStatus => ({
    mode,
    clients: [...sockets.values()].filter(Boolean),
    recent,
    error,
    operation,
    folders: access.folders(),
    clipboardAllowed: access.clipboardAllowed(),
    pendingRequests: queued,
  });
  const publish = () => {
    if (!window.isDestroyed()) window.webContents.send('mcp:status-changed', status());
  };
  const valid = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const addRecent = (message: string) => {
    recent = [message, ...recent].slice(0, 10);
    publish();
  };
  const cancelDispatch = (id: string) => {
    const item = pending.get(id);
    if (!item || item.cancelled) return;
    item.cancelled = true;
    access.end(id);
    if (!window.isDestroyed()) window.webContents.send('mcp:cancel', id);
  };
  const cancelJob = (job: { cancelled: boolean; dispatchId?: string }) => {
    job.cancelled = true;
    if (job.dispatchId) cancelDispatch(job.dispatchId);
  };
  const cancelAll = () => {
    for (const job of jobs.values()) cancelJob(job);
  };
  const dispatch = (
    request: McpRequest,
    deadline: number,
    job: { dispatchId?: string },
  ): Promise<McpReply> => {
    const id = randomUUID();
    job.dispatchId = id;
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => {
          cancelDispatch(id);
          pending.delete(id);
          access.end(id);
          resolve({ ok: false, error: 'GLEECH operation timed out.' });
        },
        Math.max(1, deadline - Date.now() + 1000),
      );
      pending.set(id, { resolve, timer });
      access.begin(id, request, deadline);
      window.webContents.send('mcp:request', { id, request, deadline });
    });
  };
  const wire = z
    .object({
      id: z.string().uuid(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
      request: z.unknown(),
    })
    .strict();
  const server = createServer((socket) => {
    if (sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.set(socket, '');
    socket.setTimeout(120000);
    socket.on('timeout', () => {
      if (!sockets.get(socket)) socket.destroy();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      for (const job of jobs.values()) if (job.socket === socket) cancelJob(job);
      sockets.delete(socket);
      publish();
    });
    let buffer = Buffer.alloc(0);
    let inflight = 0;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 10 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let boundary: number;
      while ((boundary = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, boundary).toString('utf8');
        buffer = buffer.subarray(boundary + 1);
        let message: z.infer<typeof wire>;
        try {
          message = wire.parse(JSON.parse(line));
        } catch {
          socket.destroy();
          return;
        }
        if (!timingSafeEqual(Buffer.from(message.token, 'hex'), Buffer.from(token, 'hex'))) {
          socket.destroy();
          return;
        }
        // Cancellation must bypass the queue occupied by the operation it stops.
        const cancellation = z
          .object({ action: z.literal('cancel'), requestId: z.string().uuid() })
          .strict()
          .safeParse(message.request);
        if (cancellation.success) {
          const job = jobs.get(cancellation.data.requestId);
          if (job?.socket === socket) cancelJob(job);
          continue;
        }
        if (
          message.request &&
          typeof message.request === 'object' &&
          'action' in message.request &&
          message.request.action === 'connect'
        ) {
          try {
            if (mode === 'off' || !ready)
              throw new Error('Enable MCP after GLEECH finishes starting.');
            const connection = z
              .object({
                action: z.literal('connect'),
                clientName: z
                  .string()
                  .min(1)
                  .max(128)
                  .refine((name) =>
                    [...name].every(
                      (character) =>
                        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
                    ),
                  ),
              })
              .strict()
              .parse(message.request);
            sockets.set(socket, connection.clientName);
            publish();
            socket.write(JSON.stringify({ id: message.id, ok: true, value: { mode } }) + '\n');
          } catch {
            socket.destroy();
          }
          continue;
        }
        if (inflight >= 8 || queued >= 16 || jobs.has(message.id)) {
          socket.destroy();
          return;
        }
        const job = { socket, cancelled: false } as {
          socket: Socket;
          cancelled: boolean;
          dispatchId?: string;
        };
        jobs.set(message.id, job);
        inflight++;
        queued++;
        publish();
        const acceptedGeneration = generation;
        const longOperation = Boolean(
          message.request &&
          typeof message.request === 'object' &&
          'action' in message.request &&
          [
            'export_batch',
            'batch',
            'render_full',
            'export_image',
            'create_snapshot',
            'bake_as_new_source',
            'analyze_image',
            'copy_to_clipboard',
            'request_folder_access',
          ].includes(String(message.request.action)),
        );
        const deadline = Date.now() + (longOperation ? 299000 : 59000);
        queue = queue
          .then(async () => {
            let reply: McpReply;
            try {
              if (job.cancelled) throw new Error('GLEECH request cancelled.');
              if (socket.destroyed || mode === 'off' || acceptedGeneration !== generation)
                throw new Error(
                  'MCP connection is disabled. Reconnect after enabling it in GLEECH.',
                );
              if (Date.now() >= deadline)
                throw new Error('GLEECH request expired while waiting. Retry the operation.');
              if (!ready) throw new Error('GLEECH is still starting. Try again shortly.');
              if (!sockets.get(socket))
                throw new Error('Connect to GLEECH before requesting operations.');
              const request = requestSchema.parse(message.request);
              if (request.action === 'copy_to_clipboard' && !access.clipboardAllowed())
                throw new Error('Enable the separate clipboard permission in GLEECH’s MCP panel.');
              if (requiresFullControl(request) && mode !== 'full')
                throw new Error(
                  'Enable Full Control in GLEECH and approve folders before using file tools.',
                );
              if (isMutation(request) && !['edit', 'full'].includes(mode))
                throw new Error(
                  'GLEECH is in Observe mode. Enable Edit in the MCP panel to make changes.',
                );
              operation = {
                action: request.action.replaceAll('_', ' '),
                client: sockets.get(socket)!,
              };
              publish();
              try {
                reply = await dispatch(request, deadline, job);
              } finally {
                operation = null;
                publish();
              }
              addRecent(
                `${sockets.get(socket)} · ${request.action.replaceAll('_', ' ')}${reply.ok ? '' : ' · failed'}`,
              );
            } catch (failure) {
              reply = {
                ok: false,
                error: failure instanceof Error ? failure.message : 'MCP request failed.',
              };
            }
            inflight--;
            queued--;
            publish();
            jobs.delete(message.id);
            if (!socket.destroyed)
              socket.write(
                (Buffer.byteLength(JSON.stringify(reply)) <= 9 * 1024 * 1024
                  ? JSON.stringify({ id: message.id, ...reply })
                  : JSON.stringify({
                      id: message.id,
                      ok: false,
                      error:
                        'GLEECH result exceeds the 9 MB reply limit. Inspect individual layers or use portable preset files for large recipes.',
                    })) + '\n',
              );
          })
          .catch(() => {
            socket.destroy();
          });
      }
    });
  });
  server.on('error', (failure) => {
    error = failure.message;
    mode = 'off';
    access.setMode(mode);
    generation++;
    cancelAll();
    for (const socket of sockets.keys()) socket.destroy();
    publish();
  });
  const removeConnection = async () => {
    try {
      const existing = JSON.parse(await readFile(connectionPath, 'utf8'));
      if (existing.token === token) await unlink(connectionPath);
    } catch {
      /* Other instances own their own connection file. */
    }
  };
  let configuring = false;
  const closeServer = async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (socketDirectory) {
      await rmdir(socketDirectory);
      socketDirectory = null;
    }
  };
  const setMode = async (next: McpMode) => {
    if (configuring) throw new Error('MCP settings are still updating.');
    configuring = true;
    try {
      if (next === mode) return status();
      cancelAll();
      if (next === 'off') {
        mode = 'off';
        access.setMode(mode);
        generation++;
        for (const socket of sockets.keys()) socket.destroy();
        await closeServer();
        await removeConnection();
      } else {
        if (mode === 'off') {
          if (process.platform !== 'win32') {
            socketDirectory = await mkdtemp(join(tmpdir(), 'gleech-mcp-'));
            await chmod(socketDirectory, 0o700);
            pipe = join(socketDirectory, 'ipc.sock');
          }
          try {
            if (process.platform !== 'win32' && Buffer.byteLength(pipe) >= 104)
              throw new Error(
                'MCP temporary path is too long. Launch GLEECH with a shorter TMPDIR.',
              );
            await new Promise<void>((resolve, reject) => {
              server.once('error', reject);
              server.listen(pipe, () => {
                server.removeListener('error', reject);
                resolve();
              });
            });
            if (process.platform !== 'win32') await chmod(pipe, 0o600);
            const temporary = `${connectionPath}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify({ pipe, token }), { mode: 0o600 });
            await rename(temporary, connectionPath);
          } catch (failure) {
            await closeServer();
            throw failure;
          }
        }
        mode = next;
        access.setMode(mode);
      }
      error = null;
      publish();
      return status();
    } finally {
      configuring = false;
    }
  };
  ipcMain.handle('mcp:status', (event) => {
    if (!valid(event)) throw new Error('Invalid MCP request.');
    return status();
  });
  ipcMain.handle('mcp:set-clipboard', (event, next: unknown) => {
    if (!valid(event) || typeof next !== 'boolean' || mode === 'off')
      throw new Error('Enable MCP before changing clipboard permission.');
    access.setClipboardAllowed(next);
    publish();
    return status();
  });
  let testing = false;
  ipcMain.handle('mcp:test-connection', async (event, selected: unknown = 'codex') => {
    if (!valid(event) || mode === 'off')
      throw new Error('Enable MCP before testing its connection.');
    if (testing || operation) throw new Error('Wait for the current MCP operation before testing.');
    if (!isMcpClient(selected)) throw new Error('Invalid MCP client.');
    testing = true;
    const launcher = mcpLauncher(selected, {
      command: process.execPath,
      script: serverScript(),
      connectionPath,
    });
    const client = new Client({ name: 'GLEECH connection test', version: app.getVersion() });
    const transport = new StdioClientTransport({
      ...launcher,
      env: {
        ...launcher.env,
        GLEECH_MCP_CLIENT: `Connection test · ${launcher.env.GLEECH_MCP_CLIENT}`,
      },
      stderr: 'pipe',
    });
    // Bound initialization too: no orphan helper if the pipe/configuration fails.
    const timer = setTimeout(() => {
      void client.close();
      void transport.close();
    }, 15000);
    try {
      await client.connect(transport, { timeout: 12000 });
      const tools = (await client.listTools()).tools;
      const state = await client.callTool({ name: 'get_project_state', arguments: {} }, undefined, {
        timeout: 12000,
      });
      if (state.isError)
        throw new Error('Connected, but GLEECH could not inspect the current project.');
      return {
        server: client.getServerVersion()?.name ?? 'GLEECH',
        tools: tools.length,
        message: `Connection verified · ${tools.length} tools available`,
      };
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      testing = false;
    }
  });
  ipcMain.handle('mcp:set-mode', async (event, next: unknown) => {
    if (!valid(event) || !['off', 'observe', 'edit', 'full'].includes(String(next)))
      throw new Error('Invalid MCP mode.');
    return setMode(next as McpMode);
  });
  ipcMain.handle('mcp:add-folder', async (event, kind: unknown) => {
    if (!valid(event) || !['imports', 'projects', 'exports'].includes(String(kind)))
      throw new Error('Invalid MCP folder request.');
    const selected = await dialog.showOpenDialog(window, {
      title: `Approve MCP ${kind} folder`,
      properties: ['openDirectory'],
    });
    if (!selected.canceled && selected.filePaths[0])
      await access.addFolder(kind as McpFolderKind, selected.filePaths[0]);
    publish();
    return status();
  });
  let folderPickerPending = false;
  ipcMain.handle('mcp:folder-operation', async (event, id: unknown) => {
    if (!valid(event) || typeof id !== 'string') throw new Error('Invalid MCP folder request.');
    const request = access.request(id);
    if (request.action === 'revoke_folder_access') {
      access.removeFolder(request.folderId);
      publish();
      return { canceled: false, status: status() };
    }
    if (request.action !== 'request_folder_access')
      throw new Error('Invalid MCP folder operation.');
    if (folderPickerPending)
      throw new Error('Close the current folder picker before requesting another grant.');
    folderPickerPending = true;
    try {
      const selected = await dialog.showOpenDialog(window, {
        title: `Approve MCP ${request.kind} folder`,
        message: `A connected MCP client is requesting ${request.kind} access. Choose a folder to grant access for this app session, or cancel to grant nothing.`,
        properties: ['openDirectory'],
      });
      access.request(id);
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true, status: status() };
      await access.addFolder(request.kind, selected.filePaths[0], () => {
        access.request(id);
      });
      publish();
      return { canceled: false, status: status() };
    } finally {
      folderPickerPending = false;
    }
  });
  ipcMain.handle('mcp:remove-folder', (event, id: unknown) => {
    if (!valid(event) || typeof id !== 'string') throw new Error('Invalid MCP folder request.');
    access.removeFolder(id);
    publish();
    return status();
  });
  ipcMain.handle('mcp:copy-config', (event, client: unknown = 'codex') => {
    if (!valid(event) || mode === 'off')
      throw new Error('Enable MCP before copying its configuration.');
    if (!isMcpClient(client)) throw new Error('Invalid MCP client configuration.');
    clipboard.writeText(
      mcpConfiguration(client, {
        command: process.execPath,
        script: serverScript(),
        connectionPath,
      }),
    );
  });
  function setupPrompt(event: Electron.IpcMainInvokeEvent, client: unknown) {
    if (!valid(event) || !isMcpClient(client)) throw new Error('Invalid MCP client setup request.');
    return mcpSetupPrompt(client, {
      command: process.execPath,
      script: serverScript(),
      connectionPath,
    });
  }
  ipcMain.handle('mcp:setup-prompt', (event, client: unknown = 'codex') =>
    setupPrompt(event, client),
  );
  ipcMain.handle('mcp:copy-setup-prompt', (event, client: unknown = 'codex') => {
    const prompt = setupPrompt(event, client);
    clipboard.writeText(prompt);
  });
  const onReady = (event: Electron.IpcMainEvent) => {
    if (valid(event)) ready = true;
  };
  const onReply = (event: Electron.IpcMainEvent, id: unknown, reply: unknown) => {
    if (!valid(event) || typeof id !== 'string') return;
    const result = z
      .discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), value: z.record(z.string(), z.unknown()) }),
        z.object({ ok: z.literal(false), error: z.string().max(8192) }),
      ])
      .safeParse(reply);
    if (!result.success) return;
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(id);
    access.end(id);
    item.resolve(item.cancelled ? { ok: false, error: 'GLEECH request cancelled.' } : result.data);
  };
  ipcMain.on('mcp:ready', onReady);
  ipcMain.on('mcp:reply', onReply);
  window.webContents.on('did-start-loading', () => {
    ready = false;
  });
  return () => {
    mode = 'off';
    access.setMode(mode);
    generation++;
    cancelAll();
    for (const socket of sockets.keys()) socket.destroy();
    void closeServer().catch(() => {});
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.resolve({ ok: false, error: 'GLEECH closed.' });
    }
    pending.clear();
    void removeConnection();
    for (const name of [
      'mcp:status',
      'mcp:set-mode',
      'mcp:copy-config',
      'mcp:setup-prompt',
      'mcp:copy-setup-prompt',
      'mcp:test-connection',
      'mcp:set-clipboard',
      'mcp:add-folder',
      'mcp:folder-operation',
      'mcp:remove-folder',
    ])
      ipcMain.removeHandler(name);
    ipcMain.removeListener('mcp:ready', onReady);
    ipcMain.removeListener('mcp:reply', onReply);
  };
}
