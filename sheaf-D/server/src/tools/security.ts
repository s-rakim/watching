import { Output, Tool, UserError, needFiles, qpdf, run, stem } from '../lib.js';

export const protect: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const password = String(job.opts.password ?? '');
  if (!password) throw new UserError('Type a password first.');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-protected.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    const perms: string[] = [];
    if (job.opts.noPrint) perms.push('--print=none');
    if (job.opts.noCopy) perms.push('--extract=n');
    if (job.opts.noEdit) perms.push('--modify=none');
    const owner = String(job.opts.ownerPassword || password);
    await qpdf([file.path, '--encrypt', password, owner, '256', ...perms, '--', out]);
    outs.push({ path: out, name });
  }
  return outs;
};

export const unlock: Tool = async (job) => {
  needFiles(job, 1, 'PDF');
  const password = String(job.opts.password ?? '');
  const outs: Output[] = [];
  for (const file of job.files) {
    const name = `${stem(file.name)}-unlocked.pdf`;
    const out = job.out(`${outs.length}-${name}`);
    try {
      await run('qpdf', [`--password=${password}`, '--decrypt', file.path, out], { okCodes: [0, 3] });
    } catch (err: any) {
      if (/invalid password/i.test(String(err?.stderr ?? err?.message))) {
        throw new UserError(
          password ? `That password doesn't open ${file.name}.` : `${file.name} needs its password to be unlocked.`,
        );
      }
      throw err;
    }
    outs.push({ path: out, name });
  }
  return outs;
};
