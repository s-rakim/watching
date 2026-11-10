import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordNeeded extends Error {}

const cache = new WeakMap<File, Promise<PDFDocumentProxy>>();

/** Opens a PDF for viewing. The same File always gives back the same document. */
export function openPdf(file: File): Promise<PDFDocumentProxy> {
  let doc = cache.get(file);
  if (!doc) {
    doc = file.arrayBuffer().then((data) =>
      pdfjs.getDocument({ data, isEvalSupported: false }).promise.catch((err) => {
        cache.delete(file);
        if (err?.name === 'PasswordException') {
          throw new PasswordNeeded('This PDF is password protected. Unlock it first, then come back.');
        }
        throw new Error(`${file.name} could not be opened. It may be damaged; the Repair tool can help.`);
      }),
    );
    cache.set(file, doc);
  }
  return doc;
}

/** Draws a page into a canvas at the given CSS width and returns its height. */
export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  extraRotation = 0,
): Promise<{ width: number; height: number; cancel?: () => void }> {
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (cssWidth / base.width) * dpr;
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: cssWidth, height: (cssWidth * base.height) / base.width };
}
