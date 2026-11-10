import { promises as fs } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { Job, Output, Tool, UserError, needFiles, pageCount, parseRanges, qpdf, stem, toRangeString, run } from '../lib.js';

export const merge: Tool = async (job) => {
  needFiles(job, 2, 'PDF');
  const out = job.out('merged.pdf');
  const args = ['--empty', '--pages'];
  for (const f of job.files) args.push(f.path, '1-z');
  args.push('--', out);
  await qpdf(args);
  return [{ path: out, name: 'merged.pdf' }];
};

export const split: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outputs: Output[] = [];
  for (const file of job.files) {
    const total = await pageCount(file.path);
    const base = stem(file.name);
    const mode = job.opts.mode ?? 'ranges';
    let groups: number[][] = [];

    if (mode === 'every') {
      const size = Math.max(1, parseInt(job.opts.every ?? '1', 10) || 1);
      for (let p = 1; p <= total; p += size) {
        groups.push(Array.from({ length: Math.min(size, total - p + 1) }, (_, i) => p + i));
      }
    } else if (mode === 'all') {
      groups = Array.from({ length: total }, (_, i) => [i + 1]);
    } else {
      const ranges: string[] = String(job.opts.ranges ?? '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ranges.length) throw new UserError('Type at least one page range, for example 1-3.');
      groups = ranges.map((r) => parseRanges(r, total));
      if (job.opts.mergeRanges) groups = [groups.flat()];
    }

    for (const [i, pages] of groups.entries()) {
      const label =
        groups.length === 1 && mode === 'ranges'
          ? 'split'
          : pages.length === 1
            ? `page-${pages[0]}`
            : `pages-${pages[0]}-${pages[pages.length - 1]}`;
      const name = `${base}-${label}.pdf`;
      const out = job.out(`${outputs.length + i}-${name}`);
      await qpdf([file.path, '--pages', file.path, toRangeString(pages), '--', out]);
      outputs.push({ path: out, name });
    }
  }
  return outputs;
};

export const removePages: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const file = job.files[0];
  const total = await pageCount(file.path);
  const drop = new Set(parseRanges(job.opts.pages, total));
  if (!String(job.opts.pages ?? '').trim()) throw new UserError('Pick the pages you want to remove.');
  const keep = Array.from({ length: total }, (_, i) => i + 1).filter((p) => !drop.has(p));
  if (!keep.length) throw new UserError("That would remove every page. Leave at least one.");
  const name = `${stem(file.name)}-trimmed.pdf`;
  const out = job.out(name);
  await qpdf([file.path, '--pages', file.path, toRangeString(keep), '--', out]);
  return [{ path: out, name }];
};

export const extractPages: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const file = job.files[0];
  const total = await pageCount(file.path);
  if (!String(job.opts.pages ?? '').trim()) throw new UserError('Pick the pages you want to extract.');
  const pages = parseRanges(job.opts.pages, total);
  const base = stem(file.name);
  if (job.opts.separate) {
    const outs: Output[] = [];
    for (const p of pages) {
      const name = `${base}-page-${p}.pdf`;
      const out = job.out(`${outs.length}-${name}`);
      await qpdf([file.path, '--pages', file.path, String(p), '--', out]);
      outs.push({ path: out, name });
    }
    return outs;
  }
  const name = `${base}-extracted.pdf`;
  const out = job.out(name);
  await qpdf([file.path, '--pages', file.path, toRangeString(pages), '--', out]);
  return [{ path: out, name }];
};

interface PlanPage {
  file?: number;
  page?: number;
  rotate?: number;
  blank?: boolean;
}

/**
 * Rebuilds a document from a page plan the browser sends: any page from any
 * uploaded file, in any order, optionally turned, with blank pages in between.
 */
export const organize: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const plan: PlanPage[] = Array.isArray(job.opts.pages) ? job.opts.pages : [];
  if (!plan.length) throw new UserError('There are no pages left to save.');

  let blankPath = '';
  const args = ['--empty', '--pages'];
  for (const p of plan) {
    if (p.blank) {
      if (!blankPath) blankPath = await makeBlank(job);
      args.push(blankPath, '1');
      continue;
    }
    const file = job.files[p.file ?? -1];
    if (!file || !Number.isInteger(p.page) || (p.page as number) < 1) {
      throw new UserError('The page list refers to a file that was not uploaded.');
    }
    args.push(file.path, String(p.page));
  }
  const first = job.out('ordered.pdf');
  args.push('--', first);
  await qpdf(args);

  const turns = new Map<number, number[]>();
  plan.forEach((p, i) => {
    const deg = (((p.rotate ?? 0) % 360) + 360) % 360;
    if (deg) turns.set(deg, [...(turns.get(deg) ?? []), i + 1]);
  });
  const name = job.files.length === 1 ? `${stem(job.files[0].name)}-organized.pdf` : 'organized.pdf';
  if (!turns.size) return [{ path: first, name }];

  const out = job.out(name);
  const rotateArgs = [...turns].map(([deg, pages]) => `--rotate=+${deg}:${toRangeString(pages)}`);
  await qpdf([first, ...rotateArgs, out]);
  return [{ path: out, name }];
};

async function makeBlank(job: Job): Promise<string> {
  let size: [number, number] = [595.28, 841.89];
  try {
    const { stdout } = await run('pdfinfo', [job.files[0].path]);
    const m = stdout.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
    if (m) size = [parseFloat(m[1]), parseFloat(m[2])];
  } catch {
    // A4 is a fine fallback.
  }
  const doc = await PDFDocument.create();
  doc.addPage(size);
  const p = job.out('blank.pdf');
  await fs.writeFile(p, await doc.save());
  return p;
}

export const rotate: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const angle = parseInt(job.opts.angle ?? '90', 10);
  if (![90, 180, 270].includes(angle)) throw new UserError('Rotation has to be 90, 180 or 270 degrees.');
  const outs: Output[] = [];
  for (const file of job.files) {
    const total = await pageCount(file.path);
    const pages = parseRanges(job.opts.pages, total);
    const name = `${stem(file.name)}-rotated.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    await qpdf([file.path, `--rotate=+${angle}:${toRangeString([...new Set(pages)].sort((a, b) => a - b))}`, out]);
    outs.push({ path: out, name });
  }
  return outs;
};
