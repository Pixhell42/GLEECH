// Native menu clicks blur active text fields, just like the former toolbar actions.
export async function fileAction(page, name, { waitForOperation = true } = {}) {
  if (['Open image Ctrl+Shift+O', 'Open project Ctrl+O', 'Open video…'].includes(name))
    name = 'Open File… Ctrl+O';
  const command = (await page.evaluate(() => window.gleech.platform)) === 'darwin' ? 'Cmd' : 'Ctrl';
  const displayedName = name.replaceAll('Ctrl+', `${command}+`);
  const moved = {
    'Support GLEECH': ['Donate'],
    'Discord Community': ['Community', 'Join the Discord community'],
    'Bug Report': ['Feedback', 'Bug Report'],
    'Feature Request': ['Feedback', 'Feature Request'],
  }[name];
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (moved) {
    if (!(await settings.isVisible())) await fileAction(page, 'Settings');
    await settings
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: moved[0], exact: true })
      .click();
    if (name === 'Bug Report' || name === 'Feature Request')
      await settings.getByRole('tab', { name: moved[1], exact: true }).click();
    else if (moved[1]) await settings.getByRole('button', { name: moved[1], exact: true }).click();
    if (name === 'Discord Community')
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    return;
  }
  if (await settings.isVisible())
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
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
