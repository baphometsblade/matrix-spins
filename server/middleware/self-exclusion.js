'use strict';

/**
 * Self-exclusion gate.
 *
 * Five endpoints need the same check: if users.self_excluded_until is
 * set and in the future, refuse with 403 and a machine-readable body.
 * Previously each route re-implemented the date parse, the timezone
 * comparison, and the error shape — and the error shapes had begun
 * to drift between routes.
 *
 * Usage (all routes):
 *
 *   const row = await db.get('SELECT ... self_excluded_until ... FROM users WHERE id = ?', [uid]);
 *   if (selfExclusionResponse(res, row)) return;
 *   // proceed
 *
 * Returns true if a 403 was sent (caller should stop), false otherwise.
 *
 * The caller owns the SELECT because different routes need different
 * other columns on the same row (email_verified, balance_cents, etc.)
 * — forcing another round-trip just to share this check would have
 * cost more than it saved.
 */
function selfExclusionResponse(res, userRow) {
    if (!userRow || !userRow.self_excluded_until) return false;
    const untilMs = Date.parse(userRow.self_excluded_until);
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return false;
    const untilIso = new Date(untilMs).toISOString();
    res.status(403).json({
        error: 'Your account is self-excluded until ' + untilIso + '.',
        code: 'self_excluded',
        until: untilIso,
    });
    return true;
}

module.exports = { selfExclusionResponse };
