// General test cleanup must not enter the asynchronous unsaved-work close flow.
// snapshot-check and document-check exercise native guarded closes explicitly.
export async function closeTestApp(app) {
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    );
  } catch {
    /* A test may already have closed the application. */
  }
  await app.close();
}
