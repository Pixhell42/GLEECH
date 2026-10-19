import { deflateSync, inflateSync } from 'node:zlib';

// Dependency-free PNG codec. The CLI prefers Sharp (the desktop app's codec);
// this keeps PNG input/output working when Sharp's native binary is unavailable.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface RgbaImage {
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && Buffer.from(bytes.subarray(0, 8)).equals(SIGNATURE);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(input: Uint8Array, maxPixels = 64 * 1024 * 1024): RgbaImage {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!isPng(bytes)) throw new Error('Not a PNG file.');
  let offset = 8;
  let width = 0,
    height = 0,
    depth = 0,
    colorType = 0,
    interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) throw new Error('The PNG file is truncated.');
    if (
      bytes.readUInt32BE(offset + 8 + length) !==
      crc32(bytes.subarray(offset + 4, offset + 8 + length))
    )
      throw new Error('Invalid PNG chunk checksum.');
    if (body.length !== length) throw new Error('The PNG file is truncated.');
    offset += 12 + length;
    if (type === 'IHDR') {
      if (length !== 13 || width || offset !== 33) throw new Error('Invalid PNG header.');
      if (body[10] !== 0 || body[11] !== 0)
        throw new Error('Unsupported PNG compression or filter method.');
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
  }
  if (!width || !height || width > 32768 || height > 32768 || width * height > maxPixels)
    throw new Error('Invalid PNG dimensions.');
  if (interlace !== 0) throw new Error('Interlaced PNGs need Sharp. Run pnpm install.');
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error('Unsupported PNG bit depth.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('Unsupported PNG color type.');
  if ((colorType !== 0 && colorType !== 3 && depth < 8) || (colorType === 3 && depth === 16))
    throw new Error('Invalid PNG color depth.');
  if (transparency && colorType !== 3 && !(colorType === 0 && depth <= 8))
    throw new Error('This PNG transparency format needs Sharp.');
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const expectedBytes = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expectedBytes });
  if (raw.length !== expectedBytes) throw new Error('Invalid PNG decompressed size.');
  if (raw.length < (stride + 1) * height) throw new Error('The PNG image data is incomplete.');
  const rows = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = previous[x]!;
      const c = x >= bpp ? previous[x - bpp]! : 0;
      const value = line[x]!;
      row[x] =
        filter === 0
          ? value
          : filter === 1
            ? value + a
            : filter === 2
              ? value + b
              : filter === 3
                ? value + ((a + b) >> 1)
                : filter === 4
                  ? value + paeth(a, b, c)
                  : -1;
      if (filter > 4) throw new Error('Invalid PNG row filter.');
    }
    previous = row;
  }
  const out = new Uint8Array(width * height * 4);
  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return row[index * 2]!;
    const perByte = 8 / depth;
    const byte = row[Math.floor(index / perByte)]!;
    const shift = 8 - depth * ((index % perByte) + 1);
    const value = (byte >> shift) & ((1 << depth) - 1);
    return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  const trnsGray = transparency && colorType === 0 ? transparency.readUInt16BE(0) : -1;
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (colorType === 3) {
        const index = sample(row, i);
        if (!palette || index * 3 + 2 >= palette.length) throw new Error('Invalid PNG palette.');
        out[o] = palette[index * 3]!;
        out[o + 1] = palette[index * 3 + 1]!;
        out[o + 2] = palette[index * 3 + 2]!;
        out[o + 3] = transparency && index < transparency.length ? transparency[index]! : 255;
      } else if (colorType === 0 || colorType === 4) {
        const gray = sample(row, i);
        out[o] = out[o + 1] = out[o + 2] = gray;
        out[o + 3] =
          colorType === 4
            ? sample(row, i + 1)
            : trnsGray >= 0 &&
                depth <= 8 &&
                gray === Math.round((trnsGray * 255) / ((1 << depth) - 1))
              ? 0
              : 255;
      } else {
        out[o] = sample(row, i);
        out[o + 1] = sample(row, i + 1);
        out[o + 2] = sample(row, i + 2);
        out[o + 3] = colorType === 6 ? sample(row, i + 3) : 255;
      }
    }
  }
  return { width, height, pixels: out.buffer };
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * RGBA 8-bit PNG with per-row adaptive filtering. `text` adds tEXt entries.
 * `fast` uses the Sub filter and light compression for live terminal previews.
 */
export function encodePng(
  image: RgbaImage,
  text: Record<string, string> = {},
  { fast = false, xmp }: { fast?: boolean; xmp?: string } = {},
): Buffer {
  const { width, height } = image;
  const pixels = new Uint8Array(image.pixels);
  if (pixels.length !== width * height * 4) throw new Error('Invalid export pixels.');
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let bestScore = Infinity;
    for (let filter = fast ? 1 : 0; filter < (fast ? 2 : 5); filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4]! : 0;
        const b = up ? up[x]! : 0;
        const c = up && x >= 4 ? up[x - 4]! : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? (a + b) >> 1
                  : paeth(a, b, c);
        const value = (row[x]! - predictor) & 0xff;
        candidate[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        filtered[y * (stride + 1)] = filter;
        filtered.set(candidate, y * (stride + 1) + 1);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...Object.entries(text).map(([key, value]) =>
      chunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1')),
    ),
    ...(xmp
      ? [
          chunk(
            'iTXt',
            Buffer.concat([
              Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'),
              Buffer.from(xmp, 'utf8'),
            ]),
          ),
        ]
      : []),
    chunk('IDAT', deflateSync(filtered, { level: fast ? 1 : 6 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Area-averaging resize for previews; exact for integer reductions. */
export function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) return image;
  const src = new Uint8Array(image.pixels);
  const out = new Uint8Array(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * sx)));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.width + xx) * 4;
          const alpha = src[i + 3]!;
          r += src[i]! * alpha;
          g += src[i + 1]! * alpha;
          b += src[i + 2]! * alpha;
          a += alpha;
          n++;
        }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, pixels: out.buffer };
}
