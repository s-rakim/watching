import { PDFDocument } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

// pdf.js transfers (and detaches) the buffer it is given, so always hand it a copy.
export function openForRender(bytes, password) {
  return pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
}

// Files locked with only an owner password open with an empty user password. pdf.js does
// that silently, pdf-lib needs to be told, so retry once before giving up.
export async function loadPdf(bytes, opts = {}) {
  const base = { updateMetadata: false, ...opts };
  try {
    return await PDFDocument.load(bytes, base);
  } catch (e) {
    if (base.password === undefined && /encrypted/i.test(e?.message || '')) {
      return PDFDocument.load(bytes, { ...base, password: '' });
    }
    throw e;
  }
}

export async function renderPage(pdf, pageNumber, { scale = 1, maxWidth, rotation = 0 } = {}) {
  const page = await pdf.getPage(pageNumber);
  let vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const s = maxWidth ? Math.min(maxWidth / vp.width, 4) : scale;
  vp = page.getViewport({ scale: s, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality)
  );
}

export async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Parse "1-3, 5, 8-" into arrays of zero-based page indexes, one array per group. */
export function parseRanges(text, pageCount) {
  const groups = [];
  for (const raw of String(text).split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : pageCount;
    } else if (/^\d+$/.test(part)) {
      a = b = parseInt(part, 10);
    } else {
      throw new Error(`"${part}" isn't a page or a range`);
    }
    if (a < 1 || b > pageCount || a > b) throw new Error(`${part} is outside 1-${pageCount}`);
    const g = [];
    for (let i = a; i <= b; i++) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

export function isEncryptedError(e) {
  return e && (e.name === 'PasswordException' || /encrypt|password/i.test(e.message || ''));
}

export async function closePdf(pdf) {
  try {
    await (pdf.loadingTask?.destroy?.() ?? pdf.destroy?.() ?? pdf.cleanup?.());
  } catch { /* already gone */ }
}
