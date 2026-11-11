import { Job, Output, Tool, UserError, needFiles, python, stem } from '../lib.js';

/** Runs text_tools.py and turns its "USER:" lines into messages the person sees. */
async function textTool(args: string[]) {
  try {
    await python('text_tools.py', args);
  } catch (err: any) {
    const said = String(err?.stderr ?? '').match(/^USER: (.+)$/m);
    if (said) throw new UserError(said[1]);
    throw err;
  }
}

export const summarize: Tool = async (job: Job) => {
  needFiles(job, 1, 'PDF');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-summary.md`;
    const out = job.out(`${outs.length}-${name}`);
    await textTool(['summarize', file.path, out, String(job.opts.length ?? 'medium')]);
    outs.push({ path: out, name });
  }
  return outs;
};

// DeepL language codes: two letters, plus regional targets like en-gb or pt-br.
const CODE = /^[a-z]{2}(-[a-z0-9]{2,4})?$/i;

/** Which engine a request uses. "auto" prefers DeepL when a key is set, else falls back to offline Argos. */
export function pickEngine(requested: unknown, hasKey: boolean): 'deepl' | 'argos' {
  if (requested === 'deepl' || requested === 'argos') return requested;
  return hasKey ? 'deepl' : 'argos';
}

export const translate: Tool = async (job: Job) => {
  needFiles(job, 1, 'PDF');
  const from = String(job.opts.from ?? 'auto');
  const to = String(job.opts.to ?? 'en');
  const hasKey = !!process.env.DEEPL_AUTH_KEY?.trim();
  const engine = pickEngine(job.opts.engine, hasKey);
  if (engine === 'deepl' && !hasKey) {
    throw Object.assign(new UserError('DeepL needs an API key. Set DEEPL_AUTH_KEY for Sheaf-D (the README shows how), or pick the offline translator.'), { status: 501 });
  }
  let format = ['md', 'docx'].includes(job.opts.format) ? String(job.opts.format) : 'pdf';
  // only DeepL can rebuild a PDF; the offline engine hands back text
  if (engine === 'argos' && format === 'pdf') format = 'docx';
  if ((from !== 'auto' && !CODE.test(from)) || !CODE.test(to)) throw new UserError('Pick the languages to translate between.');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-${to}.${format}`;
    const out = job.out(`${outs.length}-${name}`);
    await textTool(['translate', file.path, out, from, to, format, engine]);
    outs.push({ path: out, name });
  }
  return outs;
};
