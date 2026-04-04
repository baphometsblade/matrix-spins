/**
 * Simple in-memory TTL cache for frequently-requested API data.
 * Reduces DB load for endpoints like /api/bundles, /api/games, leaderboards.
 */

var store = new Map();

function get(key) {
    var entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

function set(key, value, ttlSeconds) {
    ttlSeconds = ttlSeconds || 300; // default 5 minutes
    store.set(key, {
        value: value,
        expiresAt: Date.now() + (ttlSeconds * 1000)
    });
}

function clear(pattern) {
    if (!pattern) {
        store.clear();
        return;
    }
    for (var key of store.keys()) {
        if (key.indexOf(pattern) !== -1) store.delete(key);
    }
}

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(function () {
    var now = Date.now();
    for (var entry of store) {
        if (entry[1].expiresAt < now) store.delete(entry[0]);
    }
}, 300000);

module.exports = { get: get, set: set, clear: clear };
