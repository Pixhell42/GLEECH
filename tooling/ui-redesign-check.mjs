import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';

const output = resolve('test-results/ui-redesign');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({ args: [resolve('apps/desktop'), '--smoke-test'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  console.log('Test window connected');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(1440, 900);
  });
  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  console.log('Sample opened');
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Motion Mosh', exact: true })
    .click();
  const settle = async () => {
    await page.waitForFunction(() => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  };
  await settle();
  console.log('Motion Mosh rendered');
  assert.equal(
    await page
      .locator('.stack-panel .stack-comparison')
      .getByRole('button', { name: 'Edited', exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator('.stack-panel .viewport-tools').count(), 0);
  assert.equal(await page.locator('.effect-row .effect-delete').count(), 0);
  assert.equal(await page.locator('.stack-footer').count(), 0);
  assert.equal(await page.locator('.project-dimensions').count(), 0);
  assert.equal(
    await page.getByRole('button', { name: 'New seed variation', exact: true }).count(),
    0,
  );
  const visibility = page.getByRole('button', { name: 'Enable Motion Mosh 1', exact: true });
  assert.equal(await visibility.getAttribute('aria-pressed'), 'true');
  await visibility.click();
  await settle();
  assert.equal(await visibility.getAttribute('aria-pressed'), 'false');
  assert.equal(
    await page
      .locator('.image-layer')
      .evaluate((n) => JSON.parse(n.dataset.renderRecipe)[0].enabled),
    false,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await visibility.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Mask', exact: true }).click();
  const maskToggle = page.getByRole('switch', { name: 'Enable painted mask', exact: true });
  await page.locator('.mask-actions').getByRole('button', { name: 'Fill', exact: true }).click();
  await maskToggle.uncheck();
  await settle();
  assert.equal(await page.locator('.paint-mask-button.mask-disabled').count(), 1);
  assert.equal(await page.locator('.mask-paint-surface').count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Mask painting controls' }).count(), 1);
  await page.getByRole('button', { name: 'Mask', exact: true }).click({ modifiers: ['Alt'] });
  assert.equal(await maskToggle.isChecked(), true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Mask', exact: true }).click({ modifiers: ['Alt'] });
  await page.getByRole('button', { name: 'Mask', exact: true }).click();
  assert.equal(await maskToggle.isChecked(), false, 'Inspecting a disabled mask must keep it off');
  await maskToggle.check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const application = page.getByRole('combobox', { name: 'Application', exact: true });
  assert.equal(await application.evaluate((n) => getComputedStyle(n).appearance), 'base-select');
  await application.click();
  await page.getByRole('option', { name: 'Top', exact: true }).click();
  assert.equal(await application.inputValue(), 'top');
  await application.selectOption('all');
  await settle();
  const coverage = page.getByRole('slider', { name: 'Coverage', exact: true });
  await coverage.fill('0.37');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.equal(await coverage.inputValue(), '1');
  assert.equal(await coverage.evaluate((n) => n.style.getPropertyValue('--range-fill')), '100%');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await coverage.inputValue(), '0.37');
  assert.equal(await coverage.evaluate((n) => n.style.getPropertyValue('--range-fill')), '37%');
  await coverage.fill('1');
  await page.getByRole('switch', { name: 'Invert application', exact: true }).check();
  await page.getByRole('switch', { name: 'Invert application', exact: true }).uncheck();
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  assert.equal(
    await page.getByRole('slider', { name: 'Tint strength', exact: true }).isEnabled(),
    true,
  );
  await page.getByRole('switch', { name: 'Tint', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  await settle();
  for (const width of [1440, 1100, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
      width,
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    await settle();
    const toolbar = await page.locator('.toolbar').evaluate((n) => ({
      height: n.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      outside: [...n.querySelectorAll('button,input')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width && (b.left < 0 || b.right > innerWidth || b.bottom > 52);
        })
        .map((el) => el.getAttribute('aria-label') ?? el.textContent),
    }));
    assert.equal(toolbar.height, 52);
    assert.equal(toolbar.overflow, false);
    assert.deepEqual(toolbar.outside, [], `${width}px toolbar`);
    const height = await page.locator('.viewport-stage').evaluate((n) => n.clientHeight);
    await page.getByRole('button', { name: 'Expand stages', exact: true }).click();
    assert.equal(await page.locator('.viewport-stage').evaluate((n) => n.clientHeight), height);
    await page.getByRole('button', { name: 'Collapse stages', exact: true }).click();
    await settle();
    await captureTestWindow(app, resolve(output, `editor-${width}.png`));
  }
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Report title', exact: true })
    .fill('Draft survives tabs');
  await dialog.getByRole('checkbox', { name: 'Attach effect stack and seed', exact: true }).check();
  await dialog.getByRole('tab', { name: 'Feature Request', exact: true }).click();
  assert.equal(
    await dialog
      .getByRole('checkbox', { name: 'Attach effect stack and seed', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    '',
  );
  await dialog.getByRole('tab', { name: 'Bug Report', exact: true }).click();
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Report title', exact: true }).inputValue(),
    'Draft survives tabs',
  );
  assert.equal(
    await dialog
      .getByRole('checkbox', { name: 'Attach effect stack and seed', exact: true })
      .isChecked(),
    true,
  );
  assert.equal(await dialog.evaluate((n) => n.getBoundingClientRect().width), 360);
  const attachmentBounds = await dialog
    .getByRole('checkbox', { name: 'Attach effect stack and seed', exact: true })
    .boundingBox();
  assert.equal(attachmentBounds.width, 14);
  assert.equal(attachmentBounds.height, 14);
  await settle();
  await captureTestWindow(app, resolve(output, 'feedback-960.png'));
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'Feedback', exact: true })
      .evaluate((n) => n === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  assert.equal(await page.locator('.effect-row').count(), 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.locator('.effect-row').count(), 1);
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Shader Ripple', exact: true })
    .click();
  await settle();
  const mark = await page.locator('.effect-row .shader-mark').boundingBox();
  assert.ok(Math.abs(mark.width - 9.6) < 0.1);
  assert.equal(
    await page.locator('.paint-mask-button.has-mask').evaluate((n) => getComputedStyle(n).opacity),
    '1',
  );
  for (const detail of await page.locator('.status-bar > span').all())
    assert.equal((await detail.getAttribute('title')).trim(), (await detail.innerText()).trim());
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await page.getByRole('heading', { name: 'Variation', exact: true }).waitFor();
  const slider = await page
    .getByRole('slider', { name: 'GLEECH intensity', exact: true })
    .boundingBox();
  const ends = await page.locator('.variation-intensity > .quiet').boundingBox();
  assert.ok(ends.y - (slider.y + slider.height) < 2);
  await page.getByRole('button', { name: 'Close variations', exact: true }).click();
  await captureTestWindow(app, resolve(output, 'editor-polished.png'));
  assert.deepEqual(errors, []);
  console.log(
    'Redesign: toolbar sizes, canvas controls, slider fill/undo, tint, feedback tabs, attachment opt-in and delete/undo passed.',
  );
} finally {
  await closeTestApp(app);
}
