import { existsSync, promises as fs } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import { Job, Output, Tool, UserError, ext, needFiles, parseRanges, python, stem } from '../lib.js';

const UNICODE_FONTS = [
  process.env.SHEAF_FONT ?? '',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
].filter(Boolean);

const FAMILIES: Record<string, [StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
};

async function load(file: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await fs.readFile(file));
  } catch (err: any) {
    if (/encrypted/i.test(String(err?.message))) {
      throw new UserError('This PDF is password protected. Unlock it first, then try again.');
    }
    throw new UserError('That PDF could not be opened. Try the Repair tool on it first.');
  }
}

async function pickFont(doc: PDFDocument, text: string, family: string, bold: boolean): Promise<PDFFont> {
  const [regular, heavy] = FAMILIES[family] ?? FAMILIES.sans;
  const standard = await doc.embedFont(bold ? heavy : regular);
  try {
    standard.encodeText(text);
    return standard;
  } catch {
    const fallback = UNICODE_FONTS.find((p) => existsSync(p));
    if (!fallback) throw new UserError('That text uses characters the built-in fonts cannot draw.');
    doc.registerFontkit(fontkit);
    return doc.embedFont(await fs.readFile(fallback), { subset: true });
  }
}

/** Can the PDF standard font draw this text as it is? */
async function plainFont(doc: PDFDocument, texts: string[], family: string, bold: boolean): Promise<PDFFont | null> {
  const [regular, heavy] = FAMILIES[family] ?? FAMILIES.sans;
  const standard = await doc.embedFont(bold ? heavy : regular);
  try {
    for (const t of texts) standard.encodeText(t);
    return standard;
  } catch {
    return null;
  }
}

type TextPicture = { image: PDFImage; w: number; h: number };

/**
 * Text the standard fonts can't draw (Chinese, Arabic, Hindi...) drawn as pictures with
 * fonts that have those characters, and with Arabic joined and Indic marks in place, which
 * a PDF font alone doesn't do. Null if that isn't possible here.
 */
async function textPictures(job: Job, doc: PDFDocument, texts: string[], o: { size: number; color: string; bold: boolean; family: string }):
  Promise<Map<string, TextPicture> | null> {
  const unique = [...new Set(texts)];
  const dir = job.out(`text-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  const items = unique.map((text, i) => ({ text, out: `${dir}/${i}.png` }));
  const spec = `${dir}/spec.json`;
  await fs.writeFile(spec, JSON.stringify({ items, size: o.size, color: o.color, bold: o.bold, family: o.family }));
  try {
    const { stdout } = await python('text_image.py', [spec]);
    const sizes = JSON.parse(stdout) as { w: number; h: number }[];
    const out = new Map<string, TextPicture>();
    for (const [i, it] of items.entries()) {
      out.set(it.text, { image: await doc.embedPng(await fs.readFile(it.out)), w: sizes[i].w, h: sizes[i].h });
    }
    return out;
  } catch {
    return null;
  }
}

function colour(hex: string | undefined, fallback = '#000000') {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '') ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Switches a page into "what you see" coordinates: origin at the bottom left
 * of the page as displayed, whatever its /Rotate entry or crop box says.
 * Returns the visible width and height. Call done() once drawing is finished.
 */
export function viewSpace(page: PDFPage): { width: number; height: number; done: () => void } {
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const { x, y, width: w, height: h } = box;
  let m: [number, number, number, number, number, number] = [1, 0, 0, 1, x, y];
  let size = { width: w, height: h };
  if (angle === 90) {
    m = [0, 1, -1, 0, x + w, y];
    size = { width: h, height: w };
  } else if (angle === 180) {
    m = [-1, 0, 0, -1, x + w, y + h];
  } else if (angle === 270) {
    m = [0, -1, 1, 0, x, y + h];
    size = { width: h, height: w };
  }
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  return { ...size, done: () => page.pushOperators(popGraphicsState()) };
}

type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

/** Centre point for a box of the given size sitting at one of nine anchors. */
function place(anchor: Anchor, pw: number, ph: number, w: number, h: number, margin: number) {
  const col = anchor[1];
  const row = anchor[0];
  const cx = col === 'l' ? margin + w / 2 : col === 'r' ? pw - margin - w / 2 : pw / 2;
  const cy = row === 'b' ? margin + h / 2 : row === 't' ? ph - margin - h / 2 : ph / 2;
  return { cx, cy };
}

/** Bottom-left corner for a w x h box rotated by `deg` around its centre. */
function corner(cx: number, cy: number, w: number, h: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  return {
    x: cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t),
    y: cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t),
  };
}

const ALL_ANCHORS: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];

export const watermark: Tool = async (job) => {
  const pdfs = job.files.filter((f) => f.field !== 'image');
  const stampFile = job.files.find((f) => f.field === 'image');
  if (!pdfs.length) throw new UserError('Add a PDF first.');
  const o = job.opts;
  const kind = o.kind === 'image' ? 'image' : 'text';
  const text = String(o.text ?? '').trim();
  if (kind === 'text' && !text) throw new UserError('Type the watermark text first.');
  if (kind === 'image' && !stampFile) throw new UserError('Choose an image to use as the watermark.');

  const opacity = Math.min(1, Math.max(0.05, Number(o.opacity ?? 0.3)));
  const angle = Number(o.rotation ?? 0);
  const anchors: Anchor[] = o.mosaic ? ALL_ANCHORS : [ALL_ANCHORS.includes(o.position) ? o.position : 'mc'];
  const outs: Output[] = [];

  let stampBytes: Buffer | null = null;
  let stampIsPng = false;
  if (kind === 'image' && stampFile) {
    stampIsPng = ext(stampFile.name) === 'png';
    if (!stampIsPng && !['jpg', 'jpeg'].includes(ext(stampFile.name))) {
      const converted = job.out('stamp.png');
      await python('img_normalize.py', [stampFile.path, converted, 'png']);
      stampBytes = await fs.readFile(converted);
      stampIsPng = true;
    } else {
      stampBytes = await fs.readFile(stampFile.path);
    }
  }

  for (const file of pdfs) {
    const doc = await load(file.path);
    const pages = doc.getPages();
    const wanted = new Set(parseRanges(o.pages, pages.length));
    const baseSize = Number(o.fontSize ?? 48);
    let font = kind === 'text' ? await plainFont(doc, [text], o.font, !!o.bold) : null;
    let picture: TextPicture | null = null;
    if (kind === 'text' && !font) {
      const pics = await textPictures(job, doc, [text], { size: baseSize, color: String(o.color ?? '#d0342c'), bold: !!o.bold, family: o.font });
      picture = pics?.get(text) ?? null;
      if (!picture) font = await pickFont(doc, text, o.font, !!o.bold);
    }
    const image = stampBytes ? (stampIsPng ? await doc.embedPng(stampBytes) : await doc.embedJpg(stampBytes)) : null;
    const t = (angle * Math.PI) / 180;
    const turned = (w: number, h: number) => ({
      bw: Math.abs(w * Math.cos(t)) + Math.abs(h * Math.sin(t)),
      bh: Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t)),
    });

    pages.forEach((page, i) => {
      if (!wanted.has(i + 1)) return;
      const view = viewSpace(page);
      const margin = Math.min(view.width, view.height) * 0.05;
      // the size of one stamp, before tiling shrinks it
      let w = 0, h = 0;
      if (font) { w = font.widthOfTextAtSize(text, baseSize); h = font.heightAtSize(baseSize, { descender: false }); }
      else if (picture) { w = picture.w; h = picture.h; }
      else if (image) { w = view.width * (Number(o.scale ?? 30) / 100); h = (w * image.height) / image.width; }
      // A tiled watermark gets one ninth of the page per copy, so copies never overlap.
      let k = o.mosaic ? 0.6 : 1;
      const { bw, bh } = turned(w * k, h * k);
      if (o.mosaic) k *= Math.min(1, ((view.width - margin * 2) / 3) * 0.92 / bw, ((view.height - margin * 2) / 3) * 0.92 / bh);
      else k *= Math.min(1, (view.width - margin * 2) / bw, (view.height - margin * 2) / bh);
      const sw = w * k, sh = h * k;
      const box = turned(sw, sh);
      for (const anchor of anchors) {
        const { cx, cy } = place(anchor, view.width, view.height, box.bw, box.bh, margin);
        const at = corner(cx, cy, sw, sh, angle);
        if (font) {
          page.drawText(text, { ...at, size: baseSize * k, font, color: colour(o.color, '#d0342c'), opacity, rotate: degrees(angle) });
        } else if (picture) {
          page.drawImage(picture.image, { ...at, width: sw, height: sh, opacity, rotate: degrees(angle) });
        } else if (image) {
          page.drawImage(image, { ...at, width: sw, height: sh, opacity, rotate: degrees(angle) });
        }
      }
      view.done();
    });

    const name = `${stem(file.name)}-watermarked.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    await fs.writeFile(out, await doc.save());
    outs.push({ path: out, name });
  }
  return outs;
};

export const pageNumbers: Tool = async (job: Job) => {
  needFiles(job, 1, 'PDF');
  const o = job.opts;
  const template = String(o.template || '{n}');
  const size = Number(o.fontSize ?? 12);
  const anchor: Anchor = ALL_ANCHORS.includes(o.position) ? o.position : 'bc';
  const margin = { small: 18, medium: 32, large: 54 }[String(o.margin ?? 'medium')] ?? 32;
  const start = parseInt(o.start ?? '1', 10) || 1;
  const outs: Output[] = [];

  for (const file of job.files) {
    const doc = await load(file.path);
    const pages = doc.getPages();
    const wanted = parseRanges(o.pages, pages.length);
    const wantedSet = new Set(wanted);
    const numbered = pages.map((_, i) => i + 1).filter((p) => wantedSet.has(p));
    const last = start + numbered.length - 1;
    const labels = numbered.map((_, idx) => template.replaceAll('{n}', String(start + idx)).replaceAll('{p}', String(last)));
    let font = await plainFont(doc, labels, o.font, !!o.bold);
    const pictures = font ? null : await textPictures(job, doc, labels, { size, color: String(o.color ?? '#1c1b1a'), bold: !!o.bold, family: o.font });
    if (!font && !pictures) font = await pickFont(doc, labels[labels.length - 1] ?? '', o.font, !!o.bold);

    numbered.forEach((pageNo, idx) => {
      const page = pages[pageNo - 1];
      const label = labels[idx];
      const view = viewSpace(page);
      const pic = pictures?.get(label);
      const w = pic ? pic.w : font!.widthOfTextAtSize(label, size);
      const h = pic ? pic.h : font!.heightAtSize(size, { descender: false });
      const { cx, cy } = place(anchor, view.width, view.height, w, h, margin);
      if (pic) page.drawImage(pic.image, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
      else page.drawText(label, { x: cx - w / 2, y: cy - h / 2, size, font: font!, color: colour(o.color, '#1c1b1a') });
      view.done();
    });

    const name = `${stem(file.name)}-numbered.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    await fs.writeFile(out, await doc.save());
    outs.push({ path: out, name });
  }
  return outs;
};

const PAPER: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  legal: [612, 1008],
};

export const imagesToPdf: Tool = async (job) => {
  needFiles(job, 1, 'image');
  const o = job.opts;
  const margin = { none: 0, small: 20, big: 48 }[String(o.margin ?? 'none')] ?? 0;
  const paper = PAPER[String(o.pageSize)] ?? null;
  const single = o.merge !== false;
  const outs: Output[] = [];
  let doc = await PDFDocument.create();

  for (const [i, file] of job.files.entries()) {
    const normalised = job.out(`img-${i}.jpg`);
    try {
      await python('img_normalize.py', [file.path, normalised, 'jpg']);
    } catch {
      throw new UserError(`${file.name} is not an image this tool can read.`);
    }
    const image = await doc.embedJpg(await fs.readFile(normalised));
    let pw: number;
    let ph: number;
    if (!paper) {
      // 72 dpi points keep the photo's pixel size sensible on screen.
      pw = image.width * 0.75 + margin * 2;
      ph = image.height * 0.75 + margin * 2;
    } else {
      const landscape = o.orientation === 'landscape' || (o.orientation !== 'portrait' && image.width > image.height);
      [pw, ph] = landscape ? [paper[1], paper[0]] : paper;
    }
    const page = doc.addPage([pw, ph]);
    const fit = Math.min((pw - margin * 2) / image.width, (ph - margin * 2) / image.height);
    const w = image.width * fit;
    const h = image.height * fit;
    page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });

    if (!single) {
      const name = `${stem(file.name)}.pdf`;
      const out = job.out(`${i}-${name}`);
      await fs.writeFile(out, await doc.save());
      outs.push({ path: out, name });
      doc = await PDFDocument.create();
    }
  }

  if (single) {
    const name = job.files.length === 1 ? `${stem(job.files[0].name)}.pdf` : String(o.outputName || 'images.pdf');
    const out = job.out(name);
    await fs.writeFile(out, await doc.save());
    outs.push({ path: out, name });
  }
  return outs;
};
