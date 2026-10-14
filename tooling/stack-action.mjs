// The redesigned stack has one delete action in its heading. Select the row
// explicitly to preserve the old tests' behavior of deleting the first effect.
export async function deleteFirstEffect(page) {
  const rows = page.locator('.effect-row');
  const count = await rows.count();
  await rows.first().locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.effect-row').length === expected,
    count - 1,
  );
}
