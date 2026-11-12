import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { buildEditableDocx, buildEditablePptx, type FlowMedia, type FlowPage, type Region } from '../docxflow.js';
import { Job, Output, Tool, UserError, exists, ext, listFiles, needFiles, python, run, stem } from '../lib.js';

const SOFFICE = process.env.SOFFICE_BIN || 'soffice';

/** Runs LibreOffice headless with a throwaway profile so jobs can overlap. */
async function office(job: Job, file: string, to: string, infilter?: string): Promise<string> {
  const outDir = path.join(job.dir, `lo-out-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(outDir, { recursive: true });
  const profile = pathToFileURL(path.join(job.dir, 'lo-profile')).href;
  const args = [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck'];
  if (infilter) args.push(`--infilter=${infilter}`);
  args.push('--convert-to', to, '--outdir', outDir, file);
  await run(SOFFICE, args, { timeout: 15 * 60 * 1000, env: { ...process.env, HOME: job.dir } });
  const made = await listFiles(outDir);
  if (!made.length) throw new UserError(`${path.basename(file)} could not be converted.`);
  return made[0];
}

const OFFICE_INPUT: Record<string, string[]> = {
  word: ['doc', 'docx', 'odt', 'rtf', 'txt', 'dot', 'dotx', 'wps'],
  powerpoint: ['ppt', 'pptx', 'odp', 'pps', 'ppsx'],
  excel: ['xls', 'xlsx', 'ods', 'csv', 'xlsm'],
};

function officeToPdf(kind: keyof typeof OFFICE_INPUT): Tool {
  return async (job) => {
    needFiles(job, 1, 'document');
    const outs: Output[] = [];
    for (const file of job.files) {
      if (!OFFICE_INPUT[kind].includes(ext(file.name))) {
        throw new UserError(`${file.name} isn't a file this tool converts. It takes ${OFFICE_INPUT[kind].join(', ')}.`);
      }
      const made = await office(job, file.path, 'pdf');
      outs.push({ path: made, name: `${stem(file.name)}.pdf` });
    }
    return outs;
  };
}

export const wordToPdf = officeToPdf('word');
export const powerpointToPdf = officeToPdf('powerpoint');
export const excelToPdf = officeToPdf('excel');

/**
 * PDF to an editable Word file or PowerPoint deck: PyMuPDF lists what is on each page (text, boxes, lines,
 * pictures) and docxflow.js, the same engine the browser app uses, turns that into real
 * tables, boxes, paragraphs and separate pictures. Charts and other drawings Word can't
 * edit become pictures of just that area, rendered in a second pass.
 */
async function editableOffice(job: Job, src: string, out: string, build: typeof buildEditableDocx = buildEditableDocx): Promise<void> {
  const dir = path.join(job.dir, `elements-${Math.random().toString(36).slice(2, 8)}`);
  await python('pdf_to_docx.py', [src, dir, 'elements']);
  const data = JSON.parse(await fs.readFile(path.join(dir, 'elements.json'), 'utf8')) as {
    title: string; pages: FlowPage[]; media: Record<string, { file: string; ext: 'png' | 'jpeg' }>;
  };
  const media: FlowMedia = {};
  for (const [id, m] of Object.entries(data.media)) {
    media[id] = { bytes: new Uint8Array(await fs.readFile(path.join(dir, m.file))), ext: m.ext };
  }
  const keyOf = (pi: number, b: Region) => `r${pi}-${[b.x, b.y, b.w, b.h].map((v) => Math.round(v * 100)).join('-')}`;
  // First pass only notes which areas need a picture; the second has them.
  const wanted = new Map<string, Region & { page: number; key: string }>();
  const blank = new Uint8Array(0);
  await build(data.pages, media, async (pi, b) => {
    const key = keyOf(pi, b);
    wanted.set(key, { page: pi, key, x: b.x, y: b.y, w: b.w, h: b.h });
    return blank;
  }, { title: data.title });
  const rendered = new Map<string, Uint8Array>();
  if (wanted.size) {
    const spec = path.join(dir, 'regions.json');
    await fs.writeFile(spec, JSON.stringify([...wanted.values()]));
    await python('pdf_to_docx.py', [src, dir, 'regions', spec]);
    for (const key of wanted.keys()) {
      const file = path.join(dir, `${key}.png`);
      if (await exists(file)) rendered.set(key, new Uint8Array(await fs.readFile(file)));
    }
  }
  const files = await build(data.pages, media, async (pi, b) => rendered.get(keyOf(pi, b)) ?? blank,
    { title: data.title });
  await new Promise<void>((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 6 } });
    const stream = createWriteStream(out);
    stream.on('close', () => resolve());
    zip.on('error', reject);
    zip.pipe(stream);
    // [Content_Types].xml first, as Word expects
    const names = Object.keys(files).sort((a, b) => Number(b === '[Content_Types].xml') - Number(a === '[Content_Types].xml'));
    for (const name of names) {
      const v = files[name];
      zip.append(typeof v === 'string' ? v : Buffer.from(v), { name, store: /\.(png|jpe?g)$/.test(name) });
    }
    void zip.finalize();
  });
  await fs.rm(dir, { recursive: true, force: true });
}

export const pdfToWord: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}.docx`;
    const out = job.out(`${outs.length}-${name}`);
    const flow = job.opts.layout === 'flow';
    // If the chosen way fails on an odd file, the other one usually still copes.
    const viaFlow = async () => {
      await python('pdf_to_docx.py', [file.path, out, 'flow']);
      if (!(await exists(out))) throw new Error('no output');
    };
    const viaElements = () => editableOffice(job, file.path, out);
    try {
      await (flow ? viaFlow() : viaElements()).catch(() => (flow ? viaElements() : viaFlow()));
      outs.push({ path: out, name });
    } catch {
      // LibreOffice's own PDF import is rougher, but better than nothing.
      const made = await office(job, file.path, 'docx:MS Word 2007 XML', 'writer_pdf_import');
      outs.push({ path: made, name });
    }
  }
  return outs;
};

export const pdfToPowerpoint: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}.pptx`;
    const out = job.out(`${outs.length}-${name}`);
    try {
      // text boxes, shapes and pictures where they were on the page
      await editableOffice(job, file.path, out, buildEditablePptx);
      outs.push({ path: out, name });
    } catch {
      const made = await office(job, file.path, 'pptx:Impress MS PowerPoint 2007 XML', 'impress_pdf_import');
      outs.push({ path: made, name });
    }
  }
  return outs;
};

export const pdfToExcel: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}.xlsx`;
    const out = job.out(`${outs.length}-${name}`);
    await python('pdf_to_xlsx.py', [file.path, out]);
    outs.push({ path: out, name });
  }
  return outs;
};

export const pdfToJpg: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const [i, file] of job.files.entries()) {
    const dir = path.join(job.dir, `img-${i}`);
    await fs.mkdir(dir, { recursive: true });
    const base = stem(file.name);
    if (job.opts.mode === 'images') {
      await run('pdfimages', ['-all', file.path, path.join(dir, base)]);
      const made = await listFiles(dir);
      if (!made.length) throw new UserError(`${file.name} has no embedded images to extract.`);
      for (const p of made) outs.push({ path: p, name: path.basename(p) });
    } else {
      const dpi = { low: 72, medium: 150, high: 300 }[String(job.opts.quality ?? 'medium')] ?? 150;
      await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=90', '-r', String(dpi), file.path, path.join(dir, 'page')]);
      const made = await listFiles(dir);
      made.forEach((p, n) => outs.push({ path: p, name: `${base}-page-${n + 1}.jpg` }));
    }
  }
  return outs;
};

const BROWSERS = [
  process.env.CHROMIUM_BIN ?? '',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function browserPath(): string | undefined {
  return BROWSERS.find((p) => existsSync(p));
}

export const htmlToPdf: Tool = async (job) => {
  const url = String(job.opts.url ?? '').trim();
  if (!url && !job.files.length) throw new UserError('Paste a web address or add an HTML file.');
  if (url && !/^https?:\/\//i.test(url)) throw new UserError('The address has to start with http:// or https://');
  const executablePath = browserPath();
  if (!executablePath) {
    const e = new UserError('Chromium is not installed on this machine, so this tool cannot run here.');
    e.status = 501;
    throw e;
  }

  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const o = job.opts;
  const margin = { none: '0', small: '10mm', big: '25mm' }[String(o.margin ?? 'small')] ?? '10mm';
  const width = { desktop: 1440, laptop: 1280, tablet: 820, phone: 390 }[String(o.screen ?? 'laptop')] ?? 1280;
  const outs: Output[] = [];
  try {
    const targets = url
      ? [{ href: url, name: `${new URL(url).hostname.replace(/^www\./, '')}.pdf` }]
      : job.files.map((f) => ({ href: pathToFileURL(f.path).href, name: `${stem(f.name)}.pdf` }));
    for (const target of targets) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      try {
        await page.goto(target.href, { waitUntil: 'networkidle2', timeout: 60_000 });
      } catch {
        throw new UserError(`Could not load ${url || target.name.replace(/\.pdf$/, '')}. Check the address and try again.`);
      }
      const out = job.out(`${outs.length}-${target.name}`);
      if (o.pageSize === 'single') {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.pdf({ path: out, width: `${width}px`, height: `${Math.min(height + 2, 14000)}px`, printBackground: true });
      } else {
        await page.pdf({
          path: out,
          format: (['A3', 'A4', 'A5', 'Letter', 'Legal'].includes(o.pageSize) ? o.pageSize : 'A4') as any,
          landscape: o.orientation === 'landscape',
          printBackground: true,
          margin: { top: margin, bottom: margin, left: margin, right: margin },
        });
      }
      await page.close();
      outs.push({ path: out, name: target.name });
    }
  } finally {
    await browser.close();
  }
  return outs;
};
