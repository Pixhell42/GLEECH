import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const mode = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve('test-results/support');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${mode}-profile-`)),
  GLEECH_SMOKE_GITHUB_CLIENT_ID: '',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  ...(exe ? { executablePath: resolve(exe) } : {}),
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ shell, clipboard, BrowserWindow }) => {
    globalThis.__supportLinks = [];
    globalThis.__supportClipboard = [];
    shell.openExternal = async (url) => {
      globalThis.__supportLinks.push(url);
    };
    clipboard.writeText = async (value) => {
      globalThis.__supportClipboard.push(value);
    };
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  const toolbar = page.locator('.toolbar');
  await toolbar.getByRole('button', { name: 'Support GLEECH', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Support GLEECH', exact: true }).waitFor();
  const socialLinks = [
    ['X · @pixhell', 'https://x.com/pixhell'],
    ['GitHub · Pixhell42', 'https://github.com/Pixhell42'],
    ['Star GLEECH on GitHub', 'https://github.com/Pixhell42/GLEECH'],
    ['X · @mjestichooligan', 'https://x.com/mjestichooligan'],
    ['YouTube · @majestichooligan', 'https://www.youtube.com/@majestichooligan'],
    ['slop.cc', 'https://slop.cc'],
  ];
  for (const [name, href] of socialLinks) {
    const link = dialog.getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    await link.click();
  }
  await captureTestWindow(app, resolve(output, `${mode}-panel.png`));
  const qrDimensions = [];
  for (const [name, handle, width, height, href] of [
    ['Cash App', '$Pixhell', 1028, 1028, 'https://cash.app/$Pixhell'],
    ['Venmo', '@pixhell', 640, 646, 'https://venmo.com/pixhell'],
    [
      'Bitcoin',
      'bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p',
      1224,
      1224,
      'bitcoin:bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p',
    ],
  ]) {
    await dialog.locator('.support-payments button').filter({ hasText: name }).click();
    const img = dialog.getByRole('img', { name: `${name} donation QR code` });
    await img.evaluate((n) => n.decode());
    const size = await img.evaluate((n) => ({
      naturalWidth: n.naturalWidth,
      naturalHeight: n.naturalHeight,
      width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height,
    }));
    assert.equal(size.naturalWidth, width);
    assert.equal(size.naturalHeight, height);
    assert.ok(Math.abs(size.width - width * 0.4) < 0.1);
    assert.ok(Math.abs(size.height - height * 0.4) < 0.1);
    qrDimensions.push({ name, ...size });
    assert.equal(await dialog.locator('.support-destination').textContent(), handle);
    const link = dialog.getByRole('link');
    assert.equal(await link.getAttribute('href'), href);
    await link.click();
    await dialog
      .getByRole('button', { name: name === 'Bitcoin' ? 'Copy Address' : 'Copy Link', exact: true })
      .click();
    await dialog.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
    await captureTestWindow(app, resolve(output, `${mode}-${name.replaceAll(' ', '-')}-qr.png`));
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  for (const name of ['Bug Report', 'Feature Request']) {
    await toolbar.getByRole('button', { name: 'Feedback', exact: true }).click();
    await dialog.getByRole('tab', { name, exact: true }).click();
    await dialog.getByRole('heading', { name, exact: true }).waitFor();
    await dialog
      .getByText('GitHub sign-in is not configured for this build yet.', { exact: true })
      .waitFor();
    assert.equal(
      await dialog.getByRole('button', { name: 'Sign in with GitHub', exact: true }).isEnabled(),
      false,
    );
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).fill(`Test ${name}`);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await toolbar.getByRole('button', { name: 'File menu', exact: true }).click();
  const menu = page.locator('.file-menu-items');
  assert.equal(await menu.locator(':scope > hr').count(), 4);
  await menu.getByRole('button', { name: 'Community', exact: true }).click();
  assert.deepEqual(
    await menu
      .getByRole('group', { name: 'Community', exact: true })
      .locator('button')
      .allTextContents(),
    ['Support GLEECH', 'Discord Community', 'Bug Report', 'Feature Request'],
  );
  const bottomGroup = await menu.evaluate((n) =>
    [...n.children]
      .slice(-5, -2)
      .map((el) => (el.tagName === 'HR' ? 'separator' : el.textContent.trim())),
  );
  assert.deepEqual(bottomGroup, [
    'CommunitySupport GLEECHDiscord CommunityBug ReportFeature Request',
    'separator',
    'Exit GLEECH Alt+F4',
  ]);
  await fileAction(page, 'Support GLEECH');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Close support panel', exact: true }).click();
  await fileAction(page, 'Bug Report');
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    'Test Bug Report',
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await fileAction(page, 'Feature Request');
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    'Test Feature Request',
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const opened = await app.evaluate(() => globalThis.__supportLinks);
  assert.deepEqual(opened, [
    ...socialLinks.map(([, url]) => url),
    'https://cash.app/$Pixhell',
    'https://venmo.com/pixhell',
    'bitcoin:bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p',
  ]);
  assert.equal(opened.length, socialLinks.length + 3);
  assert.deepEqual(await app.evaluate(() => globalThis.__supportClipboard), [
    'https://cash.app/$Pixhell',
    'https://venmo.com/pixhell',
    'bc1qld56wsqdvzgs9kffyse6zww95alk76zgq20h4p',
  ]);
  assert.equal(
    (await page.evaluate(() => window.gleech.openSupportLink('https://example.com'))).ok,
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.gleech.copySupportDestination('unknown'))).ok,
    false,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  const bounds = await toolbar.evaluate((n) =>
    [...n.querySelectorAll('button, input')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        name: el.getAttribute('aria-label') ?? el.textContent.trim(),
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
      })),
  );
  assert.ok(
    bounds.every((b) => b.left >= 0 && b.right <= 960 && b.top >= 0 && b.bottom <= 72),
    JSON.stringify(bounds),
  );
  const gleech = bounds.find((b) => b.name === 'GLEECH');
  const feedback = bounds.find((b) => b.name === 'Feedback');
  assert.ok(gleech.right + 12 <= feedback.left, JSON.stringify({ gleech, feedback }));
  await toolbar.getByRole('button', { name: 'Support GLEECH', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Support GLEECH', exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${mode}-minimum-panel.png`));
  assert.ok(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
  await dialog.locator('.support-payments button').filter({ hasText: 'Bitcoin' }).click();
  assert.ok(
    Math.abs(
      (await dialog.getByRole('img').evaluate((n) => n.getBoundingClientRect().width)) - 489.6,
    ) < 0.1,
  );
  assert.ok(
    await dialog
      .locator('.support-qr-viewport')
      .evaluate((n) => n.scrollWidth <= n.clientWidth && n.scrollHeight > n.clientHeight),
  );
  await page.keyboard.press('Escape');
  await dialog.getByRole('heading', { name: 'Support GLEECH', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${mode}-result.json`),
    JSON.stringify({ mode, qrDimensions, openedLinks: opened.length, errors }, null, 2),
  );
  console.log(JSON.stringify({ mode, qrDimensions, openedLinks: opened.length, errors }));
} finally {
  await closeTestApp(app);
}
