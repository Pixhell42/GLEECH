import { _electron as electron } from 'playwright';

export function needsNativeTestFrames(options, environment = process.env) {
  return Boolean(
    options.args?.includes('--smoke-test') &&
    options.env?.GLEECH_SMOKE_USER_DATA &&
    (environment.GITHUB_ACTIONS === 'true' || environment.GLEECH_TEST_NATIVE_FRAMES === '1'),
  );
}

export const _electron = {
  async launch(options) {
    const app = await electron.launch(options);
    if (needsNativeTestFrames(options)) {
      try {
        await app.firstWindow();
        await app.evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) {
            // Hidden windows can throttle compositor frames to 1 Hz after the
            // canvas resizes, even with backgroundThrottling disabled. Keep the
            // test desktop noninteractive while exercising real native frames.
            window.webContents.setBackgroundThrottling(false);
            window.setOpacity(0);
            window.setSkipTaskbar(true);
            window.setIgnoreMouseEvents(true);
            window.showInactive();
          }
        });
      } catch (error) {
        await app.close().catch(() => {});
        throw error;
      }
    }
    return app;
  },
};
