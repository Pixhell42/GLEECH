// Runs in the actual executable being reviewed, including ELECTRON_RUN_AS_NODE.
// Fixtures and network traffic are confined to the provided scratch folder and
// loopback. A successful probe supplements, rather than replaces, source review.
import assert from 'node:assert/strict';
import dns from 'node:dns';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const probeFile = fileURLToPath(import.meta.url);

if (process.argv[2] === '--permission-child') {
  try {
    fs.realpathSync(process.argv[3]);
    console.log(JSON.stringify({ denied: false }));
  } catch (error) {
    console.log(JSON.stringify({ denied: error.code === 'ERR_ACCESS_DENIED', code: error.code }));
  }
} else {
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 2;
  });
}

async function main() {
  const scratch = process.argv[2];
  assert.ok(
    scratch && fs.statSync(scratch).isDirectory(),
    'Supply the isolated scratch directory.',
  );
  const checks = [];
  const check = async (name, cves, action) => {
    try {
      const details = await action();
      checks.push({ name, cves, passed: true, details });
    } catch (error) {
      checks.push({ name, cves, passed: false, error: error.message });
    }
  };

  await check('v8-json-escaped-keys', [], () => {
    // Run V8's unchanged six-case regression in an independent JS context.
    const script = fs.readFileSync(
      new URL('./fixtures/v8-json-escaped-keys.txt', import.meta.url),
      'utf8',
    );
    runInNewContext(
      script,
      {
        assertArrayEquals(expected, actual) {
          assert.deepEqual(Array.from(actual), Array.from(expected));
        },
        assertEquals: assert.equal,
      },
      { timeout: 5000 },
    );
    return { upstreamCommit: '93cd21e8254b65c15ff131b2dcadf19beadb559d', cases: 6 };
  });

  await check('dns-nul-validation', ['CVE-2026-105482'], async () => {
    const sink = dgram.createSocket('udp4');
    let packets = 0;
    sink.on('message', () => packets++);
    await new Promise((resolve, reject) => {
      sink.once('error', reject);
      sink.bind(0, '127.0.0.1', resolve);
    });
    const server = `127.0.0.1:${sink.address().port}`;
    const callbackResolver = new dns.Resolver({ timeout: 100, tries: 1 });
    const promiseResolver = new dns.promises.Resolver({ timeout: 100, tries: 1 });
    callbackResolver.setServers([server]);
    promiseResolver.setServers([server]);
    const name = 'fixture.invalid\0.trusted.invalid';
    const failures = [];
    try {
      for (const method of ['resolve4', 'resolve6', 'resolveAny', 'resolveMx', 'resolveTxt']) {
        let code;
        try {
          callbackResolver[method](name, () => {});
        } catch (error) {
          code = error.code;
        }
        if (code !== 'ERR_INVALID_ARG_VALUE') failures.push(`${method} accepted a NUL`);
        await assert.rejects(async () => promiseResolver[method](name), {
          code: 'ERR_INVALID_ARG_VALUE',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.deepEqual(failures, []);
      assert.equal(packets, 0, 'Invalid names must be rejected before any DNS packet is emitted.');
      return { packets, methods: 10, synchronousCallbackRejection: true };
    } finally {
      callbackResolver.cancel();
      promiseResolver.cancel();
      sink.close();
    }
  });

  await check(
    'tls-noncanonical-hostnames',
    ['CVE-2026-105483', 'CVE-2026-106069', 'CVE-2026-106072'],
    () => {
      const hosts = [
        ['0127.0.0.1', '87.0.0.1'],
        ['0177.0.0.1', '127.0.0.1'],
        ['0x7f.0.0.1', '127.0.0.1'],
        ['2130706433', '127.0.0.1'],
        ['127.1', '127.0.0.1'],
        ['\uFF11\uFF12\uFF17.0.0.1', '127.0.0.1'],
        ['127\u30020.0.1', '127.0.0.1'],
      ];
      for (const [host, canonical] of hosts) {
        const error = tls.checkServerIdentity(host, {
          subjectaltname: `DNS:${canonical}`,
          subject: {},
        });
        assert.equal(error?.code, 'ERR_TLS_CERT_ALTNAME_INVALID', host);
      }
      assert.equal(
        tls.checkServerIdentity('127.0.0.1', { subjectaltname: 'IP Address:127.0.0.1' }),
        undefined,
      );
      assert.equal(
        tls.checkServerIdentity('fixture.invalid', { subjectaltname: 'DNS:fixture.invalid' }),
        undefined,
      );
      return { rejected: hosts.length, validControls: 2 };
    },
  );

  await check('brotli-block-switch-and-roundtrip', ['CVE-2026-111497'], () => {
    assert.equal(zlib.constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17);
    const original = Buffer.from('GLEECH security runtime fixture.\n'.repeat(100));
    assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(original)), original);
    return { blockSwitchError: -17, roundtrip: true, malformedExploitNotExecuted: true };
  });

  await check('http-agent-pending-read', ['CVE-2026-105481'], async () => {
    for (const queued of [false, true]) await checkAgent(queued);
    return { idleSocket: true, queuedRequest: true };
  });

  await check('permission-realpath-sync', ['CVE-2026-106073'], () => {
    const allowed = path.join(scratch, 'allowed');
    const denied = path.join(scratch, 'denied');
    fs.mkdirSync(allowed);
    fs.mkdirSync(denied);
    const fixture = path.join(denied, 'private-fixture.txt');
    fs.writeFileSync(fixture, 'An isolated test file, not user data.');
    const child = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${probeFile}`,
        `--allow-fs-read=${allowed}`,
        probeFile,
        '--permission-child',
        fixture,
      ],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, env: process.env },
    );
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.denied, true, JSON.stringify(result));
    return result;
  });

  console.log(
    JSON.stringify({
      schemaVersion: 1,
      executable: process.execPath,
      platform: process.platform,
      arch: process.arch,
      versions: process.versions,
      checks,
      passed: checks.every((result) => result.passed),
      limitations: [
        'Snapshot randomness requires source review and upstream tests; Electron does not support user-land --build-snapshot.',
        'Brotli memory-safety coverage also requires the compiled Chromium source revision; no malformed exploit is executed.',
        'Node dependency versions and passing behavioral checks alone do not attest the build provenance.',
      ],
    }),
  );
}

async function checkAgent(queued) {
  let serverSocket;
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    serverSocket ??= request.socket;
    response.end(request.url);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const agent = new http.Agent({ keepAlive: true, ...(queued ? { maxSockets: 1 } : {}) });
  const options = { host: '127.0.0.1', port: server.address().port, agent };
  const response = (request) =>
    new Promise((resolve, reject) => {
      request.once('error', reject);
      request.once('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.once('error', reject);
        res.once('end', () => {
          try {
            assert.equal(res.headers['x-poisoned'], undefined);
            assert.equal(body, request.path);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    });
  const poison = (socket) => {
    serverSocket.write(
      'HTTP/1.1 200 OK\r\nX-Poisoned: true\r\nConnection: keep-alive\r\nContent-Length: 0\r\n\r\n',
    );
    assert.equal(typeof socket._handle?.hasPendingRead, 'function');
    const deadline = Date.now() + 5000;
    while (!socket._handle.hasPendingRead()) {
      assert.ok(Date.now() < deadline, 'Timed out waiting for loopback socket data.');
    }
  };
  try {
    // A JavaScript-only idle listener cannot detect data still in the kernel.
    assert.equal(typeof server._handle?.hasPendingRead, 'function');
    const first = http.request({ ...options, path: '/first' });
    let firstSocket;
    first.once('socket', (socket) => {
      firstSocket = socket;
    });
    const firstClosed = new Promise((resolve) =>
      first.once('close', () => process.nextTick(resolve)),
    );
    const firstResponse = response(first);
    first.end();
    if (queued) {
      const second = http.request({ ...options, path: '/second' });
      const secondResponse = response(second);
      second.end();
      first.on('response', (res) => res.once('end', () => poison(firstSocket)));
      await Promise.all([firstResponse, secondResponse]);
      assert.equal(firstSocket.destroyed, true);
      assert.equal(second.reusedSocket, false);
    } else {
      await firstResponse;
      await firstClosed;
      const idle = agent.freeSockets[agent.getName(options)]?.[0];
      assert.ok(idle);
      poison(idle);
      const second = http.request({ ...options, path: '/second' });
      const secondResponse = response(second);
      second.end();
      assert.equal(idle.destroyed, true);
      assert.equal(second.reusedSocket, false);
      await secondResponse;
    }
  } finally {
    agent.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}
