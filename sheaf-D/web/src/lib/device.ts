// The few places where phones, tablets and desktop browsers need different handling.

// iPadOS reports itself as a Mac, so look for a touch screen as well.
export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

// WebKit refuses canvases over 16.7 million pixels and hands back a blank one instead.
export const MAX_CANVAS_AREA = 16_777_216;

/** Scale factor that keeps a w×h drawing under the canvas size limit. */
export function fitArea(w: number, h: number, max = MAX_CANVAS_AREA) {
  const area = w * h;
  return area > max ? Math.sqrt(max / area) : 1;
}

// Firefox only learned contenteditable="plaintext-only" in version 136. Older builds,
// including the ESR on many Linux distributions, ignore it and nothing becomes editable.
export const PLAIN_EDIT: 'plaintext-only' | 'true' = (() => {
  const d = document.createElement('div');
  try {
    d.contentEditable = 'plaintext-only';
  } catch {
    return 'true';
  }
  return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
})();

/** Share sheet for files, where the browser has one (iOS, iPadOS, Android). */
export function canShareFile(file: File) {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}
