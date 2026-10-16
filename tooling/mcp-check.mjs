import assert from 'node:assert/strict';
import { parse as parseToml } from 'smol-toml';
import { mkdir, mkdtemp, readFile, writeFile, access, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { createEffect, createImportedShader } from './effects-reference.mjs';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { recordDesktopFailure } from './record-desktop-failure.mjs';
import { installTestIOTracing } from './test-io-tracing.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { checkMcpImports } from './mcp-import-cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireMcp = createRequire(resolve(root, 'packages/mcp/package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const executablePath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const cpu = process.argv.includes('--cpu');
const label = cpu ? 'cpu' : 'gpu';
const output = resolve(root, 'test-results/mcp-check', label);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const input = resolve(output, 'source.png');
await sharp(
  Uint8Array.from({ length: 96 * 64 * 4 }, (_, index) =>
    index % 4 === 3 ? 255 : (index * 13) % 256,
  ),
  { raw: { width: 96, height: 64, channels: 4 } },
)
  .png()
  .toFile(input);
let app, client, transport, page;
const usedTools = new Set();
const pageErrors = [],
  stderr = [];
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result;
}
async function openMcp() {
  const toggle = page.getByRole('button', { name: 'File menu', exact: true });
  await toggle.click();
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: /MCP · AI control/ })
    .click();
}
async function setMode(mode) {
  await openMcp();
  await page
    .getByRole('group', { name: 'MCP control mode' })
    .getByRole('button', { name: mode, exact: true })
    .click();
  await page
    .getByRole('group', { name: 'MCP control mode' })
    .getByRole('button', { name: mode, exact: true })
    .and(page.locator('[aria-pressed="true"]'))
    .waitFor();
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
}
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  await installTestIOTracing(app);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, input);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.gleech.mcpStatus())).mode, 'off');
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .locator('.image-layer')
    .getAttribute('data-source-id')
    .catch(() => {});
  await page.getByRole('status').filter({ hasText: 'Opened source.png' }).waitFor();
  await setMode('Observe');
  await openMcp();
  await page.getByRole('button', { name: 'Copy Configuration', exact: true }).click();
  const codex = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(codex, /^\[mcp_servers\.gleech\]/);
  assert.match(codex, /tool_timeout_sec = 305/);
  const config = parseToml(codex).mcp_servers.gleech;
  await captureTestWindow(app, resolve(output, 'mcp-panel.png'));
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  client = new Client({ name: 'GLEECH MCP test', version: '1' });
  transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
  transport.stderr.on('data', (data) => stderr.push(data.toString()));
  await client.connect(transport);
  const actualCallTool = client.callTool.bind(client);
  client.callTool = (params, ...options) => {
    usedTools.add(params.name);
    return actualCallTool(params, ...options);
  };

  assert.equal((await client.listTools()).tools.length, 65);
  assert.equal((await client.listResources()).resources.length, 9);
  assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 3);
  const initial = (await call('get_project_state')).structuredContent;
  assert.equal(initial.effects.length, 0);
  assert.equal(initial.source.name, 'source.png');
  const analysis = (await call('analyze_image')).structuredContent;
  assert.equal(analysis.analysis.pixels, 96 * 64);
  assert.equal(analysis.analysis.opaquePixels, 96 * 64);
  assert.equal(analysis.revision, initial.revision);
  const detected = await call('analyze_image', { includeSubject: true });
  assert.ok(detected.content.some((content) => content.type === 'image'));
  assert.ok(
    detected.structuredContent.subject.meanConfidence >= 0 &&
      detected.structuredContent.subject.meanConfidence <= 1,
  );
  assert.deepEqual((await call('get_project_state')).structuredContent, initial);
  const denied = await client.callTool({ name: 'add_effect', arguments: { type: 'rgb-split' } });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied.content), /Observe mode/);
  const originalPreview = (await call('render_preview')).content.find(
    (content) => content.type === 'image',
  );
  assert.ok(originalPreview);
  const originalPng = await sharp(Buffer.from(originalPreview.data, 'base64')).metadata();
  assert.equal(originalPng.width, 96);
  assert.equal(originalPng.height, 64);
  // Reject unauthenticated clients before any renderer operation is dispatched.
  const connection = JSON.parse(await readFile(resolve(profile, 'mcp-connection.json'), 'utf8'));
  if (process.platform === 'darwin') {
    assert.ok(connection.pipe.startsWith('/'), 'MCP must use an absolute Unix socket path.');
    assert.equal((await stat(dirname(connection.pipe))).mode & 0o777, 0o700);
    assert.equal((await stat(connection.pipe)).mode & 0o777, 0o600);
    assert.equal((await stat(resolve(profile, 'mcp-connection.json'))).mode & 0o777, 0o600);
  }
  await new Promise((resolve, reject) => {
    const socket = connect(connection.pipe);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Unauthorized pipe was not closed.'));
    }, 5000);
    socket.on('connect', () =>
      socket.write(
        JSON.stringify({
          id: randomUUID(),
          token: '0'.repeat(64),
          request: { action: 'connect', clientName: 'unauthorized' },
        }) + '\n',
      ),
    );
    socket.on('data', () => reject(new Error('Unauthorized pipe received a reply.')));
    socket.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', () => {});
  });
  await setMode('Edit');
  const firstId = randomUUID(),
    shaderId = randomUUID();
  const edited = (
    await call('apply_operations', {
      expectedRevision: initial.revision,
      operations: [
        { action: 'add_effect', type: 'rgb-split', instanceId: firstId },
        { action: 'add_effect', type: 'shader-paint-flow', instanceId: shaderId },
        {
          action: 'set_parameters',
          instanceId: shaderId,
          parameters: {
            viscosity: 0.2,
            amount: 0.75,
            'application.region': 'left',
            'application.coverage': 0.7,
          },
        },
        { action: 'set_master_seed', seed: 123456 },
      ],
    })
  ).structuredContent;
  assert.equal(edited.revision, initial.revision + 1);
  assert.equal(edited.effects[0].instanceId, shaderId);
  await page.locator(`.effect-list [data-effect-id="${shaderId}"]`).waitFor();
  assert.equal(await page.getByRole('spinbutton', { name: 'Master seed' }).inputValue(), '123456');
  assert.equal(
    (await call('get_effect_parameters', { instanceId: shaderId })).structuredContent.values
      .viscosity,
    0.2,
  );
  const editedPreview = (
    await call('render_preview', { expectedRevision: edited.revision })
  ).content.find((content) => content.type === 'image');
  assert.notEqual(editedPreview.data, originalPreview.data);
  await writeFile(resolve(output, 'shader-preview.png'), Buffer.from(editedPreview.data, 'base64'));
  const exportPath = resolve(output, 'edited.png');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page.getByRole('status').filter({ hasText: 'Exported edited.png' }).waitFor();
  const exportedPixels = await sharp(await readFile(exportPath))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const previewPixels = await sharp(Buffer.from(editedPreview.data, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    exportedPixels.equals(previewPixels),
    'MCP preview differs from the app export on the same 96px input.',
  );
  await call('undo', { expectedRevision: edited.revision });
  assert.equal((await call('get_project_state')).structuredContent.effects.length, 0);
  assert.equal(await page.getByRole('spinbutton', { name: 'Master seed' }).inputValue(), '8172');
  await call('redo');
  assert.equal((await call('get_project_state')).structuredContent.effects.length, 2);
  assert.equal(
    (
      await client.callTool({
        name: 'remove_effect',
        arguments: { instanceId: firstId, expectedRevision: edited.revision },
      })
    ).isError,
    true,
  );
  await call('set_locked', { instanceId: shaderId, locked: true });
  assert.equal(
    (await client.callTool({ name: 'randomize_effect', arguments: { instanceId: shaderId } }))
      .isError,
    true,
  );
  const beforeInvalid = (await call('get_project_state')).structuredContent;
  assert.equal(
    (
      await client.callTool({
        name: 'apply_operations',
        arguments: {
          operations: [
            { action: 'set_master_seed', seed: 1 },
            { action: 'set_parameters', instanceId: firstId, parameters: { amount: 99 } },
          ],
        },
      })
    ).isError,
    true,
  );
  assert.deepEqual((await call('get_project_state')).structuredContent, beforeInvalid);
  await page.getByRole('spinbutton', { name: 'Master seed' }).fill('424242');
  const guiEdit = (await call('get_project_state')).structuredContent;
  assert.equal(guiEdit.masterSeed, 424242);
  assert.ok(guiEdit.revision > beforeInvalid.revision);
  const projectPath = resolve(output, 'mcp-edited.gleech');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await page.getByRole('status').filter({ hasText: 'Saved mcp-edited.gleech' }).waitFor();
  const projectText = await readFile(projectPath, 'utf8');
  assert.ok(!projectText.includes(connection.token), 'MCP credentials leaked into the project.');
  assert.match(projectText, /424242/);
  const creativeBase = (await call('get_project_state')).structuredContent;
  const beforeMasks = (await call('get_project_state')).structuredContent;
  const stroke = {
    size: 25,
    shape: 'circle',
    hardness: 0.5,
    falloff: 'smooth',
    mode: 'paint',
    points: [{ x: 0.5, y: 0.5 }],
  };
  await call('create_mask', { instanceId: firstId, strokes: [stroke] });
  const painted = (await call('get_effect_mask', { instanceId: firstId })).structuredContent.mask;
  assert.equal(painted.width, 96);
  assert.equal(painted.height, 64);
  assert.equal((await call('list_masks')).structuredContent.masks.length, 1);
  const maskResource = await client.readResource({ uri: `gleech://masks/${firstId}` });
  assert.deepEqual(JSON.parse(maskResource.contents[0].text).mask, painted);
  await call('invert_mask', { instanceId: firstId });
  await call('set_mask_enabled', { instanceId: firstId, enabled: false });
  assert.equal(
    (await call('get_effect_mask', { instanceId: firstId })).structuredContent.mask.inverted,
    true,
  );
  assert.equal(
    (await call('get_effect_mask', { instanceId: firstId })).structuredContent.mask.enabled,
    false,
  );
  await call('undo');
  await call('undo');
  await call('undo');
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    beforeMasks.effects,
  );
  await call('set_locked', { instanceId: shaderId, locked: false });
  await call('set_effect_mask', { instanceId: shaderId, mask: painted });
  assert.deepEqual(
    (await call('get_effect_mask', { instanceId: shaderId })).structuredContent.mask,
    painted,
  );
  await call('undo');
  await call('undo');
  const compared = await call('compare_versions');
  assert.equal(compared.content.filter((content) => content.type === 'image').length, 2);
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    creativeBase.effects,
  );
  const recipe = (await call('get_style_recipe')).structuredContent.recipe;
  assert.equal(recipe.effects.length, 2);
  const assetPixels = randomBytes(512 * 512 * 4);
  for (let index = 3; index < assetPixels.length; index += 4) assetPixels[index] = 255;
  const assetPng = await sharp(assetPixels, { raw: { width: 512, height: 512, channels: 4 } })
    .png()
    .toBuffer();
  const solid = createEffect('solid', randomUUID());
  solid.params = { ...solid.params, content: 'image', amount: 0.2 };
  solid.image = {
    source: {
      id: randomUUID(),
      name: 'Embedded.png',
      width: 512,
      height: 512,
      format: 'png',
      hasAlpha: true,
    },
    png: `data:image/png;base64,${assetPng.toString('base64')}`,
  };
  const assetRecipe = structuredClone(recipe);
  assetRecipe.effects[0].paintedMask = {
    version: 1,
    enabled: true,
    inverted: false,
    base: 0,
    width: 96,
    height: 64,
    strokes: [
      {
        size: 30,
        shape: 'circle',
        hardness: 0.5,
        falloff: 'smooth',
        mode: 'paint',
        points: [{ x: 0.5, y: 0.5 }],
      },
    ],
  };
  assetRecipe.effects.push(solid);
  if (!cpu) {
    const pkg = JSON.parse(
      await readFile(
        resolve(root, 'apps/desktop/resources/shaders/prism-weave.gleech-shader'),
        'utf8',
      ),
    );
    assetRecipe.effects.push(createImportedShader(pkg, randomUUID()));
  }
  await call('apply_style_recipe', { recipe: assetRecipe, placement: 'replace' });
  assert.deepEqual((await call('get_style_recipe')).structuredContent.recipe, assetRecipe);
  const assetPreset = (
    await call('save_preset', { name: `MCP Embedded ${randomUUID()}`, thumbnail: 'image' })
  ).structuredContent.preset;
  assert.deepEqual(
    (await call('get_style_recipe', { presetId: assetPreset.id })).structuredContent.recipe,
    assetRecipe,
  );
  const corruptRecipe = structuredClone(assetRecipe);
  const corruptPng = Buffer.from(
    corruptRecipe.effects.find((effect) => effect.type === 'solid').image.png.slice(22),
    'base64',
  );
  const compressed = corruptPng.indexOf(Buffer.from('IDAT')) + 4;
  corruptPng[compressed] = 0;
  corruptPng[compressed + 1] = 0;
  corruptRecipe.effects.find((effect) => effect.type === 'solid').image.png =
    `data:image/png;base64,${corruptPng.toString('base64')}`;
  const beforeCorruptRecipe = (await call('get_project_state')).structuredContent;
  assert.equal(
    (
      await client.callTool({
        name: 'apply_style_recipe',
        arguments: { recipe: corruptRecipe, placement: 'replace' },
      })
    ).isError,
    true,
  );
  assert.deepEqual((await call('get_project_state')).structuredContent, beforeCorruptRecipe);
  await call('undo');
  const catalogue = (await call('list_presets')).structuredContent.presets;
  assert.ok(catalogue.length >= 24);
  assert.ok(catalogue.some((preset) => preset.builtIn && preset.hasShaders));
  const savedImagePreset = (
    await call('save_preset', { name: `MCP Image ${randomUUID()}`, thumbnail: 'image' })
  ).structuredContent.preset;
  const savedStatuePreset = (
    await call('save_preset', { name: `MCP Statue ${randomUUID()}`, thumbnail: 'statue' })
  ).structuredContent.preset;
  assert.equal(savedImagePreset.thumbnailSource, 'image');
  assert.equal(savedStatuePreset.thumbnailSource, 'statue');
  assert.equal(savedImagePreset.hasShaders, true);
  const duplicate = (
    await call('duplicate_preset', {
      presetId: catalogue.find((preset) => preset.builtIn).id,
      name: `MCP Copy ${randomUUID()}`,
    })
  ).structuredContent.preset;
  assert.ok(duplicate.id);
  const userPresets = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets;
  assert.notEqual(
    userPresets.find((preset) => preset.id === savedImagePreset.id).thumbnail,
    userPresets.find((preset) => preset.id === savedStatuePreset.id).thumbnail,
  );
  assert.deepEqual(
    (await call('get_style_recipe', { presetId: savedImagePreset.id })).structuredContent.recipe,
    recipe,
  );
  const presetResource = await client.readResource({
    uri: `gleech://presets/${encodeURIComponent(savedImagePreset.id)}`,
  });
  assert.deepEqual(JSON.parse(presetResource.contents[0].text).recipe, recipe);
  for (const placement of ['replace', 'above', 'below', 'merge']) {
    const beforePlacement = (await call('get_project_state')).structuredContent;
    const applied = (await call('apply_preset', { presetId: savedImagePreset.id, placement }))
      .structuredContent;
    assert.equal(applied.effects.length, ['above', 'below'].includes(placement) ? 4 : 2);
    if (placement === 'merge') assert.deepEqual(applied.effects, creativeBase.effects);
    else if (applied.revision !== beforePlacement.revision) {
      await call('undo');
      assert.deepEqual(
        (await call('get_project_state')).structuredContent.effects,
        creativeBase.effects,
      );
    }
  }
  const batchLayer = randomUUID();
  const batchBefore = (await call('get_project_state')).structuredContent;
  await call('apply_operations', {
    operations: [
      { action: 'clear_effect_stack' },
      {
        action: 'apply_preset',
        presetId: savedImagePreset.id,
        placement: 'replace',
        instanceIds: [firstId, shaderId],
      },
      { action: 'set_locked', instanceId: shaderId, locked: false },
      { action: 'set_parameters', instanceId: shaderId, parameters: { amount: 0.35 } },
      { action: 'add_effect', type: 'scanlines', instanceId: batchLayer },
    ],
  });
  await call('undo');
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    batchBefore.effects,
  );
  const inline = (await call('apply_style_recipe', { recipe, placement: 'replace' }))
    .structuredContent;
  assert.deepEqual(inline.effects, creativeBase.effects);
  const beforeRandom = (await call('get_project_state')).structuredContent;
  for (const mode of [
    'existing-only',
    'keep-locked',
    'keep-all-add',
    'randomize-add',
    'replace-all',
  ]) {
    const randomized = (await call('randomize', { complexity: 'simple', mode, seed: 4242 }))
      .structuredContent;
    if (mode !== 'replace-all')
      assert.deepEqual(
        { ...randomized.effects.find((effect) => effect.instanceId === shaderId), index: 0 },
        creativeBase.effects.find((effect) => effect.instanceId === shaderId),
      );
    if (mode === 'existing-only')
      assert.equal(randomized.effects.length, beforeRandom.effects.length);
    if (mode === 'keep-all-add' || mode === 'randomize-add')
      assert.ok(randomized.effects.length > beforeRandom.effects.length);
    await call('undo');
    assert.deepEqual(
      (await call('get_project_state')).structuredContent.effects,
      beforeRandom.effects,
    );
  }
  assert.equal((await call('get_seed')).structuredContent.seed, 424242);
  const variations = (await call('create_variation', { seed: 101, intensity: 0.5 }))
    .structuredContent.variations;
  assert.deepEqual(
    variations.map((candidate) => candidate.similarity),
    ['close', 'close', 'close', 'medium', 'medium', 'medium', 'distant', 'distant', 'distant'],
  );
  assert.equal(new Set(variations.map((candidate) => candidate.id)).size, 9);
  const chosenVariation = (
    await call('render_variation', { variationId: variations[8].id })
  ).content.find((content) => content.type === 'image');
  assert.ok(chosenVariation);
  await call('apply_variation', { variationId: variations[8].id });
  const appliedVariation = (await call('render_preview')).content.find(
    (content) => content.type === 'image',
  );
  assert.equal(appliedVariation.data, chosenVariation.data);
  await call('undo');
  await call('create_variation', { seed: 101, intensity: 0.8 });
  assert.equal(
    (
      await client.callTool({
        name: 'apply_variation',
        arguments: { variationId: variations[8].id },
      })
    ).isError,
    true,
  );
  const beforeSemantic = (await call('get_project_state')).structuredContent;
  assert.equal((await call('list_semantic_controls')).structuredContent.controls.length, 11);
  const semantic = (await call('set_semantic_controls', { controls: { corruption: 0.25 } }))
    .structuredContent;
  assert.equal(
    semantic.effects.find((effect) => effect.instanceId === firstId).parameters.amount,
    0.25,
  );
  assert.deepEqual(
    semantic.effects.find((effect) => effect.instanceId === shaderId),
    creativeBase.effects.find((effect) => effect.instanceId === shaderId),
  );
  await call('undo');
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    beforeSemantic.effects,
  );
  assert.equal((await call('get_source_info')).structuredContent.source.id, guiEdit.source.id);
  assert.equal(
    (await client.callTool({ name: 'load_image', arguments: { path: input } })).isError,
    true,
  );
  await setMode('Full Control');
  assert.equal(
    await page.getByRole('button', { name: 'MCP controls', exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    (await client.callTool({ name: 'load_image', arguments: { path: input } })).isError,
    true,
  );
  const beforeFiles = (await call('get_project_state')).structuredContent;
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, output);
  await openMcp();
  for (const kind of ['Imports', 'Projects', 'Exports']) {
    await page.getByRole('button', { name: `Add ${kind} Folder`, exact: true }).click();
    await page.waitForFunction(
      (kind) =>
        document.querySelector('.mcp-folder-list')?.textContent?.includes(kind.toLowerCase()),
      kind,
    );
  }
  await captureTestWindow(app, resolve(output, 'mcp-full-control.png'));
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  const apiProjectPath = resolve(output, `api-${randomUUID()}.gleech`);
  assert.equal((await call('get_mcp_status')).structuredContent.folders.length, 3);
  const fileBatchBefore = (await call('get_project_state')).structuredContent;
  const fullPath = resolve(output, `full-${randomUUID()}.png`);
  await call('render_full', { path: fullPath });
  const otherInput = resolve(output, `batch-${randomUUID()}.png`);
  await sharp({
    create: {
      width: 79,
      height: 43,
      channels: 4,
      background: { r: 60, g: 90, b: 170, alpha: 0.5 },
    },
  })
    .png()
    .toFile(otherInput);
  const firstBatchPath = resolve(output, `batch-first-${randomUUID()}.png`),
    secondBatchPath = resolve(output, `batch-second-${randomUUID()}.png`);
  const batchResult = (
    await call('export_batch', {
      items: [
        { inputPath: input, outputPath: firstBatchPath },
        { inputPath: otherInput, outputPath: secondBatchPath },
      ],
    })
  ).structuredContent;
  assert.equal(batchResult.completed, 2);
  assert.equal(batchResult.failed, 0);
  assert.equal(batchResult.projectUnchanged, true);
  assert.ok(
    (
      await sharp(await readFile(firstBatchPath))
        .ensureAlpha()
        .raw()
        .toBuffer()
    ).equals(
      await sharp(await readFile(fullPath))
        .ensureAlpha()
        .raw()
        .toBuffer(),
    ),
  );
  assert.equal((await sharp(await readFile(secondBatchPath)).metadata()).width, 79);
  assert.deepEqual((await call('get_project_state')).structuredContent, fileBatchBefore);
  const invalidBatchInput = resolve(output, `broken-${randomUUID()}.png`);
  await writeFile(invalidBatchInput, 'not an image');
  const mixed = (
    await call('batch', {
      items: [
        { inputPath: invalidBatchInput, outputPath: resolve(output, `failed-${randomUUID()}.png`) },
        { inputPath: input, outputPath: resolve(output, `success-${randomUUID()}.png`) },
      ],
      presetId: savedImagePreset.id,
      continueOnError: true,
    })
  ).structuredContent;
  assert.equal(mixed.completed, 1);
  assert.equal(mixed.failed, 1);
  assert.equal(mixed.skipped, 0);
  assert.deepEqual((await call('get_project_state')).structuredContent, fileBatchBefore);
  const presetFile = resolve(output, `portable-${randomUUID()}.gleechpreset`);
  await call('export_preset', { presetId: savedImagePreset.id, path: presetFile });
  const portable = await readFile(presetFile);
  assert.ok(portable.length > 0);
  assert.equal(
    (
      await client.callTool({
        name: 'export_preset',
        arguments: { presetId: savedImagePreset.id, path: presetFile },
      })
    ).isError,
    true,
  );
  assert.ok((await readFile(presetFile)).equals(portable));
  const importedPreset = (await call('import_preset', { path: presetFile })).structuredContent
    .preset;
  assert.notEqual(importedPreset.id, savedImagePreset.id);
  assert.deepEqual(
    (await call('get_style_recipe', { presetId: importedPreset.id })).structuredContent.recipe,
    recipe,
  );
  const assetPresetFile = resolve(output, `embedded-${randomUUID()}.gleechpreset`);
  await call('export_preset', { presetId: assetPreset.id, path: assetPresetFile });
  const importedAssets = (await call('import_preset', { path: assetPresetFile })).structuredContent
    .preset;
  assert.deepEqual(
    (await call('get_style_recipe', { presetId: importedAssets.id })).structuredContent.recipe,
    assetRecipe,
  );
  await call('save_project', { path: apiProjectPath, expectedRevision: beforeFiles.revision });
  assert.equal(
    (await client.callTool({ name: 'save_project', arguments: { path: apiProjectPath } })).isError,
    true,
  );
  await call('save_project', { path: apiProjectPath, overwrite: true });
  const expectedExport = (await call('render_preview')).content.find(
    (content) => content.type === 'image',
  );
  const expectedExportPixels = await sharp(Buffer.from(expectedExport.data, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer();
  let apiPng;
  for (const [format, extension] of [
    ['png', 'png'],
    ['jpeg', 'jpg'],
    ['webp', 'webp'],
    ['tiff', 'tiff'],
  ]) {
    const path = resolve(output, `api-${randomUUID()}.${extension}`);
    const saved = (await call('export_image', { path, format, quality: 94 })).structuredContent;
    assert.equal(saved.width, 96);
    assert.equal(saved.height, 64);
    const metadata = await sharp(await readFile(path)).metadata();
    assert.equal(metadata.format, format);
    if (format === 'png') {
      apiPng = path;
      assert.ok(
        (
          await sharp(await readFile(path))
            .ensureAlpha()
            .raw()
            .toBuffer()
        ).equals(expectedExportPixels),
      );
    }
  }
  const clipboardBefore = (await call('get_project_state')).structuredContent;
  assert.equal((await client.callTool({ name: 'copy_to_clipboard', arguments: {} })).isError, true);
  await openMcp();
  await page
    .getByRole('checkbox', { name: 'Allow copying rendered images to the clipboard' })
    .check();
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  await call('copy_to_clipboard');
  const clipboardPng = await app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read();
    for (const item of items)
      if (item.types.includes('image/png')) {
        const blob = await item.getType('image/png');
        return Buffer.from(await blob.arrayBuffer()).toString('base64');
      }
    throw new Error('No PNG on clipboard');
  });
  assert.ok(
    (await sharp(Buffer.from(clipboardPng, 'base64')).ensureAlpha().raw().toBuffer()).equals(
      expectedExportPixels,
    ),
  );
  assert.deepEqual((await call('get_project_state')).structuredContent, clipboardBefore);
  await page.evaluate(() => window.gleech.setMcpClipboardAllowed(false));
  assert.equal((await client.callTool({ name: 'copy_to_clipboard', arguments: {} })).isError, true);
  const historyBefore = (await call('get_project_state')).structuredContent;
  await call('set_master_seed', { seed: 712412 });
  const operation = (await call('list_operations')).structuredContent.operations.at(-1);
  await call('set_master_seed', { seed: 712413 });
  await call('revert_to_operation', { operationId: operation.id });
  assert.equal(
    (await call('get_project_state')).structuredContent.masterSeed,
    historyBefore.masterSeed,
  );
  await call('undo');
  assert.equal((await call('get_project_state')).structuredContent.masterSeed, 712413);
  await call('redo');
  assert.equal(
    (await call('get_project_state')).structuredContent.masterSeed,
    historyBefore.masterSeed,
  );
  const protectedBytes = await readFile(apiPng);
  assert.equal(
    (await client.callTool({ name: 'export_image', arguments: { path: apiPng } })).isError,
    true,
  );
  assert.ok((await readFile(apiPng)).equals(protectedBytes));
  await call('export_image', { path: apiPng, overwrite: true });
  assert.equal(
    (
      await client.callTool({
        name: 'export_image',
        arguments: { path: resolve(output, '..', `outside-${randomUUID()}.png`) },
      })
    ).isError,
    true,
  );
  await call('create_project', { name: 'Fresh', seed: 77 });
  const empty = (await call('get_project_state')).structuredContent;
  assert.equal(empty.source, null);
  assert.equal(empty.effects.length, 0);
  assert.equal(empty.name, 'Fresh');
  await call('undo');
  assert.equal(
    (await call('get_project_state')).structuredContent.source.id,
    beforeFiles.source.id,
  );
  await call('open_project', { path: apiProjectPath });
  const reopened = (await call('get_project_state')).structuredContent;
  assert.equal(reopened.effects.length, 2);
  assert.equal(reopened.masterSeed, 424242);
  assert.notEqual(reopened.source.id, beforeFiles.source.id);
  await call('revert_to_operation', { operationId: reopened.operationId });
  assert.equal(
    (await call('get_project_state')).structuredContent.source.id,
    beforeFiles.source.id,
  );
  await call('undo');
  assert.equal((await call('get_project_state')).structuredContent.source.id, reopened.source.id);

  await call('undo');
  assert.equal(
    (await call('get_project_state')).structuredContent.source.id,
    beforeFiles.source.id,
  );
  await app.evaluate(({ dialog }) => {
    globalThis.__mcpUnexpectedSaveDialogs = 0;
    dialog.showSaveDialog = async () => {
      globalThis.__mcpUnexpectedSaveDialogs++;
      return { canceled: true };
    };
  });
  await fileAction(page, 'Save project Ctrl+S');
  await page
    .getByRole('status')
    .filter({ hasText: `Saved ${apiProjectPath.split(/[\\/]/).at(-1)}` })
    .waitFor();
  assert.equal(
    await app.evaluate(() => globalThis.__mcpUnexpectedSaveDialogs),
    0,
    'Undo failed to restore the saved project document binding.',
  );
  await call('redo');
  assert.equal((await call('get_project_state')).structuredContent.source.id, reopened.source.id);
  const replacement = resolve(output, `replacement-${randomUUID()}.png`);
  await sharp({ create: { width: 80, height: 72, channels: 4, background: '#996622' } })
    .png()
    .toFile(replacement);
  await call('replace_source', { path: replacement });
  const replaced = (await call('get_project_state')).structuredContent;
  assert.equal(replaced.source.width, 80);
  assert.equal(replaced.effects.length, 2);
  await call('undo');
  assert.equal((await call('get_project_state')).structuredContent.source.id, reopened.source.id);
  await call('redo');
  await call('load_image', { path: input });
  const loaded = (await call('get_project_state')).structuredContent;
  assert.equal(loaded.source.width, 96);
  assert.equal(loaded.effects.length, replaced.effects.length);
  await call('undo');
  assert.equal((await call('get_project_state')).structuredContent.source.id, replaced.source.id);
  const corrupt = resolve(output, `invalid-${randomUUID()}.gleech`);
  await writeFile(corrupt, 'invalid project');
  const beforeCorrupt = (await call('get_project_state')).structuredContent;
  const beforeSnapshotPreview = (await call('render_preview')).content.find(
    (content) => content.type === 'image',
  );
  const capture = (await call('create_snapshot', { name: 'MCP snapshot' })).structuredContent;
  assert.equal(capture.snapshots.length, 1);
  assert.equal(capture.effects.length, beforeCorrupt.effects.length);
  const snapshotId = capture.snapshotId;
  assert.ok(snapshotId);
  const snapshotResource = await client.readResource({ uri: `gleech://snapshots/${snapshotId}` });
  assert.equal(JSON.parse(snapshotResource.contents[0].text).snapshot.id, snapshotId);
  await call('rename_snapshot', { snapshotId, name: 'Renamed snapshot' });
  assert.equal(
    (await call('list_snapshots')).structuredContent.snapshots[0].name,
    'Renamed snapshot',
  );
  await call('bake_as_new_source', { snapshotId });
  const baked = (await call('get_project_state')).structuredContent;
  assert.equal(baked.effects.length, 0);
  assert.equal(baked.sourceSnapshotId, snapshotId);
  const bakedPreview = (await call('render_preview')).content.find(
    (content) => content.type === 'image',
  );
  assert.ok(
    (
      await sharp(Buffer.from(beforeSnapshotPreview.data, 'base64')).ensureAlpha().raw().toBuffer()
    ).equals(await sharp(Buffer.from(bakedPreview.data, 'base64')).ensureAlpha().raw().toBuffer()),
  );
  await call('undo');
  assert.equal(
    (await call('get_project_state')).structuredContent.effects.length,
    beforeCorrupt.effects.length,
  );
  await call('redo');
  await call('add_effect', { type: 'scanlines' });
  const child = (await call('create_snapshot', { name: 'Child stage', bake: true }))
    .structuredContent;
  assert.equal(child.snapshots[1].parentId, snapshotId);
  assert.equal(child.sourceSnapshotId, child.snapshotId);
  await call('restore_snapshot', { snapshotId });
  assert.equal(
    (await call('get_project_state')).structuredContent.effects.length,
    beforeCorrupt.effects.length,
  );
  await call('branch_from_snapshot', { snapshotId });
  assert.equal((await call('get_project_state')).structuredContent.sourceSnapshotId, snapshotId);
  await call('restore_snapshot', { snapshotId });
  const withSnapshots = (await call('get_project_state')).structuredContent;
  await call('save_project', { path: apiProjectPath, overwrite: true });
  await call('open_project', { path: apiProjectPath });
  assert.equal((await call('list_snapshots')).structuredContent.snapshots.length, 2);
  const afterSnapshots = (await call('get_project_state')).structuredContent;
  assert.equal(
    (await client.callTool({ name: 'open_project', arguments: { path: corrupt } })).isError,
    true,
  );
  assert.deepEqual((await call('get_project_state')).structuredContent, afterSnapshots);
  // Verify the convenience aliases independently of atomic operation dispatch.
  const aliasBefore = (await call('get_project_state')).structuredContent;
  await call('list_effects');
  await call('list_effect_types');
  assert.ok((await call('list_effect_types', { type: 'rgb-split' })).structuredContent.parameters);
  assert.equal(
    (await call('get_snapshot', { snapshotId })).structuredContent.snapshot.id,
    snapshotId,
  );
  const aliasId = randomUUID(),
    copyId = randomUUID();
  await call('add_effect', { type: 'rgb-split', instanceId: aliasId });
  await call('duplicate_effect', { instanceId: aliasId, newId: copyId });
  await call('set_parameters', { instanceId: aliasId, parameters: { amount: 0.2 } });
  await call('set_enabled', { instanceId: aliasId, enabled: false });
  await call('move_effect', { instanceId: aliasId, index: 0 });
  await call('remove_effect', { instanceId: aliasId });
  await call('remove_effect', { instanceId: copyId });
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    aliasBefore.effects,
  );
  await call('clear_effect_stack');
  assert.equal((await call('list_effects')).structuredContent.effects.length, 0);
  await call('undo');
  assert.deepEqual(
    (await call('get_project_state')).structuredContent.effects,
    aliasBefore.effects,
  );
  for (const resource of (await client.listResources()).resources)
    assert.ok((await client.readResource({ uri: resource.uri })).contents.length);
  // Hold a real native batch read to cancel at a deterministic async boundary.
  // Test profiles only; no user files, renderer bridge replacement, or sleeps as proof.
  const cancellationBefore = (await call('get_project_state')).structuredContent;
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('mcp:batch-read');
    globalThis.mcpCancelGate = { original, entered: false, release: null };
    ipcMain.removeHandler('mcp:batch-read');
    ipcMain.handle('mcp:batch-read', async (...args) => {
      globalThis.mcpCancelGate.entered = true;
      await new Promise((resolve) => {
        globalThis.mcpCancelGate.release = resolve;
      });
      return original(...args);
    });
  });
  for (const kind of ['signal', 'downgrade', 'disconnect']) {
    await app.evaluate(() => {
      globalThis.mcpCancelGate.entered = false;
    });
    let target = client;
    if (kind === 'disconnect') {
      target = new Client({ name: 'Disconnect test', version: '1' });
      await target.connect(new StdioClientTransport({ ...config, stderr: 'pipe' }));
    }
    const destination = resolve(output, `cancel-${kind}-${randomUUID()}.png`);
    const controller = new AbortController();
    const pending = target
      .callTool(
        {
          name: 'export_batch',
          arguments: {
            items: [{ inputPath: input, outputPath: destination }],
          },
        },
        undefined,
        { signal: controller.signal },
      )
      .then(
        (value) => value,
        (error) => error,
      );
    await app.evaluate(async () => {
      const until = Date.now() + 10000;
      while (!globalThis.mcpCancelGate.entered && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!globalThis.mcpCancelGate.entered) throw new Error('Batch did not enter native gate');
    });
    let queued;
    if (kind === 'signal') {
      const queuedController = new AbortController();
      queued = target
        .callTool({ name: 'set_master_seed', arguments: { seed: 300099 } }, undefined, {
          signal: queuedController.signal,
        })
        .then(
          (value) => value,
          (error) => error,
        );
      await page.waitForFunction(
        async () => (await window.gleech.mcpStatus()).pendingRequests >= 2,
      );
      queuedController.abort();
      controller.abort();
    } else if (kind === 'downgrade') {
      await page.evaluate(() => window.gleech.setMcpMode('observe'));
    } else await target.close();
    await app.evaluate(() => globalThis.mcpCancelGate.release());
    const cancelled = await pending;
    assert.ok(cancelled instanceof Error || cancelled.isError, `${kind} must cancel`);
    if (queued) await queued;
    await page.waitForFunction(async () => (await window.gleech.mcpStatus()).operation === null);
    await assert.rejects(access(destination));
    assert.deepEqual((await call('get_project_state')).structuredContent, cancellationBefore);
    if (kind === 'downgrade') await page.evaluate(() => window.gleech.setMcpMode('full'));
  }
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('mcp:batch-read');
    ipcMain.handle('mcp:batch-read', globalThis.mcpCancelGate.original);
    delete globalThis.mcpCancelGate;
  });
  await openMcp();
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Connection verified · 65 tools available' })
    .waitFor();
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  assert.deepEqual((await call('get_project_state')).structuredContent, cancellationBefore);
  const resourcePreview = await client.readResource({ uri: 'gleech://current-render' });
  assert.equal(resourcePreview.contents[0].mimeType, 'image/png');
  assert.ok(resourcePreview.contents[0].blob.length > 0);
  const paletteResource = await client.readResource({ uri: 'gleech://palettes' });
  assert.ok(Array.isArray(JSON.parse(paletteResource.contents[0].text).palettes));
  const folders = (await page.evaluate(() => window.gleech.mcpStatus())).folders;
  await page.evaluate(
    (id) => window.gleech.removeMcpFolder(id),
    folders.find((folder) => folder.kind === 'exports').id,
  );
  assert.equal(
    (
      await client.callTool({
        name: 'export_image',
        arguments: { path: resolve(output, `revoked-${randomUUID()}.png`) },
      })
    ).isError,
    true,
  );
  await setMode('Observe');
  assert.equal(
    (await client.callTool({ name: 'set_master_seed', arguments: { seed: 10 } })).isError,
    true,
  );
  await openMcp();
  assert.match(await page.locator('.mcp-dialog').innerText(), /Codex/);
  await captureTestWindow(app, resolve(output, 'mcp-connected.png'));
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  await checkMcpImports({ app, page, client, call, setMode, sharp, output, input });
  const missingTools = (await client.listTools()).tools
    .map((tool) => tool.name)
    .filter((name) => !usedTools.has(name));
  assert.deepEqual(missingTools, [], 'Every exposed MCP tool must have a native integration case.');
  await client.close();
  client = null;
  await setMode('Off');
  assert.equal(await page.getByRole('button', { name: 'MCP controls', exact: true }).count(), 0);
  await assert.rejects(access(resolve(profile, 'mcp-connection.json')));
  if (process.platform === 'darwin') {
    await assert.rejects(access(connection.pipe));
    await assert.rejects(access(dirname(connection.pipe)));
    await setMode('Observe');
    await setMode('Off');
  }
  assert.deepEqual(pageErrors, []);
  const backend = await page.locator('footer').getAttribute('data-render-backend');
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        backend,
        packaged: Boolean(executablePath),
        toolCount: 65,
        pageErrors,
        stderr,
        snapshotCount: withSnapshots.snapshots.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `MCP ${label}${executablePath ? ' packaged' : ''}: 65 tools, presets/recipes, nine variations, GLEECH modes, semantic controls, scoped file I/O, snapshots, previews, permissions and persistence passed (${backend}).`,
  );
} catch (failure) {
  await recordDesktopFailure({ app, page, output, label, failure, errors: pageErrors }).catch(
    (error) => {
      console.error('Could not capture desktop failure diagnostics:', error.message);
    },
  );
  throw failure;
} finally {
  if (client) await client.close().catch(() => {});
  if (app) await closeTestApp(app);
}
