import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const exe = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
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
  await fileAction(page, 'Support GLEECH');
  const dialog = page.getByRole('dialog');
  const checkQrFit = async () => {
    const size = await dialog.getByRole('img').evaluate((image) => {
      const frame = image.closest('.support-qr-viewport');
      const content = image.closest('.app-settings-content');
      const picture = image.getBoundingClientRect();
      const bounds = frame.getBoundingClientRect();
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: picture.width,
        height: picture.height,
        frameFits:
          frame.scrollWidth <= frame.clientWidth + 1 &&
          frame.scrollHeight <= frame.clientHeight + 1,
        contentFits:
          content.scrollWidth <= content.clientWidth + 1 &&
          content.scrollHeight <= content.clientHeight + 1,
        imageFits:
          picture.left >= bounds.left &&
          picture.top >= bounds.top &&
          picture.right <= bounds.right &&
          picture.bottom <= bounds.bottom,
      };
    });
    assert.ok(size.width >= 128 && size.height >= 128, JSON.stringify(size));
    assert.ok(
      Math.abs(size.width / size.height - size.naturalWidth / size.naturalHeight) < 0.01,
      'QR image keeps its original aspect ratio',
    );
    assert.ok(size.frameFits && size.contentFits && size.imageFits, JSON.stringify(size));
    return size;
  };
  assert.equal(await page.locator('dialog:modal').count(), 1);
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'settings-title');
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
    assert.equal(await page.locator('dialog:modal').count(), 1);
    const img = dialog.getByRole('img', { name: `${name} donation QR code` });
    await img.evaluate((n) => n.decode());
    const size = await checkQrFit();
    assert.equal(size.naturalWidth, width);
    assert.equal(size.naturalHeight, height);
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
    await fileAction(page, name);
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
    const navigation = dialog.getByRole('navigation', { name: 'Settings sections' });
    await navigation.getByRole('button', { name: 'Donate', exact: true }).click();
    await navigation.getByRole('button', { name: 'Feedback', exact: true }).click();
    assert.equal(await page.locator('dialog:modal').count(), 1);
    assert.equal(
      await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
      `Test ${name}`,
    );
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await toolbar.getByRole('button', { name: 'File menu', exact: true }).click();
  const menu = page.locator('.file-menu-items');
  assert.equal(await menu.locator(':scope > hr').count(), 4);
  assert.equal(await menu.getByRole('button', { name: 'Settings', exact: true }).count(), 1);
  assert.equal(await menu.getByRole('button', { name: 'Community', exact: true }).count(), 0);
  const bottomGroup = await menu.evaluate((n) =>
    [...n.children]
      .slice(-5, -2)
      .map((el) => (el.tagName === 'HR' ? 'separator' : el.textContent.trim())),
  );
  assert.deepEqual(bottomGroup, ['Settings', 'separator', 'Exit GLEECH Alt+F4']);
  await fileAction(page, 'Support GLEECH');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await fileAction(page, 'Bug Report');
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    'Test Bug Report',
  );
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await fileAction(page, 'Feature Request');
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    'Test Feature Request',
  );
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
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
  assert.ok(!bounds.some((b) => b.name === 'Feedback' || b.name === 'Support GLEECH'));
  await fileAction(page, 'Support GLEECH');
  await dialog.getByRole('heading', { name: 'Support GLEECH', exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${mode}-minimum-panel.png`));
  assert.ok(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
  for (const name of ['Cash App', 'Venmo', 'Bitcoin']) {
    await dialog.locator('.support-payments button').filter({ hasText: name }).click();
    await dialog.getByRole('img').evaluate((node) => node.decode());
    qrDimensions.push({ name, minimumWindow: true, ...(await checkQrFit()) });
    await captureTestWindow(
      app,
      resolve(output, `${mode}-minimum-${name.replaceAll(' ', '-')}-qr.png`),
    );
    await page.keyboard.press('Escape');
    await dialog.getByRole('heading', { name: 'Support GLEECH', exact: true }).waitFor();
  }
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
