import {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict,
  StandardFonts, degrees, rgb, PageSizes,
} from '@cantoo/pdf-lib';
import {
  loadPdf, openForRender, closePdf, renderPage, canvasToBlob, blobBytes, baseName,
} from './pdf.js';

const out = (name, bytes, type = 'application/pdf') => ({ name, blob: new Blob([bytes], { type }) });

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

async function recompressJpeg(bytes, { maxDim, quality }) {
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  } catch {
    return null;
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { bytes: await blobBytes(blob), w, h };
}

function isRgbOrGray(dict, context) {
  let cs = dict.get(PDFName.of('ColorSpace'));
  if (!cs) return false;
  cs = context.lookup(cs);
  if (cs instanceof PDFName) return cs === PDFName.of('DeviceRGB') || cs === PDFName.of('DeviceGray');
  if (cs instanceof PDFArray && cs.get(0) === PDFName.of('ICCBased')) {
    const icc = context.lookup(cs.get(1));
    const n = icc?.dict?.get(PDFName.of('N'));
    return n && (n.asNumber() === 3 || n.asNumber() === 1);
  }
  return false;
}

export async function compress(file, level, onProgress) {
  const cfg = LEVELS[level] || LEVELS.recommended;
  const doc = await loadPdf(file.bytes, { password: file.password });
  const ctx = doc.context;
  const images = ctx.enumerateIndirectObjects().filter(([, obj]) => {
    if (!(obj instanceof PDFRawStream)) return false;
    const d = obj.dict;
    if (d.get(PDFName.of('Subtype')) !== PDFName.of('Image')) return false;
    const filter = d.get(PDFName.of('Filter'));
    const isDct = filter === PDFName.of('DCTDecode') ||
      (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of('DCTDecode'));
    return isDct && isRgbOrGray(d, ctx) && !d.get(PDFName.of('Decode'));
  });
  let done = 0;
  for (const [ref, stream] of images) {
    const res = await recompressJpeg(stream.contents, cfg);
    if (res && res.bytes.length < stream.contents.length * 0.9) {
      const d = stream.dict.clone(ctx);
      d.set(PDFName.of('Width'), PDFNumber.of(res.w));
      d.set(PDFName.of('Height'), PDFNumber.of(res.h));
      d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      d.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      d.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      d.delete(PDFName.of('DecodeParms'));
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

/* ---------- Page numbers ---------- */
export async function addPageNumbers(file, o) {
  const doc = await loadPdf(file.bytes, { password: file.password });
  const font = await doc.embedFont(o.font === 'serif' ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const size = Number(o.size) || 11;
  const margin = Number(o.margin) || 28;
  pages.forEach((page, i) => {
    if (o.skipFirst && i === 0) return;
    const n = i + Number(o.start || 1) - (o.skipFirst ? 1 : 0);
    const label = String(o.format || '{n}').replace('{n}', n).replace('{total}', total);
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(label, size);
    const [v, h] = (o.position || 'bottom-center').split('-');
    const x = h === 'left' ? margin : h === 'right' ? width - margin - tw : (width - tw) / 2;
    const y = v === 'top' ? height - margin - size : margin;
    page.drawText(label, { x, y, size, font, color: hexToRgb(o.color || '#000000') });
  });
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
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const spots = o.layout === 'tile'
      ? Array.from({ length: 9 }, (_, k) => [width * ((k % 3) + 0.5) / 3, height * (Math.floor(k / 3) + 0.5) / 3])
      : [[width / 2, height / 2]];
    for (const [cx, cy] of spots) {
      const rad = (angle * Math.PI) / 180;
      if (img) {
        const scale = Math.min((width * (o.layout === 'tile' ? 0.25 : 0.5)) / img.width, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, {
          x: cx - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad),
          y: cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad),
          width: w, height: h, rotate: degrees(angle), opacity,
        });
      } else {
        const text = o.text || 'CONFIDENTIAL';
        const size = Number(o.size) || (o.layout === 'tile' ? 28 : 64);
        const tw = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: cx - (tw / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad),
          y: cy - (tw / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad),
          size, font, color: hexToRgb(o.color || '#d14343'), opacity, rotate: degrees(angle),
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
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (scan) ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
  ctx.drawImage(bmp, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  return { bytes: await blobBytes(blob), type: 'image/jpeg' };
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
    canvas.width = canvas.height = 0;
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
      let text = '';
      let end = null;
      for (const r of l.runs) {
        if (end !== null && r.x - end > l.size * 0.2 && !text.endsWith(' ') && !r.str.startsWith(' ')) text += ' ';
        text += r.str;
        end = r.x + r.w;
      }
      l.text = text.replace(/\s+/g, ' ').trim();
      l.x = l.runs[0]?.x ?? 0;
    }
    pages.push(lines.filter((l) => l.text).sort((a, b) => b.y - a.y));
  }
  return pages;
}

export function linesToMarkdown(pages) {
  const sizes = pages.flat().map((l) => Math.round(l.size * 2) / 2);
  const freq = new Map();
  for (const s of sizes) freq.set(s, (freq.get(s) || 0) + 1);
  const body = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const md = [];
  for (const lines of pages) {
    let para = [];
    const flush = () => { if (para.length) { md.push(para.join(' ').replace(/(\w)- (\w)/g, '$1$2')); md.push(''); para = []; } };
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const gap = prev ? prev.y - l.y : 0;
      const ratio = l.size / body;
      if (ratio > 1.15 && l.text.length < 120) {
        flush();
        md.push(`${ratio > 1.8 ? '#' : ratio > 1.4 ? '##' : '###'} ${l.text}`, '');
        return;
      }
      const bullet = l.text.match(/^([•●▪◦‣\-*–]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        flush();
        md.push(/^\d/.test(bullet[1]) ? `${bullet[1].replace(')', '.')} ${bullet[2]}` : `- ${bullet[2]}`);
        return;
      }
      if (prev && gap > l.size * 1.8) flush();
      if (!para.length && md.length && /^(- |\d+\. )/.test(md[md.length - 1])) md.push('');
      para.push(l.text);
    });
    flush();
    md.push('---', '');
  }
  while (md.length && (md[md.length - 1] === '' || md[md.length - 1] === '---')) md.pop();
  return md.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

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
}

export async function unlock(file, password) {
  const doc = await loadPdf(file.bytes, { password: password ?? '' });
  dropEncryptionLeftovers(doc);
  return [out(`${baseName(file.name)}-unlocked.pdf`, await doc.save())];
}

/* ---------- Repair ----------
 * First try a lenient parse and rewrite (rebuilds the xref table and drops broken objects).
 * If pdf-lib can't make sense of it, fall back to pdf.js, which is more forgiving, and
 * rebuild each page it can render as an image.
 */
export async function repair(file) {
  try {
    const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
    if (doc.getPageCount() > 0) return { outputs: [out(`${baseName(file.name)}-repaired.pdf`, await doc.save())], method: 'structure' };
  } catch { /* fall through */ }
  const pdf = await openForRender(file.bytes);
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const canvas = await renderPage(pdf, i, { scale: 2 });
      const img = await doc.embedJpg(await blobBytes(await canvasToBlob(canvas, 'image/jpeg', 0.9)));
      const page = doc.addPage([canvas.width / 2, canvas.height / 2]);
      page.drawImage(img, { x: 0, y: 0, width: canvas.width / 2, height: canvas.height / 2 });
    } catch { /* skip unreadable page */ }
  }
  if (!doc.getPageCount()) throw new Error("This file is too damaged to recover any pages.");
  return { outputs: [out(`${baseName(file.name)}-repaired.pdf`, await doc.save())], method: 'raster' };
}

/* ---------- Overlay editing (edit, sign, redact) ----------
 * items use page-relative coordinates in 0..1 with the origin at the top-left of the page as
 * displayed (rotation included), which is how the editor works. They are mapped back to PDF
 * user space here.
 */
function toPdfRect(page, it) {
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
    } else if (it.type === 'image') {
      const img = it.mime === 'image/png' ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes);
      const pos = rotatedOrigin(r);
      page.drawImage(img, { ...pos, width: r.rot % 180 ? r.h : r.w, height: r.rot % 180 ? r.w : r.h, rotate });
    } else if (it.type === 'text') {
      const f = await font(it.font || 'sans');
      const size = it.fontSize * r.viewH; // font size stored relative to page height
      const lines = String(it.text).split('\n');
      const pos = rotatedOrigin(r);
      lines.forEach((line, i) => {
        const off = size * 1.2 * i + size;
        // move down `off` from the top of the box along the rotated axis
        const dx = [0, 90, 180, 270].indexOf(r.rot);
        const boxH = r.rot % 180 ? r.w : r.h;
        const shift = boxH - off;
        const vec = [[0, 1], [-1, 0], [0, -1], [1, 0]][dx];
        page.drawText(line, {
          x: pos.x + vec[0] * shift, y: pos.y + vec[1] * shift,
          size, font: f, color: hexToRgb(it.color || '#000000'), rotate,
        });
      });
    }
  }
  return [out(outName || `${baseName(file.name)}-edited.pdf`, await doc.save())];
}

// For drawImage/drawText with rotation, the origin is the bottom-left corner of the
// content in its own (rotated) frame. Map from our un-rotated user-space rect.
function rotatedOrigin(r) {
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
      const w = canvas.width / 2.5, h = canvas.height / 2.5;
      const page = doc.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      canvas.width = canvas.height = 0;
    }
    onProgress?.((i + 1) / n);
  }
  await closePdf(pdf);
  doc.setProducer('');
  return [out(`${baseName(file.name)}-redacted.pdf`, await doc.save())];
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
