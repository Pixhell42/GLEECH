import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { load as parseYaml } from 'js-yaml';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireMcp = createRequire(resolve(root, 'packages/mcp/package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const executablePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const output = resolve(
  root,
  'test-results/mcp-clients-check',
  executablePath ? 'packaged' : 'native',
);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const input = resolve(output, 'source.png');
await sharp({
  create: { width: 24, height: 16, channels: 4, background: { r: 80, g: 40, b: 20, alpha: 0.5 } },
})
  .png()
  .toFile(input);
const profiles = [
  ['codex', 'Codex', 'toml', '.codex'],
  ['chatgpt-desktop', 'ChatGPT Desktop', 'toml', 'Hosted ChatGPT conversations'],
  ['cursor', 'Cursor', 'json', '.cursor'],
  ['claude-desktop', 'Claude Desktop', 'json', 'claude_desktop_config.json'],
  ['claude-code', 'Claude Code', 'json', '.mcp.json'],
  ['hermes', 'Hermes', 'yaml', '.hermes'],
  ['grok-build', 'Grok Build', 'toml', '.grok'],
  ['json', 'Other (JSON)', 'json', 'mcpServers'],
];
let app, page, client, originalClipboard, ownedClipboard;
const errors = [],
  verifications = [];
async function start() {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
}
async function menu() {
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: /MCP · AI control/ })
    .click();
  await page.locator('.mcp-dialog').waitFor();
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result;
}
try {
  await start();
  originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  await menu();
  assert.equal(await page.getByLabel('MCP client', { exact: true }).inputValue(), 'codex');
  assert.equal(
    await page.getByRole('button', { name: 'Copy Configuration', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Test Connection', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Connection Help', exact: true }).click();
  await page.getByRole('dialog', { name: 'Connect Codex', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#mcp-setup-prompt')?.value.length > 0);
  assert.equal(await page.getByRole('button', { name: 'Copy Setup Prompt' }).isDisabled(), false);
  const offPrompt = await page
    .getByLabel('Setup prompt · includes your GLEECH configuration')
    .inputValue();
  await page.getByRole('button', { name: 'Copy Setup Prompt' }).click();
  await page
    .getByRole('dialog', { name: 'Connect Codex' })
    .getByRole('status')
    .filter({ hasText: 'Copied Codex setup prompt' })
    .waitFor();
  ownedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(ownedClipboard, offPrompt);
  const offStatus = await page.evaluate(() => window.gleech.mcpStatus());
  assert.equal(offStatus.mode, 'off');
  assert.deepEqual(offStatus.clients, []);
  assert.deepEqual(offStatus.folders, []);
  assert.equal(offStatus.clipboardAllowed, false);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Connection Help' }).isVisible(), true);
  assert.deepEqual(
    await page
      .locator('#mcp-client option')
      .evaluateAll((options) => options.map((option) => option.textContent)),
    profiles.map((entry) => entry[1]),
  );
  await page
    .getByRole('group', { name: 'MCP control mode' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.waitForFunction(async () => (await window.gleech.mcpStatus()).mode === 'edit');
  // Invalid profiles cannot replace clipboard data or start a helper.
  const invalidClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  await assert.rejects(
    page.evaluate(() => window.gleech.copyMcpConfiguration('http')),
    /Invalid MCP client/,
  );
  await assert.rejects(
    page.evaluate(() => window.gleech.testMcpConnection('dots')),
    /Invalid MCP client/,
  );
  await assert.rejects(
    page.evaluate(() => window.gleech.getMcpSetupPrompt('http')),
    /Invalid MCP client/,
  );
  await assert.rejects(
    page.evaluate(() => window.gleech.copyMcpSetupPrompt('http')),
    /Invalid MCP client/,
  );
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), invalidClipboard);
  await page
    .getByRole('group', { name: 'MCP control mode' })
    .getByRole('button', { name: 'Full Control', exact: true })
    .click();
  await page.waitForFunction(async () => (await window.gleech.mcpStatus()).mode === 'full');
  await page.getByRole('button', { name: 'Connection Help' }).click();
  await page.waitForFunction(() => document.querySelector('#mcp-setup-prompt')?.value.length > 0);
  assert.equal(await page.getByRole('button', { name: 'Copy Setup Prompt' }).isDisabled(), false);
  await page.getByRole('button', { name: 'Copy Setup Prompt' }).click();
  await page
    .getByRole('dialog', { name: 'Connect Codex' })
    .getByRole('status')
    .filter({ hasText: 'Copied Codex setup prompt' })
    .waitFor();
  ownedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(ownedClipboard, offPrompt);
  assert.equal((await page.evaluate(() => window.gleech.mcpStatus())).mode, 'full');
  await page.getByRole('button', { name: 'Close connection help' }).click();
  await page
    .getByRole('group', { name: 'MCP control mode' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.waitForFunction(async () => (await window.gleech.mcpStatus()).mode === 'edit');
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, input);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('status').filter({ hasText: 'Opened source.png' }).waitFor();

  for (const [id, name, format, help] of profiles) {
    await menu();
    await page.getByLabel('MCP client', { exact: true }).selectOption(id);
    assert.ok((await page.locator('.mcp-dialog').innerText()).includes(help));
    assert.equal((await page.evaluate(() => window.gleech.mcpStatus())).mode, 'edit');
    await page.getByRole('button', { name: 'Copy Configuration', exact: true }).click();
    await page
      .locator('.mcp-dialog [role="status"]')
      .filter({ hasText: `Copied ${name} configuration` })
      .waitFor();
    const text = (ownedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText()));
    await writeFile(resolve(output, `${id}.${format}`), text);
    const config =
      format === 'json' ? JSON.parse(text) : format === 'yaml' ? parseYaml(text) : parseToml(text);
    const launch = (config.mcpServers ?? config.mcp_servers).gleech;
    await page.getByRole('button', { name: 'Connection Help', exact: true }).click();
    const helpDialog = page.getByRole('dialog', { name: `Connect ${name}`, exact: true });
    await helpDialog.waitFor();
    await page.waitForFunction(() => document.querySelector('#mcp-setup-prompt')?.value.length > 0);
    const prompt = await page
      .getByLabel('Setup prompt · includes your GLEECH configuration')
      .inputValue();
    assert.ok(prompt.includes(text.trimEnd()));
    assert.ok(prompt.includes('Preserve other servers and settings'));
    assert.ok(prompt.includes('If you cannot edit local files'));
    assert.ok(!prompt.includes('GLEECH_MCP_TOKEN'));
    await page.getByRole('button', { name: 'Copy Setup Prompt' }).click();
    await helpDialog
      .getByRole('status')
      .filter({ hasText: `Copied ${name} setup prompt` })
      .waitFor();
    ownedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(ownedClipboard, prompt);
    await captureTestWindow(app, resolve(output, `${id}-help.png`));
    assert.equal(
      await helpDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      true,
    );
    await page.getByRole('button', { name: 'Close connection help' }).click();
    assert.equal(launch.env.GLEECH_MCP_CLIENT, id === 'json' ? 'MCP client' : name);
    assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(launch.env.GLEECH_MCP_CONNECTION, resolve(profile, 'mcp-connection.json'));
    assert.ok(!('url' in launch));
    if (executablePath)
      assert.equal(
        await realpath(launch.command),
        await realpath(await app.evaluate(() => process.execPath)),
      );
    if (id === 'claude-code') assert.equal(launch.timeout, 305000);
    if (id === 'cursor') assert.equal(launch.type, 'stdio');
    if (id === 'hermes') {
      assert.equal(launch.timeout, 305);
      assert.equal(launch.supports_parallel_tool_calls, false);
    }
    if (format === 'toml') {
      assert.equal(launch.tool_timeout_sec, 305);
      assert.equal(launch.startup_timeout_sec, 20);
    }
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await page
      .locator('.mcp-dialog [role="status"]')
      .filter({ hasText: 'Connection verified · 62 tools available' })
      .waitFor();
    await captureTestWindow(app, resolve(output, `${id}-panel.png`));
    await page.getByRole('button', { name: 'Close MCP panel' }).click();

    client = new Client({ name: `Config verifier ${name}`, version: '1' });
    const transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: launch.env,
      stderr: 'pipe',
    });
    const stderr = [];
    transport.stderr.on('data', (data) => stderr.push(data.toString()));
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 62);
    const label = id === 'json' ? 'MCP client' : name;
    const status = (await call('get_mcp_status')).structuredContent;
    assert.ok(status.clients.includes(label));
    const before = (await call('get_project_state')).structuredContent;
    const nextSeed = before.masterSeed === 19314 ? 19315 : 19314;
    await call('set_master_seed', { seed: nextSeed, expectedRevision: before.revision });
    assert.equal(
      await page.getByRole('spinbutton', { name: 'Master seed' }).inputValue(),
      String(nextSeed),
    );
    const preview = await call('render_preview');
    assert.ok(
      preview.content.some(
        (content) => content.type === 'image' && content.mimeType === 'image/png',
      ),
    );
    await call('undo');
    assert.equal((await call('get_project_state')).structuredContent.masterSeed, before.masterSeed);
    await client.close();
    client = null;
    await page.waitForFunction(async () => (await window.gleech.mcpStatus()).clients.length === 0);
    verifications.push({
      id,
      format,
      launcherVerified: true,
      activityLabel: label,
      previewAndUndo: true,
      setupPromptVerified: true,
    });
  }

  // Choice persists across panel dismissal and a full app restart; control mode stays Off.
  await menu();
  await page.getByLabel('MCP client', { exact: true }).selectOption('chatgpt-desktop');
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  await closeTestApp(app);
  app = null;
  await start();
  await menu();
  assert.equal(
    await page.getByLabel('MCP client', { exact: true }).inputValue(),
    'chatgpt-desktop',
  );
  assert.equal((await page.evaluate(() => window.gleech.mcpStatus())).mode, 'off');
  assert.equal(
    await page.getByRole('button', { name: 'Copy Configuration', exact: true }).isDisabled(),
    true,
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 760));
  await captureTestWindow(app, resolve(output, 'compact-panel.png'));
  assert.equal(
    await page
      .locator('.mcp-dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    true,
  );
  await page.getByRole('button', { name: 'Connection Help' }).click();
  const compactHelp = page.getByRole('dialog', { name: 'Connect ChatGPT Desktop' });
  await compactHelp.waitFor();
  assert.equal(
    await compactHelp.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    true,
  );
  await captureTestWindow(app, resolve(output, 'compact-help.png'));
  await page.getByRole('button', { name: 'Close connection help' }).click();
  await page.getByRole('button', { name: 'Close MCP panel' }).click();
  await page.evaluate(() => localStorage.setItem('gleech.mcp.client', 'http'));
  await menu();
  assert.equal(await page.getByLabel('MCP client', { exact: true }).inputValue(), 'codex');
  assert.deepEqual(errors, []);
  const result = {
    packaged: Boolean(executablePath),
    profiles: verifications,
    persistedChoice: true,
    invalidChoiceFallback: true,
    compactLayout: true,
    errors,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    `MCP client configs${executablePath ? ' packaged' : ''}: all ${profiles.length} profiles, menu selector, labels, previews, Undo, diagnostics and persistence passed.`,
  );
  // Configuration artifacts contain paths only; the authentication token stays in the profile.
  for (const [id, , format] of profiles)
    assert.ok(!(await readFile(resolve(output, `${id}.${format}`), 'utf8')).includes('"token"'));
} catch (error) {
  if (app) await captureTestWindow(app, resolve(output, 'failure.png')).catch(() => {});
  throw error;
} finally {
  if (client) await client.close().catch(() => {});
  if (app) {
    if (ownedClipboard !== undefined)
      await app
        .evaluate(
          async ({ clipboard }, saved) => {
            if ((await clipboard.readText()) === saved.owned)
              await clipboard.writeText(saved.original);
          },
          { owned: ownedClipboard, original: originalClipboard },
        )
        .catch(() => {});
    await closeTestApp(app);
  }
}
