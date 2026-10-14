import { writeFile } from 'node:fs/promises';

// Hidden smoke windows can stop delivering compositor frames after a resize.
// Electron's capture API explicitly keeps the window hidden and awake.
export async function captureTestWindow(app, path) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    if (image.isEmpty()) throw new Error('The test window capture was empty.');
    return image.toPNG().toString('base64');
  });
  await writeFile(path, Buffer.from(png, 'base64'));
}
