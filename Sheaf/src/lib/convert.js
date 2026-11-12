// PDF to Word / Excel / PowerPoint, OCR, Summarize and Translate. All of it runs here in the
// browser: text comes from pdf.js, OCR from a local copy of Tesseract, and summaries and
// translations use the browser's own on-device models when it has them.
import { StandardFonts, degrees } from '@cantoo/pdf-lib';
import { loadPdf, openForRender, closePdf, renderPage, canvasToBlob, blobBytes, baseName } from './pdf.js';
import { extractLines, linesToBlocks, blocksToMarkdown, toPdfRect, rotatedOrigin, out } from './ops.js';
import { buildDocx, buildXlsx, buildPptx } from './office.js';
import JSZip from 'jszip';
import { openForWord, readEditable } from './wordlayout.js';
import { buildEditableDocx, buildEditablePptx } from './docxflow.js';
import { cleanText, readingOrder, gapBetween } from './textorder.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function readLines(file) {
  const pdf = await openForRender(file.bytes, file.password);
  try { return await extractLines(pdf); } finally { await closePdf(pdf); }
}

// Browser model APIs can stall (Chromium builds expose them without a model), so every call gets a deadline.
const deadline = (promise, ms, msg) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms))]);

const noText = (name) => new Error(`${name} has no text layer to read. Run OCR PDF on it first.`);

/* ---------- PDF to Word ---------- */
// "layout" (the default) keeps the page looking the same: every line where it was, in its
// own font and colour, over a picture of the boxes, lines and images. "flow" gives plain
// running text with headings and lists, for when the words matter more than the look.
export async function pdfToWord(file, o = {}, onProgress) {
  const title = baseName(file.name);
  if (o.layout === 'flow') {
    const pages = await readLines(file);
    if (!pages.some((p) => p.length)) throw noText(file.name);
    return [{ name: `${title}.docx`, blob: await buildDocx(linesToBlocks(pages), { title }) }];
  }
  const pdf = await openForWord(file.bytes, file.password);
  try {
    const { pages, media, renderRegion } = await readEditable(pdf, onProgress);
    const files = await buildEditableDocx(pages, media, renderRegion, { title });
    const zip = new JSZip();
    for (const [path, data] of Object.entries(files)) zip.file(path, data);
    return [{ name: `${title}.docx`, blob: await zip.generateAsync({ type: 'blob', mimeType: DOCX, compression: 'DEFLATE' }) }];
  } finally { await closePdf(pdf); }
}

/* ---------- PDF to Excel ----------
 * Each line is cut into cells wherever the gap between text runs is wider than a couple of
 * spaces. Cell start positions are then clustered across the page into columns, so a value
 * lands under its header even when some rows skip a column.
 */
function lineCells(l) {
  const cells = [];
  let cur = null;
  for (const r of l.runs) {
    // pdf.js fills wide gaps with a whitespace item; skipping it leaves the gap measurable
    if (!r.str.trim()) continue;
    if (cur && r.x - cur.end < l.size * 0.9) {
      cur.runs.push(r); cur.end = Math.max(cur.end, r.x + r.w);
    } else {
      cur = { x: r.x, end: r.x + r.w, runs: [r] };
      cells.push(cur);
    }
  }
  return cells.map((c) => {
    let text = '', prev = null;
    for (const r of readingOrder(c.runs)) {
      if (prev && gapBetween(prev, r) > l.size * 0.15 && !text.endsWith(' ') && !r.str.startsWith(' ')) text += ' ';
      text += r.str; prev = r;
    }
    return { x: c.x, end: c.end, text: cleanText(text).replace(/\s+/g, ' ').trim() };
  }).filter((c) => c.text);
}

function cellValue(s) {
  const t = s.replace(/[\s ]/g, '');
  if (/^[-+(]?[$€£¥]?\d{1,3}(,\d{3})+(\.\d+)?\)?$|^[-+(]?[$€£¥]?\d+(\.\d+)?\)?$/.test(t)) {
    const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
    const n = Number(t.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && !/^0\d/.test(t.replace(/^[-+($€£¥]+/, ''))) return neg ? -n : n;
  }
  return s;
}

function pageToRows(lines) {
  const cellLines = lines.map(lineCells).filter((c) => c.length);
  if (!cellLines.length) return [];
  const tol = Math.max(6, (lines[0]?.size || 10) * 1.2);
  const starts = cellLines.flat().map((c) => c.x).sort((a, b) => a - b);
  const cols = [];
  for (const x of starts) {
    const last = cols[cols.length - 1];
    if (last && x - last.max <= tol) { last.max = x; last.sum += x; last.n++; } else cols.push({ max: x, sum: x, n: 1 });
  }
  const centers = cols.map((c) => c.sum / c.n);
  return cellLines.map((cells) => {
    const row = [];
    for (const c of cells) {
      let k = 0;
      for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - c.x) < Math.abs(centers[k] - c.x)) k = i;
      while (row[k] != null) k++; // two cells snapped to one column: push the later one right
      row[k] = cellValue(c.text);
    }
    return Array.from(row, (v) => v ?? null);
  });
}

export async function pdfToExcel(file, o) {
  const pages = await readLines(file);
  if (!pages.some((p) => p.length)) throw noText(file.name);
  const perPage = pages.map(pageToRows);
  const sheets = o.layout === 'one'
    ? [{ name: baseName(file.name), rows: perPage.flatMap((rows, i) => (i && rows.length ? [[], ...rows] : rows)) }]
    : perPage.map((rows, i) => ({ name: `Page ${i + 1}`, rows })).filter((s) => s.rows.length);
  return [{ name: `${baseName(file.name)}.xlsx`, blob: await buildXlsx(sheets) }];
}

/* ---------- PDF to PowerPoint ---------- */
export async function pdfToPowerpoint(file, o, onProgress) {
  if (o.slides !== 'pictures') {
    const pdf = await openForWord(file.bytes, file.password);
    try {
      const { pages, media, renderRegion } = await readEditable(pdf, onProgress);
      const files = await buildEditablePptx(pages, media, renderRegion, { title: baseName(file.name) });
      const zip = new JSZip();
      for (const [path, data] of Object.entries(files)) zip.file(path, data);
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
      return [{ name: `${baseName(file.name)}.pptx`, blob }];
    } finally { await closePdf(pdf); }
  }
  const pdf = await openForRender(file.bytes, file.password);
  const slides = [];
  const scale = Number(o.dpi || 150) / 72;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPage(pdf, i, { scale });
      slides.push({ jpeg: await blobBytes(await canvasToBlob(canvas, 'image/jpeg', 0.88)), w: vp.width, h: vp.height });
      canvas.width = canvas.height = 0;
      onProgress?.(i / pdf.numPages);
    }
  } finally { await closePdf(pdf); }
  return [{ name: `${baseName(file.name)}.pptx`, blob: await buildPptx(slides, { title: baseName(file.name) }) }];
}

/* ---------- OCR ----------
 * Each page is rendered at 300 dpi and read with Tesseract. The words go back on top of the
 * original page as invisible text, sized and placed over the word they came from, so the
 * page looks the same but can be searched, selected and copied.
 */
const BASE = new URL(import.meta.env.BASE_URL || '/', location.href).href;
export const OCR_LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese']];

let tesseract;
async function ocrWorker(lang) {
  tesseract ||= await import('tesseract.js');
  return tesseract.createWorker(lang, 1, {
    workerPath: `${BASE}ocr/worker.min.js`,
    corePath: `${BASE}ocr/core`,
    langPath: `${BASE}ocr/lang`,
    gzip: true,
  });
}

function wordsOf(data) {
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ ...w, line: l });
  return words;
}

export async function ocr(file, o, onProgress) {
  const render = await openForRender(file.bytes, file.password);
  const doc = await loadPdf(file.bytes, { password: file.password });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  const clean = (s) => [...s].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : '?')).join('');
  const worker = await ocrWorker(o.lang || 'eng');
  const text = [];
  let done = 0, skipped = 0;
  try {
    const pages = doc.getPages();
    for (let i = 1; i <= render.numPages; i++) {
      const pdfPage = await render.getPage(i);
      if (o.skipText) {
        const tc = await pdfPage.getTextContent();
        const existing = tc.items.map((t) => t.str || '').join('').replace(/\s/g, '');
        if (existing.length > 20) { skipped++; text.push(tc.items.map((t) => t.str).join(' ')); onProgress?.(i / render.numPages); continue; }
      }
      const canvas = await renderPage(render, i, { scale: 300 / 72 });
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      text.push(data.text);
      const page = pages[i - 1];
      const W = canvas.width, H = canvas.height;
      for (const w of wordsOf(data)) {
        const str = clean(w.text.trim());
        if (!str || w.confidence < 20) continue;
        const { x0, y0, x1, y1 } = w.bbox;
        const r = toPdfRect(page, { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H });
        const across = r.rot % 180 ? r.h : r.w;
        const tall = r.rot % 180 ? r.w : r.h;
        const width1 = font.widthOfTextAtSize(str, 1);
        if (!width1) continue;
        const size = Math.max(1, Math.min(across / width1, tall * 1.4));
        const origin = rotatedOrigin(r);
        // nudge the baseline up from the box bottom by roughly the font's descent
        const lift = tall * 0.18;
        const vec = [[0, 1], [-1, 0], [0, -1], [1, 0]][[0, 90, 180, 270].indexOf(r.rot)] || [0, 1];
        page.drawText(str, { x: origin.x + vec[0] * lift, y: origin.y + vec[1] * lift, size, font, opacity: 0, rotate: degrees(r.rot) });
      }
      canvas.width = canvas.height = 0;
      done++;
      onProgress?.(i / render.numPages);
    }
  } finally {
    await worker.terminate();
    await closePdf(render);
  }
  const name = baseName(file.name);
  const outputs = o.output === 'txt'
    ? [out(`${name}.txt`, new TextEncoder().encode(text.join('\n\f\n')), 'text/plain')]
    : [out(`${name}-ocr.pdf`, await doc.save())];
  return { outputs, done, skipped };
}

/* ---------- Summarize ----------
 * When the browser ships an on-device summariser (Chrome's Summarizer API) it is used.
 * Otherwise sentences are ranked by how many of the document's key terms they carry,
 * with a nudge for sentences near the start of a section, and the best are kept in order.
 */
const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also may might must shall one two three per via within without upon however thus therefore page'
  + ' le la les des du de et en un une est que qui pour dans sur pas par au aux el los las del y por con para una es se lo der die das und ist mit den dem ein eine zu von nicht il di che per non con')
  .split(' '));

// Chinese, Japanese and Korean (and Thai) don't put spaces between words.
const UNSPACED = /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

export function splitSentences(text) {
  // a full stop between digits (3.5, 1.250) is not the end of a sentence
  const t = text.replace(/\s+/g, ' ').replace(/(\d)\.(\d)/g, '$1\u2024$2');
  return (t.match(/[^.!?。！？।]+(?:[.!?。！？।]+["')\]」』]*|$)/g) || []).map((s) => s.trim().replace(/\u2024/g, '.'))
    .filter((s) => (s.split(' ').length >= 5 || (UNSPACED.test(s) && s.length >= 8)) && (s.match(/\d/g) || []).length < s.length * 0.25);
}

export function extractiveSummary(blocks, count) {
  const sentences = [];
  let sinceHeading = 0;
  for (const b of blocks) {
    if (b.t === 'h') { sinceHeading = 0; continue; }
    if (b.t !== 'p' && b.t !== 'li') continue;
    for (const s of splitSentences(b.text)) sentences.push({ s, pos: sentences.length, early: sinceHeading++ < 2 });
  }
  const words = (s) => {
    const ws = s.toLowerCase().match(/\p{L}[\p{L}\p{M}'-]+/gu)?.filter((w) => w.length > 2 && !STOP.has(w) && !UNSPACED.test(w)) || [];
    // for unspaced scripts, pairs of characters stand in for words
    for (const run of s.match(new RegExp(`${UNSPACED.source}+`, 'gu')) || []) for (let i = 0; i < run.length - 1; i++) ws.push(run.slice(i, i + 2));
    return ws;
  };
  const tf = new Map();
  for (const x of sentences) for (const w of words(x.s)) tf.set(w, (tf.get(w) || 0) + 1);
  const top = Math.max(1, ...tf.values());
  for (const x of sentences) {
    const ws = words(x.s);
    const score = ws.reduce((a, w) => a + tf.get(w) / top, 0) / Math.sqrt(ws.length || 1);
    x.score = score * (x.early ? 1.25 : 1) * (x.s.length > 400 ? 0.7 : 1);
  }
  const seen = new Set();
  return [...sentences].sort((a, b) => b.score - a.score)
    .filter((x) => { const k = x.s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, count).sort((a, b) => a.pos - b.pos).map((x) => x.s);
}

const LENGTH = { short: 5, medium: 10, long: 18 };

export async function summarize(file, o) {
  const pages = await readLines(file);
  if (!pages.some((p) => p.length)) throw noText(file.name);
  const blocks = linesToBlocks(pages);
  const plain = blocks.filter((b) => b.t !== 'page').map((b) => b.text).join('\n');
  const title = baseName(file.name);
  let points = null, method = 'key sentences picked from the document';
  if (o.method !== 'local' && 'Summarizer' in self) {
    try {
      if ((await deadline(self.Summarizer.availability(), 5000, 'no answer')) !== 'unavailable') {
        const sm = await deadline(self.Summarizer.create({ type: 'key-points', format: 'plain-text', length: o.length === 'long' ? 'long' : o.length === 'short' ? 'short' : 'medium' }), 120000, 'model did not load');
        // the on-device model has a small context window, so long files are summarised in parts
        const chunks = plain.match(/[\s\S]{1,12000}(?=\s|$)/g) || [];
        const parts = [];
        for (const c of chunks.slice(0, 12)) parts.push(await deadline(sm.summarize(c), 120000, 'model timed out'));
        sm.destroy?.();
        const got = parts.join('\n').split('\n').map((l) => l.replace(/^[\s*•-]+/, '').trim()).filter(Boolean);
        // some builds answer with an error message instead of throwing
        if (got.length && !/model (is )?not available|not supported/i.test(got.join(' '))) {
          points = got;
          method = 'the summariser built into this browser';
        }
      }
    } catch (e) { console.warn('Built-in summariser failed, using the local method', e); }
  }
  points ||= extractiveSummary(blocks, LENGTH[o.length] || 10);
  if (!points.length) throw new Error(`${file.name} does not have enough running text to summarise.`);
  const headings = blocks.filter((b) => b.t === 'h' && b.level <= 2).map((b) => b.text).slice(0, 12);
  const words = plain.split(/\s+/).length;
  const md = [`# Summary of ${title}`, '', `${pages.length} page${pages.length === 1 ? '' : 's'}, about ${words.toLocaleString()} words. Made with ${method}.`, '',
    '## Key points', '', ...points.map((p) => `- ${p}`), '',
    ...(headings.length ? ['## Sections', '', ...headings.map((h) => `- ${h}`), ''] : [])].join('\n');
  return { outputs: [out(`${title}-summary.md`, new TextEncoder().encode(md), 'text/markdown')], preview: points, method };
}

/* ---------- Translate ----------
 * Uses the browser's on-device Translator API (Chrome 138+ on desktop). The language model
 * downloads once on first use and then works offline; the text never leaves the machine.
 */
export const LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['sv', 'Swedish'], ['vi', 'Vietnamese']];

export function translatorSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

async function detectLanguage(sample) {
  if (!('LanguageDetector' in self)) return null;
  try {
    const d = await deadline(self.LanguageDetector.create(), 20000, 'no detector');
    const [best] = await deadline(d.detect(sample), 10000, 'no answer');
    d.destroy?.();
    return best && best.confidence > 0.5 ? best.detectedLanguage : null;
  } catch { return null; }
}

/** Opened while the click that started the job still counts, since a first download needs it. */
export async function openTranslator(o, sample, onProgress) {
  if (!translatorSupported()) {
    throw new Error('This browser has no on-device translator. Use Chrome 138 or newer on a desktop, or Sheaf-D, which translates on its own server.');
  }
  let from = o.from;
  if (from === 'auto') {
    from = await detectLanguage(sample);
    if (!from) throw new Error('Could not tell which language the PDF is in. Pick it under "From".');
  }
  if (from === o.to) throw new Error('The PDF is already in that language.');
  const broken = 'The translator in this browser did not respond. Chrome 138 or newer on a desktop works, or use Sheaf-D.';
  const avail = await deadline(self.Translator.availability({ sourceLanguage: from, targetLanguage: o.to }), 10000, broken);
  if (avail === 'unavailable') throw new Error(`This browser cannot translate from ${name(from)} to ${name(o.to)} yet.`);
  // a first use downloads the language pack, which can take a few minutes on a slow line
  const tr = await deadline(self.Translator.create({
    sourceLanguage: from, targetLanguage: o.to,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded * 0.3)),
  }), 600000, broken);
  return { tr, from };
}
const name = (code) => LANGS.find(([c]) => c === code)?.[1] || code;

export async function readBlocks(file) {
  const pages = await readLines(file);
  if (!pages.some((p) => p.length)) throw noText(file.name);
  return linesToBlocks(pages);
}

export async function translate(file, blocks, o, tr, onProgress) {
  const res = [];
  const todo = blocks.filter((b) => b.t !== 'page').length || 1;
  let n = 0;
  for (const b of blocks) {
    if (b.t === 'page') { res.push(b); continue; }
    res.push({ ...b, text: await deadline(tr.translate(b.text), 60000, 'The translator stopped responding part way through.') });
    onProgress?.(0.3 + (++n / todo) * 0.7);
  }
  return saveTranslation(file, res, o);
}

async function saveTranslation(file, res, o) {
  const base = `${baseName(file.name)}-${o.to}`;
  if (o.format === 'md') return [out(`${base}.md`, new TextEncoder().encode(blocksToMarkdown(res)), 'text/markdown')];
  return [{ name: `${base}.docx`, blob: await buildDocx(res, { title: base }) }];
}

/* DeepL goes through the relay in vite.config.js, which holds the API key. A plain static
 * host has no relay, so the status check fails and the on-device translator is used. */
export async function deeplReady() {
  try {
    const r = await deadline(fetch(`${BASE}api/deepl/status`), 4000, 'no answer');
    return r.ok && (await r.json()).enabled === true;
  } catch { return false; }
}

export async function translateWithDeepl(file, blocks, o, onProgress) {
  const todo = blocks.map((b, i) => [b, i]).filter(([b]) => b.t !== 'page' && b.text.trim());
  const res = blocks.map((b) => ({ ...b }));
  let detected = null;
  for (let s = 0; s < todo.length; s += 50) {
    const chunk = todo.slice(s, s + 50);
    const r = await fetch(`${BASE}api/deepl/translate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk.map(([b]) => b.text), from: o.from, to: o.to }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'DeepL could not be reached. Is Sheaf running with npm run serve or npm run dev?');
    detected ||= data.detected;
    chunk.forEach(([, i], k) => { res[i].text = data.text[k]; });
    onProgress?.(Math.min(1, (s + chunk.length) / todo.length));
  }
  return { outputs: await saveTranslation(file, res, o), from: o.from === 'auto' ? (detected || '').toLowerCase() : o.from };
}

export { DOCX };
