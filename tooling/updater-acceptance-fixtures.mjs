import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';

export async function startUpdateFixture(config) {
  const state = { kind: 'valid', badDigest: false, slow: false, requests: [], bytesServed: 0 };
  const base = 'https://github.com/Pixhell42/GLEECH/releases/download/v0.2.1/';
  const releases = () => {
    const version = state.kind === 'same' ? '0.2.0' : state.kind === 'older' ? '0.1.2' : '0.2.1';
    let archive = config.payload.archive.replace('0.2.1', version);
    if (state.kind === 'wrong-arch')
      archive = archive.replace(
        /-(arm64|x64|x86_64)(\.zip|-setup\.exe|\.AppImage)$/,
        '-not-this-architecture$2',
      );
    return [
      {
        draft: state.kind === 'draft',
        prerelease: true,
        tag_name: `v${version}`,
        body: 'Private updater acceptance fixture notes.',
        assets: [
          ...(state.kind === 'missing-manifest' ? [] : [{ name: config.manifest }]),
          {
            name: archive,
            browser_download_url: base.replace('0.2.1', version) + archive,
            size: config.payload.bytes,
            digest: `sha256:${state.badDigest ? '0'.repeat(64) : config.payload.sha256}`,
          },
        ],
      },
    ];
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    state.requests.push({ path, range: request.headers.range ?? null, at: Date.now() });
    if (path === '/releases') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(releases()));
      return;
    }
    if (path === '/releases/download/v0.2.1/' + config.manifest) {
      const size = config.payload.bytes + (state.kind === 'invalid-manifest' ? 1 : 0);
      response.writeHead(200, { 'Content-Type': 'text/yaml' });
      response.end(
        `version: 0.2.1\nfiles:\n  - url: ${config.payload.archive}\n    sha512: ${config.payload.sha512}\n    size: ${size}\npath: ${config.payload.archive}\nsha512: ${config.payload.sha512}\nreleaseDate: '2026-10-28T00:00:00.000Z'\n`,
      );
      return;
    }
    if (path !== '/releases/download/v0.2.1/' + config.payload.archive) {
      response.writeHead(404);
      response.end();
      return;
    }
    let start = 0,
      end = config.payload.bytes - 1;
    if (request.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
      if (start > end || end >= config.payload.bytes) {
        response.writeHead(416);
        response.end();
        return;
      }
    }
    response.writeHead(request.headers.range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(request.headers.range
        ? { 'Content-Range': `bytes ${start}-${end}/${config.payload.bytes}` }
        : {}),
    });
    const stream = createReadStream(config.payload.path, { start, end, highWaterMark: 65536 });
    response.once('close', () => stream.destroy());
    stream.once('error', (error) => response.destroy(error));
    stream.on('data', (chunk) => (state.bytesServed += chunk.length));
    if (!state.slow) stream.pipe(response);
    else
      stream.on('data', (chunk) => {
        stream.pause();
        response.write(chunk);
        setTimeout(() => stream.resume(), 20);
      });
    if (state.slow) stream.once('end', () => response.end());
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(config.serverPort, '127.0.0.1', accept);
  });
  return {
    state,
    origin: `http://127.0.0.1:${config.serverPort}`,
    async close() {
      server.closeAllConnections();
      await new Promise((accept) => server.close(accept));
    },
  };
}

// Only transport and the Finder selection boundary are fixtures. No IPC handlers,
// updater methods, version values, checksum checks or installer calls are replaced.
export function installUpdateRouting(electron, config) {
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/Pixhell42/GLEECH/releases?'))
      return fetch(config.origin + '/releases', options);
    if (url.startsWith('https://github.com/Pixhell42/GLEECH/releases/download/v0.2.1/'))
      return fetch(config.origin + new URL(url).pathname + new URL(url).search, options);
    throw new Error('Unexpected network destination in updater acceptance.');
  };
  if (electron) {
    const nativeRequest = electron.net.request.bind(electron.net);
    electron.net.request = (options) => {
      const url =
        typeof options === 'string'
          ? new URL(options)
          : new URL(
              options.url ??
                `${options.protocol ?? 'https:'}//${options.hostname ?? options.host}${options.port ? ':' + options.port : ''}${options.path ?? '/'}`,
            );
      if (
        url.hostname !== 'github.com' ||
        !url.pathname.startsWith('/Pixhell42/GLEECH/releases/download/v0.2.1/')
      )
        throw new Error('Unexpected native updater destination.');
      const local = new URL(url.pathname + url.search, config.origin);
      const original = typeof options === 'string' ? {} : options;
      return nativeRequest({
        ...original,
        url: local.href,
        protocol: local.protocol,
        hostname: local.hostname,
        host: local.hostname,
        port: Number(local.port),
        path: local.pathname + local.search,
      });
    };
    electron.shell.showItemInFolder = (path) => {
      if (!/GLEECH-0\.2\.1-mac-(arm64|x64)\.zip$/.test(path))
        throw new Error('Unexpected Finder handoff.');
      // The path is recorded in memory; the driver writes the owned receipt.
      globalThis.__updaterFinderSelection = path;
      process
        .getBuiltinModule('fs')
        .writeFileSync(
          config.revealFile,
          JSON.stringify({ path, version: electron.app.getVersion() }),
        );
    };
  }
  return true;
}

// Runs in the real CLI's embedded Node runtime, then instruments its real
// terminal updater child through the main-process inspection transport.
async function routeInspector(url, expression) {
  const socket = new WebSocket(url);
  await new Promise((accept, reject) => {
    socket.addEventListener('open', accept, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  let paused;
  const pausedEvent = new Promise((accept) => (paused = accept));
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const request = pending.get(value.id);
      pending.delete(value.id);
      if (value.error) request?.reject(new Error(value.error.message));
      else request?.accept(value.result);
    } else if (value.method === 'Debugger.paused') paused();
  });
  const send = (method, params = {}) =>
    new Promise((accept, reject) => {
      const requestId = ++id;
      pending.set(requestId, { accept, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  await send('Runtime.enable');
  await send('Debugger.enable');
  await send('Runtime.runIfWaitingForDebugger');
  let timer;
  try {
    await Promise.race([
      pausedEvent,
      new Promise(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error('Terminal updater did not pause for inspection.')),
            15000,
          )),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const result = await send('Runtime.evaluate', {
    expression,
    includeCommandLineAPI: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  await send('Debugger.resume');
  socket.close();
}

export async function writeCliUpdateFixture(path, config) {
  assert.equal(config.origin, `http://127.0.0.1:${config.serverPort}`);
  const expression = `(${installUpdateRouting.toString()})(require('electron'), ${JSON.stringify(config)})`;
  const source = `const configuration = ${JSON.stringify(config)};
(${installUpdateRouting.toString()})(null, configuration);
const children = require('node:child_process');
const originalSpawn = children.spawn;
const inspect = ${routeInspector.toString()};
children.spawn = function(file, args, options) {
  if (!args.includes('--gleech-terminal-update')) return originalSpawn(file, args, options);
  if (file !== configuration.installedExecutable) throw new Error('Unexpected terminal updater executable.');
  const childEnv = { ...options.env };
  delete childEnv.NODE_OPTIONS;
  const child = originalSpawn(file, ['--inspect-brk=0', ...args], { ...options, env: childEnv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let inspecting = false;
  child.stderr.on('data', chunk => {
    require('node:fs').appendFileSync(configuration.childLog, String(chunk));
    const match = /Debugger listening on (ws:\\/\\/127\\.0\\.0\\.1:[0-9]+\\/[^\\s]+)/.exec(String(chunk));
    if (match && !inspecting) { inspecting = true; void inspect(match[1], ${JSON.stringify(expression)}).then(() => child.stderr.unref()).catch(error => { process.stderr.write(String(error) + '\\n'); child.kill(); }); }
  });
  return child;
};
`;
  await writeFile(path, source);
}
