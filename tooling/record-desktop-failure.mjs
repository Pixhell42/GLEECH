import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { captureTestWindow } from './capture-test-window.mjs';

// Capture only UI/window state. MCP configuration and connection credentials are excluded.
export async function recordDesktopFailure({ app, page, output, label, failure, errors }) {
  const captures = await Promise.allSettled([
    page?.evaluate(() => ({
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      visibility: document.visibilityState,
      busy: document.querySelector('[aria-busy]')?.getAttribute('aria-busy'),
      statuses: [...document.querySelectorAll('[role="status"]')].map((node) => {
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          text: node.textContent,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          display: style.display,
          visibility: style.visibility,
        };
      }),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      layer: {
        sourceId: document.querySelector('.image-layer')?.dataset.sourceId,
        requestedRevision: document.querySelector('.image-layer')?.dataset.requestedRevision,
        renderRevision: document.querySelector('.image-layer')?.dataset.renderRevision,
      },
    })),
    app?.evaluate(({ BrowserWindow, screen }) => ({
      runtime: process.versions,
      systemMemory: process.getSystemMemoryInfo(),
      workerJobs: globalThis.__gleechTestWorkerJobs ?? [],
      io: globalThis.__gleechTestIO ?? [],
      windows: BrowserWindow.getAllWindows().map((window) => ({
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        visible: window.isVisible(),
        minimized: window.isMinimized(),
        focused: window.isFocused(),
        loading: window.webContents.isLoading(),
      })),
      displays: screen.getAllDisplays().map(({ bounds, workArea, scaleFactor }) => ({
        bounds,
        workArea,
        scaleFactor,
      })),
    })),
    app ? captureTestWindow(app, resolve(output, `${label}-failure.png`)) : undefined,
  ]);
  const result = (index) =>
    captures[index].status === 'fulfilled' ? captures[index].value : String(captures[index].reason);
  await writeFile(
    resolve(output, `${label}-failure.json`),
    JSON.stringify(
      {
        error: failure instanceof Error ? failure.stack : String(failure),
        errors,
        renderer: result(0),
        native: result(1),
        screenshot: captures[2].status === 'fulfilled' && Boolean(app),
      },
      null,
      2,
    ),
  );
}
