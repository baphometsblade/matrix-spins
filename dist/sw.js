// Matrix Spins Casino — Service Worker
// PWA: cache-first statics, network-first HTML, network-only API,
// offline fallback, version-update messaging.

const VERSION = 'b1782621956946';
const STATIC_CACHE  = `matrix-spins-static-${VERSION}`;
const RUNTIME_CACHE = `matrix-spins-runtime-${VERSION}`;
const HTML_CACHE    = `matrix-spins-html-${VERSION}`;
const ALL_CACHES    = [STATIC_CACHE, RUNTIME_CACHE, HTML_CACHE];

const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/404.html',
  '/manifest.json',
  '/assets/icon-192.svg',
  '/assets/icon-512.svg',
];

// Best-effort precache — must not block install if any 404
const PRECACHE_OPTIONAL = [
  '/css/landing-redesign.css',
  '/css/performance-mobile.css',
  '/css/jackpot.css',
  '/css/notifications.css',
  '/css/skeleton.css',
  '/js/api-client.js',
  '/js/notifications.js',
  '/js/pwa-install.js',
  '/terms.html',
  '/responsible-gambling.html',
  '/privacy.html',
];

// Content-hashed bundles — precached for instant first paint on returning
// visits. These change per build; the bundle script auto-updates the hashes
// in dist/sw.js during each build (see scripts/bundle-js.js).
const PRECACHE_HASHED_BUNDLES = [
  '/styles.4f270501.min.css',
  '/bundle.ea751d95.min.js',
];

// ─── Install: precache app shell ───────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(APP_SHELL);
    // Optional assets — fetched individually so one 404 doesn't fail install
    await Promise.allSettled(
      PRECACHE_OPTIONAL.map(url => cache.add(url).catch(() => null))
    );
    // Hashed bundles — critical for first paint but must not block install
    // (hash may not match if SW is cached but bundles were rebuilt)
    await Promise.allSettled(
      PRECACHE_HASHED_BUNDLES.map(url => cache.add(url).catch(() => null))
    );
    // Don't auto-skipWaiting — wait for client postMessage so the user
    // sees the "update available" banner before reload.
  })());
});

// ─── Activate: purge old caches, claim clients ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();
    // Inform pages a new SW is active so they can show "Update applied"
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: VERSION }));
  })());
});

// ─── Message: client requests immediate skipWaiting ────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: VERSION });
  }
});

// ─── Fetch routing ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only intercept GET — never POST/PUT/DELETE
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip non-http(s) requests (chrome-extension, data:, etc.)
  if (!url.protocol.startsWith('http')) return;

  // API: network only, never cache (sensitive data, auth, balance)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnlyAPI(request));
    return;
  }

  // Google Fonts — cache-first (rarely change, small)
  if (url.hostname.endsWith('fonts.googleapis.com') ||
      url.hostname.endsWith('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Unhashed app code (js/css/mjs WITHOUT a content hash) — stale-while-revalidate
  // so code fixes (e.g. js/casino-engine.js) reach returning users on their next
  // load instead of being pinned cache-first until the SW VERSION is bumped.
  // Content-hashed bundles (bundle.<hash>.min.js / styles.<hash>.min.css) are
  // immutable and intentionally fall through to cache-first below.
  if (/\.(js|mjs|css)(\?.*)?$/i.test(url.pathname) &&
      !/\.[a-f0-9]{8,}\.(min\.)?(js|css)(\?.*)?$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Static asset — cache-first (media, fonts, hashed bundles)
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // HTML navigation — network-first with offline fallback
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Everything else — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ─── Strategies ────────────────────────────────────────────────

async function networkOnlyAPI(request) {
  try {
    return await fetch(request);
  } catch (_) {
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Network unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirstHTML(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Pre-cached offline page — Matrix-themed fallback
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    const fourOhFour = await caches.match('/404.html');
    if (fourOhFour) return fourOhFour;
    return new Response('<h1>Offline</h1><p>You appear to be offline.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ─── Helpers ───────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return /\.(css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|eot|otf|mp3|wav|ogg)(\?.*)?$/i.test(pathname);
}
