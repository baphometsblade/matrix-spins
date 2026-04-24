'use strict';

/**
 * Shared per-user mutex for spin-type actions (regular spin, buy-feature).
 *
 * Prevents double-spend and session-cap overshoot from concurrent requests
 * by the same user. A single map is shared between spin.routes.js and
 * buyfeature.routes.js so that a user cannot race a /api/spin against a
 * /api/buy-feature on the same account.
 *
 * The lock is in-memory and therefore PER-INSTANCE. Under multi-instance
 * load balancing, two requests hitting different instances can still race —
 * but every DB write the routes perform after this check uses atomic SQL
 * (balance guard, session-cap CASE clamp, etc.), so the worst case is a
 * small number of overshoot spins rather than unbounded leaks.
 */

// userId -> { timestamp, kind }
const activeRequests = new Map();

// Any spin older than this is considered stale and can be evicted
const MAX_SPIN_DURATION_MS = 30_000;
const CLEANUP_INTERVAL_MS = 60_000;

// Periodically drop orphaned locks (e.g. from a crashed request handler)
const _cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - MAX_SPIN_DURATION_MS;
    for (const [uid, data] of activeRequests) {
        if (data.timestamp < cutoff) activeRequests.delete(uid);
    }
}, CLEANUP_INTERVAL_MS);
if (typeof _cleanupTimer.unref === 'function') _cleanupTimer.unref();

function isLocked(userId) {
    return activeRequests.has(userId);
}

/**
 * Returns true if the lock was acquired, false if another request already
 * holds it for this userId.
 */
function tryAcquire(userId, kind = 'spin') {
    if (activeRequests.has(userId)) return false;
    activeRequests.set(userId, { timestamp: Date.now(), kind });
    return true;
}

function release(userId) {
    activeRequests.delete(userId);
}

function activeKind(userId) {
    const v = activeRequests.get(userId);
    return v ? v.kind : null;
}

function _size() {
    return activeRequests.size;
}

function _clearAll() {
    activeRequests.clear();
}

module.exports = {
    tryAcquire,
    release,
    isLocked,
    activeKind,
    MAX_SPIN_DURATION_MS,
    _size,
    _clearAll,
};
