import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPdfWriter,
  flipbookImageSize,
  flipbookLayout,
  pdfText,
  spriteGrid,
  writeFlipbookPdf,
  writeSpriteSheet,
} from './flipbook';

/** Checks the header, that every xref offset points at its object, and the trailer. */
function inspectPdf(bytes: Buffer) {
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\s*$/.exec(text)?.[1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref))!;
  const count = Number(header[1]);
  const table = text.slice(startxref + header[0].length).split('\n');
  expect(table[0]).toBe('0000000000 65535 f ');
  for (let id = 1; id < count; id++) {
    const entry = table[id]!;
    expect(entry).toMatch(/^\d{10} 00000 n $/);
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
  }
  expect(text).toContain(`trailer\n<< /Size ${count} /Root 1 0 R >>`);
  // Stream lengths must match the bytes between stream/endstream.
  for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = match.index! + match[0].length;
    expect(text.slice(start + Number(match[1]), start + Number(match[1]) + 10)).toBe('\nendstream');
  }
  return {
    pages: (text.match(/\/Type \/Page /g) ?? []).length,
    count: Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)?.[1]),
    text,
  };
}

describe('PDF writer', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gleech-pdf-test-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes a valid file with images, text and pages', async () => {
    const path = join(dir, 'plain.pdf');
    const pdf = await createPdfWriter(path);
    const jpeg = await sharp({
      create: { width: 8, height: 4, channels: 3, background: '#ff0000' },
    })
      .jpeg()
      .toBuffer();
    const image = await pdf.addImage(jpeg, 8, 4);
    await pdf.addPage(
      612,
      792,
      `q 80 0 0 40 10 10 cm /Im0 Do Q\nBT /F1 12 Tf 10 100 Td ${pdfText('Hi (there) \\ ✓')} Tj ET`,
      {
        Im0: image,
      },
    );
    await pdf.addPage(612, 792, '', {});
    const bytes = await pdf.close();
    const file = await readFile(path);
    expect(file.length).toBe(bytes);
    const { pages, count, text } = inspectPdf(file);
    expect([pages, count]).toEqual([2, 2]);
    expect(text).toContain('(Hi \\(there\\) \\\\ ?)');
    expect(text).toContain('/BaseFont /Helvetica ');
    expect(text).toContain('/Filter /DCTDecode');
  });

  it('lays out flip book cards with a binding strip', () => {
    const letter = flipbookLayout('letter', 8, 0.5, 16 / 9);
    expect([letter.columns, letter.rows]).toEqual([2, 4]);
    expect(letter.imageWidth / 72).toBeCloseTo(3.5, 2);
    expect(letter.binding).toBe(36);
    expect(letter.left).toBeGreaterThanOrEqual(18);
    const twelve = flipbookLayout('a4', 12, 0.5, 16 / 9);
    expect(twelve.columns * twelve.rows).toBeGreaterThanOrEqual(12);
    expect(twelve.cardHeight * twelve.rows).toBeLessThanOrEqual(841.89 - 36 + 0.01);
    const card = flipbookLayout('4x6', 4, 0.5, 16 / 9);
    expect(card.cardWidth * card.columns).toBeLessThanOrEqual(432 - 36 + 0.01);
    expect(flipbookImageSize(letter, 1920, 1080)).toEqual({ width: 1050, height: 591 });
    expect(flipbookImageSize(letter, 640, 360)).toEqual({ width: 640, height: 360 });
    expect(() => flipbookLayout('4x6', 12, 6, 1)).toThrow(/no room/);
  });

  it('writes flip book pages with cover, cut lines and numbers', async () => {
    const frames: string[] = [];
    for (let i = 0; i < 10; i++) {
      const file = join(dir, `f${i}.jpg`);
      await sharp({
        create: { width: 32, height: 18, channels: 3, background: { r: i * 20, g: 80, b: 160 } },
      })
        .jpeg()
        .toFile(file);
      frames.push(file);
    }
    const output = join(dir, 'book.pdf');
    const result = await writeFlipbookPdf({
      outputPath: output,
      frames,
      imageWidth: 32,
      imageHeight: 18,
      layout: flipbookLayout('letter', 4, 0.5, 16 / 9),
      cutLines: true,
      frameNumbers: true,
      cover: 'Skate (loop)',
    });
    expect(result.pages).toBe(4);
    const { pages, text } = inspectPdf(await readFile(output));
    expect(pages).toBe(4);
    expect(text).toContain('(Skate \\(loop\\)) Tj');
    expect(text).toContain('(010) Tj');
    expect(text).toContain('[3 2] 0 d');
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(11);
  });
});

describe('sprite sheets', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gleech-sprite-test-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('chooses grids and caps the sheet size', () => {
    expect(spriteGrid(90, 'auto', 320, 180)).toMatchObject({ columns: 7, rows: 13 });
    expect(spriteGrid(90, 10, 320, 180)).toMatchObject({ columns: 10, rows: 9, width: 3200 });
    expect(spriteGrid(5, 16, 320, 180)).toMatchObject({ columns: 5, rows: 1 });
    expect(spriteGrid(90, 'row', 320, 180)).toMatchObject({ columns: 90, rows: 1, cellWidth: 182 });
    const big = spriteGrid(180, 10, 1920, 1080);
    expect(big.width).toBeLessThanOrEqual(16384);
    expect(big.height).toBeLessThanOrEqual(16384);
    expect(big.width * big.height).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  it('composites cells into one PNG with a JSON of rectangles', async () => {
    const cells: string[] = [];
    for (let i = 0; i < 5; i++) {
      const file = join(dir, `c${i}.png`);
      await sharp({
        create: {
          width: 4,
          height: 2,
          channels: 4,
          background: { r: i * 50, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toFile(file);
      cells.push(file);
    }
    const grid = spriteGrid(5, 'auto', 4, 2);
    const output = join(dir, 'sheet.png');
    const json = join(dir, 'sheet.json');
    const result = await writeSpriteSheet({
      outputPath: output,
      cells,
      grid,
      times: [0, 0.5, 1, 1.5, 2],
      fps: 2,
      jsonPath: json,
    });
    expect(result.bytes).toBeGreaterThan(0);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([grid.width, grid.height]);
    const parsed = JSON.parse(await readFile(json, 'utf8'));
    expect(parsed.size).toEqual({ w: grid.width, h: grid.height });
    expect(parsed.frames[3]).toEqual({
      index: 3,
      t: 1.5,
      x: (3 % grid.columns) * 4,
      y: Math.floor(3 / grid.columns) * 2,
      w: 4,
      h: 2,
    });
    const third = parsed.frames[3];
    expect(data[(third.y * info.width + third.x) * 4]).toBe(150);
    // Unused cells stay transparent.
    if (grid.columns * grid.rows > 5) expect(data[data.length - 1]).toBe(0);
  });
});
