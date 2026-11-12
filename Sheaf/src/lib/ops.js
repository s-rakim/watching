import {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict, PDFRef,
  StandardFonts, degrees, rgb, PageSizes, LineCapStyle, BlendMode,
} from '@cantoo/pdf-lib';
import {
  loadPdf, openForRender, closePdf, renderPage, canvasToBlob, blobBytes, baseName, pdfjs,
} from './pdf.js';
import { makeCanvas, encodeCanvas, fitArea, releaseCanvas } from './device.js';
import { cleanText, readingOrder, gapBetween } from './textorder.js';

export const out = (name, bytes, type = 'application/pdf') => ({ name, blob: new Blob([bytes], { type }) });

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Build one PDF from a list of page refs. Each ref is { src, index, rotation }, where src is
 * a loaded PDFDocument. Copies pages so vector content, fonts and links survive.
 */
export async function assemble(refs) {
  const doc = await PDFDocument.create();
  const bySrc = new Map();
  for (const r of refs) {
    if (!bySrc.has(r.src)) bySrc.set(r.src, []);
    bySrc.get(r.src).push(r.index);
  }
  const copied = new Map();
  for (const [src, idx] of bySrc) {
    const uniq = [...new Set(idx)];
    const pages = await doc.copyPages(src, uniq);
    uniq.forEach((i, k) => copied.set(`${bySrc.size > 1 ? [...bySrc.keys()].indexOf(src) : 0}:${i}`, pages[k]));
  }
  const used = new Set();
  const keys = [...bySrc.keys()];
  for (const r of refs) {
    const key = `${bySrc.size > 1 ? keys.indexOf(r.src) : 0}:${r.index}`;
    let page = copied.get(key);
    // The same source page placed twice needs its own copy.
    if (used.has(key)) [page] = await doc.copyPages(r.src, [r.index]);
    used.add(key);
    if (r.rotation) page.setRotation(degrees((page.getRotation().angle + r.rotation + 360) % 360));
    doc.addPage(page);
  }
  return doc;
}

export async function merge(files) {
  const refs = [];
  for (const f of files) {
    const src = await loadPdf(f.bytes, { password: f.password });
    for (let i = 0; i < src.getPageCount(); i++) refs.push({ src, index: i, rotation: f.rotation || 0 });
  }
  const doc = await assemble(refs);
  return [out('merged.pdf', await doc.save())];
}

export async function splitGroups(file, groups, { mergeAll = false } = {}) {
  const src = await loadPdf(file.bytes, { password: file.password });
  const name = baseName(file.name);
  if (mergeAll) {
    const doc = await assemble(groups.flat().map((index) => ({ src, index })));
    return [out(`${name}-extracted.pdf`, await doc.save())];
  }
  const results = [];
  for (const g of groups) {
    const doc = await assemble(g.map((index) => ({ src, index })));
    const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
    results.push(out(`${name}-${label}.pdf`, await doc.save()));
  }
  return results;
}

/** pages: [{ fileIdx, index, rotation }] in the order they should appear. */
export async function rebuild(files, pages, outName) {
  const srcs = [];
  for (const f of files) srcs.push(await loadPdf(f.bytes, { password: f.password }));
  const doc = await assemble(pages.map((p) => ({ src: srcs[p.fileIdx], index: p.index, rotation: p.rotation })));
  return [out(outName, await doc.save())];
}

export async function rotateFiles(files, angle) {
  const results = [];
  for (const f of files) {
    const doc = await loadPdf(f.bytes, { password: f.password });
    for (const p of doc.getPages()) p.setRotation(degrees((p.getRotation().angle + angle + 360) % 360));
    results.push(out(`${baseName(f.name)}-rotated.pdf`, await doc.save()));
  }
  return results;
}

/* ---------- Compress ----------
 * Recompresses embedded JPEG images at a lower resolution and quality, then saves with
 * object streams. Text and vector content are left alone, so the result stays searchable.
 */
const LEVELS = {
  low: { maxDim: 2400, quality: 0.85 },
  recommended: { maxDim: 1600, quality: 0.72 },
  extreme: { maxDim: 1000, quality: 0.5 },
};

async function recompressJpeg(bytes, cfg) {
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  } catch {
    return null;
  }
  return recompressBitmap(bmp, cfg);
}

async function recompressBitmap(bmp, { maxDim, quality }) {
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await encodeCanvas(canvas, 'image/jpeg', quality);
  releaseCanvas(canvas);
  return { bytes: await blobBytes(blob), w, h };
}

function channels(dict, context) {
  let cs = dict.get(PDFName.of('ColorSpace'));
  if (!cs) return 0;
  cs = context.lookup(cs);
  if (cs === PDFName.of('DeviceRGB')) return 3;
  if (cs === PDFName.of('DeviceGray')) return 1;
  if (cs === PDFName.of('DeviceCMYK')) return 4;
  if (cs instanceof PDFArray && cs.get(0) === PDFName.of('ICCBased')) {
    const n = context.lookup(cs.get(1))?.dict?.get(PDFName.of('N'));
    return n ? n.asNumber() : 0;
  }
  return 0;
}

const filterOf = (d) => {
  const f = d.get(PDFName.of('Filter'));
  if (f instanceof PDFArray) return f.size() === 1 ? f.get(0) : null;
  return f;
};

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undo PNG row filters (Predictor 10 to 15). */
function unpredict(data, w, bpp) {
  const row = w * bpp, out = new Uint8Array(row * Math.floor(data.length / (row + 1)));
  for (let y = 0, i = 0; i < data.length && y * row < out.length; y++) {
    const type = data[i++], o = y * row;
    for (let x = 0; x < row; x++, i++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - row + x] : 0, c = y && x >= bpp ? out[o - row + x - bpp] : 0;
      let v = data[i];
      if (type === 1) v += a; else if (type === 2) v += b; else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v;
    }
  }
  return out;
}

/** A Flate image (what PNGs and screenshots become) as a bitmap, or null if it is not plain 8-bit RGB or grey. */
async function flateBitmap(stream, ctx, n) {
  const d = stream.dict;
  const w = d.get(PDFName.of('Width'))?.asNumber(), h = d.get(PDFName.of('Height'))?.asNumber();
  if (!w || !h || d.get(PDFName.of('BitsPerComponent'))?.asNumber() !== 8) return null;
  let px = filterOf(d) ? await inflate(stream.contents) : stream.contents;
  const parms = ctx.lookup(d.get(PDFName.of('DecodeParms')));
  const predictor = parms instanceof PDFDict ? parms.get(PDFName.of('Predictor'))?.asNumber() || 1 : 1;
  if (predictor >= 10) px = unpredict(px, w, n);
  else if (predictor !== 1) return null;
  if (px.length < w * h * n) return null;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += n) {
    rgba[i * 4] = px[j]; rgba[i * 4 + 1] = px[j + (n === 3 ? 1 : 0)]; rgba[i * 4 + 2] = px[j + (n === 3 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, w, h));
}

export async function compress(file, level, onProgress) {
  const cfg = LEVELS[level] || LEVELS.recommended;
  const doc = await loadPdf(file.bytes, { password: file.password });
  const ctx = doc.context;
  // Soft masks are transparency, not pictures, and must stay lossless.
  const masks = new Set();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const sm = obj?.dict?.get?.(PDFName.of('SMask'));
    if (sm instanceof PDFRef) masks.add(sm.tag);
  }
  const images = ctx.enumerateIndirectObjects().filter(([ref, obj]) => {
    if (!(obj instanceof PDFRawStream) || masks.has(ref.tag)) return false;
    const d = obj.dict;
    if (d.get(PDFName.of('Subtype')) !== PDFName.of('Image') || d.get(PDFName.of('ImageMask'))) return false;
    const n = channels(d, ctx), f = filterOf(d);
    const decode = d.get(PDFName.of('Decode'));
    // Photoshop-style CMYK JPEGs are stored inverted with a [1 0 1 0 ...] Decode array; the
    // browser's JPEG decoder already undoes that. Any other Decode array is left alone.
    if (decode) return f === PDFName.of('DCTDecode') && n === 4 && decode.toString().replace(/\s+/g, ' ') === '[ 1 0 1 0 1 0 1 0 ]';
    if (f === PDFName.of('DCTDecode')) return n === 1 || n === 3 || n === 4;
    // Lossless pictures are only turned into JPEG at the stronger levels, and only big ones.
    const big = (d.get(PDFName.of('Width'))?.asNumber() || 0) * (d.get(PDFName.of('Height'))?.asNumber() || 0) >= 90000;
    return (f === PDFName.of('FlateDecode') || !f) && level !== 'low' && big && (n === 1 || n === 3);
  });
  let done = 0;
  for (const [ref, stream] of images) {
    const d0 = stream.dict;
    const flate = filterOf(d0) !== PDFName.of('DCTDecode');
    let res = null;
    try {
      const bmp = flate ? await flateBitmap(stream, ctx, channels(d0, ctx)) : null;
      res = flate ? (bmp && await recompressBitmap(bmp, cfg)) : await recompressJpeg(stream.contents, cfg);
    } catch { res = null; }
    // A lossless picture only becomes a JPEG when that saves at least half.
    if (res && res.bytes.length < stream.contents.length * (flate ? 0.5 : 0.9)) {
      const d = d0.clone(ctx);
      d.set(PDFName.of('Width'), PDFNumber.of(res.w));
      d.set(PDFName.of('Height'), PDFNumber.of(res.h));
      d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      d.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      d.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      d.delete(PDFName.of('DecodeParms'));
      d.delete(PDFName.of('Decode'));
      d.set(PDFName.of('Length'), PDFNumber.of(res.bytes.length));
      ctx.assign(ref, PDFRawStream.of(d, res.bytes));
    }
    onProgress?.(++done / images.length);
  }
  const bytes = await doc.save({ useObjectStreams: true });
  const original = file.bytes.length;
  const best = bytes.length < original ? bytes : file.bytes;
  return {
    outputs: [out(`${baseName(file.name)}-compressed.pdf`, best)],
    stats: { before: original, after: best.length, images: images.length },
  };
}

/* ---------- Drawing on the page as it is shown ----------
 * Pages can carry a /Rotate entry and a crop box that starts away from 0,0. Readers show the
 * crop box turned by /Rotate, so stamps and numbers are placed in that frame and mapped back
 * into the page's own coordinates here.
 */
function viewSize(page) {
  const { width, height } = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return { vw: rot % 180 ? height : width, vh: rot % 180 ? width : height, rot };
}

/** A point given from the bottom-left corner of the page as shown, in page coordinates. */
function viewPoint(page, vx, vy) {
  const { vw, vh } = viewSize(page);
  const r = toPdfRect(page, { x: vx / vw, y: (vh - vy) / vh, w: 0, h: 0 });
  return { x: r.x, y: r.y };
}

const charsets = new WeakMap();
/** Can this standard font draw every character? Helvetica and Times only cover Latin-1. */
function canEncode(font, text) {
  if (!charsets.has(font)) charsets.set(font, new Set(font.getCharacterSet()));
  const set = charsets.get(font);
  return [...text].every((ch) => ch === '\n' || set.has(ch.codePointAt(0)));
}

const CSS_FONTS = {
  sans: 'Helvetica, Arial, "Noto Sans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  serif: '"Times New Roman", Times, "Noto Serif", "Noto Serif CJK SC", serif',
  mono: '"Courier New", Courier, "Noto Sans Mono", monospace',
};
const cssFont = (family, bold, px) => `${bold ? 'bold ' : ''}${px}px ${CSS_FONTS[family] || CSS_FONTS.sans}`;

function measureCss(text, size, family, bold) {
  const ctx = makeCanvas(1, 1).getContext('2d');
  ctx.font = cssFont(family, bold, 100);
  return (ctx.measureText(text).width / 100) * size;
}

/**
 * Text the standard fonts can't draw (Cyrillic, Greek, Arabic, Chinese, Hindi...) is drawn
 * by the browser, which has the fonts and does the shaping and right-to-left ordering, and
 * goes into the PDF as a picture. It looks right but can't be selected as text.
 */
const pictures = new WeakMap();
async function textPicture(doc, text, opts) {
  if (!pictures.has(doc)) pictures.set(doc, new Map());
  const cache = pictures.get(doc), key = JSON.stringify([text, opts]);
  if (!cache.has(key)) cache.set(key, drawTextPicture(doc, text, opts));
  return cache.get(key);
}

async function drawTextPicture(doc, text, { size, family, bold, color }) {
  const k = Math.min(6, Math.max(2, 240 / size));
  const width = measureCss(text, size, family, bold);
  const w = Math.ceil(width * k) + 4, h = Math.ceil(size * 1.3 * k);
  const fit = fitArea(w, h);
  const canvas = makeCanvas(Math.max(1, Math.floor(w * fit)), Math.max(1, Math.floor(h * fit)));
  const ctx = canvas.getContext('2d');
  ctx.scale(fit, fit);
  ctx.font = cssFont(family, bold, size * k);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 2, size * k);
  const png = await blobBytes(await encodeCanvas(canvas, 'image/png'));
  releaseCanvas(canvas);
  return { img: await doc.embedPng(png), w: w / k, h: h / k, descent: size * 0.3 };
}

/**
 * Draws one line of text with its baseline starting at (x, y) in the page as shown, turned
 * `angle` degrees anticlockwise from upright.
 */
async function drawViewText(doc, page, text, { x, y, size, font, family = 'sans', bold = false, color = '#000000', opacity = 1, angle = 0 }) {
  const { rot } = viewSize(page);
  const rotate = degrees(rot + angle);
  if (canEncode(font, text)) {
    page.drawText(text, { ...viewPoint(page, x, y), size, font, color: hexToRgb(color), opacity, rotate });
    return;
  }
  const pic = await textPicture(doc, text, { size, family, bold, color });
  const t = (angle * Math.PI) / 180;
  const at = viewPoint(page, x + Math.sin(t) * pic.descent - Math.cos(t) * 2 / (240 / size), y - Math.cos(t) * pic.descent);
  page.drawImage(pic.img, { ...at, width: pic.w, height: pic.h, opacity, rotate });
}

const textWidth = (font, text, size, family, bold) => (canEncode(font, text) ? font.widthOfTextAtSize(text, size) : measureCss(text, size, family, bold));

/* ---------- Page numbers ---------- */
export async function addPageNumbers(file, o) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  const family = o.font === 'serif' ? 'serif' : 'sans';
  const font = await doc.embedFont(family === 'serif' ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const pages = doc.getPages();
  const numbered = pages.length - (o.skipFirst ? 1 : 0);
  const size = Number(o.size) || 11;
  const margin = Number(o.margin) || 28;
  for (const [i, page] of pages.entries()) {
    if (o.skipFirst && i === 0) continue;
    const n = i + Number(o.start ?? 1) - (o.skipFirst ? 1 : 0);
    const total = numbered + Number(o.start ?? 1) - 1;
    const label = String(o.format || '{n}').replaceAll('{n}', n).replaceAll('{total}', total);
    const { vw, vh } = viewSize(page);
    const tw = textWidth(font, label, size, family, false);
    const [v, h] = (o.position || 'bottom-center').split('-');
    const x = h === 'left' ? margin : h === 'right' ? vw - margin - tw : (vw - tw) / 2;
    const y = v === 'top' ? vh - margin - size : margin;
    await drawViewText(doc, page, label, { x, y, size, font, family, color: o.color || '#000000' });
  }
  return [out(`${baseName(file.name)}-numbered.pdf`, await doc.save())];
}

/* ---------- Watermark ---------- */
export async function watermark(file, o, imageBytes) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  let img;
  if (o.kind === 'image' && imageBytes) {
    img = imageBytes.type === 'image/png' ? await doc.embedPng(imageBytes.bytes) : await doc.embedJpg(imageBytes.bytes);
  }
  const opacity = Number(o.opacity ?? 0.3);
  const angle = Number(o.angle ?? 45);
  const tile = o.layout === 'tile';
  const rad = (angle * Math.PI) / 180;
  const text = o.text || 'CONFIDENTIAL';
  for (const page of doc.getPages()) {
    const { vw, vh, rot } = viewSize(page);
    const spots = tile
      ? Array.from({ length: 9 }, (_, k) => [vw * ((k % 3) + 0.5) / 3, vh * (Math.floor(k / 3) + 0.5) / 3])
      : [[vw / 2, vh / 2]];
    // Room along the slant, so long text is made smaller instead of running off the page
    // or, when tiled, into the next copy.
    const room = (Math.abs(Math.cos(rad)) < 0.01 ? vh : Math.abs(Math.sin(rad)) < 0.01 ? vw : Math.min(vw / Math.abs(Math.cos(rad)), vh / Math.abs(Math.sin(rad)))) * (tile ? 0.3 : 0.9);
    for (const [cx, cy] of spots) {
      if (img) {
        const scale = Math.min((vw * (tile ? 0.25 : 0.5)) / img.width, 1);
        const w = img.width * scale, h = img.height * scale;
        const at = viewPoint(page, cx - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad), cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad));
        page.drawImage(img, { ...at, width: w, height: h, rotate: degrees(rot + angle), opacity });
      } else {
        let size = Number(o.size) || (tile ? 28 : 64);
        let tw = textWidth(font, text, size, 'sans', true);
        if (tw > room) { size *= room / tw; tw = room; }
        await drawViewText(doc, page, text, {
          x: cx - (tw / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad),
          y: cy - (tw / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad),
          size, font, family: 'sans', bold: true, color: o.color || '#d14343', opacity, angle,
        });
      }
    }
  }
  return [out(`${baseName(file.name)}-watermarked.pdf`, await doc.save())];
}

/* ---------- Images to PDF ---------- */
const SIZES = { a4: PageSizes.A4, letter: PageSizes.Letter };
const MARGINS = { none: 0, small: 20, big: 48 };

async function normalizeImage(file, scan) {
  const type = file.type;
  if (!scan && (type === 'image/jpeg' || type === 'image/png')) {
    return { bytes: new Uint8Array(await file.arrayBuffer()), type };
  }
  const bmp = await createImageBitmap(file);
  // 48 MP phone photos are bigger than a canvas may be on iOS, so scale those down.
  const k = fitArea(bmp.width, bmp.height);
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  // Safari before 18 has no canvas filters, so there the scan look is done by hand.
  const native = 'filter' in Object.getPrototypeOf(ctx);
  if (scan && native) ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  if (scan && !native) scanFilter(ctx, w, h);
  const blob = await encodeCanvas(canvas, 'image/jpeg', 0.88);
  releaseCanvas(canvas);
  return { bytes: await blobBytes(blob), type: 'image/jpeg' };
}

/** Same look as the CSS filter used for scans: grey, more contrast, slightly brighter. */
function scanFilter(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const v = Math.max(0, Math.min(255, ((g - 128) * 1.6 + 128) * 1.08));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export async function imagesToPdf(files, o) {
  const groups = o.merge === false ? files.map((f) => [f]) : [files];
  const results = [];
  for (const group of groups) {
    const doc = await PDFDocument.create();
    for (const f of group) {
      const { bytes, type } = await normalizeImage(f.file, o.scan);
      const img = type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const m = MARGINS[o.margin] ?? 0;
      let pw, ph;
      if (o.size === 'fit') {
        pw = img.width + m * 2; ph = img.height + m * 2;
      } else {
        [pw, ph] = SIZES[o.size] || PageSizes.A4;
        const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && img.width > img.height);
        if (landscape) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - m * 2) / img.width, (ph - m * 2) / img.height);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    const name = groups.length > 1 ? `${baseName(group[0].name)}.pdf` : (o.scan ? 'scan.pdf' : 'images.pdf');
    results.push(out(name, await doc.save()));
  }
  return results;
}

/* ---------- PDF to images ---------- */
export async function pdfToImages(file, o, onProgress) {
  const pdf = await openForRender(file.bytes, file.password);
  const type = o.format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = o.format === 'png' ? 'png' : 'jpg';
  const scale = Number(o.dpi || 150) / 72;
  const results = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const canvas = await renderPage(pdf, i, { scale });
    results.push({ name: `${baseName(file.name)}-page-${String(i).padStart(3, '0')}.${ext}`, blob: await canvasToBlob(canvas, type, Number(o.quality || 0.9)) });
    releaseCanvas(canvas);
    onProgress?.(i / pdf.numPages);
  }
  await closePdf(pdf);
  return results;
}

/* ---------- PDF to Markdown ----------
 * pdf.js gives positioned text runs. Runs are grouped into lines by baseline, lines into
 * blocks by vertical gap, and font size relative to the body size decides heading level.
 */
export async function extractLines(pdf) {
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      const x = it.transform[4], y = it.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) < size * 0.4);
      if (!line) { line = { y, size, runs: [] }; lines.push(line); }
      line.size = Math.max(line.size, size);
      line.runs.push({ x, str: it.str, w: it.width, bold: /bold|black|heavy/i.test(tc.styles[it.fontName]?.fontFamily || it.fontName) });
    }
    for (const l of lines) {
      l.runs.sort((a, b) => a.x - b.x);
      l.x = l.runs[0]?.x ?? 0;
      l.right = Math.max(...l.runs.map((r) => r.x + r.w));
      let text = '';
      let prev = null;
      for (const r of readingOrder(l.runs)) {
        if (prev && gapBetween(prev, r) > l.size * 0.2 && !text.endsWith(' ') && !r.str.startsWith(' ')) text += ' ';
        text += r.str;
        prev = r;
      }
      l.text = cleanText(text).replace(/\s+/g, ' ').trim();
    }
    pages.push(lines.filter((l) => l.text).sort((a, b) => b.y - a.y));
  }
  return pages;
}

/**
 * Reading-order blocks from extracted lines: headings (by font size against the body size),
 * list items, paragraphs, and a marker at each page end. Markdown, Word and Translate share it.
 */
export function linesToBlocks(pages) {
  const sizes = pages.flat().map((l) => Math.round(l.size * 2) / 2);
  const freq = new Map();
  for (const s of sizes) freq.set(s, (freq.get(s) || 0) + 1);
  const body = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const blocks = [];
  for (const lines of pages) {
    const bodyLines = lines.filter((l) => Math.abs(l.size - body) < body * 0.15 && l.right != null);
    const left = Math.min(...bodyLines.map((l) => l.x)), right = Math.max(...bodyLines.map((l) => l.right));
    let para = [];
    // A word broken across two lines ("infor-" / "mation") is joined back up. Only at a line
    // end, and only before a lowercase letter, so "D- 32/46" or "A- grade" are left alone.
    const join = (ls) => ls.reduce((t, l) => (/[a-z]-$/i.test(t) && /^[a-z]/.test(l) ? t.slice(0, -1) + l : t ? `${t} ${l}` : l), '');
    const flush = () => { if (para.length) { blocks.push({ t: 'p', text: join(para) }); para = []; } };
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const gap = prev ? prev.y - l.y : 0;
      const ratio = l.size / body;
      if (ratio > 1.15 && l.text.length < 120) {
        flush();
        blocks.push({ t: 'h', level: ratio > 1.8 ? 1 : ratio > 1.4 ? 2 : 3, text: l.text });
        return;
      }
      const bullet = l.text.match(/^([•●▪◦‣\-*–]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        flush();
        blocks.push({ t: 'li', marker: /^\d/.test(bullet[1]) ? bullet[1].replace(')', '.') : null, text: bullet[2] });
        return;
      }
      // A wide gap above, or a line before that stopped well short of the right margin,
      // ends the paragraph. Without the second test, short lines such as list items whose
      // bullets are drawn as shapes all run together into one paragraph.
      if (prev && (gap > l.size * 1.8 || right - prev.right > Math.max(body * 8, (right - left) * 0.25))) flush();
      para.push(l.text);
    });
    flush();
    blocks.push({ t: 'page' });
  }
  return blocks;
}

export function blocksToMarkdown(blocks) {
  const md = [];
  for (const b of blocks) {
    if (b.t === 'h') md.push(`${'#'.repeat(b.level)} ${b.text}`, '');
    else if (b.t === 'li') md.push(b.marker ? `${b.marker} ${b.text}` : `- ${b.text}`);
    else if (b.t === 'p') {
      if (md.length && /^(- |\d+\. )/.test(md[md.length - 1])) md.push('');
      md.push(b.text, '');
    } else md.push('---', '');
  }
  while (md.length && (md[md.length - 1] === '' || md[md.length - 1] === '---')) md.pop();
  return md.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export const linesToMarkdown = (pages) => blocksToMarkdown(linesToBlocks(pages));

export async function pdfToMarkdown(file, o) {
  const pdf = await openForRender(file.bytes, file.password);
  const pages = await extractLines(pdf);
  await closePdf(pdf);
  if (o.format === 'txt') {
    const txt = pages.map((ls) => ls.map((l) => l.text).join('\n')).join('\n\n\f\n\n');
    return [out(`${baseName(file.name)}.txt`, new TextEncoder().encode(txt), 'text/plain')];
  }
  return [out(`${baseName(file.name)}.md`, new TextEncoder().encode(linesToMarkdown(pages)), 'text/markdown')];
}

/* ---------- Security ---------- */
export async function protect(file, o) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  doc.encrypt({
    userPassword: o.password,
    ownerPassword: o.ownerPassword || o.password,
    permissions: {
      printing: o.allowPrint ? 'highResolution' : false,
      copying: !!o.allowCopy,
      modifying: !!o.allowEdit,
      annotating: !!o.allowEdit,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: !!o.allowEdit,
    },
  });
  return [out(`${baseName(file.name)}-protected.pdf`, await doc.save())];
}

// A decrypted document still carries the old encryption dictionary and, in files that use
// cross-reference streams, the old xref stream that points at it. Readers that scan for
// those objects would treat the saved copy as locked, so drop them before saving.
function dropEncryptionLeftovers(doc) {
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj?.dict;
    if (!dict) continue;
    const isXref = dict.get(PDFName.of('Type')) === PDFName.of('XRef');
    const isEncryptDict = obj instanceof PDFDict && dict.has(PDFName.of('O')) && dict.has(PDFName.of('U')) && dict.has(PDFName.of('Filter'));
    if (isXref || isEncryptDict) ctx.delete(ref);
  }
  // Keep the trailer's /Size honest after the deletions.
  ctx.largestObjectNumber = Math.max(0, ...ctx.enumerateIndirectObjects().map(([r]) => r.objectNumber));
}

export async function unlock(file, password) {
  const doc = await loadPdf(file.bytes, { password: password ?? '' });
  dropEncryptionLeftovers(doc);
  return [out(`${baseName(file.name)}-unlocked.pdf`, await doc.save())];
}

/* ---------- Repair ----------
 * A lenient parse and rewrite rebuilds the xref table and drops broken objects. That alone
 * can leave a page pointing at objects that were cut off (a truncated download loses its
 * fonts this way, and the text turns to boxes), so every page is checked for references
 * that lead nowhere. Pages that are whole are copied as they are; the rest are rebuilt as
 * images from pdf.js, which is better at drawing damaged files.
 */
function missingRefs(doc, root) {
  const ctx = doc.context, seen = new Set();
  let missing = 0;
  const walk = (obj, depth) => {
    if (!obj || depth > 40 || missing) return;
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) return;
      seen.add(obj.tag);
      const target = ctx.lookup(obj);
      if (target === undefined) { missing++; return; }
      walk(target, depth + 1);
    } else if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) if (k !== PDFName.of('Parent') && k !== PDFName.of('P')) walk(v, depth + 1);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) walk(v, depth + 1);
    } else if (obj.dict instanceof PDFDict) walk(obj.dict, depth + 1);
  };
  walk(root, 0);
  return missing;
}

export async function repair(file) {
  let src = null;
  try {
    src = await loadPdf(file.bytes, { password: file.password, throwOnInvalidObject: false });
  } catch { /* pdf-lib can't read it at all */ }
  let pdf = null;
  const raster = async (i) => {
    pdf ||= await openForRender(file.bytes, file.password);
    const canvas = await renderPage(pdf, i + 1, { scale: 2 });
    const img = await doc.embedJpg(await blobBytes(await canvasToBlob(canvas, 'image/jpeg', 0.9)));
    const w = canvas.width / canvas.pdfScale, h = canvas.height / canvas.pdfScale;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    releaseCanvas(canvas);
  };
  const doc = await PDFDocument.create();
  let rebuilt = 0, partial = 0;
  try {
    const count = src ? src.getPageCount() : (pdf ||= await openForRender(file.bytes, file.password)).numPages;
    for (let i = 0; i < count; i++) {
      const page = src?.getPage(i);
      if (page && !missingRefs(src, page.node)) {
        const [copy] = await doc.copyPages(src, [i]);
        doc.addPage(copy);
        continue;
      }
      try { await raster(i); rebuilt++; continue; } catch { /* pdf.js can't draw it either */ }
      // Keep what pdf-lib could read; some of it may be missing, but it beats losing the page.
      if (page) { const [copy] = await doc.copyPages(src, [i]); doc.addPage(copy); partial++; }
    }
  } finally { if (pdf) await closePdf(pdf); }
  if (!doc.getPageCount()) throw new Error('This file is too damaged to recover any pages.');
  return { outputs: [out(`${baseName(file.name)}-repaired.pdf`, await doc.save())], method: rebuilt ? 'raster' : 'structure', rebuilt, partial };
}

/* ---------- Overlay editing (edit, sign, redact) ----------
 * items use page-relative coordinates in 0..1 with the origin at the top-left of the page as
 * displayed (rotation included), which is how the editor works. They are mapped back to PDF
 * user space here.
 */
export function toPdfRect(page, it) {
  // pdf.js displays the crop box, so work relative to it.
  const cb = page.getCropBox();
  const { width, height } = cb;
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const vw = rot % 180 ? height : width;
  const vh = rot % 180 ? width : height;
  const x = it.x * vw, y = it.y * vh, w = it.w * vw, h = it.h * vh;
  let r;
  switch (rot) {
    case 90: r = { x: y, y: x, w: h, h: w }; break;
    case 180: r = { x: width - x - w, y, w, h }; break;
    case 270: r = { x: width - y - h, y: height - x - w, w: h, h: w }; break;
    default: r = { x, y: height - y - h, w, h };
  }
  return { x: r.x + cb.x, y: r.y + cb.y, w: r.w, h: r.h, rot, viewH: vh };
}

export async function applyOverlays(file, items, outName) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  const pages = doc.getPages();
  const fonts = {};
  const font = async (k) => (fonts[k] ||= await doc.embedFont({
    sans: StandardFonts.Helvetica, 'sans-bold': StandardFonts.HelveticaBold,
    serif: StandardFonts.TimesRoman, 'serif-bold': StandardFonts.TimesRomanBold, mono: StandardFonts.Courier,
  }[k] || StandardFonts.Helvetica));
  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    const r = toPdfRect(page, it);
    const rotate = degrees(r.rot);
    if (it.type === 'rect' || it.type === 'whiteout') {
      page.drawRectangle({
        x: r.x, y: r.y, width: r.w, height: r.h,
        color: it.type === 'whiteout' ? rgb(1, 1, 1) : it.fill ? hexToRgb(it.color) : undefined,
        borderColor: it.type === 'whiteout' ? undefined : hexToRgb(it.color),
        borderWidth: it.type === 'whiteout' || it.fill ? 0 : 2,
        opacity: it.opacity ?? 1,
      });
    } else if (it.type === 'highlight') {
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: hexToRgb(it.color || '#ffe14d'), opacity: 0.45, blendMode: BlendMode.Multiply });
    } else if (it.type === 'ink') {
      const pts = it.points.map(([px, py]) => {
        const q = toPdfRect(page, { x: it.x + px * it.w, y: it.y + py * it.h, w: 0, h: 0 });
        return { x: q.x, y: q.y };
      });
      const thickness = it.width * r.viewH;
      const color = hexToRgb(it.color || '#111827');
      for (let k = 1; k < pts.length; k++) {
        page.drawLine({ start: pts[k - 1], end: pts[k], thickness, color, lineCap: LineCapStyle.Round });
      }
    } else if (it.type === 'image') {
      const img = it.mime === 'image/png' ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes);
      const pos = rotatedOrigin(r);
      page.drawImage(img, { ...pos, width: r.rot % 180 ? r.h : r.w, height: r.rot % 180 ? r.w : r.h, rotate });
    } else if (it.type === 'text') {
      const fam = it.font || 'sans';
      const f = await font(fam);
      const size = it.fontSize * r.viewH; // font size stored relative to page height
      const { vw, vh } = viewSize(page);
      const lines = String(it.text).split('\n');
      for (const [i, line] of lines.entries()) {
        await drawViewText(doc, page, line, {
          x: it.x * vw, y: vh - (it.y * vh + size * 1.2 * i + size), size, font: f,
          family: fam.split('-')[0], bold: fam.endsWith('-bold'), color: it.color || '#000000',
        });
      }
    }
  }
  return [out(outName || `${baseName(file.name)}-edited.pdf`, await doc.save())];
}

// For drawImage/drawText with rotation, the origin is the bottom-left corner of the
// content in its own (rotated) frame. Map from our un-rotated user-space rect.
export function rotatedOrigin(r) {
  switch (r.rot) {
    case 90: return { x: r.x + r.w, y: r.y };
    case 180: return { x: r.x + r.w, y: r.y + r.h };
    case 270: return { x: r.x, y: r.y + r.h };
    default: return { x: r.x, y: r.y };
  }
}

/**
 * True redaction: pages with boxes are rendered to an image with the boxes burned in, so
 * the hidden text is gone from the file rather than just covered. Untouched pages are copied
 * as they are.
 */
export async function redact(file, items, onProgress) {
  const src = await loadPdf(file.bytes, { password: file.password });
  const pdf = await openForRender(file.bytes, file.password);
  const doc = await PDFDocument.create();
  const affected = new Set(items.map((i) => i.page));
  let helv = null;
  const invisibleFont = async () => (helv ||= await doc.embedFont(StandardFonts.Helvetica));
  const n = src.getPageCount();
  for (let i = 0; i < n; i++) {
    if (!affected.has(i)) {
      const [p] = await doc.copyPages(src, [i]);
      doc.addPage(p);
    } else {
      const canvas = await renderPage(pdf, i + 1, { scale: 2.5 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      for (const it of items.filter((x) => x.page === i)) {
        ctx.fillRect(it.x * canvas.width, it.y * canvas.height, it.w * canvas.width, it.h * canvas.height);
      }
      const img = await doc.embedJpg(await blobBytes(await canvasToBlob(canvas, 'image/jpeg', 0.92)));
      const w = canvas.width / canvas.pdfScale, h = canvas.height / canvas.pdfScale;
      const page = doc.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      releaseCanvas(canvas);
      await keepTextOutside(pdf, i + 1, page, items.filter((x) => x.page === i), await invisibleFont());
    }
    onProgress?.((i + 1) / n);
  }
  await closePdf(pdf);
  doc.setProducer('');
  return [out(`${baseName(file.name)}-redacted.pdf`, await doc.save())];
}

/**
 * A redacted page is a picture, which would make the rest of its text unsearchable. Every
 * line that does not touch a black box is put back as invisible text in the same place.
 * Anything that touches a box, even at one corner, is left out.
 */
async function keepTextOutside(pdf, n, page, boxes, font) {
  const p = await pdf.getPage(n);
  const vp = p.getViewport({ scale: 1 });
  const { width: W, height: H } = page.getSize();
  const charset = new Set(font.getCharacterSet());
  const tc = await p.getTextContent();
  for (const it of tc.items) {
    if (!it.str?.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!size || !(m[0] > 0 && Math.abs(m[1]) < m[0] * 0.02)) continue;
    const x0 = m[4], base = m[5], x1 = x0 + it.width * (W / vp.width);
    const top = base - size, bottom = base + size * 0.25;
    const hit = boxes.some((b) => x1 > b.x * W && x0 < (b.x + b.w) * W && bottom > b.y * H && top < (b.y + b.h) * H);
    if (hit) continue;
    const str = [...cleanText(it.str)].filter((ch) => charset.has(ch.codePointAt(0))).join('');
    if (!str.trim()) continue;
    page.drawText(str, { x: x0, y: H - base, size, font, opacity: 0 });
  }
  p.cleanup();
}

/* ---------- Crop ---------- */
export async function crop(file, box, scope, currentPage) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  doc.getPages().forEach((page, i) => {
    if (scope === 'current' && i !== currentPage) return;
    const r = toPdfRect(page, box);
    page.setMediaBox(r.x, r.y, r.w, r.h);
    page.setCropBox(r.x, r.y, r.w, r.h);
  });
  return [out(`${baseName(file.name)}-cropped.pdf`, await doc.save())];
}

/* ---------- Compare ---------- */
export function diffWords(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length;
  if (n * m > 4e6) return [{ op: 'del', text: a }, { op: 'add', text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const res = [];
  const push = (op, w) => { const l = res[res.length - 1]; if (l && l.op === op) l.text += ' ' + w; else res.push({ op, text: w }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return res;
}
