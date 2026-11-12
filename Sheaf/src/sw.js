// Service worker for Sheaf. The build fills in VERSION and PRECACHE (see vite.config.js),
// so every file of a release is stored on first visit and the app works offline after.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `sheaf-${VERSION}`;
const FONTS = 'sheaf-fonts';
const scope = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(scope(p), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sheaf-') && key !== CACHE && key !== FONTS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks for this when someone taps "Reload" on the update notice.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The DeepL relay's status answer changes with the server's settings, so never store it.
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' && url.pathname.includes('/wordcraft/')) {
      // The Word editor's page, opened in a frame with ?host=parent. Keep the last copy for offline use.
      event.respondWith(fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.origin + url.pathname, copy)); }
        return res;
      }).catch(async () => (await caches.match(url.origin + url.pathname)) || Response.error()));
      return;
    }
    if (req.mode === 'navigate') {
      // Pages: try the network so a new release shows up, fall back to the stored copy.
      event.respondWith(fetch(req).catch(async () => (await caches.match(scope('./'))) || Response.error()));
      return;
    }
    // Built files have a content hash in their name, so a stored copy is always right.
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })());
    return;
  }

  // Web fonts: answer from the cache, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh;
    })());
  }
});
