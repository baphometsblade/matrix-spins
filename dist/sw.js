const CACHE_VERSION = 13;
const CACHE_NAME = 'matrix-spins-v' + CACHE_VERSION;
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/provably-fair.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => console.warn('[SW] Precache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.allSettled(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls or non-GET requests
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;

  // Cache-first for immutable hashed assets (bundle.XXXX.js, styles.XXXX.css)
  if (/bundle\.[a-f0-9]+\.js|styles\.[a-f0-9]+\.css/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{background:#0a0e17;color:#e2e8f0;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;text-align:center}.c{max-width:400px;padding:2rem}h1{font-size:1.5rem;color:#f59e0b}p{color:#94a3b8;line-height:1.6}button{background:#f59e0b;color:#0a0e17;border:none;padding:.75rem 2rem;border-radius:8px;font-weight:600;cursor:pointer;margin-top:1rem}</style></head><body><div class="c"><h1>You\'re Offline</h1><p>Check your internet connection and try again.</p><button onclick="location.reload()">Retry</button></div></body></html>', { status: 503, headers: { 'Content-Type': 'text/html' } }));
        })
      )
    );
    return;
  }

  // Cache-first for static assets (images, fonts) — bounded by /assets/ path
  if (url.pathname.startsWith('/assets/') || /\.(png|jpg|jpeg|gif|svg|webp|avif|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached || new Response('', { status: 404 }));
        })
      )
    );
    return;
  }

  // Network-first for HTML/JS with offline fallback to cached index
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        // Update cache with fresh response (only GET, only same-origin)
        if (resp.ok && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
  );
});

// Listen for messages to trigger update
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
