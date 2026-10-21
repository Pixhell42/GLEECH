// Flip books: a small dependency-free PDF writer that lays JPEG frames out as
// cut-and-bind cards, plus sprite sheets (one PNG grid + optional JSON).
import sharp from 'sharp';
import { open, readFile, writeFile } from 'node:fs/promises';
import type { FlipbookSettings } from '../shared/render';

// ---------------------------------------------------------------------------
// PDF writer

export interface PdfWriter {
  /** Adds a baseline RGB JPEG as an image XObject; returns its object id. */
  addImage(jpeg: Uint8Array, width: number, height: number): Promise<number>;
  /** Adds a page. `content` uses /F1 (Helvetica), /F2 (Helvetica-Bold) and the named images. */
  addPage(
    width: number,
    height: number,
    content: string,
    images: Readonly<Record<string, number>>,
  ): Promise<void>;
  /** Writes the page tree, xref and trailer; returns the file size. */
  close(): Promise<number>;
  /** Closes the file without finishing it (cancel). */
  abort(): Promise<void>;
}

const CATALOG = 1;
const PAGES = 2;
const FONT = 3;
const BOLD_FONT = 4;

export async function createPdfWriter(path: string): Promise<PdfWriter> {
  const file = await open(path, 'w');
  const offsets: number[] = [];
  const pages: number[] = [];
  let position = 0;
  let nextId = 5;
  const write = async (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
    await file.write(bytes);
    position += bytes.length;
  };
  const object = async (id: number, ...parts: (string | Uint8Array)[]) => {
    offsets[id] = position;
    await write(`${id} 0 obj\n`);
    for (const part of parts) await write(part);
    await write('\nendobj\n');
  };
  const stream = (dictionary: string, data: Uint8Array) =>
    [`<< ${dictionary} /Length ${data.length} >>\nstream\n`, data, '\nendstream'] as const;

  // Binary marker so tools treat the file as binary.
  await write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  await object(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  await object(
    FONT,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  await object(
    BOLD_FONT,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  return {
    async addImage(jpeg, width, height) {
      const id = nextId++;
      await object(
        id,
        ...stream(
          `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
          jpeg,
        ),
      );
      return id;
    },
    async addPage(width, height, content, images) {
      const contentId = nextId++;
      const pageId = nextId++;
      await object(contentId, ...stream('', Buffer.from(content, 'latin1')));
      const xobjects = Object.entries(images)
        .map(([name, id]) => `/${name} ${id} 0 R`)
        .join(' ');
      await object(
        pageId,
        `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
          `/Resources << /Font << /F1 ${FONT} 0 R /F2 ${BOLD_FONT} 0 R >> /XObject << ${xobjects} >> >> ` +
          `/Contents ${contentId} 0 R >>`,
      );
      pages.push(pageId);
    },
    async close() {
      await object(
        PAGES,
        `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      );
      const xref = position;
      let table = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
      for (let id = 1; id < nextId; id++)
        table += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
      await write(
        table + `trailer\n<< /Size ${nextId} /Root ${CATALOG} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      );
      await file.close();
      return position;
    },
    async abort() {
      await file.close().catch(() => {});
    },
  };
}

/** Compact number for PDF operators. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** PDF string literal in WinAnsi; characters outside Latin-1 become '?'. */
export function pdfText(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 63;
    const safe = code < 32 || code > 255 ? '?' : char;
    out += safe === '\\' || safe === '(' || safe === ')' ? '\\' + safe : safe;
  }
  return `(${out})`;
}

// ---------------------------------------------------------------------------
// Flip book layout

/** Page sizes in points; 4×6 cards print landscape. */
export const PAPER_SIZES: Record<FlipbookSettings['paper'], readonly [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
  '4x6': [432, 288],
};
const MARGIN = 18;

export interface FlipLayout {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly perPage: number;
  /** Card = binding strip + picture, in points. */
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly binding: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Top-left corner of the grid, from the page's top-left. */
  readonly left: number;
  readonly top: number;
}

/** Grid that gives each frame the largest picture on the page. */
export function flipbookLayout(
  paper: FlipbookSettings['paper'],
  perPage: number,
  bindingInches: number,
  aspect: number,
): FlipLayout {
  const [pageWidth, pageHeight] = PAPER_SIZES[paper];
  const binding = Math.max(0, bindingInches) * 72;
  const availableWidth = pageWidth - MARGIN * 2;
  const availableHeight = pageHeight - MARGIN * 2;
  let best: FlipLayout | null = null;
  for (let columns = 1; columns <= perPage; columns++) {
    const rows = Math.ceil(perPage / columns);
    const cardWidth = availableWidth / columns;
    let imageWidth = cardWidth - binding;
    let imageHeight = imageWidth / aspect;
    if (imageHeight * rows > availableHeight) {
      imageHeight = availableHeight / rows;
      imageWidth = imageHeight * aspect;
    }
    if (imageWidth <= 0 || imageHeight <= 0) continue;
    const layout: FlipLayout = {
      pageWidth,
      pageHeight,
      columns,
      rows,
      perPage,
      cardWidth: imageWidth + binding,
      cardHeight: imageHeight,
      binding,
      imageWidth,
      imageHeight,
      left: (pageWidth - (imageWidth + binding) * columns) / 2,
      top: (pageHeight - imageHeight * rows) / 2,
    };
    if (!best || imageWidth * imageHeight > best.imageWidth * best.imageHeight + 0.01)
      best = layout;
  }
  if (!best) throw new Error('The binding margin leaves no room for the frames on this paper.');
  return best;
}

/** JPEG pixel size for a card picture: 300 dpi, never larger than the frame. */
export function flipbookImageSize(
  layout: FlipLayout,
  frameWidth: number,
  frameHeight: number,
  dpi = 300,
): { width: number; height: number } {
  const scale = Math.min(1, ((layout.imageWidth / 72) * dpi) / frameWidth);
  return {
    width: Math.max(1, Math.round(frameWidth * scale)),
    height: Math.max(1, Math.round(frameHeight * scale)),
  };
}

export interface FlipbookPdfOptions {
  readonly outputPath: string;
  /** JPEG files of the frames, in flip order. */
  readonly frames: readonly string[];
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly layout: FlipLayout;
  readonly cutLines: boolean;
  readonly frameNumbers: boolean;
  /** Printed frame numbers; defaults to 1, 2, 3… */
  readonly labels?: readonly number[] | undefined;
  /** Title for the cover page; no cover when undefined. */
  readonly cover?: string | undefined;
  /** Stops early when canceled. */
  readonly canceled?: () => boolean;
}

export async function writeFlipbookPdf(
  options: FlipbookPdfOptions,
): Promise<{ pages: number; bytes: number }> {
  const { layout, frames } = options;
  const pdf = await createPdfWriter(options.outputPath);
  let pages = 0;
  try {
    if (options.cover !== undefined && frames[0]) {
      const image = await pdf.addImage(
        await readFile(frames[0]),
        options.imageWidth,
        options.imageHeight,
      );
      const width = layout.pageWidth - MARGIN * 4;
      const height = Math.min(
        (width * options.imageHeight) / options.imageWidth,
        layout.pageHeight - MARGIN * 4 - 90,
      );
      const drawWidth = (height * options.imageWidth) / options.imageHeight;
      const top = layout.pageHeight - MARGIN * 2;
      const content = [
        `BT /F2 24 Tf 0 g ${num(MARGIN * 2)} ${num(top - 24)} Td ${pdfText(options.cover)} Tj ET`,
        `BT /F1 11 Tf 0.35 g ${num(MARGIN * 2)} ${num(top - 44)} Td ${pdfText(`${frames.length} frames · flip book`)} Tj ET`,
        `BT /F1 9 Tf 0.35 g ${num(MARGIN * 2)} ${num(top - 60)} Td ${pdfText(`${options.cutLines ? 'Cut along the dashed lines' : 'Cut the cards apart'}, stack them with frame 1 on top, and bind the left edge.`)} Tj ET`,
        `q ${num(drawWidth)} 0 0 ${num(height)} ${num((layout.pageWidth - drawWidth) / 2)} ${num(top - 80 - height)} cm /Im0 Do Q`,
      ].join('\n');
      await pdf.addPage(layout.pageWidth, layout.pageHeight, content, { Im0: image });
      pages++;
    }
    for (let start = 0; start < frames.length; start += layout.perPage) {
      if (options.canceled?.()) throw new Error('Render canceled.');
      const images: Record<string, number> = {};
      const ops: string[] = [];
      const count = Math.min(layout.perPage, frames.length - start);
      for (let slot = 0; slot < count; slot++) {
        const index = start + slot;
        const name = `Im${slot}`;
        images[name] = await pdf.addImage(
          await readFile(frames[index]!),
          options.imageWidth,
          options.imageHeight,
        );
        const column = slot % layout.columns;
        const row = Math.floor(slot / layout.columns);
        const x = layout.left + column * layout.cardWidth;
        const y = layout.pageHeight - layout.top - (row + 1) * layout.cardHeight;
        if (layout.binding > 0)
          ops.push(
            `0.93 g ${num(x)} ${num(y)} ${num(layout.binding)} ${num(layout.cardHeight)} re f`,
          );
        ops.push(
          `q ${num(layout.imageWidth)} 0 0 ${num(layout.imageHeight)} ${num(x + layout.binding)} ${num(y)} cm /${name} Do Q`,
        );
        if (options.frameNumbers) {
          const label = pdfText(String(options.labels?.[index] ?? index + 1).padStart(3, '0'));
          if (layout.binding >= 18)
            ops.push(`BT /F1 7 Tf 0.3 g ${num(x + 3)} ${num(y + 4)} Td ${label} Tj ET`);
          else
            ops.push(
              `1 g ${num(x + layout.binding)} ${num(y)} 18 10 re f`,
              `BT /F1 7 Tf 0 g ${num(x + layout.binding + 2)} ${num(y + 2.5)} Td ${label} Tj ET`,
            );
        }
        if (options.cutLines)
          ops.push(
            `q 0.55 G 0.5 w [3 2] 0 d ${num(x)} ${num(y)} ${num(layout.cardWidth)} ${num(layout.cardHeight)} re S Q`,
          );
      }
      await pdf.addPage(layout.pageWidth, layout.pageHeight, ops.join('\n'), images);
      pages++;
    }
    return { pages, bytes: await pdf.close() };
  } catch (error) {
    await pdf.abort();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sprite sheets

export interface SpriteGrid {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Grid for `count` cells; Auto makes the sheet roughly square. Cells shrink
 * so the sheet stays within `maxSide` px (a common GPU texture limit).
 */
export function spriteGrid(
  count: number,
  columns: FlipbookSettings['columns'],
  cellWidth: number,
  cellHeight: number,
  maxSide = 16384,
  maxPixels = 128 * 1024 * 1024,
): SpriteGrid {
  const n = Math.max(1, count);
  const cols =
    columns === 'row'
      ? n
      : columns === 'auto'
        ? Math.min(n, Math.max(1, Math.round(Math.sqrt((n * cellHeight) / cellWidth))))
        : Math.min(n, columns);
  const rows = Math.ceil(n / cols);
  const scale = Math.min(
    1,
    maxSide / (cols * cellWidth),
    maxSide / (rows * cellHeight),
    Math.sqrt(maxPixels / (cols * cellWidth * rows * cellHeight)),
  );
  const width = Math.max(1, Math.floor(cellWidth * scale));
  const height = Math.max(1, Math.floor(cellHeight * scale));
  return {
    columns: cols,
    rows,
    cellWidth: width,
    cellHeight: height,
    width: cols * width,
    height: rows * height,
  };
}

export interface SpriteFrameRect {
  readonly index: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function spriteRects(grid: SpriteGrid, times: readonly number[]): SpriteFrameRect[] {
  return times.map((t, index) => ({
    index,
    t: Math.round(t * 1000) / 1000,
    x: (index % grid.columns) * grid.cellWidth,
    y: Math.floor(index / grid.columns) * grid.cellHeight,
    w: grid.cellWidth,
    h: grid.cellHeight,
  }));
}

/** Composites cell PNGs (already cell-sized) into one PNG; optional JSON of rectangles. */
export async function writeSpriteSheet(options: {
  readonly outputPath: string;
  readonly cells: readonly string[];
  readonly grid: SpriteGrid;
  readonly times: readonly number[];
  readonly fps: number;
  readonly jsonPath?: string | undefined;
}): Promise<{ bytes: number; jsonBytes: number }> {
  const { grid } = options;
  const rects = spriteRects(grid, options.times);
  const info = await sharp({
    create: {
      width: grid.width,
      height: grid.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    limitInputPixels: false,
  })
    .composite(
      options.cells.map((input, index) => ({
        input,
        left: rects[index]!.x,
        top: rects[index]!.y,
      })),
    )
    .png({ compressionLevel: 6 })
    .toFile(options.outputPath);
  let jsonBytes = 0;
  if (options.jsonPath) {
    const json = JSON.stringify(
      { frames: rects, size: { w: grid.width, h: grid.height }, fps: options.fps },
      null,
      1,
    );
    await writeFile(options.jsonPath, json);
    jsonBytes = Buffer.byteLength(json);
  }
  return { bytes: info.size, jsonBytes };
}
