import { defineConfig, loadEnv } from 'vite';

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
    plugins: [deeplRelay(env.DEEPL_AUTH_KEY)],
    // Vite turns away requests for host names it doesn't recognise. Tailscale
    // MagicDNS names end in .ts.net, so let those through when the site is
    // opened by name from another device on the tailnet.
    server: { allowedHosts: ['.ts.net'] },
    preview: { allowedHosts: ['.ts.net'] },
  };
});
