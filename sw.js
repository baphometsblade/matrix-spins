// Matrix Spins Casino — Service Worker
// Production PWA: cache-first statics, network-first HTML, network-only API

const CACHE_NAME = 'matrix-spins-v4';

const PRECACHE_ASSETS = [
  '/index.html',
  '/404.html',
  // Core CSS
  '/css/landing-redesign.css',
  '/css/performance-mobile.css',
  '/css/jackpot.css',
  '/css/chat-widget.css',
  '/css/notifications.css',
  // Compliance & UX CSS
  '/css/cookie-consent.css',
  '/css/age-gate.css',
  '/css/skeleton.css',
  '/css/search.css',
  '/css/favorites.css',
  '/css/session-monitor.css',
  '/css/conversion.css',
  // Page CSS
  '/css/auth.css',
  '/css/wallet.css',
  '/css/vip.css',
  '/css/promotions.css',
  '/css/leaderboard.css',
  '/css/referral.css',
  '/css/achievements.css',
  '/css/spin-wheel.css',
  '/css/account.css',
  '/css/email-capture.css',
  // Core JS
  '/js/api-client.js',
  '/js/jackpot.js',
  '/js/chat-widget.js',
  '/js/notifications.js',
  '/js/cookie-consent.js',
  '/js/age-gate.js',
  '/js/search.js',
  '/js/favorites.js',
  '/js/session-monitor.js',
  '/js/sound-manager.js',
  '/js/analytics.js',
  '/js/email-capture.js',
  '/js/conversion.js',
  '/js/activity-feed.js',
  '/js/casino-engine.js',
  '/js/game-registry.js',
  '/js/studio-themes.js',
  '/js/retention.js',
  '/js/countries.js',
  '/css/activity-feed.css',
  '/terms.html',
  '/responsible-gambling.html',
  '/provably-fair.html',
  '/privacy.html',
  '/faq.html',
];

// ── Install: pre-cache critical assets and take control immediately ──
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

// ── Activate: purge old caches and claim all clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => clients.claim())
  );
});

// ── Fetch: route requests by type ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests — network only, never cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Google Fonts — cache-first (fonts rarely change)
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // CSS, JS, images — cache-first with network fallback
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML navigation requests — network-first with cache fallback
  if (request.mode === 'navigate' ||
      request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Everything else — network-first
  event.respondWith(networkFirst(request));
});

// ── Strategies ──

// Cache-first: serve from cache, fall back to network and store the response
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

// Network-first for HTML: try network, cache fallback, ultimate fallback 404
async function networkFirstHTML(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline with no cache — serve pre-cached 404 page
    return caches.match('/404.html');
  }
}

// Network-first for miscellaneous requests
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match(request);
  }
}

// ── Helpers ──

function isStaticAsset(pathname) {
  return /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)(\?.*)?$/i.test(pathname);
}
