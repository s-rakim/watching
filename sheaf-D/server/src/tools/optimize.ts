import { promises as fs } from 'node:fs';
import { Output, Tool, UserError, needFiles, qpdf, run, stem } from '../lib.js';

const LEVELS: Record<string, { preset: string; dpi: number }> = {
  extreme: { preset: '/screen', dpi: 72 },
  recommended: { preset: '/ebook', dpi: 150 },
  light: { preset: '/printer', dpi: 300 },
};

export const compress: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const level = LEVELS[job.opts.level] ?? LEVELS.recommended;
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-compressed.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    await run('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.6',
      `-dPDFSETTINGS=${level.preset}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dSAFER',
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-dSubsetFonts=true',
      '-dDownsampleColorImages=true',
      '-dDownsampleGrayImages=true',
      '-dDownsampleMonoImages=true',
      `-dColorImageResolution=${level.dpi}`,
      `-dGrayImageResolution=${level.dpi}`,
      `-dMonoImageResolution=${Math.max(level.dpi, 300)}`,
      `-sOutputFile=${out}`,
      file.path,
    ]).catch((err) => {
      if (/password/i.test(String(err?.stderr ?? err?.message))) {
        throw new UserError('This PDF is password protected. Unlock it first, then try again.');
      }
      throw err;
    });
    // Already-tight files can come out bigger. Hand back the original then.
    const [before, after] = await Promise.all([fs.stat(file.path), fs.stat(out)]);
    if (after.size >= before.size) await fs.copyFile(file.path, out);
    outs.push({ path: out, name });
  }
  return outs;
};

export const repair: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-repaired.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    const attempts: Array<() => Promise<unknown>> = [
      () => qpdf([file.path, out]),
      () => run('gs', ['-o', out, '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress', '-dQUIET', '-dSAFER', file.path]),
      () => run('pdftocairo', ['-pdf', file.path, out]),
    ];
    let fixed = false;
    for (const attempt of attempts) {
      try {
        await attempt();
        const stat = await fs.stat(out);
        if (stat.size > 0) {
          fixed = true;
          break;
        }
      } catch (err) {
        if (err instanceof UserError) throw err;
      }
    }
    if (!fixed) throw new UserError(`${file.name} is too damaged to recover.`);
    outs.push({ path: out, name });
  }
  return outs;
};

export const ocr: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const langs = (Array.isArray(job.opts.languages) ? job.opts.languages : [job.opts.languages || 'eng'])
    .map((l: string) => String(l).replace(/[^a-z_]/gi, ''))
    .filter(Boolean);
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-ocr.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    const args = ['-l', langs.join('+') || 'eng', '--output-type', 'pdf', '--optimize', '1'];
    args.push(job.opts.redo ? '--force-ocr' : '--skip-text');
    if (job.opts.deskew) args.push('--deskew');
    if (job.opts.rotate) args.push('--rotate-pages');
    args.push(file.path, out);
    await ocrmypdf(args);
    outs.push({ path: out, name });
  }
  return outs;
};

export const pdfa: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const level = ['1', '2', '3'].includes(String(job.opts.level)) ? String(job.opts.level) : '2';
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-pdfa.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    // No recognition pass here, only the archival conversion.
    await ocrmypdf(['--skip-text', '--tesseract-timeout', '0', '--output-type', `pdfa-${level}`, file.path, out]);
    outs.push({ path: out, name });
  }
  return outs;
};

async function ocrmypdf(args: string[]) {
  try {
    await run(process.env.OCRMYPDF_BIN || 'ocrmypdf', ['--quiet', ...args], { okCodes: [0, 10], timeout: 30 * 60 * 1000 });
  } catch (err: any) {
    const text = String(err?.stderr ?? err?.message ?? '');
    if (/EncryptedPdfError|encrypted/i.test(text)) {
      throw new UserError('This PDF is password protected. Unlock it first, then try again.');
    }
    if (/does not have language data|MissingDependency.*lang/i.test(text)) {
      throw new UserError('That language pack is not installed for Tesseract.');
    }
    throw err;
  }
}
