'use strict';
const db = require('../database');

/**
 * In-memory session timer for responsible gambling compliance.
 * Tracks when each user's play session started and enforces
 * the session_time_limit from user_limits.
 */

// Map<userId, { startedAt: number (epoch ms) }>
const activeSessions = new Map();

// Cleanup stale sessions every 15 minutes (sessions idle > 6 hours)
var SESSION_STALE_MS = 6 * 60 * 60 * 1000;
setInterval(function pruneActiveSessions() {
    var now = Date.now();
    var pruned = 0;
    for (var [uid, sess] of activeSessions) {
        if (now - sess.startedAt > SESSION_STALE_MS) {
            activeSessions.delete(uid);
            pruned++;
        }
    }
    if (pruned > 0) console.warn('[SessionTimer] Pruned ' + pruned + ' stale sessions');
}, 15 * 60 * 1000);

/**
 * Start a new session timer for the given user.
 * If a session is already running, this is a no-op (returns existing).
 */
function startSession(userId) {
    if (activeSessions.has(userId)) {
        return activeSessions.get(userId);
    }
    const session = { startedAt: Date.now() };
    activeSessions.set(userId, session);
    return session;
}

/**
 * Check whether the user is allowed to continue playing.
 * Reads session_time_limit from user_limits table.
 * Auto-starts a session if none exists (first spin starts the timer).
 *
 * @returns {{ allowed: boolean, elapsed: number, limit: number|null, remaining: number|null }}
 *   elapsed and remaining are in minutes; limit is null when no limit is set.
 */
async function checkSession(userId) {
    try {
        // Auto-start session if not yet started
        if (!activeSessions.has(userId)) {
            startSession(userId);
        }

        const session = activeSessions.get(userId);
        const elapsedMs = Date.now() - session.startedAt;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);

        // Fetch user's configured session time limit (can be null = unlimited)
        const limitsRow = await db.get(
            'SELECT session_time_limit FROM user_limits WHERE user_id = ?',
            [userId]
        );

        const limit = (limitsRow && limitsRow.session_time_limit != null)
            ? limitsRow.session_time_limit
            : null;

        // No limit configured — always allowed
        if (limit === null) {
            return {
                allowed: true,
                elapsed: elapsedMinutes,
                limit: null,
                remaining: null
            };
        }

        const remaining = Math.max(0, limit - elapsedMinutes);
        const allowed = elapsedMinutes < limit;

        return {
            allowed,
            elapsed: elapsedMinutes,
            limit,
            remaining
        };
    } catch (e) {
        console.error('[SessionTimer] check error:', e.message);
        // Fail CLOSED for responsible gaming — if we can't verify the session limit,
        // block play until the service recovers. This is an industry requirement:
        // responsible gaming controls must never silently degrade.
        return { allowed: false, elapsed: 0, limit: null, remaining: 0, error: 'Session timer unavailable' };
    }
}

/**
 * End (clear) a user's session timer.
 */
function endSession(userId) {
    activeSessions.delete(userId);
}

/**
 * Get current session info without any DB lookup.
 * Returns null if no active session.
 */
function getSessionInfo(userId) {
    const session = activeSessions.get(userId);
    if (!session) return null;

    const elapsedMs = Date.now() - session.startedAt;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);

    return {
        active: true,
        startedAt: new Date(session.startedAt).toISOString(),
        elapsedMinutes
    };
}

module.exports = {
    startSession,
    checkSession,
    endSession,
    getSessionInfo
};
