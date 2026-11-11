import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Job, Output, Tool, UserError, ext, needFiles } from '../lib.js';

/**
 * Tools that take PDFs in and give PDFs back, so they can be chained. Each step's results
 * become the next step's input files. Merge can only come first, Protect only last.
 */
export const CHAINABLE = [
  'merge',
  'rotate',
  'compress',
  'repair',
  'ocr',
  'page-numbers',
  'watermark',
  'pdf-to-pdfa',
  'unlock',
  'protect',
] as const;

const MAX_STEPS = 8;

export function workflow(registry: Record<string, Tool>): Tool {
  return async (job: Job) => {
    needFiles(job, 1, 'PDF');
    const steps: { tool: string; options?: Record<string, unknown> }[] = Array.isArray(job.opts.steps) ? job.opts.steps : [];
    if (!steps.length) throw new UserError('Add at least one step to the workflow.');
    if (steps.length > MAX_STEPS) throw new UserError(`A workflow can have up to ${MAX_STEPS} steps.`);
    steps.forEach((s, i) => {
      if (!CHAINABLE.includes(s?.tool as any) || !registry[s.tool]) throw new UserError(`Step ${i + 1} is not a tool that can be part of a workflow.`);
      if (s.tool === 'merge' && i > 0) throw new UserError('Merge has to be the first step.');
      if (s.tool === 'protect' && i < steps.length - 1) throw new UserError('Protect has to be the last step, since later steps could not open the file.');
      if (s.tool === 'watermark' && (s.options as any)?.kind === 'image') throw new UserError('Image watermarks can’t be used in a workflow yet. Use a text watermark.');
    });
    for (const f of job.files) if (ext(f.name) !== 'pdf') throw new UserError(`${f.name} isn’t a PDF.`);

    let files = job.files.map((f) => ({ path: f.path, name: f.name, field: f.field }));
    let outputs: Output[] = [];
    for (const [i, step] of steps.entries()) {
      const dir = path.join(job.dir, `step-${i + 1}`);
      await fs.mkdir(path.join(dir, 'out'), { recursive: true });
      const sub: Job = {
        dir,
        files,
        opts: { ...(step.options ?? {}) },
        out: (name) => path.join(dir, 'out', name.replace(/[\\/]/g, '_')),
      };
      if (step.tool === 'merge' && files.length < 2) {
        outputs = files.map((f) => ({ path: f.path, name: f.name }));
      } else {
        outputs = await registry[step.tool](sub);
      }
      if (!outputs.length) throw new UserError(`Step ${i + 1} gave nothing back.`);
      files = outputs.map((o) => ({ path: o.path, name: o.name, field: 'files' }));
    }
    return outputs;
  };
}
