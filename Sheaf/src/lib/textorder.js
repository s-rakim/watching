// pdf.js hands back text the way it was drawn, which is not always the way it reads.
// These helpers put it back into reading order and plain characters before any tool
// (Markdown, Word, Excel, Summarize, Translate, Compare) uses it.

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const LTR = /[\p{L}\p{N}]/u;

/**
 * Presentation forms (Arabic shapes, ligatures like "ﬁ", CJK compatibility and Kangxi
 * radicals that Chrome and Skia write instead of the real ideographs) become the normal
 * characters, and control characters left by fonts with a broken ToUnicode map are dropped.
 */
export function cleanText(s) {
  // eslint-disable-next-line no-control-regex
  return s.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, '');
}

const kind = (s) => (RTL.test(s) ? 'R' : LTR.test(s) ? 'L' : 'N');

/** Is this mostly right-to-left text (Arabic, Hebrew, Persian, Urdu)? */
export function isRtl(pieces) {
  let r = 0, l = 0;
  for (const p of pieces) { const k = kind(p.str ?? p); if (k === 'R') r++; else if (k === 'L') l++; }
  return r > 0 && r >= l;
}

/**
 * Pieces of one line, sorted left to right as they sit on the page, put into the order they
 * are read. Arabic and Hebrew come out of most PDFs one glyph at a time from left to right,
 * so a right-to-left line is turned round, with any Latin words or numbers inside it kept
 * the right way. Each piece needs a `str`.
 */
export function readingOrder(pieces) {
  const kinds = pieces.map((p) => kind(p.str));
  if (!kinds.includes('R')) return pieces;
  const flip = isRtl(pieces) ? 'L' : 'R';
  const out = isRtl(pieces) ? [...pieces].reverse() : [...pieces];
  const ks = isRtl(pieces) ? [...kinds].reverse() : [...kinds];
  // Reverse each stretch of the other direction back, letting spaces and punctuation
  // in the middle of a stretch belong to it.
  for (let i = 0; i < out.length;) {
    if (ks[i] !== flip) { i++; continue; }
    let j = i, last = i;
    while (j < out.length && ks[j] !== (flip === 'L' ? 'R' : 'L')) { if (ks[j] === flip) last = j; j++; }
    const seg = out.slice(i, last + 1).reverse();
    out.splice(i, seg.length, ...seg);
    i = last + 1;
  }
  return out;
}

/** Horizontal gap between two pieces, whichever side of each other they are on. */
export function gapBetween(a, b) {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
}
