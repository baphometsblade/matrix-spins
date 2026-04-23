'use strict';

/**
 * Matrix Spins — minimal service worker.
 *
 * The lobby registers /sw.js so it can come online as a PWA later.
 * We intentionally do NOT cache the bundle or HTML yet: caching before
 * we have a versioned deploy pipeline means stale code sticks around
 * forever on users' devices. This worker exists so registration
 * succeeds (no 404, no console error) and so we can push a real
 * caching strategy later without users having to manually unregister.
 *
 * When we're ready to cache, replace the fetch handler with a
 * cache-first strategy keyed off the hashed bundle filename.
 */

self.addEventListener('install', (event) => {
    // Take over immediately on first install so the next navigation is controlled.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Drop any caches a previous version of this worker may have created.
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

// No fetch handler: every request passes through to the network exactly
// as if the worker weren't there. This is the safe default.
