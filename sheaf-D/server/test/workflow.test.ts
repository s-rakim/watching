import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Job, Tool } from '../src/lib.js';
import { workflow } from '../src/tools/workflow.js';

// Stand-in tools that append their name to each file, so the chain order shows in the result.
const tag =
  (label: string): Tool =>
  async (job) =>
    Promise.all(
      job.files.map(async (f, i) => {
        const out = job.out(`${i}-${label}.pdf`);
        await fs.writeFile(out, `${await fs.readFile(f.path, 'utf8')}>${label}${JSON.stringify(job.opts)}`);
        return { path: out, name: f.name.replace(/\.pdf$/, `-${label}.pdf`) };
      }),
    );

const registry: Record<string, Tool> = {
  compress: tag('compress'),
  'page-numbers': tag('numbers'),
  protect: tag('protect'),
  merge: async (job) => {
    const out = job.out('merged.pdf');
    const parts = await Promise.all(job.files.map((f) => fs.readFile(f.path, 'utf8')));
    await fs.writeFile(out, parts.join('+'));
    return [{ path: out, name: 'merged.pdf' }];
  },
};

async function job(steps: unknown, n = 1): Promise<Job> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-'));
  await fs.mkdir(path.join(dir, 'out'));
  const files = [];
  for (let i = 0; i < n; i++) {
    const p = path.join(dir, `in${i}.pdf`);
    await fs.writeFile(p, `f${i}`);
    files.push({ path: p, name: `doc${i}.pdf`, field: 'files' });
  }
  return { dir, files, opts: { steps }, out: (name) => path.join(dir, 'out', name) };
}

test('runs the steps in order, feeding each one the last one’s output', async () => {
  const run = workflow(registry);
  const out = await run(await job([{ tool: 'merge' }, { tool: 'compress', options: { level: 'extreme' } }, { tool: 'page-numbers' }], 2));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'merged-compress-numbers.pdf');
  assert.equal(await fs.readFile(out[0].path, 'utf8'), 'f0+f1>compress{"level":"extreme"}>numbers{}');
});

test('keeps one result per file when there is no merge', async () => {
  const out = await workflow(registry)(await job([{ tool: 'compress' }], 3));
  assert.deepEqual(out.map((o) => o.name), ['doc0-compress.pdf', 'doc1-compress.pdf', 'doc2-compress.pdf']);
});

test('refuses steps in an order that cannot work', async () => {
  const run = workflow(registry);
  await assert.rejects(run(await job([{ tool: 'compress' }, { tool: 'merge' }])), /Merge has to be the first step/);
  await assert.rejects(run(await job([{ tool: 'protect' }, { tool: 'compress' }])), /Protect has to be the last step/);
  await assert.rejects(run(await job([{ tool: 'html-to-pdf' }])), /not a tool that can be part of a workflow/);
  await assert.rejects(run(await job([])), /at least one step/);
});
