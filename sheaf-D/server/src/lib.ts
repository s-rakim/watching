import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Upload {
  path: string;
  name: string;
  field: string;
}

export interface Output {
  path: string;
  name: string;
}

export interface Job {
  dir: string;
  files: Upload[];
  opts: Record<string, any>;
  /** Returns a fresh path inside the job's output folder. */
  out(name: string): string;
}

export type Tool = (job: Job) => Promise<Output[]>;

/** An error whose message is safe to show to the person using the app. */
export class UserError extends Error {
  status = 400;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(
  cmd: string,
  args: string[],
  opts: { okCodes?: number[]; timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const okCodes = opts.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout ?? 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : -1) : 0;
        if (err && (err as any).code === 'ENOENT') {
          const e = new UserError(`"${cmd}" is not installed on this machine, so this tool can't run here.`);
          e.status = 501;
          return reject(e);
        }
        if (err && (err as any).killed) {
          return reject(new UserError('That took too long and was stopped. Try a smaller file.'));
        }
        if (!okCodes.includes(code)) {
          const e: any = new Error(`${cmd} exited with ${code}: ${String(stderr || stdout).slice(0, 2000)}`);
          e.stderr = String(stderr);
          e.stdout = String(stdout);
          e.code = code;
          return reject(e);
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

/** qpdf exits with 3 when it finished but had warnings. That still counts. */
export async function qpdf(args: string[]): Promise<RunResult> {
  try {
    return await run('qpdf', args, { okCodes: [0, 3] });
  } catch (err: any) {
    const text = `${err?.stderr ?? ''}${err?.message ?? ''}`;
    if (/invalid password/i.test(text)) {
      throw new UserError('This PDF is password protected. Unlock it first, then try again.');
    }
    throw err;
  }
}

export async function pageCount(file: string): Promise<number> {
  const { stdout } = await qpdf(['--show-npages', file]);
  const n = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(n)) throw new UserError('Could not read that PDF.');
  return n;
}

/**
 * Turns "1-3, 5, 8-end" into [1,2,3,5,8,...]. Pages are 1-based and the
 * result keeps the order the person typed, so "3,1" really means 3 then 1.
 */
export function parseRanges(input: string | undefined, total: number): number[] {
  const text = (input ?? '').trim().toLowerCase();
  if (!text || text === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [];
  for (const raw of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = raw.match(/^(\d+|end|last|z)?(?:\s*-\s*(\d+|end|last|z)?)?$/);
    if (!m || (m[1] === undefined && m[2] === undefined)) {
      throw new UserError(`"${raw}" isn't a page range. Use something like 1-3, 5, 8-end.`);
    }
    const num = (v: string | undefined, fallback: number) =>
      v === undefined ? fallback : /^\d+$/.test(v) ? parseInt(v, 10) : total;
    const isRange = raw.includes('-');
    const a = num(m[1], 1);
    const b = isRange ? num(m[2], total) : a;
    if (a < 1 || b < 1 || a > total || b > total) {
      throw new UserError(`Page range "${raw}" is outside this document, which has ${total} page${total === 1 ? '' : 's'}.`);
    }
    if (a <= b) for (let p = a; p <= b; p++) pages.push(p);
    else for (let p = a; p >= b; p--) pages.push(p);
  }
  return pages;
}

/** Collapses [1,2,3,5] into "1-3,5" for qpdf. */
export function toRangeString(pages: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j + 1;
  }
  return parts.join(',');
}

export function stem(name: string): string {
  const base = path.basename(name);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

export function ext(name: string): string {
  return path.extname(name).toLowerCase().replace('.', '');
}

export function safeName(name: string): string {
  const cleaned = path
    .basename(name)
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .trim();
  return cleaned || 'file';
}

export function needFiles(job: Job, min = 1, what = 'file'): void {
  if (job.files.length < min) {
    throw new UserError(min === 1 ? `Add a ${what} first.` : `Add at least ${min} ${what}s.`);
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  const names = await fs.readdir(dir);
  return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((n) => path.join(dir, n));
}

export const PY_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../py');

export function python(script: string, args: string[]): Promise<RunResult> {
  return run(process.env.PYTHON_BIN || 'python3', [path.join(PY_DIR, script), ...args]);
}
