// Native menu clicks blur active text fields, just like the former toolbar actions.
export async function fileAction(page, name, { waitForOperation = true } = {}) {
  const command = (await page.evaluate(() => window.gleech.platform)) === 'darwin' ? 'Cmd' : 'Ctrl';
  const displayedName = name.replaceAll('Ctrl+', `${command}+`);
  const toggle = page.getByRole('button', { name: 'File menu', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const groups = {
    Save: ['Save project Ctrl+S', 'Save project as… Ctrl+Shift+S'],
    Edit: ['Copy Ctrl+C', 'Paste Ctrl+V'],
    Export: [
      'Export image…',
      'Quick PNG Export Ctrl+Shift+E',
      'Render Video… Ctrl+Shift+R',
      'Export GIF… Ctrl+Shift+G',
    ],
    Library: [
      'Filters and Presets',
      'Open sample image',
      'Save Stack as Preset',
      'Import Preset',
      'Add Shader',
    ],
    Community: ['Support GLEECH', 'Discord Community', 'Bug Report', 'Feature Request'],
  };
  const group = Object.entries(groups).find(([, actions]) => actions.includes(name))?.[0];
  if (group)
    await page
      .locator('.file-menu-items')
      .getByRole('button', { name: group, exact: true })
      .click();
  await page
    .locator('.file-menu-items')
    .getByRole('button', { name: displayedName, exact: true })
    .click();
  // Exit may destroy the renderer; document-check waits for that native close.
  if (name === 'Exit GLEECH Alt+F4' || !waitForOperation) return;
  // Native image I/O can outlast a locator's short default timeout on hosted
  // Windows. Wait for the real operation to finish before reading its result.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.locator('.operation-banner').waitFor({ state: 'hidden', timeout: 180000 });
}
