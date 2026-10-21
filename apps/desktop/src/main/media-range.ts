// HTTP range serving for the gleech-media:// protocol, kept free of Electron
// imports so it can be tested with plain Request/Response objects.
import { open, type FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';

const CHUNK_BYTES = 256 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};
export function mediaMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parse a Range header against a file size. Returns null to serve the whole
 * file (no header, or one we ignore), 'unsatisfiable' for a 416, or an
 * inclusive byte range. Only the first range of a multi-range request is served.
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*(?:,|$)/i.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    // Suffix range: the last N bytes.
    const length = Number(match[2]);
    if (!length || !size) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 };
}

/** Streams [start, end] from an open file and closes it when done or cancelled. */
function fileStream(handle: FileHandle, start: number, end: number): ReadableStream<Uint8Array> {
  let position = start;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const remaining = end + 1 - position;
        if (remaining <= 0) {
          await close();
          controller.close();
          return;
        }
        const chunk = new Uint8Array(Math.min(CHUNK_BYTES, remaining));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) {
          // The file shrank while streaming.
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      } catch (error) {
        await close();
        controller.error(error);
      }
    },
    cancel: close,
  });
}

const CORS_HEADERS = {
  // Media IDs are unguessable per-session tokens; '*' lets the dev server origin
  // and file:// pages read frames into a canvas without tainting it.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

/** Serve a local file for GET/HEAD with byte-range support (200, 206 or 416). */
export async function serveFile(request: Request, path: string): Promise<Response> {
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range',
      },
    });
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch {
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }
  let size: number;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file.');
    size = stat.size;
  } catch {
    await handle.close().catch(() => {});
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }
  const range = parseRange(request.headers.get('range'), size);
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': mediaMimeType(path),
  };
  if (range === 'unsatisfiable') {
    await handle.close().catch(() => {});
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;
  if (request.method === 'HEAD' || size === 0) {
    await handle.close().catch(() => {});
    return new Response(null, { status, headers });
  }
  return new Response(fileStream(handle, start, end), { status, headers });
}
