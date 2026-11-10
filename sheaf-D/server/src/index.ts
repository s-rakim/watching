import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Job, Output, Tool, UserError, run, safeName } from './lib.js';
import { extractPages, merge, organize, removePages, rotate, split } from './tools/pages.js';
import { compress, ocr, pdfa, repair } from './tools/optimize.js';
import { protect, unlock } from './tools/security.js';
import { imagesToPdf, pageNumbers, watermark } from './tools/stamp.js';
import {
  browserPath,
  excelToPdf,
  htmlToPdf,
  pdfToExcel,
  pdfToJpg,
  pdfToPowerpoint,
  pdfToWord,
  powerpointToPdf,
  wordToPdf,
} from './tools/convert.js';

const TOOLS: Record<string, Tool> = {
  merge,
  split,
  'remove-pages': removePages,
  'extract-pages': extractPages,
  organize,
  rotate,
  compress,
  repair,
  ocr,
  'pdf-to-pdfa': pdfa,
  protect,
  unlock,
  watermark,
  'page-numbers': pageNumbers,
  'jpg-to-pdf': imagesToPdf,
  'scan-to-pdf': imagesToPdf,
  'word-to-pdf': wordToPdf,
  'powerpoint-to-pdf': powerpointToPdf,
  'excel-to-pdf': excelToPdf,
  'html-to-pdf': htmlToPdf,
  'pdf-to-jpg': pdfToJpg,
  'pdf-to-word': pdfToWord,
  'pdf-to-powerpoint': pdfToPowerpoint,
  'pdf-to-excel': pdfToExcel,
};

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB ?? '500', 10);
const WORK_ROOT = process.env.WORK_DIR ?? path.join(os.tmpdir(), 'sheaf');
const WEB_DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist');

await fs.rm(WORK_ROOT, { recursive: true, force: true });
await fs.mkdir(WORK_ROOT, { recursive: true });

const app = express();
app.disable('x-powered-by');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join((req as any).jobDir as string, 'in');
      fs.mkdir(dir, { recursive: true }).then(
        () => cb(null, dir),
        (err) => cb(err, dir),
      );
    },
    filename: (req, file, cb) => {
      const n = ((req as any).fileSeq = ((req as any).fileSeq ?? 0) + 1);
      cb(null, `${String(n).padStart(4, '0')}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 200 },
});

function openJob(req: Request, res: Response, next: NextFunction) {
  const dir = path.join(WORK_ROOT, randomUUID());
  (req as any).jobDir = dir;
  // Uploads and results only live as long as the request that made them.
  res.on('close', () => void fs.rm(dir, { recursive: true, force: true }));
  fs.mkdir(path.join(dir, 'out'), { recursive: true }).then(() => next(), next);
}

async function probe(cmd: string, args: string[]): Promise<string | null> {
  try {
    const r = await run(cmd, args, { timeout: 20_000, okCodes: [0, 1] });
    return (r.stdout || r.stderr).trim();
  } catch {
    return null;
  }
}

let capabilities: Promise<Record<string, unknown>> | null = null;
function detect() {
  capabilities ??= (async () => {
    const [qpdfV, gsV, office, ocrV, langs, poppler, py] = await Promise.all([
      probe('qpdf', ['--version']),
      probe('gs', ['--version']),
      probe(process.env.SOFFICE_BIN || 'soffice', ['--version']),
      probe(process.env.OCRMYPDF_BIN || 'ocrmypdf', ['--version']),
      probe('tesseract', ['--list-langs']),
      probe('pdftoppm', ['-v']),
      probe(process.env.PYTHON_BIN || 'python3', ['-c', 'import pdf2docx, pdfplumber, openpyxl, PIL; print("ok")']),
    ]);
    return {
      qpdf: !!qpdfV,
      ghostscript: !!gsV,
      libreoffice: !!office,
      ocr: !!ocrV,
      poppler: !!poppler,
      python: py === 'ok',
      chromium: !!browserPath(),
      languages: (langs ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[a-z_]{3,}$/i.test(l) && l !== 'osd'),
      maxUploadMb: MAX_MB,
    };
  })();
  return capabilities;
}

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, ...(await detect()) });
});

app.post('/api/tools/:tool', openJob, upload.any(), async (req, res, next) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return next(Object.assign(new UserError('There is no tool by that name.'), { status: 404 }));
  const dir = (req as any).jobDir as string;
  try {
    let opts: Record<string, any> = {};
    if (typeof req.body?.options === 'string' && req.body.options) {
      try {
        opts = JSON.parse(req.body.options);
      } catch {
        throw new UserError('The options sent with this request were not valid.');
      }
    }
    const files = ((req.files as Express.Multer.File[]) ?? []).map((f) => ({
      path: f.path,
      // Browsers send names as UTF-8 but multer reads them as latin1.
      name: safeName(Buffer.from(f.originalname, 'latin1').toString('utf8')),
      field: f.fieldname,
    }));
    const job: Job = {
      dir,
      files,
      opts,
      out: (name) => path.join(dir, 'out', safeName(name)),
    };
    const outputs = await tool(job);
    if (!outputs.length) throw new UserError('Nothing came out of that. Check the file and try again.');
    await send(res, dir, outputs, req.params.tool);
  } catch (err) {
    next(err);
  }
});

async function send(res: Response, dir: string, outputs: Output[], tool: string) {
  let file = outputs[0];
  if (outputs.length > 1) {
    file = { path: path.join(dir, 'bundle.zip'), name: `sheaf-${tool}.zip` };
    await zip(file.path, outputs);
  }
  const stat = await fs.stat(file.path);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Sheaf-Files', String(outputs.length));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Sheaf-Files');
  res.download(file.path, file.name);
}

function zip(target: string, outputs: Output[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(target);
    const archive = archiver('zip', { zlib: { level: 6 } });
    stream.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(stream);
    const seen = new Map<string, number>();
    for (const o of outputs) {
      const count = seen.get(o.name) ?? 0;
      seen.set(o.name, count + 1);
      const ext = path.extname(o.name);
      const name = count ? `${o.name.slice(0, o.name.length - ext.length)} (${count + 1})${ext}` : o.name;
      archive.file(o.path, { name });
    }
    void archive.finalize();
  });
}

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `Files can be up to ${MAX_MB} MB each.` : 'That upload could not be read.';
    return res.status(413).json({ error: message });
  }
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong while processing that file. Check it opens normally and try again.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Sheaf-D is running at http://localhost:${PORT}`);
});
