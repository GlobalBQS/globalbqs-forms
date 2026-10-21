/* GlobalBQS Forms service worker.
 * - versioned cache: the build writes VERSION and the asset list into this file, so every release changes
 *   the bytes of sw.js and the browser installs the new version (works even if the host cannot set headers);
 * - cache-first app shell (works on board without signal);
 * - the new version waits until the user taps "Reload" (message skipWaiting);
 * - API calls (supabase.co) and uploads are never cached or intercepted.
 */
const VERSION = '1.0.1-20261021-d6ed713c-demo';
const ASSETS = ["./","app.css","assets/fonts/ibm-plex-mono-latin-400-normal.woff2","assets/fonts/ibm-plex-mono-latin-500-normal.woff2","assets/fonts/ibm-plex-mono-latin-600-normal.woff2","assets/fonts/ibm-plex-sans-latin-400-normal.woff2","assets/fonts/ibm-plex-sans-latin-500-normal.woff2","assets/fonts/ibm-plex-sans-latin-600-normal.woff2","assets/fonts/ibm-plex-sans-latin-700-normal.woff2","assets/icons/apple-touch-icon.png","assets/icons/favicon-32.png","assets/icons/globalbqs-icon-dark.svg","assets/icons/icon-192.png","assets/icons/icon-512.png","assets/icons/icon.svg","assets/icons/maskable-192.png","assets/icons/maskable-512.png","config.js","index.html","js/api.js","js/app.js","js/db.js","js/forms/bunker_delivery.js","js/forms/calc.js","js/forms/components.js","js/forms/engine.js","js/forms/registry.js","js/photos.js","js/sync.js","js/ui.js","manifest.webmanifest"];
const CACHE = 'gbqs-forms-' + VERSION;
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // fetch fresh copies (bypass the HTTP cache) so a release never mixes old and new files
    await Promise.all(ASSETS.map(async (a) => {
      const res = await fetch(new Request(a, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + a);
      await cache.put(a === './' ? new URL('./', SCOPE).href : a, res);
    }));
    // first install: no older version to replace -> activate immediately
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gbqs-forms-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
  if (event.data && event.data.type === 'version' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return; // API, storage, other sites
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    // job link /j/<token> -> app with hash route
    const rel = url.pathname.slice(SCOPE.pathname.length);
    const m = /^j\/([0-9a-fA-F]{64})\/?$/.exec(rel);
    if (m) { event.respondWith(Response.redirect(SCOPE.href + '#/j/' + m[1].toLowerCase(), 302)); return; }
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const shell = (await cache.match(new URL('./', SCOPE).href)) || (await cache.match('index.html'));
      if (shell && (rel === '' || rel === 'index.html' || !/\.[a-z0-9]+$/i.test(rel))) return shell;
      try { return await fetch(req); } catch { return shell || Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
