import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';

const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const configuredClient = process.argv.includes('--configured-client');
const expectedClientId = configuredClient
  ? JSON.parse(await readFile(resolve('apps/desktop/src/shared/feedback-github.json'), 'utf8'))
      .clientId
  : 'fixture-public-client-id';
assert.ok(expectedClientId, 'Configure the public GitHub App Client ID first.');
const mode = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${configuredClient ? '-configured' : ''}`;
const output = resolve('test-results/github-feedback');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${mode}-profile-`));
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: profile,
  GLEECH_SMOKE_GITHUB_CLIENT_ID: 'fixture-public-client-id',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
if (configuredClient) delete env.GLEECH_SMOKE_GITHUB_CLIENT_ID;
async function launch() {
  const app = await electron.launch({
    args: [
      ...(exe ? [] : [resolve('apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    ...(exe ? { executablePath: resolve(exe) } : {}),
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ shell, clipboard, BrowserWindow }, expectedClientId) => {
    globalThis.__feedbackLinks = [];
    globalThis.__feedbackClipboard = [];
    globalThis.__feedbackCalls = [];
    globalThis.__feedbackIssueBodies = [];
    globalThis.__feedbackPolls = 0;
    globalThis.__feedbackPostAttempts = 0;
    shell.openExternal = async (url) => {
      globalThis.__feedbackLinks.push(url);
    };
    clipboard.writeText = (text) => {
      globalThis.__feedbackClipboard.push(text);
    };
    // All network destinations are intercepted. Unexpected requests fail instead of reaching GitHub.
    globalThis.fetch = async (url, init) => {
      globalThis.__feedbackCalls.push({ url, method: init?.method ?? 'GET' });
      const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
      if (
        url === 'https://github.com/login/device/code' ||
        url === 'https://github.com/login/oauth/access_token'
      ) {
        if (new URLSearchParams(init.body).get('client_id') !== expectedClientId)
          throw new Error('The bundled public Client ID does not match the configured ID.');
      }
      if (url === 'https://github.com/login/device/code')
        return reply({
          device_code: 'fixture-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        });
      if (url === 'https://github.com/login/oauth/access_token') {
        globalThis.__feedbackPolls++;
        return reply(
          globalThis.__feedbackPolls === 1
            ? { error: 'authorization_pending' }
            : { access_token: 'fixture-private-token', expires_in: 28800 },
        );
      }
      if (url === 'https://api.github.com/user') return reply({ login: 'FixtureTester' });
      if (
        url === 'https://api.github.com/repos/Pixhell42/GLEECH/issues' &&
        init?.method === 'POST'
      ) {
        globalThis.__feedbackPostAttempts++;
        if (globalThis.__feedbackPostAttempts === 1)
          return reply({ message: 'Fixture permission error' }, 403);
        const issue = JSON.parse(init.body);
        globalThis.__feedbackIssueBodies.push(issue);
        const number = 40 + globalThis.__feedbackPostAttempts;
        return reply(
          { number, html_url: `https://github.com/Pixhell42/GLEECH/issues/${number}` },
          201,
        );
      }
      throw new Error('Unexpected fixture network destination');
    };
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  }, expectedClientId);
  return { app, page };
}
let instance = await launch();
const errors = [];
try {
  let { app, page } = instance;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Bit crush', exact: true })
    .click();
  await page.locator('.toolbar').getByRole('button', { name: 'Feedback', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const title = dialog.getByRole('textbox', { name: 'Report title', exact: true });
  const description = dialog.getByRole('textbox', { name: 'Report description', exact: true });
  await dialog.getByRole('checkbox', { name: 'Attach effect stack and seed', exact: true }).check();
  await title.fill('Fixture preview bug');
  await description.fill('The preview behaves unexpectedly.');
  await dialog.locator('.feedback-extra summary').click();
  await dialog
    .getByRole('textbox', { name: 'Steps to reproduce', exact: true })
    .fill('Open sample and change a setting.');
  await dialog
    .getByRole('textbox', { name: 'Expected behavior', exact: true })
    .fill('Show the edited preview.');
  assert.equal(
    await dialog.getByRole('button', { name: 'Submit to GitHub', exact: true }).isEnabled(),
    false,
  );
  await dialog.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
  await dialog.getByText('ABCD-EFGH', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Copy Code', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.__feedbackClipboard), ['ABCD-EFGH']);
  await captureTestWindow(app, resolve(output, `${mode}-sign-in.png`));
  await dialog.getByText('FixtureTester', { exact: true }).waitFor({ timeout: 20000 });
  assert.deepEqual(await page.evaluate(() => window.gleech.feedbackStatus()), {
    ok: true,
    value: { configured: true, login: 'FixtureTester' },
  });
  await dialog.getByRole('button', { name: 'Submit to GitHub', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'cannot create issues' }).waitFor();
  assert.equal(await title.inputValue(), 'Fixture preview bug');
  assert.equal(await description.inputValue(), 'The preview behaves unexpectedly.');
  await dialog.getByRole('button', { name: 'Submit to GitHub', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'submitted as #42' }).waitFor();
  await captureTestWindow(app, resolve(output, `${mode}-submitted.png`));
  await dialog.getByRole('button', { name: 'View on GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await fileAction(page, 'Feature Request');
  await dialog.getByRole('textbox', { name: 'Report title', exact: true }).fill('Fixture feature');
  await dialog
    .getByRole('textbox', { name: 'Report description', exact: true })
    .fill('Add an interesting control.');
  await dialog.locator('.feedback-extra summary').click();
  await dialog
    .getByRole('textbox', { name: 'Problem or use case', exact: true })
    .fill('Help editing.');
  await dialog
    .getByRole('textbox', { name: 'Suggested behavior', exact: true })
    .fill('Make it adjustable.');
  await dialog.getByRole('button', { name: 'Submit to GitHub', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'submitted as #43' }).waitFor();
  const bodies = await app.evaluate(() => globalThis.__feedbackIssueBodies);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].title, '[Bug] Fixture preview bug');
  assert.ok(bodies[0].body.includes('### Steps to reproduce\n\nOpen sample and change a setting.'));
  assert.ok(bodies[0].body.includes('OS: win32'));
  assert.ok(bodies[0].body.includes('### Effect stack and seed'));
  assert.ok(bodies[0].body.includes('"type": "bit-crush"'));
  assert.ok(!bodies[0].body.includes('data:image/'));
  assert.ok(!bodies[1].body.includes('### Effect stack and seed'));
  assert.ok(!JSON.stringify(bodies).includes('fixture-private-token'));
  assert.equal(bodies[1].title, '[Feature] Fixture feature');
  assert.ok(bodies[1].body.includes('### Suggested behavior\n\nMake it adjustable.'));
  assert.deepEqual(await app.evaluate(() => globalThis.__feedbackLinks), [
    'https://github.com/login/device',
    'https://github.com/Pixhell42/GLEECH/issues/42',
  ]);
  for (const number of [0, -1, 1.5, 'https://other.example'])
    assert.equal(
      (await page.evaluate((number) => window.gleech.openFeedbackIssue(number), number)).ok,
      false,
    );
  const authPath = resolve(profile, 'feedback-github.bin');
  const encrypted = await readFile(authPath);
  assert.ok(!encrypted.toString().includes('fixture-private-token'));
  await closeTestApp(app);
  instance = await launch();
  ({ app, page } = instance);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await fileAction(page, 'Bug Report');
  dialog = page.getByRole('dialog');
  await dialog.getByText('FixtureTester', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.__feedbackCalls), []);
  assert.ok(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${mode}-minimum-form.png`));
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await dialog.getByText('Connect GitHub to submit from GLEECH.', { exact: true }).waitFor();
  await assert.rejects(access(authPath));
  assert.equal((await page.evaluate(() => window.gleech.openFeedbackSignIn())).ok, false);
  assert.equal((await page.evaluate(() => window.gleech.copyFeedbackSignInCode())).ok, false);
  await dialog.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
  await dialog.getByText('ABCD-EFGH', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel Sign-in', exact: true }).click();
  assert.equal((await page.evaluate(() => window.gleech.pollFeedbackSignIn())).ok, false);
  assert.deepEqual(errors, []);
  const result = {
    mode,
    simulatedIssues: bodies.length,
    encryptedCredentialPersistence: true,
    permissionRetry: true,
    errors,
  };
  await writeFile(resolve(output, `${mode}-result.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await closeTestApp(instance.app);
}
