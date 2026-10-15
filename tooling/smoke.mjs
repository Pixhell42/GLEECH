import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.argv[2];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.GLEECH_SMOKE_USER_DATA = resolve(root, 'test-results/profile');
await mkdir(env.GLEECH_SMOKE_USER_DATA, { recursive: true });
const app = await electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  args: executablePath ? ['--smoke-test'] : [resolve(root, 'apps/desktop'), '--smoke-test'],
  env,
  timeout: 30000,
});

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  assert.equal(await page.title(), 'Untitled — GLEECH');
  const seed = page.getByRole('spinbutton', { name: 'Master seed' });
  assert.equal(await seed.inputValue(), '8172');
  await seed.fill('991');
  assert.equal(await seed.inputValue(), '991');
  assert.equal(await page.evaluate(() => window.gleech.platform), 'win32');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const settings = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(settings.contextIsolation, true);
  assert.equal(settings.sandbox, true);
  assert.equal(settings.nodeIntegration, false);
  assert.deepEqual(errors, []);
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'test-results/desktop-smoke.png') });
  console.log(`Windows desktop smoke passed (${executablePath ? 'packaged' : 'built'} app).`);
} finally {
  await closeTestApp(app);
}
