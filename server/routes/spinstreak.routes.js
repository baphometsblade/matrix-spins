'use strict';

var router = require('express').Router();
var { authenticate } = require('../middleware/auth');
var db = require('../database');

/**
 * Spin Streak Bonus Multiplier System
 *
 * Tracks consecutive spins within a 2-hour session window.
 * Multiplier tiers based on spin count in that window.
 */

var STREAK_TIERS = [
    { spins: 10, multiplier: 1.1, tierName: 'Bronze Streak' },
    { spins: 25, multiplier: 1.25, tierName: 'Silver Streak' },
    { spins: 50, multiplier: 1.5, tierName: 'Gold Streak' },
    { spins: 100, multiplier: 2.0, tierName: 'FIRE STREAK!' },
    { spins: 200, multiplier: 3.0, tierName: 'LEGENDARY STREAK!' }
];

var SESSION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Calculate multiplier based on spin count
 */
function getMultiplierAndTier(spinCount) {
    var multiplier = 1.0;
    var tierName = 'No Streak';

    for (var i = 0; i < STREAK_TIERS.length; i++) {
        var tier = STREAK_TIERS[i];
        if (spinCount >= tier.spins) {
            multiplier = tier.multiplier;
            tierName = tier.tierName;
        }
    }

    return { multiplier: multiplier, tierName: tierName };
}

/**
 * Find next tier threshold
 */
function getNextTier(spinCount) {
    for (var i = 0; i < STREAK_TIERS.length; i++) {
        var tier = STREAK_TIERS[i];
        if (spinCount < tier.spins) {
            return tier;
        }
    }
    return null;
}

/**
 * GET /api/spin-streak
 * Get current streak status for authenticated user
 *
 * Returns:
 * {
 *   currentStreak: number,
 *   currentMultiplier: number,
 *   nextTier: object | null,
 *   spinsToNext: number,
 *   tierName: string
 * }
 */
router.get('/', authenticate, async function(req, res) {
    try {
        var userId = req.user.id;
        var twoHoursAgo = new Date(Date.now() - SESSION_WINDOW_MS);
        var isPg = !!process.env.DATABASE_URL;

        // Count spins in last 2 hours
        var result = await db.get(
            isPg
                ? "SELECT COUNT(*) as spin_count FROM spins WHERE user_id = $1 AND created_at > $2"
                : "SELECT COUNT(*) as spin_count FROM spins WHERE user_id = ? AND created_at > ?",
            [userId, twoHoursAgo.toISOString().slice(0, 19).replace('T', ' ')]
        );

        var currentStreak = result && result.spin_count ? parseInt(result.spin_count, 10) : 0;

        // Find current tier and next tier
        var tierInfo = getMultiplierAndTier(currentStreak);
        var nextTier = getNextTier(currentStreak);
        var spinsToNext = nextTier ? (nextTier.spins - currentStreak) : 0;

        return res.json({
            currentStreak: currentStreak,
            currentMultiplier: tierInfo.multiplier,
            nextTier: nextTier,
            spinsToNext: spinsToNext,
            tierName: tierInfo.tierName
        });
    } catch (err) {
        console.warn('[SpinStreak] GET / error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch streak status' });
    }
});

/**
 * GET /api/spin-streak/leaderboard
 * Get leaderboard of top streakers (last 24 hours)
 * Public endpoint (no auth required)
 *
 * Returns:
 * {
 *   leaderboard: [
 *     { username, spinCount, multiplier, tierName },
 *     ...
 *   ]
 * }
 */
router.get('/leaderboard', async function(req, res) {
    try {
        var oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        var isPg = !!process.env.DATABASE_URL;

        var query = isPg
            ? "SELECT u.username, COUNT(s.id) as spin_count FROM spins s JOIN users u ON s.user_id = u.id WHERE s.created_at > $1 GROUP BY u.id, u.username ORDER BY spin_count DESC LIMIT 10"
            : "SELECT u.username, COUNT(s.id) as spin_count FROM spins s JOIN users u ON s.user_id = u.id WHERE s.created_at > ? GROUP BY u.id, u.username ORDER BY spin_count DESC LIMIT 10";

        var rows = await db.all(query, [oneDayAgo.toISOString().slice(0, 19).replace('T', ' ')]);

        var leaderboard = (rows || []).map(function(row) {
            var spinCount = row.spin_count ? parseInt(row.spin_count, 10) : 0;
            var tierInfo = getMultiplierAndTier(spinCount);

            return {
                username: row.username,
                spinCount: spinCount,
                multiplier: tierInfo.multiplier,
                tierName: tierInfo.tierName
            };
        });

        return res.json({ leaderboard: leaderboard });
    } catch (err) {
        console.warn('[SpinStreak] GET /leaderboard error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

module.exports = router;
