import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute } from 'node:path';
import { type McpRequest, type McpReply } from './protocol';

export interface McpConnection {
  pipe: string;
  token: string;
}
export function isMcpEndpoint(pipe: unknown, platform = process.platform): pipe is string {
  if (typeof pipe !== 'string') return false;
  if (platform === 'win32') return pipe.startsWith('\\\\.\\pipe\\gleech-mcp-');
  return (
    isAbsolute(pipe) &&
    !pipe.includes('\0') &&
    Buffer.byteLength(pipe) < 104 &&
    basename(pipe) === 'ipc.sock' &&
    /^gleech-mcp-[A-Za-z0-9]{6}$/.test(basename(dirname(pipe)))
  );
}
export async function connectGleech(path: string, clientName: string) {
  const connection = JSON.parse(await readFile(path, 'utf8')) as McpConnection;
  if (!isMcpEndpoint(connection.pipe) || !/^[a-f0-9]{64}$/.test(connection.token ?? ''))
    throw new Error('Invalid GLEECH connection file.');
  const socket = connect(connection.pipe);
  const pending = new Map<
    string,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      cleanup(): void;
    }
  >();
  let buffer = Buffer.alloc(0);
  const fail = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.cleanup();
      item.reject(error);
    }
    pending.clear();
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('GLEECH disconnected. Open the app and enable MCP.')));
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 12 * 1024 * 1024) {
      socket.destroy(new Error('GLEECH reply exceeds the connection limit.'));
      return;
    }
    let boundary: number;
    while ((boundary = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      try {
        const reply = JSON.parse(line) as McpReply & { id: string };
        const item = pending.get(reply.id);
        if (!item) continue;
        pending.delete(reply.id);
        clearTimeout(item.timer);
        item.cleanup();
        if (reply.ok) item.resolve(reply.value);
        else item.reject(new Error(reply.error));
      } catch {
        socket.destroy(new Error('Invalid GLEECH reply.'));
        return;
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  function send(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) return Promise.reject(new Error('GLEECH request cancelled.'));
    if (socket.destroyed) return Promise.reject(new Error('GLEECH disconnected.'));
    if (pending.size >= 8) return Promise.reject(new Error('Too many concurrent GLEECH requests.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        clearTimeout(item.timer);
        item.cleanup();
        if (!socket.destroyed)
          socket.write(
            JSON.stringify({
              id: randomUUID(),
              token: connection.token,
              request: { action: 'cancel', requestId: id },
            }) + '\n',
          );
        reject(new Error('GLEECH request cancelled.'));
      };
      const timer = setTimeout(() => {
        cancel();
      }, 305000);
      pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', cancel),
      });
      signal?.addEventListener('abort', cancel, { once: true });
      socket.write(JSON.stringify({ id, token: connection.token, request }) + '\n');
    });
  }
  try {
    await send({ action: 'connect', clientName: clientName.slice(0, 128) });
  } catch (error) {
    socket.destroy();
    throw error;
  }
  return {
    call: (request: McpRequest, signal?: AbortSignal) => send(request, signal),
    close: () => socket.destroy(),
  };
}
