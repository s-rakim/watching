// Reads a PDF page the way PDF to Word and PowerPoint need it: every piece of text with its
// position, font, size, weight and colour, and every box, line, drawing and picture as a
// separate piece (see docxflow.js for what is done with them).
//
// pdf.js reports where text is and which font it uses, but not its colour, and for many
// PDFs (anything printed from Chrome, for one) every weight of a typeface is embedded as a
// "Regular" Type 3 font. So the page is drawn twice, once as it is and once with the text
// operators filtered out. The pixels that differ are the text itself: their colour is the
// text colour, and the thickness of the strokes says whether it is bold.
import { pdfjs } from './pdf.js';
import { fitArea, encodeCanvas, releaseCanvas } from './device.js';
import { cleanText } from './textorder.js';

const { OPS, Util } = pdfjs;

// How finely the page is sampled for colour and stroke width.
const SAMPLE_SCALE = 4;

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
    let x = m[4], w = it.width, str = it.str;
    const base = m[5];
    // A crop box can leave text outside the visible page. Drop what is wholly outside and
    // trim the letters that stick out, or the frame would be pushed back onto the page and
    // land on top of its neighbours.
    if (upright) {
      if (x + w <= 0 || x >= vp1.width || base <= 0 || base - size >= vp1.height) continue;
      const chars = [...str];
      const per = w / (chars.length || 1);
      const cutL = x < 0 ? Math.ceil(-x / per) : 0;
      const cutR = x + w > vp1.width ? Math.ceil((x + w - vp1.width) / per) : 0;
      if (cutL + cutR >= chars.length) continue;
      if (cutL || cutR) {
        str = chars.slice(cutL, chars.length - cutR).join('');
        x += cutL * per; w -= (cutL + cutR) * per;
      }
    }
    const item = { str, x, base, w, size, upright, dir: it.dir, font: fontFor(it.fontName), skew: Math.abs(m[2]) > size * 0.08 };
    if (str.trim()) {
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
  releaseCanvas(bareCanvas);
  // colour of the page (without text) a little inside each corner of a box, the most common one wins
  const H = bare.length / 4 / W;
  const sample = (b) => {
    const inset = Math.min(4, b.w / 4, b.h / 4);
    const pts = [[b.x + inset, b.y + inset], [b.x + b.w - inset, b.y + inset], [b.x + inset, b.y + b.h - inset], [b.x + b.w - inset, b.y + b.h - inset], [b.x + b.w / 2, b.y + b.h / 2]];
    const cols = pts.map(([px, py]) => { const X = Math.min(W - 1, Math.max(0, Math.round(px * s))), Y = Math.min(H - 1, Math.max(0, Math.round(py * s))); const i = (Y * W + X) * 4; return hex(bare[i], bare[i + 1], bare[i + 2]); });
    const count = new Map(); for (const c of cols) count.set(c, (count.get(c) || 0) + 1);
    return [...count].sort((a, b2) => b2[1] - a[1])[0][0];
  };
  return { page, vp1, items, visible, sample };
}

const FILL_OPS = new Set([OPS.fill, OPS.eoFill]);
const STROKE_OPS = new Set([OPS.stroke, OPS.closeStroke]);
const BOTH_OPS = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask, OPS.paintImageMaskXObjectGroup]);

const toHex = (c) => {
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
  if (Array.isArray(c) || ArrayBuffer.isView(c)) return hex(c[0], c[1], c[2]);
  return null;
};
const mix = (hexColor, alpha) => {
  if (!hexColor || alpha >= 0.98) return hexColor;
  const n = parseInt(hexColor, 16);
  return hex(...[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => 255 - (255 - v) * alpha));
};

/** Subpaths of a pdf.js path, each a list of [kind, x, y] in page-as-shown points. */
function subpaths(data, m) {
  const out = [];
  let cur = null;
  const pt = (x, y) => { const p = [x, y]; Util.applyTransform(p, m); return p; };
  for (let i = 0; i < data.length;) {
    const op = data[i++];
    if (op === 0) { cur = [['M', ...pt(data[i], data[i + 1])]]; out.push(cur); i += 2; }
    else if (op === 1) { cur?.push(['L', ...pt(data[i], data[i + 1])]); i += 2; }
    else if (op === 2) { cur?.push(['C', ...pt(data[i], data[i + 1]), ...pt(data[i + 2], data[i + 3]), ...pt(data[i + 4], data[i + 5])]); i += 6; }
    else if (op === 3) { cur?.push(['C', ...pt(data[i], data[i + 1]), ...pt(data[i + 2], data[i + 3])]); i += 4; }
    else if (op === 4) { if (cur) cur.closed = true; }
    else break;
  }
  return out;
}

function bboxOf(sp) {
  const xs = [], ys = [];
  for (const seg of sp) for (let k = 1; k < seg.length; k += 2) { xs.push(seg[k]); ys.push(seg[k + 1]); }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Is this subpath a rectangle, a rounded rectangle, a single line, or something else? */
function classify(sp) {
  const b = bboxOf(sp);
  const ends = sp.map((s) => [s[s.length - 2], s[s.length - 1]]);
  const curves = sp.filter((s) => s[0] === 'C');
  const straight = sp.slice(1).every((s, k) => s[0] !== 'L' || Math.abs(s[1] - ends[k][0]) < 0.6 || Math.abs(s[2] - ends[k][1]) < 0.6);
  if (!straight) return { kind: 'shape', ...b };
  if (!curves.length) {
    if (sp.length === 2) return { kind: 'line', x1: sp[0][1], y1: sp[0][2], x2: sp[1][1], y2: sp[1][2], ...b };
    if (sp.length >= 4 && sp.length <= 6) return { kind: 'rect', ...b };
    return { kind: 'shape', ...b };
  }
  // a rounded rectangle: straight sides and small curved corners
  // (Skia splits each corner into several short curves, so count doesn't matter, only
  // that every curve stays near a corner.)
  const reach = Math.min(b.w, b.h) / 2 + 1;
  const nearCorner = (x, y) => Math.min(x - b.x, b.x + b.w - x) <= reach && Math.min(y - b.y, b.y + b.h - y) <= reach;
  const corners = curves.every((c) => { for (let k = 1; k < c.length; k += 2) if (!nearCorner(c[k], c[k + 1])) return false; return true; });
  if (corners && b.w > 6 && b.h > 6) return { kind: 'rect', round: true, ...b };
  return { kind: 'shape', ...b };
}

async function imageObject(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((res) => { try { store.get(id, res); } catch { res(null); } setTimeout(() => res(null), 4000); });
}

async function imageBytes(img, alpha = 1) {
  if (!img) return null;
  const w = img.width || img.bitmap?.width, h = img.height || img.bitmap?.height;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: alpha < 0.98 });
  let opaque = false;
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const px = new Uint8ClampedArray(w * h * 4);
    const d = img.data;
    if (img.kind === 3) px.set(d.subarray(0, px.length));
    else if (img.kind === 2) { opaque = true; for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { px[i] = d[j]; px[i + 1] = d[j + 1]; px[i + 2] = d[j + 2]; px[i + 3] = 255; } }
    else if (img.kind === 1) { opaque = true; const row = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (d[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; } }
    else return null;
    ctx.putImageData(new ImageData(px, w, h), 0, 0);
  } else return null;
  if (alpha < 0.98) {
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = Math.round(d.data[i] * alpha);
    ctx.putImageData(d, 0, 0);
    opaque = false;
  }
  const jpeg = opaque && w * h > 250000;
  const blob = await encodeCanvas(canvas, jpeg ? 'image/jpeg' : 'image/png', 0.9);
  releaseCanvas(canvas);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: jpeg ? 'jpeg' : 'png' };
}

async function readGraphics(page, vp1, media, cache, sample) {
  const list = await page.getOperatorList();
  const rects = [], lines = [], shapes = [], images = [];
  let m = vp1.transform;
  let st = { fill: '000000', stroke: '000000', lw: 1, fa: 1, sa: 1, pattern: false, ga: 1, clip: null };
  const stack = [], groups = [];
  let pendingClip = false;
  // Chrome often draws a card's coloured edge as the whole card clipped down to a strip,
  // so a shape is cut to the clip around it.
  const cut = (c) => {
    if (!st.clip) return c;
    const [cx0, cy0, cx1, cy1] = st.clip;
    if (c.x >= cx0 - 0.5 && c.y >= cy0 - 0.5 && c.x + c.w <= cx1 + 0.5 && c.y + c.h <= cy1 + 0.5) return c;
    const x0 = Math.max(c.x, cx0), y0 = Math.max(c.y, cy0), x1 = Math.min(c.x + c.w, cx1), y1 = Math.min(c.y + c.h, cy1);
    if (x1 <= x0 || y1 <= y0) return null;
    const out = { ...c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (c.kind === 'line') Object.assign(out, { x1: Math.min(Math.max(c.x1, x0), x1), x2: Math.min(Math.max(c.x2, x0), x1), y1: Math.min(Math.max(c.y1, y0), y1), y2: Math.min(Math.max(c.y2, y0), y1) });
    if (c.round && (out.w < c.w * 0.8 || out.h < c.h * 0.8)) out.round = false;
    return out;
  };
  const lwOf = (lw) => Math.max(0.25, lw * Math.hypot(m[0], m[1]));
  for (let k = 0; k < list.fnArray.length; k++) {
    const fn = list.fnArray[k], a = list.argsArray[k];
    if (fn === OPS.save) { stack.push([m, { ...st }]); continue; }
    if (fn === OPS.restore) { const top = stack.pop(); if (top) [m, st] = top; continue; }
    if (fn === OPS.transform) { m = Util.transform(m, a); continue; }
    if (fn === OPS.paintFormXObjectBegin) { stack.push([m, { ...st }]); if (a?.[0]) m = Util.transform(m, a[0]); continue; }
    if (fn === OPS.paintFormXObjectEnd) { const top = stack.pop(); if (top) [m, st] = top; continue; }
    if (fn === OPS.setFillRGBColor) { st.fill = toHex(a[0]) ?? toHex(a); st.pattern = false; continue; }
    if (fn === OPS.setStrokeRGBColor) { st.stroke = toHex(a[0]) ?? toHex(a); continue; }
    if (fn === OPS.setFillColorN || fn === OPS.setFillTransparent) { st.pattern = true; continue; }
    if (fn === OPS.setLineWidth) { st.lw = a[0]; continue; }
    if (fn === OPS.setGState) {
      for (const [key, v] of a[0] || []) { if (key === 'ca') st.fa = v; else if (key === 'CA') st.sa = v; else if (key === 'LW') st.lw = v; }
      continue;
    }
    if (fn === OPS.clip || fn === OPS.eoClip) { pendingClip = true; continue; }
    if (fn === OPS.constructPath) {
      const [op, data] = a;
      const fill = FILL_OPS.has(op) || BOTH_OPS.has(op), stroke = STROKE_OPS.has(op) || BOTH_OPS.has(op);
      const path = data?.[0];
      const parts = path ? subpaths(path, m).filter((sp) => sp.length >= 2) : [];
      if (pendingClip) {
        pendingClip = false;
        if (parts.length) {
          const bs = parts.map(bboxOf);
          const c = [Math.min(...bs.map((b) => b.x)), Math.min(...bs.map((b) => b.y)), Math.max(...bs.map((b) => b.x + b.w)), Math.max(...bs.map((b) => b.y + b.h))];
          st.clip = st.clip ? [Math.max(st.clip[0], c[0]), Math.max(st.clip[1], c[1]), Math.min(st.clip[2], c[2]), Math.min(st.clip[3], c[3])] : c;
        }
      }
      if (!fill && !stroke) continue; // clipping path
      for (const sp of parts) {
        const c = cut(classify(sp));
        if (!c) continue;
        const fillColor = fill && !st.pattern ? mix(st.fill, st.fa * st.ga) : null;
        // a gradient-filled box keeps its box; its colour is read off the drawn page
        if (fill && st.pattern) { if (c.kind === 'rect' && sample) rects.push({ x: c.x, y: c.y, w: c.w, h: c.h, fill: sample(c), stroke: null, lw: 0, round: !!c.round }); else shapes.push(c); continue; }
        if (c.kind === 'rect') rects.push({ x: c.x, y: c.y, w: c.w, h: c.h, fill: fillColor, stroke: stroke ? mix(st.stroke, st.sa) : null, lw: stroke ? lwOf(st.lw) : 0, round: !!c.round });
        else if (c.kind === 'line' && stroke) lines.push({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, color: mix(st.stroke, st.sa), lw: lwOf(st.lw) });
        else if (c.w > 0.5 || c.h > 0.5) shapes.push(c);
      }
      continue;
    }
    // A transparency group fades everything inside it (how watermarks are usually made).
    if (fn === OPS.beginGroup) { groups.push(st.ga); st.ga *= st.fa; continue; }
    if (fn === OPS.endGroup) { st.ga = groups.pop() ?? 1; continue; }
    if (fn === OPS.shadingFill) continue;
    if (IMAGE_OPS.has(fn)) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => { const q = [...p]; Util.applyTransform(q, m); return q; });
      const x = Math.min(...corners.map((q) => q[0])), y = Math.min(...corners.map((q) => q[1]));
      const b = { x, y, w: Math.max(...corners.map((q) => q[0])) - x, h: Math.max(...corners.map((q) => q[1])) - y };
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        // Word and LibreOffice don't agree on picture transparency, so a faded picture is
        // stored already faded.
        const alpha = Math.round(st.fa * st.ga * 100) / 100;
        const id = `${fn === OPS.paintImageXObject ? a[0] : `inline${k}`}@${alpha}`;
        if (!cache.has(id)) {
          const obj = fn === OPS.paintImageXObject ? await imageObject(page, a[0]) : a[0];
          const bytes = await imageBytes(obj, alpha).catch(() => null);
          const key = `${n0(page)}-${id}`;
          if (bytes) media[key] = bytes;
          cache.set(id, bytes ? key : null);
        }
        const key = cache.get(id);
        if (key) images.push({ ...b, id: key, alpha: st.fa * st.ga, faint: st.fa * st.ga < 0.5 });
      } else shapes.push(b); // stencil masks are drawn shapes
    }
  }
  return { rects, lines, shapes, images };
}
const n0 = (page) => page.pageNumber;

/** Everything PDF to Word and PowerPoint need, page by page. */
export async function readEditable(pdf, onProgress) {
  const pages = [], media = {};
  for (let n = 1; n <= pdf.numPages; n++) {
    const { page, vp1, items, visible, sample } = await readPageLayout(pdf, n);
    const g = await readGraphics(page, vp1, media, new Map(), sample);
    let texts = visible.map((it) => ({
      str: cleanText(it.str), x: it.x, w: it.w, base: it.base, size: it.size, font: it.font.family, kind: it.font.kind,
      bold: !!it.font.bold, italic: !!(it.font.italic || it.skew), color: it.color || '000000', link: it.link || null,
    }));
    // A scan with an OCR layer: the words are invisible, over one big picture. Word gets
    // the words as real text and the picture goes, which is what people want from a scan.
    const hidden = items.filter((it) => it.upright && it.str.trim() && !it.ink);
    const scan = g.images.find((im) => im.w * im.h > vp1.width * vp1.height * 0.8);
    if (scan && hidden.length > 20 && texts.filter((t) => t.str.trim()).length < hidden.length * 0.2) {
      g.images = g.images.filter((im) => im !== scan);
      texts = hidden.map((it) => ({ str: cleanText(it.str), x: it.x, w: it.w, base: it.base, size: it.size, font: 'Arial', kind: 'sans', bold: false, italic: false, color: '000000', link: null }));
    }
    // Text at an angle can't be a Word paragraph, so it goes into a picture with what's around it.
    for (const it of items) if (!it.upright && it.str.trim()) g.shapes.push({ x: it.x - it.size, y: it.base - it.w - it.size, w: it.size * 2 + it.w, h: it.w + it.size * 2 });
    pages.push({ w: vp1.width, h: vp1.height, texts, ...g, _page: page });
    onProgress?.(n / pdf.numPages * 0.8);
  }
  const renderRegion = async (pi, b) => {
    const page = pages[pi]._page;
    const scale = Math.min(3, Math.sqrt(12e6 / Math.max(1, b.w * b.h)));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(b.w * scale)); canvas.height = Math.max(1, Math.ceil(b.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // photos and watermarks are in the document already, so they are left out of drawings
    const filter = (i, list) => !IMAGE_OPS.has(list.fnArray[i]) || [OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask].includes(list.fnArray[i]);
    await page.render({ canvasContext: ctx, viewport: vp, canvas, transform: [1, 0, 0, 1, -b.x * scale, -b.y * scale], operationsFilter: filter }).promise;
    const blob = await encodeCanvas(canvas, 'image/png');
    releaseCanvas(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  };
  return { pages, media, renderRegion };
}
