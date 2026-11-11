import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Writes dist/sw.js with the full list of files in this build, so the service worker can
 * store all of them on install and the app opens offline. The version string changes
 * whenever any built file changes, which is what tells browsers an update is waiting.
 */
function serviceWorker() {
  const publicFiles = (dir, root = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? publicFiles(join(dir, d.name), root) : [relative(root, join(dir, d.name)).split('\\').join('/')]);
  return {
    name: 'sheaf-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html');
      const files = ['./', ...built, ...publicFiles('public')].sort();
      const hash = createHash('sha256');
      for (const f of built) {
        const item = bundle[f];
        hash.update(f).update(item.type === 'chunk' ? item.code : item.source);
      }
      const html = bundle['index.html'];
      if (html) hash.update(html.source);
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  // Vite turns away requests for host names it doesn't recognise. Tailscale
  // MagicDNS names end in .ts.net, so let those through when the site is
  // opened by name from another device on the tailnet.
  server: { allowedHosts: ['.ts.net'] },
  preview: { allowedHosts: ['.ts.net'] },
  // The default target already covers Safari 16 and Chrome 111. pdf.js's legacy build
  // (see src/lib/pdf.js) fills in what older iOS and Firefox ESR releases lack.
  build: { chunkSizeWarningLimit: 1600 },
});
