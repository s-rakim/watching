// Small checks for the handful of places where phones, tablets and desktop browsers
// need different handling. Everything else is plain feature detection at the call site.

// iPadOS reports itself as a Mac, so look for a touch screen as well.
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

// WebKit refuses canvases over 16.7 million pixels and quietly hands back a blank one.
// Other engines allow more, but memory on phones runs out well before their limits.
export const MAX_CANVAS_AREA = 16_777_216;

/** Scale factor that keeps a w×h drawing under the canvas size limit. */
export function fitArea(w, h, max = MAX_CANVAS_AREA) {
  const area = w * h;
  return area > max ? Math.sqrt(max / area) : 1;
}

/** A 2D canvas that works off the main thread where it can, and on older Safari too. */
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(w, h);
      if (c.getContext('2d')) return c;
    } catch { /* fall back below */ }
  }
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export function encodeCanvas(canvas, type = 'image/jpeg', quality = 0.9) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));
}

/** Let the browser have the canvas memory back now. iOS is slow to do this on its own. */
export function releaseCanvas(canvas) {
  if (canvas) canvas.width = canvas.height = 0;
}

// Some Android file pickers (Drive, a few download managers) hand over PDFs with no MIME
// type and no extension. Reading the first bytes settles it.
export async function looksLikePdf(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return true;
  if (file.type && file.type !== 'application/octet-stream') return false;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return new TextDecoder('latin1').decode(head).includes('%PDF-');
}

// Firefox only learned contenteditable="plaintext-only" in version 136. Older builds,
// including the ESR on many Linux distributions, ignore it and make nothing editable.
export const PLAIN_EDIT = (() => {
  const d = document.createElement('div');
  try { d.contentEditable = 'plaintext-only'; } catch { return 'true'; }
  return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
})();

/** Share sheet for files, where the browser has one (iOS, iPadOS, Android, some desktops). */
export function canShareFile(file) {
  try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; }
}
