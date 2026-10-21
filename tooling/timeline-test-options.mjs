import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Accept native Mac executables, Linux launchers/AppImages and Windows EXEs.
// A packaged target must never fall back to the development app.
export function timelineTestOptions(argv, profile, environment = process.env) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  assert.ok(positional.length <= 1, 'Supply at most one packaged executable.');
  for (const arg of argv.filter((arg) => arg.startsWith('--')))
    assert.ok(
      ['--cpu', '--require-webgpu', '--require-ffmpeg'].includes(arg),
      `Unknown timeline test option: ${arg}`,
    );
  const executablePath = positional[0] && resolve(positional[0]);
  const cpu = argv.includes('--cpu');
  const requireWebgpu = argv.includes('--require-webgpu');
  assert.ok(!(cpu && requireWebgpu), 'Choose CPU or required WebGPU, not both.');
  const env = { ...environment, GLEECH_SMOKE_USER_DATA: profile, GLEECH_TEST_NATIVE_FRAMES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  return {
    cpu,
    requireWebgpu,
    requireFfmpeg: Boolean(executablePath) || argv.includes('--require-ffmpeg'),
    launch: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : [resolve('apps/desktop')]),
        '--smoke-test',
        ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
      ],
      env,
      timeout: 30000,
    },
  };
}

export async function verifyTimelineBackend(page, options) {
  const backend = await page.locator('footer').getAttribute('data-render-backend');
  if (options.cpu) assert.equal(backend, 'cpu', 'The timeline must use the requested CPU backend.');
  if (options.requireWebgpu)
    assert.equal(backend, 'webgpu', 'The native GPU test must not silently use CPU fallback.');
  console.log('Timeline backend:', backend);
}

export async function verifyTimelineRuntime(app, options) {
  const runtime = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    executable: process.execPath,
    appimage: Boolean(process.env.APPIMAGE),
  }));
  assert.equal(runtime.packaged, Boolean(options.launch.executablePath));
  assert.equal(runtime.platform, process.platform);
  assert.equal(runtime.arch, process.arch);
  if (options.launch.executablePath?.endsWith('.AppImage'))
    assert.ok(runtime.appimage, 'Exercise the actual AppImage runtime.');
  console.log('Timeline runtime:', JSON.stringify(runtime));
}
