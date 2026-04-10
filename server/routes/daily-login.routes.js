'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Database initialization — lazy init pattern
var _dbInitialized = false;

async function _ensureTables() {
    if (_dbInitialized) return;
    _dbInitialized = true;

    var isPg = db.isPg();
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

    // Create daily_login_rewards table — tracks all login claims
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS daily_login_rewards (
            id ${idDef},
            user_id INTEGER NOT NULL,
            login_date TEXT NOT NULL,
            day_streak INTEGER NOT NULL,
            reward_type TEXT NOT NULL,
            reward_amount INTEGER NOT NULL,
            claimed_at ${tsDef},
            UNIQUE(user_id, login_date)
        )`);
    } catch (e) {
        // Table might already exist
    }

    // Ensure users table has streak columns
    try {
        await db.run('ALTER TABLE users ADD COLUMN current_streak INTEGER DEFAULT 0');
    } catch (e) { /* Column might already exist */ }

    try {
        await db.run('ALTER TABLE users ADD COLUMN last_login_date TEXT');
    } catch (e) { /* Column might already exist */ }

    try {
        await db.run('ALTER TABLE users ADD COLUMN gems INTEGER DEFAULT 0');
    } catch (e) { /* Column might already exist */ }

    try {
        await db.run('ALTER TABLE users ADD COLUMN free_spin_tokens INTEGER DEFAULT 0');
    } catch (e) { /* Column might already exist */ }
}

// Reward schedule: 7-day cycle
var REWARD_SCHEDULE = [
    { day: 1, type: 'gems', amount: 50 },
    { day: 2, type: 'gems', amount: 100 },
    { day: 3, type: 'gems', amount: 150, tokens: 1 },
    { day: 4, type: 'gems', amount: 200 },
    { day: 5, type: 'gems', amount: 300, tokens: 2 },
    { day: 6, type: 'gems', amount: 500 },
    { day: 7, type: 'gems', amount: 1000, tokens: 5 }  // MEGA reward
];

/**
 * Get today's date in UTC as YYYY-MM-DD string
 */
function getTodayUTC() {
    var now = new Date();
    var year = now.getUTCFullYear();
    var month = String(now.getUTCMonth() + 1).padStart(2, '0');
    var day = String(now.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

/**
 * Check if two date strings (YYYY-MM-DD) are the same day
 */
function isSameDay(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return false;
    return dateStr1.substring(0, 10) === dateStr2.substring(0, 10);
}

/**
 * Check if dateStr1 is exactly one day before dateStr2
 */
function isDayBefore(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return false;
    var d1 = new Date(dateStr1 + 'T00:00:00Z');
    var d2 = new Date(dateStr2 + 'T00:00:00Z');
    var diffMs = d2 - d1;
    var diffDays = diffMs / (1000 * 60 * 60 * 24);
    return Math.abs(diffDays - 1) < 0.1;
}

/**
 * Get the reward for a given day number (1-7)
 */
function getRewardForDay(dayNum) {
    var idx = (dayNum - 1) % 7;
    return REWARD_SCHEDULE[idx] || null;
}

/**
 * Apply streak bonus multiplier
 * Consecutive days multiply by (1 + streak_week * 0.1), capped at 2x
 */
function applyStreakBonus(baseAmount, streakNumber) {
    var weeksCompleted = Math.floor((streakNumber - 1) / 7);
    var multiplier = 1 + (weeksCompleted * 0.1);
    multiplier = Math.min(multiplier, 2);  // Cap at 2x
    return Math.floor(baseAmount * multiplier);
}

// GET /api/daily-login/status
// Returns: current streak, today's reward, calendar data (last 30 days), next milestone
router.get('/status', authenticate, async function(req, res) {
    try {
        await _ensureTables();

        var userId = req.user.id;
        var today = getTodayUTC();

        var user = await db.get(
            'SELECT current_streak, last_login_date, gems, free_spin_tokens FROM users WHERE id = ?',
            [userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        var currentStreak = user.current_streak || 0;
        var lastLoginDate = user.last_login_date;

        // Check if streak is broken (missed a day)
        if (lastLoginDate && !isSameDay(lastLoginDate, today) && !isDayBefore(lastLoginDate, today)) {
            currentStreak = 0;
        }

        // Determine today's day in cycle (1-7)
        var todayInCycle = ((currentStreak % 7) + 1);
        var todayReward = getRewardForDay(todayInCycle);

        // Bonus amount after streak multiplier
        var bonusAmount = applyStreakBonus(todayReward.amount, currentStreak + 1);

        // Get last 30 days of calendar data
        var thirtydaysAgo = new Date();
        thirtydaysAgo.setUTCDate(thirtydaysAgo.getUTCDate() - 30);
        var startDate = thirtydaysAgo.toISOString().substring(0, 10);

        var calendarRows = await db.all(
            'SELECT login_date, day_streak, reward_amount, reward_type FROM daily_login_rewards WHERE user_id = ? AND login_date >= ? ORDER BY login_date',
            [userId, startDate]
        );

        // Build calendar grid (30 days)
        var calendar = [];
        var calendarMap = {};
        calendarRows.forEach(function(row) {
            calendarMap[row.login_date] = row;
        });

        for (var i = 30; i >= 0; i--) {
            var d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            var dateStr = d.toISOString().substring(0, 10);
            var claim = calendarMap[dateStr];

            calendar.push({
                date: dateStr,
                claimed: !!claim,
                dayInCycle: claim ? ((claim.day_streak % 7) + 1) : null,
                rewardAmount: claim ? claim.reward_amount : null,
                rewardType: claim ? claim.reward_type : null
            });
        }

        // Next milestone thresholds: 7, 14, 30 days
        var nextMilestone = null;
        if (currentStreak >= 30) {
            nextMilestone = { days: 30, achieved: true };
        } else if (currentStreak >= 14) {
            nextMilestone = { days: 30, achieved: false, progress: currentStreak };
        } else if (currentStreak >= 7) {
            nextMilestone = { days: 14, achieved: false, progress: currentStreak };
        } else {
            nextMilestone = { days: 7, achieved: false, progress: currentStreak };
        }

        var canClaimToday = !isSameDay(lastLoginDate, today);

        res.json({
            currentStreak: currentStreak,
            canClaimToday: canClaimToday,
            todayInCycle: todayInCycle,
            todayReward: {
                type: todayReward.type,
                baseAmount: todayReward.amount,
                bonusAmount: bonusAmount,
                freeSpinTokens: todayReward.tokens || 0
            },
            calendar: calendar,
            nextMilestone: nextMilestone,
            userBalance: {
                gems: user.gems || 0,
                freeSpinTokens: user.free_spin_tokens || 0
            }
        });
    } catch (err) {
        console.warn('[daily-login] GET /status error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/daily-login/claim
// Claim today's reward, update streak
router.post('/claim', authenticate, bonusGuard, async function(req, res) {
    try {
        await _ensureTables();

        var userId = req.user.id;
        var today = getTodayUTC();

        // ROUND 37: Self-exclusion check (regulatory compliance)
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

        // Get user and current balance
        var user = await db.get(
            'SELECT current_streak, last_login_date, gems, free_spin_tokens, balance FROM users WHERE id = ?',
            [userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent double-claim (one claim per calendar day)
        if (isSameDay(user.last_login_date, today)) {
            return res.status(400).json({
                error: 'Already claimed today',
                nextAvailableAt: today + 'T00:00:00Z'
            });
        }

        var currentStreak = user.current_streak || 0;
        var lastLoginDate = user.last_login_date;

        // Check if streak is broken (missed a day)
        if (lastLoginDate && !isSameDay(lastLoginDate, today) && !isDayBefore(lastLoginDate, today)) {
            currentStreak = 0;
        }

        // Determine day in cycle (1-7)
        var dayInCycle = ((currentStreak % 7) + 1);
        var reward = getRewardForDay(dayInCycle);

        // Apply streak bonus
        var bonusAmount = applyStreakBonus(reward.amount, currentStreak + 1);

        // New streak: if yesterday was last login, continue; otherwise reset to 1
        var newStreak = isDayBefore(lastLoginDate, today) ? (currentStreak + 1) : 1;

        // Update user: new streak, last login date, add gems and tokens
        var newGems = (user.gems || 0) + bonusAmount;
        var newTokens = (user.free_spin_tokens || 0) + (reward.tokens || 0);

        // ── Wrap in transaction: INSERT claim record FIRST (UNIQUE catches duplicates),
        // then UPDATE user. If INSERT fails on UNIQUE(user_id, login_date), no gems are credited. ──
        await db.beginTransaction();
        try {
            // INSERT first — UNIQUE constraint prevents double-claim even under concurrency
            await db.run(
                'INSERT INTO daily_login_rewards (user_id, login_date, day_streak, reward_type, reward_amount, claimed_at) VALUES (?, ?, ?, ?, ?, ' + (db.isPg() ? 'NOW()' : "datetime('now')") + ')',
                [userId, today, newStreak, reward.type, bonusAmount]
            );

            // Only if INSERT succeeded, credit gems + update streak
            await db.run(
                'UPDATE users SET current_streak = ?, last_login_date = ?, gems = COALESCE(gems, 0) + ?, free_spin_tokens = COALESCE(free_spin_tokens, 0) + ? WHERE id = ?',
                [newStreak, today, bonusAmount, (reward.tokens || 0), userId]
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (rbErr) { console.warn('[DailyLogin] Rollback failed:', rbErr.message); }
            // UNIQUE constraint violation = already claimed today
            if (txErr.message && txErr.message.includes('UNIQUE')) {
                return res.status(400).json({ error: 'Already claimed today', alreadyClaimed: true });
            }
            throw txErr;
        }

        res.json({
            success: true,
            claimedAmount: bonusAmount,
            claimedTokens: reward.tokens || 0,
            newStreak: newStreak,
            newGemsBalance: newGems,
            newTokensBalance: newTokens,
            nextMilestoneProgress: newStreak
        });
    } catch (err) {
        console.warn('[daily-login] POST /claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim reward' });
    }
});

module.exports = router;
