// Reads a PDF page the way PDF to Word needs it: every piece of text with its position,
// font, size, weight and colour, plus a picture of everything that isn't text (boxes,
// rules, charts, logos, photos, shading).
//
// pdf.js reports where text is and which font it uses, but not its colour, and for many
// PDFs (anything printed from Chrome, for one) every weight of a typeface is embedded as a
// "Regular" Type 3 font. So the page is drawn twice, once as it is and once with the text
// operators filtered out. The pixels that differ are the text itself: their colour is the
// text colour, and the thickness of the strokes says whether it is bold.
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { pdfjs, closePdf } from './pdf.js';
import { fitArea, encodeCanvas, releaseCanvas } from './device.js';

const { OPS, Util } = pdfjs;

// How finely the page is sampled for colour and stroke width, and the resolution of the
// background picture that goes into the Word file.
const SAMPLE_SCALE = 4;
const BACKGROUND_DPI = 200;

export function openForWord(bytes, password) {
  // fontExtraProperties gives us the font's real name, which Word needs.
  return pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, fontExtraProperties: true }).promise;
}

/**
 * An operations filter that drops the page's text: everything between BT and ET. Text that
 * runs at an angle can't go in a Word frame, so with keepRotated those blocks are drawn
 * and stay part of the background picture.
 */
function withoutText(keepRotated = false, base = [1, 0, 0, 1, 0, 0]) {
  let seen = -1, ctm = base, inBlock = false, drop = true;
  const stack = [], skip = [];
  const tilted = (m) => Math.abs(m[1]) > Math.abs(m[0]) * 0.02 || m[0] <= 0;
  const rotatedBlock = (list, from) => {
    let matrices = 0, m = ctm;
    for (let k = from; k < list.fnArray.length; k++) {
      const fn = list.fnArray[k];
      if (fn === OPS.endText) break;
      // some writers put a cm inside BT, which PDF allows in practice if not on paper
      if (fn === OPS.transform) m = Util.transform(m, list.argsArray[k]);
      if (fn === OPS.setTextMatrix) {
        matrices++;
        if (tilted(Util.transform(m, list.argsArray[k][0]))) return true;
      }
    }
    return !matrices && tilted(m);
  };
  return (i, list) => {
    for (let k = seen + 1; k <= i; k++) {
      const fn = list.fnArray[k], args = list.argsArray[k];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = Util.transform(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      if (fn === OPS.beginText) { inBlock = true; drop = !(keepRotated && rotatedBlock(list, k + 1)); }
      skip[k] = inBlock && drop;
      if (fn === OPS.endText) inBlock = false;
    }
    seen = Math.max(seen, i);
    return !skip[i];
  };
}

async function draw(page, vp, operationsFilter) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas, operationsFilter }).promise;
  return canvas;
}

const STYLE_WORDS = /^(regular|roman|book|normal|medium|bold|semibold|demibold|extrabold|ultrabold|black|heavy|light|extralight|ultralight|thin|italic|oblique|it|bolditalic|boldoblique|mt|ps|psmt|std|pro|condensed|cond)$/i;
const KNOWN = {
  arial: 'Arial', arialmt: 'Arial', helvetica: 'Arial', helveticaneue: 'Helvetica Neue', timesnewroman: 'Times New Roman',
  timesnewromanps: 'Times New Roman', times: 'Times New Roman', courier: 'Courier New', couriernew: 'Courier New',
  symbol: 'Symbol', zapfdingbats: 'Wingdings', dejavusans: 'DejaVu Sans', dejavuserif: 'DejaVu Serif', calibri: 'Calibri',
  cambria: 'Cambria', georgia: 'Georgia', verdana: 'Verdana', tahoma: 'Tahoma', garamond: 'Garamond',
};

/** "ABCDEF+OpenSans-SemiboldItalic" -> "Open Sans". */
export function familyName(raw, { serif, mono } = {}) {
  let n = String(raw || '').replace(/^[A-Z]{6}\+/, '').replace(/[-_,](Subset(ted)?)$/i, '');
  n = n.split(/[-,]/)[0].replace(/(MT|PSMT|PS)$/, '');
  const key = n.toLowerCase().replace(/[^a-z]/g, '');
  if (KNOWN[key]) return KNOWN[key];
  // Remaining style words glued on with no dash, as in "RobotoBold"
  const words = n.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  while (words.length > 1 && STYLE_WORDS.test(words[words.length - 1])) words.pop();
  const name = words.join(' ').trim();
  if (name && !/^(g_d\d|f\d+|font|t3|type3)/i.test(name)) return name;
  return mono ? 'Courier New' : serif ? 'Times New Roman' : 'Arial';
}

const hex = (r, g, b) => [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Looks at the pixels a piece of text adds to the page. Returns how much ink there is, the
 * colour of the solid part of the glyphs, and the typical horizontal stroke width (in pixels).
 */
function measureInk(full, bare, W, box) {
  const x0 = Math.max(0, Math.floor(box[0])), x1 = Math.min(W, Math.ceil(box[2]));
  const y0 = Math.max(0, Math.floor(box[1])), y1 = Math.min(full.length / 4 / W, Math.ceil(box[3]));
  let max = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    const d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
    if (d > max) max = d;
  }
  if (max < 40) return { ink: 0 };
  let r = 0, g = 0, b = 0, n = 0, ink = 0;
  const runs = [];
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
      const a = d / max;
      if (a >= 0.8) { r += full[i]; g += full[i + 1]; b += full[i + 2]; n++; }
      if (a > 0.15) { ink++; run += a; } else if (run) { runs.push(run); run = 0; }
    }
    if (run) runs.push(run);
  }
  runs.sort((p, q) => p - q);
  return { ink, color: [r / n, g / n, b / n], stem: runs.length ? runs[runs.length >> 1] : 0, samples: runs.length };
}

/** Colours that are nearly the same are made the same, and near-black becomes black. */
function tidyColours(items) {
  const groups = [];
  for (const it of items) {
    if (!it.rgb) continue;
    const [r, g, b] = it.rgb;
    if (Math.max(r, g, b) < 60 && Math.max(r, g, b) - Math.min(r, g, b) < 24) { it.color = '000000'; continue; }
    let grp = groups.find((c) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 36);
    if (!grp) groups.push(grp = { r, g, b, sum: [0, 0, 0], n: 0, members: [] });
    grp.sum[0] += r; grp.sum[1] += g; grp.sum[2] += b; grp.n++; grp.members.push(it);
  }
  for (const grp of groups) {
    // the darkest member is the closest to the true colour (thin strokes lighten the rest)
    const dark = grp.members.reduce((p, q) => (q.rgb[0] + q.rgb[1] + q.rgb[2] < p.rgb[0] + p.rgb[1] + p.rgb[2] ? q : p));
    const c = hex(...dark.rgb);
    for (const m of grp.members) m.color = c;
  }
}

/**
 * Decides bold per font. A font whose name or flags say bold is bold. Otherwise its stroke
 * width is compared with the lightest font of the same family on the page, or with what a
 * regular weight looks like when the family only appears once.
 */
function decideWeights(fonts) {
  const byFamily = new Map();
  for (const f of fonts.values()) {
    f.stemRatio = f.stems.length ? f.stems.sort((a, b) => a - b)[f.stems.length >> 1] : 0;
    if (!byFamily.has(f.family)) byFamily.set(f.family, []);
    byFamily.get(f.family).push(f);
  }
  for (const list of byFamily.values()) {
    const measured = list.filter((f) => f.stemRatio && f.samples >= 6);
    const light = measured.length ? Math.min(...measured.map((f) => f.stemRatio)) : 0;
    for (const f of list) {
      if (f.named !== null) { f.bold = f.named; continue; }
      if (!f.stemRatio) { f.bold = false; continue; }
      f.bold = measured.length > 1 && f.stemRatio > light * 1.28 ? true : f.stemRatio > 0.13;
    }
  }
}

/**
 * One page, ready for the Word writer:
 * { w, h, background: Uint8Array | null, frames: [{ x, top, base, size, w, runs: [...] }] }
 * All lengths are in points from the top-left corner of the page.
 */
export async function readPageLayout(pdf, n) {
  const page = await pdf.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  let s = SAMPLE_SCALE * fitArea(vp1.width * SAMPLE_SCALE, vp1.height * SAMPLE_SCALE);
  const vp = page.getViewport({ scale: s });
  const fullCanvas = await draw(page, vp, null);
  const bareCanvas = await draw(page, vp, withoutText());
  const W = fullCanvas.width;
  const full = fullCanvas.getContext('2d').getImageData(0, 0, W, fullCanvas.height).data;
  const bare = bareCanvas.getContext('2d').getImageData(0, 0, W, bareCanvas.height).data;
  releaseCanvas(fullCanvas);

  const tc = await page.getTextContent();
  const links = (await page.getAnnotations()).filter((a) => a.subtype === 'Link' && a.url).map((a) => {
    const corner = (px, py) => { const p = [px, py]; Util.applyTransform(p, vp1.transform); return p; };
    const [x1, y1] = corner(a.rect[0], a.rect[1]), [x2, y2] = corner(a.rect[2], a.rect[3]);
    return { url: a.url, x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2) };
  });

  const fonts = new Map();
  const fontFor = (id) => {
    if (fonts.has(id)) return fonts.get(id);
    let obj = null;
    try { obj = page.commonObjs.has(id) ? page.commonObjs.get(id) : null; } catch { /* not loaded */ }
    const raw = obj?.name || obj?.fallbackName || '';
    const nameSaysBold = /bold|black|heavy|semibold|demi/i.test(raw);
    const family = familyName(raw, { serif: obj?.isSerifFont, mono: obj?.isMonospace });
    const f = {
      family,
      kind: obj?.isMonospace || /mono|courier|consol/i.test(family) ? 'mono'
        : obj?.isSerifFont || /times|serif|georgia|garamond|cambria|roman|book antiqua|palatino/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans',
      // Type 3 fonts often carry a "Regular" name whatever they look like, so don't trust it
      named: nameSaysBold || obj?.bold || obj?.black ? true : obj?.isType3Font || !raw ? null : /regular|roman|book|light/i.test(raw) ? false : null,
      italic: /italic|oblique/i.test(raw) || !!obj?.italic,
      stems: [], samples: 0,
    };
    fonts.set(id, f);
    return f;
  };

  const items = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue;
    const m = Util.transform(vp1.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!size) continue;
    // Rotated text can't sit in a Word frame, so it stays in the background picture instead.
    const upright = m[0] > 0 && Math.abs(m[1]) < m[0] * 0.02;
    const style = tc.styles[it.fontName] || {};
    const ascent = style.ascent || 0.8, descent = style.descent || -0.2;
    const x = m[4], base = m[5], w = it.width;
    const item = { str: it.str, x, base, w, size, upright, font: fontFor(it.fontName), skew: Math.abs(m[2]) > size * 0.08 };
    if (it.str.trim()) {
      const box = [x * s, (base - ascent * size) * s, (x + w) * s, (base - descent * size) * s];
      const ink = measureInk(full, bare, W, box);
      item.ink = ink.ink;
      if (ink.ink) {
        item.rgb = ink.color;
        if (ink.samples) { item.font.stems.push(ink.stem / (size * s)); item.font.samples += ink.samples; }
      }
      const cx = x + w / 2, cy = base - size * 0.3;
      item.link = links.find((l) => cx >= l.x1 && cx <= l.x2 && cy >= l.y1 && cy <= l.y2)?.url;
    }
    items.push(item);
  }
  decideWeights(fonts);
  tidyColours(items);

  // Text that leaves no mark (an OCR layer over a scan, or white-on-white) is already in the
  // background picture, so it isn't repeated on top.
  const visible = items.filter((it) => it.upright && (!it.str.trim() || it.ink > 0));
  const rotated = items.some((it) => !it.upright && it.str.trim());

  // Background: the text-free drawing, scaled to the export resolution. Rotated text is
  // drawn back into it so it isn't lost.
  let bgCanvas = bareCanvas;
  if (rotated) { releaseCanvas(bareCanvas); bgCanvas = await draw(page, vp, withoutText(true, vp1.transform)); }
  const background = await backgroundPng(bgCanvas, vp1);
  releaseCanvas(bgCanvas);
  page.cleanup();

  return { w: vp1.width, h: vp1.height, background, frames: toFrames(visible) };
}

async function backgroundPng(canvas, vp1) {
  const k = Math.min(1, (BACKGROUND_DPI / 72) / (canvas.width / vp1.width));
  const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let blank = true;
  for (let i = 0; i < px.length; i += 16) if (px[i] < 250 || px[i + 1] < 250 || px[i + 2] < 250) { blank = false; break; }
  if (blank) { releaseCanvas(small); return null; }
  const blob = await encodeCanvas(small, 'image/png');
  releaseCanvas(small);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Text pieces on one baseline are joined into a frame until the gap between two of them is
 * wide enough to be a column break. Each frame is placed on the page on its own, so a table
 * row becomes one frame per cell and every cell lands where it was.
 */
function toFrames(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => a.base - b.base || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l.base - it.base) < Math.min(l.size, it.size) * 0.35);
    if (!line) lines.push(line = { base: it.base, size: it.size, items: [] });
    line.items.push(it);
    line.size = Math.max(line.size, it.size);
  }
  const frames = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of line.items) {
      const blank = !it.str.trim();
      if (cur) {
        const gap = it.x - cur.end;
        if (gap > Math.max(cur.size, it.size) * 0.6 && !blank) { cur = null; }
      }
      if (blank) { if (cur) cur.pendingSpace = true; continue; }
      if (!cur) {
        cur = { x: it.x, base: line.base, size: it.size, end: it.x + it.w, runs: [], pendingSpace: false };
        frames.push(cur);
      } else {
        const gap = it.x - cur.end;
        if ((cur.pendingSpace || gap > it.size * 0.15) && !/\s$/.test(cur.runs.at(-1).text) && !/^\s/.test(it.str)) cur.runs.at(-1).text += ' ';
      }
      cur.pendingSpace = false;
      const run = {
        text: it.str, font: it.font.family, kind: it.font.kind, size: it.size, bold: !!it.font.bold, italic: it.font.italic || it.skew,
        color: it.color || '000000', link: it.link || null,
      };
      const last = cur.runs.at(-1);
      if (last && last.font === run.font && Math.abs(last.size - run.size) < 0.25 && last.bold === run.bold
        && last.italic === run.italic && last.color === run.color && last.link === run.link && last.kind === run.kind) last.text += run.text;
      else cur.runs.push(run);
      cur.size = Math.max(cur.size, it.size);
      cur.end = Math.max(cur.end, it.x + it.w);
    }
  }
  for (const f of frames) {
    f.w = f.end - f.x;
    for (const r of f.runs) r.text = r.text.replace(/\s+/g, ' ');
    f.runs.at(-1).text = f.runs.at(-1).text.trimEnd();
    delete f.end; delete f.pendingSpace;
  }
  return frames.filter((f) => f.runs.some((r) => r.text));
}

/*
 * Word only has the font if it's installed, and often it isn't (Roboto, Inter and friends on
 * Windows). The stand-in is usually Arial-like and can be wider, which would push a cell's
 * text into the next one. So each frame is measured in the matching standard font, and if
 * it comes out wider than it was in the PDF, the letters are tightened to fit.
 */
let metricFonts;
async function standardFonts() {
  if (!metricFonts) {
    const d = await PDFDocument.create();
    const [sans, sansBold, serif, serifBold, mono] = await Promise.all([StandardFonts.Helvetica, StandardFonts.HelveticaBold,
      StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.Courier].map((f) => d.embedFont(f)));
    metricFonts = { sans, sansBold, serif, serifBold, mono, monoBold: mono };
  }
  return metricFonts;
}

function textWidth(fonts, r) {
  const font = fonts[r.kind + (r.bold ? 'Bold' : '')] || fonts.sans;
  try { return font.widthOfTextAtSize(r.text, r.size); } catch { /* a character outside WinAnsi */ }
  let w = 0;
  for (const ch of r.text) {
    try { w += font.widthOfTextAtSize(ch, r.size); } catch { w += r.size * 0.6; }
  }
  return w;
}

async function fitFrames(pages) {
  const fonts = await standardFonts();
  for (const pg of pages) for (const f of pg.frames) {
    const chars = f.runs.reduce((n, r) => n + [...r.text].length, 0);
    if (chars < 2) continue;
    const natural = f.runs.reduce((w, r) => w + textWidth(fonts, r), 0);
    if (natural <= f.w * 1.02) continue;
    // points per character, never more than a fifth of the text size
    f.tighten = Math.max(-f.size * 0.2, (f.w - natural) / chars);
  }
}

export async function readLayout(pdf, onProgress) {
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      pages.push(await readPageLayout(pdf, i));
      onProgress?.(i / pdf.numPages);
    }
  } finally { await closePdf(pdf); }
  await fitFrames(pages);
  return pages;
}
