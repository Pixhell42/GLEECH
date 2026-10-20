import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaMimeType, parseRange, serveFile } from './media-range';

describe('parseRange', () => {
  it('reads open, closed and suffix ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 });
    expect(parseRange('bytes=-300', 100)).toEqual({ start: 0, end: 99 });
    // Only the first of several ranges is served.
    expect(parseRange('bytes=0-9, 20-29', 100)).toEqual({ start: 0, end: 9 });
  });

  it('rejects ranges past the end and ignores malformed ones', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=20-10', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
  });
});

describe('serveFile', () => {
  let folder: string;
  let path: string;
  const bytes = Uint8Array.from({ length: 700 * 1024 }, (_, index) => (index * 7) & 255);

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'gleech-media-'));
    path = join(folder, 'clip.mp4');
    await writeFile(path, bytes);
  });
  afterAll(() => rm(folder, { recursive: true, force: true }));

  const same = (actual: ArrayBuffer, expected: Uint8Array) =>
    Buffer.from(actual).equals(Buffer.from(expected.buffer, expected.byteOffset, expected.length));
  const request = (headers: Record<string, string> = {}, method = 'GET') =>
    new Request('gleech-media://media/id', { method, headers });

  it('serves the whole file with range support advertised', async () => {
    const response = await serveFile(request(), path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(same(await response.arrayBuffer(), bytes)).toBe(true);
  });

  it('answers range requests with 206 and the exact bytes', async () => {
    const response = await serveFile(request({ Range: 'bytes=300000-600000' }), path);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 300000-600000/${bytes.length}`);
    expect(response.headers.get('content-length')).toBe('300001');
    expect(same(await response.arrayBuffer(), bytes.subarray(300000, 600001))).toBe(true);

    const tail = await serveFile(request({ Range: 'bytes=-10' }), path);
    expect(same(await tail.arrayBuffer(), bytes.subarray(bytes.length - 10))).toBe(true);
  });

  it('answers 416, HEAD, OPTIONS and missing files', async () => {
    const past = await serveFile(request({ Range: `bytes=${bytes.length}-` }), path);
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    const head = await serveFile(request({ Range: 'bytes=0-99' }, 'HEAD'), path);
    expect(head.status).toBe(206);
    expect(head.headers.get('content-length')).toBe('100');
    expect(await head.text()).toBe('');
    expect((await serveFile(request({}, 'OPTIONS'), path)).status).toBe(204);
    expect((await serveFile(request({}, 'POST'), path)).status).toBe(405);
    expect((await serveFile(request(), join(folder, 'missing.mp4'))).status).toBe(404);
  });

  it('cancels a stream without reading the rest', async () => {
    const response = await serveFile(request(), path);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value!.length).toBeGreaterThan(0);
    await reader.cancel();
  });

  it('labels media types', () => {
    expect(mediaMimeType('a.MOV')).toBe('video/quicktime');
    expect(mediaMimeType('a.opus')).toBe('audio/ogg');
    expect(mediaMimeType('a.gif')).toBe('image/gif');
    expect(mediaMimeType('a.xyz')).toBe('application/octet-stream');
  });
});
