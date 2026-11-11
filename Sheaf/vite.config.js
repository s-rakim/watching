import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

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
      // OCR engines and language data are tens of MB. They are stored the first time OCR
      // runs instead, so installing the app doesn't download them all up front.
      const pub = existsSync('public') ? publicFiles('public').filter((f) => !f.startsWith('ocr/')) : [];
      const files = ['./', ...built, ...pub].sort();
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

// Translate can use DeepL. DeepL's API won't answer requests made from a web page, and the
// key must not reach the browser, so the dev and preview servers relay the calls here and
// add the key from DEEPL_AUTH_KEY (environment or a .env file next to this one).
function deeplRelay(key) {
  const api = key?.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const target = (code) => ({ EN: 'EN-US', PT: 'PT-PT', ZH: 'ZH-HANS' }[code.toUpperCase()] || code.toUpperCase());
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  const handler = async (req, res, next) => {
    if (req.url === '/api/deepl/status') return send(res, 200, { enabled: !!key?.trim() });
    if (req.url !== '/api/deepl/translate' || req.method !== 'POST') return next();
    if (!key?.trim()) return send(res, 501, { error: 'DeepL is not set up. Put DEEPL_AUTH_KEY in Sheaf/.env and restart.' });
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const { text, from, to } = JSON.parse(raw);
      if (!Array.isArray(text) || text.length > 50 || !to) return send(res, 400, { error: 'Bad request' });
      const r = await fetch(`${api}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target_lang: target(to), ...(from && from !== 'auto' ? { source_lang: from.toUpperCase().split('-')[0] } : {}) }),
      });
      if (r.status === 403) return send(res, 502, { error: 'DeepL turned down the API key. Check DEEPL_AUTH_KEY.' });
      if (r.status === 456) return send(res, 502, { error: 'Your DeepL quota for this month is used up.' });
      if (!r.ok) return send(res, 502, { error: `DeepL returned an error (${r.status}).` });
      const data = await r.json();
      send(res, 200, { text: data.translations.map((t) => t.text), detected: data.translations[0]?.detected_source_language });
    } catch (e) {
      send(res, 502, { error: `Could not reach DeepL: ${e.message}` });
    }
  };
  return {
    name: 'deepl-relay',
    configureServer: (server) => { server.middlewares.use(handler); },
    configurePreviewServer: (server) => { server.middlewares.use(handler); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [serviceWorker(), deeplRelay(env.DEEPL_AUTH_KEY)],
    // Vite turns away requests for host names it doesn't recognise. Tailscale
    // MagicDNS names end in .ts.net, so let those through when the site is
    // opened by name from another device on the tailnet.
    server: { allowedHosts: ['.ts.net'] },
    preview: { allowedHosts: ['.ts.net'] },
    // The default target already covers Safari 16 and Chrome 111. pdf.js's legacy build
    // (see src/lib/pdf.js) fills in what older iOS and Firefox ESR releases lack.
    build: { chunkSizeWarningLimit: 1600 },
  };
});
