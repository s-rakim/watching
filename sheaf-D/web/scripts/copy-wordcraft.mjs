// The Word editor (WordCraft) is built once, in Sheaf/public/wordcraft. Running Sheaf-D from
// a checkout copies it from there. The Docker image builds its own copy from source instead
// (see the wordcraft stage in the Dockerfile), so this does nothing when the files are there.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(web, 'public', 'wordcraft');
const src = join(web, '..', '..', 'Sheaf', 'public', 'wordcraft');
const rev = (dir) => (existsSync(join(dir, 'REVISION')) ? readFileSync(join(dir, 'REVISION'), 'utf8').trim() : '');

if (existsSync(join(src, 'index.html')) && rev(src) !== rev(dest)) {
  cpSync(src, dest, { recursive: true });
  console.log(`Copied the Word editor (WordCraft ${rev(src).slice(0, 8)}) into web/public/wordcraft`);
} else if (!existsSync(join(dest, 'index.html'))) {
  console.warn('No Word editor build found. Edit Word will say it is not installed. See Sheaf/scripts/build-wordcraft.sh.');
}
