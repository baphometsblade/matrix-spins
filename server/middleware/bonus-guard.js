'use strict';

/**
 * Centralized Bonus Guard Middleware
 *
 * Applies self-exclusion check + daily bonus cap check before ANY bonus claim.
 * Import and use as middleware on bonus routes to ensure consistent enforcement.
 *
 * Usage:
 *   const { bonusGuard } = require('../middleware/bonus-guard');
 *   router.post('/claim', authenticate, bonusGuard, async (req, res) => { ... });
 */

const db = require('../database');
const bonusCap = require('../services/bonus-cap.service');

/**
 * Middleware that blocks bonus claims for self-excluded users
 * and users who have hit the daily bonus cap.
 */
async function bonusGuard(req, res, next) {
    try {
        var userId = req.user && (req.user.id || req.user.userId);
        if (!userId) return next(); // No auth context — let route handle it

        // 1. Self-exclusion check (both tables: self_exclusions + user_limits)
        // ROUND 30: Fail CLOSED on DB errors — was silently continuing (catch(_){}).
        // This is centralized middleware; fail-open here means ALL bonus routes are vulnerable.
        var selfExclFound = false;
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            // Table may not exist — only tolerate "no such table" errors, fail on all others
            if (exclErr.message && exclErr.message.includes('no such table')) {
                // OK — table doesn't exist yet, fall through to user_limits check
            } else {
                console.error('[BonusGuard] Self-exclusion check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed. Please try again.' });
            }
        }

        try {
            var limits = await db.get(
                'SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
                [userId]
            );
            if (limits) {
                var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
                if (limits.self_excluded_until && limits.self_excluded_until > now) {
                    return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
                }
                if (limits.cooling_off_until && limits.cooling_off_until > now) {
                    return res.status(403).json({ error: 'Account is in cooling-off period. Bonuses are disabled.' });
                }
            }
        } catch (limErr) {
            if (limErr.message && limErr.message.includes('no such table')) {
                // OK — table doesn't exist yet
            } else {
                console.error('[BonusGuard] User limits check failed:', limErr.message);
                return res.status(500).json({ error: 'Security check failed. Please try again.' });
            }
        }

        // 2. Daily bonus cap check
        try {
            var capCheck = await bonusCap.checkDailyCap(userId);
            if (!capCheck.canReceive) {
                return res.status(400).json({
                    error: 'Daily bonus limit reached ($' + bonusCap.MAX_DAILY_BONUS_TOTAL + '/day).',
                    dailyTotal: capCheck.totalToday
                });
            }
            // Attach remaining cap to request for downstream use
            req.bonusCapRemaining = capCheck.remaining;
        } catch (_) {
            // Fail open for cap check (non-critical)
            req.bonusCapRemaining = bonusCap.MAX_DAILY_BONUS_TOTAL;
        }

        next();
    } catch (err) {
        // ROUND 30: Fail CLOSED — was failing open (next()), meaning any uncaught
        // error in bonus-guard would bypass ALL security checks
        console.error('[BonusGuard] Unexpected error:', err.message);
        return res.status(500).json({ error: 'Security check failed. Please try again.' });
    }
}

module.exports = { bonusGuard };
