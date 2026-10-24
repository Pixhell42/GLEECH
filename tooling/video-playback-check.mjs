// Native playback benchmark. Reports rendered frames separately from the clock
// and decoder so a moving playhead cannot hide a stalled effects preview.
// Use --visible for performance comparisons: smoke-test windows otherwise
// throttle their compositor to 1 Hz. --cpu checks the compatibility renderer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';

const output = resolve('test-results/video-playback');
await mkdir(output, { recursive: true });
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const cpu = process.argv.includes('--cpu');
const visible = process.argv.includes('--visible');
const stress = process.argv.includes('--stress');
const shader = process.argv.includes('--shader');
const stallOnce = process.argv.includes('--stall-once');
let workerRestarts = 0;
const heights = stress ? [1440] : [1080, 2160];
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(join(output, 'profile-')),
  GLEECH_TEST_NATIVE_FRAMES: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    resolve('apps/desktop'),
    '--smoke-test',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
const results = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, visible) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960);
    if (visible) {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(1);
      window.setSkipTaskbar(true);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
    }
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, visible);
  const status = await page.evaluate(() => window.gleech.renderStatus(true));
  assert.ok(status.ok && status.value.available, 'ffmpeg is required');
  for (const height of heights) {
    const width = (height * 16) / 9;
    const clip = join(output, `long-gop-${height}.mp4`);
    if (
      !(await access(clip).then(
        () => true,
        () => false,
      ))
    ) {
      execFileSync(status.value.path, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${width}x${height}:rate=30:duration=12`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-g',
        '300',
        '-pix_fmt',
        'yuv420p',
        clip,
      ]);
    }
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, clip);
    await fileAction(page, 'Open video…');
    await page.locator('.timeline-dock').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.filmstrip img').length > 0);
    console.log(`Opened ${width}x${height} clip`);
    if (stress) await page.getByRole('button', { name: 'Play', exact: true }).click();
    for (const name of stress
      ? ['Noise / Grain', 'Mirroring', 'Spatial crush', ...(shader ? ['Shader Plasma'] : [])]
      : ['RGB split']) {
      await page
        .locator('.timeline-dock')
        .getByRole('button', { name: 'Add track', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Effect…', exact: true }).click();
      await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
    }
    if (!stress)
      await page.waitForFunction(() => {
        const node = document.querySelector('.image-layer');
        return node.dataset.renderRevision === node.dataset.requestedRevision;
      });
    const worker = page.workers().find((worker) => /effect-worker/.test(worker.url()));
    assert.ok(worker, 'effect worker is available');
    await worker.evaluate(() => {
      if (!self.__videoTimings) {
        self.__videoTimings = [];
        const starts = new Map();
        const onmessage = self.onmessage;
        const postMessage = self.postMessage.bind(self);
        self.onmessage = (event) => {
          if (event.origin !== '' && event.origin !== self.location.origin) return;
          if (event.data.kind === 'render') starts.set(event.data.id, performance.now());
          return onmessage(event);
        };
        self.postMessage = (...args) => {
          const reply = args[0];
          const start = starts.get(reply.id);
          if (['success', 'error', 'cancelled'].includes(reply.kind)) {
            starts.delete(reply.id);
            if (start !== undefined) self.__videoTimings.push(performance.now() - start);
          }
          return postMessage(...args);
        };
      }
      self.__videoTimings.length = 0;
    });
    page.on('worker', (created) => {
      if (/effect-worker/.test(created.url())) workerRestarts++;
    });
    if (stallOnce)
      await worker.evaluate(() => {
        const handler = self.onmessage;
        let dropped = false;
        self.onmessage = (event) => {
          if (event.origin !== '' && event.origin !== self.location.origin) return;
          if (!dropped && event.data.kind === 'render' && event.data.purpose === 'preview') {
            dropped = true;
            return;
          }
          handler(event);
        };
      });
    if (!stress) await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Exclude startup seek and shader compilation; sample the first traversal,
    // not a previously rendered loop from the timeline cache.
    await page.waitForTimeout(1000);
    const metrics = await page.evaluate(
      async (sampleMs) => {
        const layer = document.querySelector('.image-layer');
        const video = document.querySelector('video');
        const before = video?.getVideoPlaybackQuality();
        const startTime = video?.currentTime;
        let seeks = 0;
        const onSeek = () => seeks++;
        video?.addEventListener('seeking', onSeek);
        const frames = [];
        let compositorFrames = 0;
        let request = requestAnimationFrame(function tick() {
          compositorFrames++;
          request = requestAnimationFrame(tick);
        });
        const readbacks = [];
        const read = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (...args) {
          if (args[2] > 100 && args[3] > 100) readbacks.push([args[2], args[3]]);
          return read.apply(this, args);
        };
        const observer = new MutationObserver((changes) => {
          if (
            changes.some((change) =>
              ['interactiveRevision', 'renderRevision', 'frameKey'].some(
                (key) =>
                  change.attributeName ===
                  `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
              ),
            )
          )
            frames.push({
              time: performance.now(),
              width: Number(layer.dataset.previewWidth),
              milliseconds: Number(layer.dataset.interactiveRenderMs),
            });
        });
        observer.observe(layer, { attributes: true });
        const began = performance.now();
        await new Promise((done) => setTimeout(done, sampleMs));
        const elapsed = performance.now() - began;
        cancelAnimationFrame(request);
        observer.disconnect();
        CanvasRenderingContext2D.prototype.getImageData = read;
        video?.removeEventListener('seeking', onSeek);
        const after = video?.getVideoPlaybackQuality();
        const paintTimes = [began, ...frames.map((frame) => frame.time), began + elapsed];
        return {
          elapsedMs: Math.round(elapsed),
          renderedFrames: frames.length,
          compositorFrames,
          renderedFps: Number(((frames.length * 1000) / elapsed).toFixed(2)),
          previewWidths: [...new Set(frames.map((frame) => frame.width))],
          averagePreviewMs: Number(
            (frames.reduce((sum, frame) => sum + frame.milliseconds, 0) / frames.length).toFixed(2),
          ),
          largestFrameGapMs: Math.round(
            Math.max(...paintTimes.slice(1).map((time, index) => time - paintTimes[index])),
          ),
          readbacks: readbacks.length,
          readbackPixels: readbacks.reduce((sum, [w, h]) => sum + w * h, 0),
          readbackSizes: [...new Set(readbacks.map(([w, h]) => `${w}x${h}`))],
          seeks,
          decoderFrames: after && after.totalVideoFrames - before.totalVideoFrames,
          decoderDrops: after && after.droppedVideoFrames - before.droppedVideoFrames,
          videoSeconds: video && Number((video.currentTime - startTime).toFixed(2)),
        };
      },
      stress ? 16000 : 5000,
    );
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const workerMs = await worker
      .evaluate(() => {
        const times = self.__videoTimings;
        return Number((times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(2));
      })
      .catch(() => null);
    const result = { width, height, ...metrics, averageWorkerMs: workerMs, workerRestarts };
    results.push(result);
    console.log(JSON.stringify(result));
    assert.ok(result.renderedFrames > 0, 'playback must present processed frames');
    if (stallOnce)
      assert.ok(
        workerRestarts > 0 && result.renderedFrames >= 5,
        'a nonresponsive preview worker was replaced and playback recovered',
      );
    else if (stress)
      assert.ok(
        result.largestFrameGapMs < 1500,
        'the filtered preview continues to paint through a loop',
      );
    // Pausing must return to the full source raster.
    await page.waitForFunction((width) => {
      const node = document.querySelector('.image-layer');
      return (
        node.dataset.renderRevision === node.dataset.requestedRevision &&
        node.dataset.previewQuality === 'full' &&
        Number(node.dataset.previewWidth) === width
      );
    }, width);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, `${label}-${cpu ? 'cpu' : 'default'}.json`),
    JSON.stringify(results, null, 2),
  );
} finally {
  await closeTestApp(app);
}
