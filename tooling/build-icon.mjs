import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const beta = process.argv.includes('--beta');
const name = beta ? 'icon-beta' : 'icon';
const source = resolve(root, `assets/branding/g${beta ? '-beta' : ''}.png`);
const output = resolve(root, 'apps/desktop/resources/branding');
await mkdir(output, { recursive: true });

// Keep the approved artwork and alpha; only resize and encode for Windows icons.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  const size = sizes[index];
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(resolve(output, `${name}.ico`), Buffer.concat([header, ...frames]));
await sharp(source)
  .resize(512, 512)
  .png()
  .toFile(resolve(output, `${name}.png`));
console.log(`GLEECH ${beta ? 'beta ' : ''}icons generated: 512px PNG and 16–256px Windows ICO.`);
