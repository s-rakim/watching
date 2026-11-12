// Points the @capacitor/* imports at the stand-ins next to this file, and lets the feed
// address come from FEED instead of import.meta.env (which only exists under Vite).
export async function resolve(spec, ctx, next) {
  const m = { '@capacitor/app': 'app', '@capacitor/core': 'core', '@capacitor/filesystem': 'fs' }[spec];
  if (m) return { url: new URL(`./mock-${m}.mjs`, import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  const r = await next(url, ctx);
  if (url.includes('liveupdate.js')) {
    const src = String(r.source).replace('import.meta.env.VITE_SHEAF_LIVE_URL', 'process.env.FEED');
    return { ...r, source: src, shortCircuit: true };
  }
  return r;
}
