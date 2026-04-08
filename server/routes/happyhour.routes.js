'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── Happy Hour Schedule ───
// Three daily events with fixed multipliers (UTC times)
var HAPPY_HOUR_SCHEDULE = [
    { name: 'Lunch Rush',       startUtc: 12, endUtc: 14, multiplier: 1.5 },
    { name: 'Evening Blitz',    startUtc: 19, endUtc: 21, multiplier: 2.0 },
    { name: 'Midnight Madness', startUtc: 0,  endUtc: 2,  multiplier: 1.75 }
];

// Bootstrap: Create happy_hour_bonuses table if it doesn't exist
var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsType = isPg ? 'TIMESTAMPTZ' : 'TEXT';

db.run(
    'CREATE TABLE IF NOT EXISTS happy_hour_bonuses (' +
    'id ' + idDef + ',' +
    'user_id INTEGER NOT NULL,' +
    'happy_hour_name TEXT NOT NULL,' +
    'bonus_amount REAL NOT NULL,' +
    'claimed_at ' + tsType + ' NOT NULL,' +
    'FOREIGN KEY(user_id) REFERENCES users(id)' +
    ')'
).catch(function(err) {
    // Table already exists or other expected error
    console.warn('[HappyHour] Bootstrap error (expected): ' + err.message);
});

// ─── Helper: Determine current hour in UTC ───
function getCurrentUtcHour() {
    return new Date().getUTCHours();
}

// ─── Helper: Get next happy hour ───
function getNextHappyHour() {
    var now = new Date();
    var currentHour = getCurrentUtcHour();

    // Find the next scheduled happy hour
    var upcoming = null;
    var minHoursUntil = Infinity;

    for (var i = 0; i < HAPPY_HOUR_SCHEDULE.length; i++) {
        var hh = HAPPY_HOUR_SCHEDULE[i];
        var hoursUntil;

        if (hh.startUtc > currentHour) {
            // Starts later today
            hoursUntil = hh.startUtc - currentHour;
        } else {
            // Starts tomorrow
            hoursUntil = (24 - currentHour) + hh.startUtc;
        }

        if (hoursUntil < minHoursUntil) {
            minHoursUntil = hoursUntil;
            upcoming = {
                name: hh.name,
                multiplier: hh.multiplier,
                startsAt: new Date(now.getTime() + hoursUntil * 60 * 60 * 1000)
            };
        }
    }

    return upcoming;
}

// ─── Helper: Check if any happy hour is currently active ───
function getActiveHappyHour() {
    var currentHour = getCurrentUtcHour();

    for (var i = 0; i < HAPPY_HOUR_SCHEDULE.length; i++) {
        var hh = HAPPY_HOUR_SCHEDULE[i];

        // Handle midnight madness edge case (0-2 UTC, spans midnight)
        if (hh.startUtc === 0 && hh.endUtc === 2) {
            if (currentHour >= 0 && currentHour < 2) {
                return {
                    name: hh.name,
                    multiplier: hh.multiplier,
                    endsAt: new Date((new Date()).getTime() + (hh.endUtc - currentHour) * 60 * 60 * 1000)
                };
            }
        } else {
            // Normal case
            if (currentHour >= hh.startUtc && currentHour < hh.endUtc) {
                return {
                    name: hh.name,
                    multiplier: hh.multiplier,
                    endsAt: new Date((new Date()).getTime() + (hh.endUtc - currentHour) * 60 * 60 * 1000)
                };
            }
        }
    }

    return null;
}

/**
 * GET / (public)
 * Get current happy hour status and next scheduled event
 * Returns: { active: bool, current: {...}, next: {...}, schedule: [...] }
 */
router.get('/', async function(req, res) {
    try {
        var active = getActiveHappyHour();
        var next = getNextHappyHour();

        // Build simplified schedule for frontend
        var schedule = HAPPY_HOUR_SCHEDULE.map(function(hh) {
            return {
                name: hh.name,
                startUtc: hh.startUtc,
                endUtc: hh.endUtc,
                multiplier: hh.multiplier
            };
        });

        res.json({
            active: !!active,
            current: active || null,
            next: next,
            schedule: schedule
        });
    } catch (err) {
        console.warn('[HappyHour GET /] Error: ' + err.message);
        res.status(500).json({ error: 'Failed to fetch happy hour status' });
    }
});

/**
 * GET /history (authenticated)
 * Get user's happy hour bonus claim history (last 20 claims)
 */
router.get('/history', authenticate, async function(req, res) {
    try {
        var userId = req.user.id;

        // ROUND 34: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }


        var rows = await db.all(
            'SELECT id, happy_hour_name, bonus_amount, claimed_at FROM happy_hour_bonuses ' +
            'WHERE user_id = ? ' +
            'ORDER BY claimed_at DESC ' +
            'LIMIT 20',
            [userId]
        );

        res.json({
            history: rows || []
        });
    } catch (err) {
        console.warn('[HappyHour GET /history] Error: ' + err.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

/**
 * POST /admin/create (admin only)
 * Create a custom one-time happy hour event
 * Body: { name: string, multiplier: number, durationMinutes: number }
 */
router.post('/admin/create', authenticate, requireAdmin, async function(req, res) {
    try {
        var name = req.body.name;
        var multiplier = req.body.multiplier;
        var durationMinutes = req.body.durationMinutes || 120;

        if (!name || typeof multiplier !== 'number' || multiplier <= 0) {
            return res.status(400).json({ error: 'Invalid happy hour parameters' });
        }

        // ROUND 37: Cap admin-created multiplier to prevent massive payouts
        // if admin credentials are compromised.
        if (multiplier > 3.0) {
            return res.status(400).json({ error: 'Multiplier cannot exceed 3.0x' });
        }

        // For now, we just acknowledge the request — custom events would require
        // extending the system to support transient events beyond the fixed schedule
        res.json({
            success: true,
            message: 'Custom happy hour created: ' + name,
            event: {
                name: name,
                multiplier: multiplier,
                durationMinutes: durationMinutes
            }
        });
    } catch (err) {
        console.warn('[HappyHour POST /admin/create] Error: ' + err.message);
        res.status(500).json({ error: 'Failed to create happy hour event' });
    }
});

/**
 * GET /admin/stats (admin only)
 * Get aggregated stats on happy hour engagement
 * Returns: { totalClaims, uniquePlayers, totalBonusAwarded, topHours }
 */
router.get('/admin/stats', authenticate, requireAdmin, async function(req, res) {
    try {
        // Total claims
        var totalClaimsRow = await db.get(
            'SELECT COUNT(*) as count FROM happy_hour_bonuses',
            []
        );
        var totalClaims = totalClaimsRow ? totalClaimsRow.count : 0;

        // Unique players
        var uniqueRow = await db.get(
            'SELECT COUNT(DISTINCT user_id) as count FROM happy_hour_bonuses',
            []
        );
        var uniquePlayers = uniqueRow ? uniqueRow.count : 0;

        // Total bonus awarded
        var totalBonusRow = await db.get(
            'SELECT SUM(bonus_amount) as total FROM happy_hour_bonuses',
            []
        );
        var totalBonusAwarded = totalBonusRow && totalBonusRow.total ? totalBonusRow.total : 0;

        // Top happy hours by claims
        var topHours = await db.all(
            'SELECT happy_hour_name, COUNT(*) as claims, SUM(bonus_amount) as total_bonus ' +
            'FROM happy_hour_bonuses ' +
            'GROUP BY happy_hour_name ' +
            'ORDER BY claims DESC ' +
            'LIMIT 5',
            []
        );

        res.json({
            totalClaims: totalClaims,
            uniquePlayers: uniquePlayers,
            totalBonusAwarded: parseFloat(totalBonusAwarded).toFixed(2),
            topHours: topHours || []
        });
    } catch (err) {
        console.warn('[HappyHour GET /admin/stats] Error: ' + err.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

module.exports = router;
