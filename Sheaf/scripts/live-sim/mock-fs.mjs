import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const Directory = { Data: 'DATA' };
const p = (path) => join(globalThis.SIM.dataDir, path);
export const Filesystem = {
  getUri: async ({ path }) => ({ uri: 'file://' + p(path) }),
  stat: async ({ path }) => { await fs.stat(p(path)); return {}; },
  rmdir: async ({ path }) => { await fs.stat(p(path)); await fs.rm(p(path), { recursive: true }); },
  mkdir: async ({ path }) => { await fs.mkdir(p(path), { recursive: true }); },
  writeFile: async ({ path, data, recursive }) => { if (recursive) await fs.mkdir(dirname(p(path)), { recursive: true }); await fs.writeFile(p(path), Buffer.from(data, 'base64')); globalThis.SIM.writes++; },
  copy: async ({ from, to }) => { await fs.stat(dirname(p(to))); await fs.copyFile(p(from), p(to)); globalThis.SIM.copies++; },
  rename: async ({ from, to }) => { await fs.rename(p(from), p(to)); },
  readdir: async ({ path }) => ({ files: (await fs.readdir(p(path))).map((name) => ({ name })) }),
};
