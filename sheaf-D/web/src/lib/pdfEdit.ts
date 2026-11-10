import {
  BlendMode,
  concatTransformationMatrix,
  LineCapStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import { stem } from './format';
import { openPdf } from './pdf';

interface Box {
  id: string;
  /** Zero-based page index. */
  page: number;
  /** Position and size in PDF points, measured from the top left of the page as displayed. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontFamily = 'sans' | 'serif' | 'mono';

export type Obj =
  | (Box & { type: 'text'; text: string; size: number; color: string; font: FontFamily; bold: boolean })
  | (Box & { type: 'rect' | 'ellipse'; stroke: string; fill: string | null; strokeWidth: number })
  | (Box & { type: 'highlight'; color: string })
  | (Box & { type: 'whiteout' })
  | (Box & { type: 'redact' })
  | (Box & { type: 'line'; stroke: string; strokeWidth: number; flip: boolean })
  | (Box & { type: 'path'; points: [number, number][]; stroke: string; strokeWidth: number })
  | (Box & { type: 'image'; src: string });

export const LINE_HEIGHT = 1.25;

export const FONT_CSS: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

// Distance from the top of a line box to the baseline, as a share of font size.
const BASELINE: Record<FontFamily, number> = { sans: 0.97, serif: 0.96, mono: 0.89 };

const STANDARD: Record<FontFamily, [StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
};

function colour(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type Matrix = [number, number, number, number, number, number];

/** Matrix from "page as displayed, origin bottom left" to the PDF's own coordinates. */
function viewMatrix(page: PDFPage): { m: Matrix; width: number; height: number } {
  const { x, y, width: w, height: h } = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  if (angle === 90) return { m: [0, 1, -1, 0, x + w, y], width: h, height: w };
  if (angle === 180) return { m: [-1, 0, 0, -1, x + w, y + h], width: w, height: h };
  if (angle === 270) return { m: [0, -1, 1, 0, x, y + h], width: h, height: w };
  return { m: [1, 0, 0, 1, x, y], width: w, height: h };
}

async function loadDoc(file: File): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch (err: any) {
    if (/encrypted/i.test(String(err?.message))) {
      throw new Error('This PDF is password protected. Unlock it first, then come back.');
    }
    throw new Error('This PDF could not be opened for editing. Running it through Repair first usually fixes that.');
  }
}

function dataUrlBytes(url: string): Uint8Array {
  const raw = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Draws text to a transparent PNG, for characters the standard PDF fonts can't encode. */
function textAsImage(o: Extract<Obj, { type: 'text' }>): string {
  const scale = 3;
  const lines = o.text.split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${o.bold ? '700' : '400'} ${o.size * scale}px ${FONT_CSS[o.font]}`;
  ctx.font = font;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  canvas.width = Math.ceil(width) + 4;
  canvas.height = Math.ceil(lines.length * o.size * LINE_HEIGHT * scale) + 4;
  ctx.font = font;
  ctx.fillStyle = o.color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, 0, (i * LINE_HEIGHT + BASELINE[o.font]) * o.size * scale));
  return canvas.toDataURL('image/png');
}

function toBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** Burns every object into the PDF and returns the new file. */
export async function applyEdits(file: File, objects: Obj[], suffix: string): Promise<{ blob: Blob; name: string }> {
  const doc = await loadDoc(file);
  const pages = doc.getPages();
  const fonts = new Map<string, PDFFont>();
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();

  const fontFor = async (family: FontFamily, bold: boolean) => {
    const key = `${family}${bold}`;
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(STANDARD[family][bold ? 1 : 0]));
    return fonts.get(key)!;
  };
  const imageFor = async (src: string) => {
    if (!images.has(src)) {
      const bytes = dataUrlBytes(src);
      images.set(src, src.startsWith('data:image/jpeg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes));
    }
    return images.get(src)!;
  };

  for (const [index, page] of pages.entries()) {
    const mine = objects.filter((o) => o.page === index);
    if (!mine.length) continue;
    const view = viewMatrix(page);
    const H = view.height;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...view.m));

    for (const o of mine) {
      if (o.type === 'text') {
        if (!o.text.trim()) continue;
        const font = await fontFor(o.font, o.bold);
        let encodable = true;
        try {
          font.encodeText(o.text.replace(/\n/g, ''));
        } catch {
          encodable = false;
        }
        if (encodable) {
          o.text.split('\n').forEach((line, i) => {
            page.drawText(line, {
              x: o.x,
              y: H - (o.y + (i * LINE_HEIGHT + BASELINE[o.font]) * o.size),
              size: o.size,
              font,
              color: colour(o.color),
            });
          });
        } else {
          const img = await imageFor(textAsImage(o));
          page.drawImage(img, { x: o.x, y: H - o.y - img.height / 3, width: img.width / 3, height: img.height / 3 });
        }
      } else if (o.type === 'rect') {
        page.drawRectangle({
          x: o.x,
          y: H - o.y - o.h,
          width: o.w,
          height: o.h,
          borderColor: colour(o.stroke),
          borderWidth: o.strokeWidth,
          color: o.fill ? colour(o.fill) : undefined,
        });
      } else if (o.type === 'ellipse') {
        page.drawEllipse({
          x: o.x + o.w / 2,
          y: H - o.y - o.h / 2,
          xScale: o.w / 2,
          yScale: o.h / 2,
          borderColor: colour(o.stroke),
          borderWidth: o.strokeWidth,
          color: o.fill ? colour(o.fill) : undefined,
        });
      } else if (o.type === 'highlight') {
        page.drawRectangle({
          x: o.x,
          y: H - o.y - o.h,
          width: o.w,
          height: o.h,
          color: colour(o.color),
          opacity: 0.45,
          blendMode: BlendMode.Multiply,
        });
      } else if (o.type === 'whiteout' || o.type === 'redact') {
        page.drawRectangle({
          x: o.x,
          y: H - o.y - o.h,
          width: o.w,
          height: o.h,
          color: o.type === 'redact' ? rgb(0, 0, 0) : rgb(1, 1, 1),
        });
      } else if (o.type === 'line') {
        const [y1, y2] = o.flip ? [o.y + o.h, o.y] : [o.y, o.y + o.h];
        page.drawLine({
          start: { x: o.x, y: H - y1 },
          end: { x: o.x + o.w, y: H - y2 },
          thickness: o.strokeWidth,
          color: colour(o.stroke),
          lineCap: LineCapStyle.Round,
        });
      } else if (o.type === 'path') {
        const d = o.points
          .map(([px, py], i) => `${i ? 'L' : 'M'} ${(o.x + px * o.w).toFixed(2)} ${(o.y + py * o.h).toFixed(2)}`)
          .join(' ');
        page.drawSvgPath(d, {
          x: 0,
          y: H,
          borderColor: colour(o.stroke),
          borderWidth: o.strokeWidth,
          borderLineCap: LineCapStyle.Round,
        });
      } else if (o.type === 'image') {
        const img = await imageFor(o.src);
        page.drawImage(img, { x: o.x, y: H - o.y - o.h, width: o.w, height: o.h });
      }
    }
    page.pushOperators(popGraphicsState());
  }

  return { blob: toBlob(await doc.save()), name: `${stem(file.name)}-${suffix}.pdf` };
}

/**
 * Real redaction. Pages with black boxes are flattened to a picture with the
 * boxes painted in, and the output is a brand new document, so the text that
 * was underneath is not in the file any more. Untouched pages are copied
 * across as they are unless `flattenAll` is set.
 */
export async function redactPdf(
  file: File,
  boxes: Obj[],
  flattenAll: boolean,
): Promise<{ blob: Blob; name: string }> {
  const source = await loadDoc(file);
  const viewer = await openPdf(file);
  const out = await PDFDocument.create();
  const total = source.getPageCount();

  for (let index = 0; index < total; index++) {
    const mine = boxes.filter((b) => b.page === index && b.type === 'redact');
    if (!mine.length && !flattenAll) {
      const [copy] = await out.copyPages(source, [index]);
      out.addPage(copy);
      continue;
    }
    const page = await viewer.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    // About 200 dpi, capped so huge pages don't exhaust canvas memory.
    const scale = Math.min(2.8, Math.sqrt(16_000_000 / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.fillStyle = '#000';
    for (const b of mine) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    const jpg = await out.embedJpg(dataUrlBytes(canvas.toDataURL('image/jpeg', 0.9)));
    const fresh = out.addPage([base.width, base.height]);
    fresh.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    canvas.width = canvas.height = 0;
  }

  return { blob: toBlob(await out.save()), name: `${stem(file.name)}-redacted.pdf` };
}

export interface CropRect {
  /** Fractions of the displayed page, measured from its top left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function cropPdf(
  file: File,
  rect: CropRect,
  onlyPage: number | null,
): Promise<{ blob: Blob; name: string }> {
  const doc = await loadDoc(file);
  doc.getPages().forEach((page, index) => {
    if (onlyPage !== null && onlyPage !== index) return;
    const { m, width, height } = viewMatrix(page);
    const corners: [number, number][] = [
      [rect.x * width, height - rect.y * height],
      [(rect.x + rect.w) * width, height - (rect.y + rect.h) * height],
    ];
    const mapped = corners.map(([vx, vy]) => [m[0] * vx + m[2] * vy + m[4], m[1] * vx + m[3] * vy + m[5]]);
    const x = Math.min(mapped[0][0], mapped[1][0]);
    const y = Math.min(mapped[0][1], mapped[1][1]);
    const w = Math.abs(mapped[0][0] - mapped[1][0]);
    const h = Math.abs(mapped[0][1] - mapped[1][1]);
    page.setMediaBox(x, y, w, h);
    page.setCropBox(x, y, w, h);
    page.setTrimBox(x, y, w, h);
    page.setBleedBox(x, y, w, h);
    page.setArtBox(x, y, w, h);
  });
  return { blob: toBlob(await doc.save()), name: `${stem(file.name)}-cropped.pdf` };
}

/** Trims the empty edges off a canvas and returns a PNG data URL. */
export function trimCanvas(source: HTMLCanvasElement): { src: string; width: number; height: number } | null {
  const ctx = source.getContext('2d')!;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right <= left || bottom <= top) return null;
  const pad = 6;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), width: out.width, height: out.height };
}
