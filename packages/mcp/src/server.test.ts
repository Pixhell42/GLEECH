import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGleechMcpServer } from './server';
import { createMcpCommands } from './commands';
import { createCommandService } from '@gleech/command-service';
import { createProject, createEffect } from '@gleech/project-model';
import workspacePackage from '../../../package.json';

it('returns large portable data once instead of exceeding stdio limits with duplicate JSON', async () => {
  const payload = { recipe: { embedded: 'x'.repeat(3 * 1024 * 1024) } };
  const server = createGleechMcpServer(async () => payload);
  const client = new Client({ name: 'Large reply', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'get_style_recipe', arguments: {} });
    expect(result.structuredContent).toEqual(payload);
    expect(JSON.stringify(result.content).length).toBeLessThan(1024);
  } finally {
    await client.close();
    await server.close();
  }
});

it('propagates client cancellation to tools and resource reads', async () => {
  let started!: () => void;
  let stopped!: () => void;
  let began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const server = createGleechMcpServer(async (_request, signal) => {
    started();
    return await new Promise<Record<string, unknown>>((_resolve, reject) => {
      const abort = () => {
        stopped();
        reject(new Error('Cancelled'));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  });
  const client = new Client({ name: 'Cancellation test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const controller = new AbortController();
    const call = client.callTool({ name: 'render_preview', arguments: {} }, undefined, {
      signal: controller.signal,
    });
    const rejected = expect(call).rejects.toThrow();
    await began;
    controller.abort();
    await Promise.all([rejected, cancelled]);
    began = new Promise<void>((resolve) => {
      started = resolve;
    });
    cancelled = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const resourceController = new AbortController();
    const read = client.readResource(
      { uri: 'gleech://current-stack' },
      { signal: resourceController.signal },
    );
    const readRejected = expect(read).rejects.toThrow();
    await began;
    resourceController.abort();
    await Promise.all([readRejected, cancelled]);
  } finally {
    await client.close();
    await server.close();
  }
});

it('serves tools, resources, structured results, validation errors and PNG images over MCP', async () => {
  const adapter = createMcpCommands(
    createCommandService({
      ...createProject('Protocol'),
      source: {
        id: 'image',
        name: 'image.png',
        width: 1,
        height: 1,
        format: 'png',
        hasAlpha: true,
      },
      effects: [createEffect('shader-paint-flow', 'paint')],
    }),
  );
  const server = createGleechMcpServer(async (request) =>
    request.action === 'render_preview' ? { revision: 0, png: 'cG5n' } : adapter.execute(request),
  );
  const client = new Client({ name: 'Test client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getServerVersion()).toEqual({
      name: 'GLEECH',
      version: workspacePackage.version,
    });
    const toolList = (await client.listTools()).tools;
    expect(toolList.length).toBe(74);
    expect(
      toolList.every((tool) => typeof tool.description === 'string' && tool.description.length > 0),
    ).toBe(true);
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toContain(
      'gleech://project/current',
    );
    expect((await client.listResourceTemplates()).resourceTemplates.length).toBe(3);
    expect(
      (await client.readResource({ uri: 'gleech://current-stack' })).contents[0],
    ).toHaveProperty('text');
    const result = await client.callTool({
      name: 'set_parameters',
      arguments: { instanceId: 'paint', parameters: { viscosity: 0.15 }, expectedRevision: 0 },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty('revision', 1);
    expect(
      (
        await client.callTool({
          name: 'set_parameters',
          arguments: { instanceId: 'paint', parameters: { viscosity: 99 } },
        })
      ).isError,
    ).toBe(true);
    expect(
      (await client.callTool({ name: 'add_effect', arguments: { type: 'missing' } })).isError,
    ).toBe(true);
    expect(
      (await client.callTool({ name: 'render_preview', arguments: {} })).content,
    ).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'cG5n' });
  } finally {
    adapter.dispose();
    await client.close();
    await server.close();
  }
});
