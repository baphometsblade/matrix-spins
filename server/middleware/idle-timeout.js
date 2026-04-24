'use strict';

/**
 * Idle-session timeout middleware.
 *
 * The authenticate middleware accepts any valid, non-blacklisted JWT
 * until it expires (7 days by default). An attacker who silently
 * exfiltrates a token can use it for the full lifetime.
 *
 * This middleware adds a second clock: if the user has been inactive
 * for longer than IDLE_TIMEOUT_MINUTES (default 30, configurable via
 * env SESSION_IDLE_TIMEOUT_MINUTES), the server rejects the request
 * with 401 and the user must re-authenticate. Every authenticated
 * request bumps the last-activity timestamp, so active users are
 * never interrupted.
 *
 * State lives in memory per-instance — acceptable for single-instance
 * Render deploys. Multi-instance would want Redis. Stale entries are
 * swept every 10 minutes to prevent unbounded growth.
 *
 * This middleware must run AFTER authenticate so req.user is populated.
 */

const IDLE_TIMEOUT_MINUTES = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES, 10) || 30;
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// userId -> { lastSeen: epoch_ms }
const lastActivity = new Map();

// Periodic cleanup — forget users who have been idle > 2x timeout
const _cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - (IDLE_TIMEOUT_MS * 2);
    let cleaned = 0;
    for (const [uid, entry] of lastActivity) {
        if (entry.lastSeen < cutoff) {
            lastActivity.delete(uid);
            cleaned++;
        }
    }
    if (cleaned > 0) console.warn('[IdleTimeout] Swept ' + cleaned + ' stale entries');
}, CLEANUP_INTERVAL_MS);
if (typeof _cleanupTimer.unref === 'function') _cleanupTimer.unref();

/**
 * Express middleware that rejects idle sessions and bumps last-activity
 * on every valid request.
 *
 * Must run after authenticate.
 */
function idleTimeoutMiddleware(req, res, next) {
    if (!req.user || !req.user.id) {
        // Not authenticated — let downstream handle it
        return next();
    }

    const userId = req.user.id;
    const now = Date.now();
    const entry = lastActivity.get(userId);

    // Bootstrap: first request since server start for this user →
    // record activity and proceed (don't punish cold starts).
    if (!entry) {
        lastActivity.set(userId, { lastSeen: now });
        return next();
    }

    const idleMs = now - entry.lastSeen;
    if (idleMs > IDLE_TIMEOUT_MS) {
        // Too idle — force re-auth. Clear the entry so the next /login
        // starts with a fresh timer.
        lastActivity.delete(userId);
        return res.status(401).json({
            error: 'Session timed out due to inactivity. Please sign in again.',
            code: 'session_idle',
            idleMinutes: Math.round(idleMs / 60000),
            timeoutMinutes: IDLE_TIMEOUT_MINUTES,
        });
    }

    // Active — bump timestamp
    entry.lastSeen = now;
    next();
}

function _reset(userId) {
    if (userId != null) lastActivity.delete(userId);
    else lastActivity.clear();
}

function _getLastSeen(userId) {
    const entry = lastActivity.get(userId);
    return entry ? entry.lastSeen : null;
}

module.exports = {
    idleTimeoutMiddleware,
    IDLE_TIMEOUT_MINUTES,
    IDLE_TIMEOUT_MS,
    _reset,
    _getLastSeen,
};
