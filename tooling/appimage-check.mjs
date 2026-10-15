import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'test-results'), { recursive: true });
const profile = await mkdtemp(resolve(root, 'test-results/appimage-restart-'));
assert.ok(process.argv[2], 'Usage: node tooling/appimage-check.mjs /path/to/GLEECH.AppImage');
const executablePath = resolve(process.argv[2]);
const args = [
  '--smoke-test',
  '--ozone-platform=x11',
  '--use-angle=vulkan',
  '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan',
];
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const launchDirectories = [];
async function launch(copyConfiguration = true) {
  // Extract-and-run caches by image digest inside TMPDIR. Use a short, distinct
  // temporary root per launch so CI exercises the same path change as FUSE.
  // Keep the app profile fixed so the original copied client settings are reused.
  const temporary = await mkdtemp(join(tmpdir(), 'gleech-ai-'));
  launchDirectories.push(temporary);
  const app = await electron.launch({
    executablePath,
    args,
    env: { ...env, TMPDIR: temporary },
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.gleech.mcpStatus())).mode, 'off');
    await page.getByRole('button', { name: 'File menu', exact: true }).click();
    await page
      .locator('.file-menu-items')
      .getByRole('button', { name: /MCP · AI control/ })
      .click();
    await page
      .getByRole('group', { name: 'MCP control mode' })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    let config;
    if (copyConfiguration) {
      await page.getByRole('button', { name: 'Copy Configuration', exact: true }).click();
      config = parse(await app.evaluate(({ clipboard }) => clipboard.readText())).mcp_servers
        .gleech;
    }
    const runtime = await app.evaluate(() => ({
      executable: process.execPath,
      appimage: process.env.APPIMAGE,
    }));
    assert.ok(runtime.appimage, 'Launch the actual AppImage, not an unpacked executable');
    await page.getByRole('button', { name: 'Close MCP panel' }).click();
    return { app, page, config, runtime, temporary };
  } catch (error) {
    await closeTestApp(app);
    throw error;
  }
}
async function connect(config) {
  const client = new Client({ name: 'AppImage restart test', version: '1' });
  const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
  try {
    await client.connect(transport, { timeout: 10000 });
    const tools = await client.listTools();
    const state = await client.callTool({ name: 'get_project_state', arguments: {} });
    assert.ok(!state.isError);
    const status = await client.callTool({ name: 'get_mcp_status', arguments: {} });
    assert.equal(status.structuredContent.mode, 'edit');
    assert.deepEqual(status.structuredContent.folders, []);
    assert.equal(status.structuredContent.clipboardAllowed, false);
    return { success: true, tools: tools.tools.length };
  } catch (e) {
    return { success: false, error: String(e) };
  } finally {
    await client.close();
    await transport.close();
  }
}
let first, second;
try {
  first = await launch();
  assert.equal((await connect(first.config)).success, true);
  assert.ok(
    first.config.command.startsWith(profile),
    'Saved launcher must use a stable profile path',
  );
  await closeTestApp(first.app);
  first.app = null;
  await rm(first.temporary, { recursive: true, force: true });
  await assert.rejects(access(first.runtime.executable), { code: 'ENOENT' });
  second = await launch(false);
  const old = await connect(first.config);
  assert.notEqual(
    second.runtime.executable,
    first.runtime.executable,
    'The AppImage must have remounted for this regression check',
  );
  assert(old.success, 'The saved MCP configuration must survive AppImage remounting');
  console.log(
    `AppImage MCP restart check passed (${old.tools} tools, saved configuration reused after remount, MCP Off on each launch).`,
  );
} finally {
  if (first?.app) await closeTestApp(first.app);
  if (second?.app) await closeTestApp(second.app);
  for (const temporary of launchDirectories) await rm(temporary, { recursive: true, force: true });
}
