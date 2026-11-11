// Copies Tesseract's worker, WebAssembly core and language data into public/ocr so OCR
// works without reaching any CDN. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const dest = join(root, 'public', 'ocr');

mkdirSync(join(dest, 'core'), { recursive: true });
mkdirSync(join(dest, 'lang'), { recursive: true });
cpSync(join(pkg('tesseract.js'), 'dist', 'worker.min.js'), join(dest, 'worker.min.js'));
// Only the LSTM builds are needed (Tesseract.js picks one at runtime by CPU features).
const core = pkg('tesseract.js-core');
for (const f of readdirSync(core)) if (/lstm\.wasm(\.js)?$|lstm\.js$/.test(f)) cpSync(join(core, f), join(dest, 'core', f));
for (const lang of ['eng', 'spa', 'fra', 'deu', 'ita', 'por']) {
  const src = join(pkg(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`);
  if (existsSync(src)) cpSync(src, join(dest, 'lang', `${lang}.traineddata.gz`));
}
console.log('OCR files copied to public/ocr');
