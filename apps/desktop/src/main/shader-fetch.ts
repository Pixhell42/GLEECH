import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { isIP } from 'node:net';
import { decodeShaderImport, MAX_SHADER_PACKAGE_BYTES } from '@gleech/project-model/shader-package';

export function shaderUrl(value: string): URL {
  if (value.length > 2048) throw new Error('Shader URL is too long.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a direct HTTPS shader URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Shader URLs must use public HTTPS without credentials.');
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
    url.hostname = 'raw.githubusercontent.com';
    url.pathname = url.pathname.replace('/blob/', '/');
  }
  url.hash = '';
  return url;
}

export function publicShaderAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(':')[0]!, 16);
    // Global unicast only; mapped IPv4, local, multicast and transition ranges stay excluded.
    const second = Number.parseInt(address.split(':')[1] || '0', 16);
    return (
      first >= 0x2000 &&
      first < 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    );
  }
  return false;
}

async function download(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ contents: string; url: URL }> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((entry) => !publicShaderAddress(entry.address)))
    throw new Error('Shader URLs must resolve to a public internet address.');
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    // Resolve and pin each hop; redirects cannot bypass the public-address check.
    const request = get(
      {
        hostname: pinned.address,
        servername: hostname,
        port: 443,
        path: url.pathname + url.search,
        signal,
        headers: {
          Host: url.host,
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'GLEECH shader importer',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          if (!response.headers.location || redirects >= 3) {
            reject(new Error('Shader URL redirected too many times.'));
            return;
          }
          let next: URL;
          try {
            next = shaderUrl(new URL(response.headers.location, url).href);
          } catch (error) {
            reject(error);
            return;
          }
          void download(next, signal, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Shader download failed (HTTP ${status}).`));
          return;
        }
        if (/text\/html/i.test(response.headers['content-type'] ?? '')) {
          response.resume();
          reject(new Error('This URL is a web page. Use a direct shader file URL.'));
          return;
        }
        const declared = Number(response.headers['content-length']);
        if (declared > MAX_SHADER_PACKAGE_BYTES) {
          response.destroy();
          reject(new Error('Shader file exceeds 256 KiB.'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_SHADER_PACKAGE_BYTES) {
            response.destroy();
            reject(new Error('Shader file exceeds 256 KiB.'));
          } else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({ contents: Buffer.concat(chunks).toString('utf8'), url }),
        );
      },
    );
    request.on('error', reject);
  });
}

export async function fetchShader(value: string) {
  const signal = AbortSignal.timeout(15_000);
  let onAbort: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Shader download timed out.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  let result: Awaited<ReturnType<typeof download>>;
  try {
    result = await Promise.race([download(shaderUrl(value), signal), deadline]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const { contents, url } = result;
  if (/^\s*(?:<!doctype\s+html|<html)/i.test(contents))
    throw new Error('Use a direct shader file URL, rather than a web page.');
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'Imported shader');
  return decodeShaderImport(contents, name, url.href);
}
