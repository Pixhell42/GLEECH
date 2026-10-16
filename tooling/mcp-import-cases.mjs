import assert from 'node:assert/strict';

// Used by the native MCP suite in isolated profiles, on both CPU and GPU.
export async function checkMcpImports({ app, page, client, call, setMode, sharp, output, input }) {
  const png = await sharp({
    create: { width: 7, height: 5, channels: 4, background: { r: 70, g: 140, b: 210, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const payload = { data: png.toString('base64'), mimeType: 'image/png', name: 'agent-frame.png' };
  assert.equal(
    (await client.callTool({ name: 'load_image_data', arguments: payload })).isError,
    true,
  );
  await setMode('Edit');
  assert.equal(
    (await client.callTool({ name: 'request_folder_access', arguments: { kind: 'imports' } }))
      .isError,
    true,
  );
  await page.evaluate(async () => {
    for (const folder of (await window.gleech.mcpStatus()).folders)
      await window.gleech.removeMcpFolder(folder.id);
  });
  assert.deepEqual((await call('get_mcp_status')).structuredContent.folders, []);
  await call('create_project', { name: 'Payload integration' });
  const before = (await call('get_project_state')).structuredContent;
  for (const invalid of [
    { ...payload, data: '!!!!' },
    { ...payload, data: 'data:image/png;base64,' + payload.data },
    { ...payload, mimeType: 'image/jpeg' },
    { ...payload, data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') },
    { ...payload, name: '../escape.png' },
    { ...payload, data: 'A'.repeat(8 * 1024 * 1024 + 4) },
    { ...payload, expectedRevision: before.revision + 1 },
  ]) {
    assert.equal(
      (await client.callTool({ name: 'load_image_data', arguments: invalid })).isError,
      true,
    );
    assert.deepEqual((await call('get_project_state')).structuredContent, before);
  }
  // The SDK strips undeclared arguments. Even if a client supplies a path, only
  // its declared bytes are imported; a path must never become a fallback source.
  let state = (
    await call('load_image_data', { ...payload, path: input, expectedRevision: before.revision })
  ).structuredContent;
  assert.equal(state.source.name, payload.name);
  assert.deepEqual([state.source.width, state.source.height, state.source.hasAlpha], [7, 5, true]);
  const pixels = await page.evaluate(async (id) => {
    const result = await window.gleech.originalPixels(id);
    if (!result.ok) throw new Error(result.error);
    return Array.from(new Uint8Array(result.value.pixels));
  }, state.source.id);
  assert.deepEqual(Buffer.from(pixels), await sharp(png).ensureAlpha().raw().toBuffer());
  const preview = (await call('render_preview')).content.find((item) => item.type === 'image');
  assert.ok(preview);
  assert.equal((await sharp(Buffer.from(preview.data, 'base64')).metadata()).width, 7);
  await call('undo');
  assert.equal((await call('get_project_state')).structuredContent.source, null);
  await call('redo');
  assert.equal((await call('get_project_state')).structuredContent.source.id, state.source.id);
  state = (await call('add_effect', { type: 'rgb-split' })).structuredContent;
  const layers = state.effects;
  for (const format of ['jpeg', 'webp']) {
    const data = (await sharp(png)[format]().toBuffer()).toString('base64');
    state = (
      await call('load_image_data', { data, mimeType: `image/${format}`, name: `frame.${format}` })
    ).structuredContent;
    assert.equal(state.source.format, format);
    assert.deepEqual(state.effects, layers, 'Payload import must preserve the effect stack.');
  }
  // Hold the real decode IPC and revoke Edit permission before it resumes.
  const beforeCancelledImport = (await call('get_project_state')).structuredContent;
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('mcp:read-image-data');
    globalThis.payloadGate = { original, entered: false, release: null };
    ipcMain.removeHandler('mcp:read-image-data');
    ipcMain.handle('mcp:read-image-data', async (...args) => {
      globalThis.payloadGate.entered = true;
      await new Promise((resolve) => {
        globalThis.payloadGate.release = resolve;
      });
      return original(...args);
    });
  });
  const pendingImport = client.callTool({ name: 'load_image_data', arguments: payload });
  await app.evaluate(async () => {
    const until = Date.now() + 10000;
    while (!globalThis.payloadGate.entered && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (!globalThis.payloadGate.entered) throw new Error('Payload did not enter decoder');
  });
  await page.evaluate(() => window.gleech.setMcpMode('observe'));
  await app.evaluate(() => globalThis.payloadGate.release());
  assert.equal((await pendingImport).isError, true);
  assert.deepEqual((await call('get_project_state')).structuredContent, beforeCancelledImport);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('mcp:read-image-data');
    ipcMain.handle('mcp:read-image-data', globalThis.payloadGate.original);
    delete globalThis.payloadGate;
  });
  await setMode('Full Control');
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.folderOptions = options;
      return { canceled: true, filePaths: [] };
    };
  });
  assert.equal(
    (await call('request_folder_access', { kind: 'imports' })).structuredContent.canceled,
    true,
  );
  assert.deepEqual((await call('get_mcp_status')).structuredContent.folders, []);
  const options = await app.evaluate(() => globalThis.folderOptions);
  assert.deepEqual(options.properties, ['openDirectory']);
  assert.match(options.message, /connected MCP client/);
  // A user-selected directory is the only grant source. No path argument exists.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, output);
  const granted = (await call('request_folder_access', { kind: 'imports' })).structuredContent;
  assert.equal(granted.canceled, false);
  assert.equal(granted.status.folders.length, 1);
  assert.equal(granted.status.folders[0].kind, 'imports');
  await call('load_image', { path: input });
  await call('revoke_folder_access', { folderId: granted.status.folders[0].id });
  assert.deepEqual((await call('get_mcp_status')).structuredContent.folders, []);
  assert.equal(
    (await client.callTool({ name: 'load_image', arguments: { path: input } })).isError,
    true,
  );
  for (const cancellation of ['signal', 'downgrade']) {
    await app.evaluate(({ dialog }) => {
      globalThis.folderGate = { entered: false, release: null };
      dialog.showOpenDialog = async () => {
        globalThis.folderGate.entered = true;
        return new Promise((resolve) => {
          globalThis.folderGate.release = resolve;
        });
      };
    });
    await page.evaluate(() => {
      window.folderCancelled = false;
      window.unsubscribeFolderCancel = window.gleech.onMcpCancelled(() => {
        window.folderCancelled = true;
      });
    });
    const controller = new AbortController();
    const pending = client
      .callTool({ name: 'request_folder_access', arguments: { kind: 'imports' } }, undefined, {
        signal: controller.signal,
      })
      .then(
        (value) => value,
        (error) => error,
      );
    await app.evaluate(async () => {
      const until = Date.now() + 10000;
      while (!globalThis.folderGate.entered && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!globalThis.folderGate.entered) throw new Error('Folder picker did not open');
    });
    if (cancellation === 'signal') {
      controller.abort();
      await page.waitForFunction(() => window.folderCancelled);
    } else await page.evaluate(() => window.gleech.setMcpMode('observe'));
    await app.evaluate(
      (path) => globalThis.folderGate.release({ canceled: false, filePaths: [path] }),
      output,
    );
    const cancelled = await pending;
    assert.ok(cancelled instanceof Error || cancelled.isError);
    await page.waitForFunction(async () => (await window.gleech.mcpStatus()).operation === null);
    assert.deepEqual((await call('get_mcp_status')).structuredContent.folders, []);
    await page.evaluate(() => {
      window.unsubscribeFolderCancel();
    });
    if (cancellation === 'downgrade') await setMode('Full Control');
  }
  await setMode('Observe');
}
