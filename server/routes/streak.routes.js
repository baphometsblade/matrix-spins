'use strict';

var router = require('express').Router();
var { authenticate } = require('../middleware/auth');
var { bonusGuard } = require('../middleware/bonus-guard');
var db = require('../database');

db.run("ALTER TABLE users ADD COLUMN streak_count INTEGER DEFAULT 0").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[streak] ALTER failed:', e.message || e); });
db.run("ALTER TABLE users ADD COLUMN streak_last_date TEXT").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[streak] ALTER failed:', e.message || e); });

var STREAK_REWARDS = [
    null,
    { type: 'gems', amount: 50 },
    { type: 'gems', amount: 100 },
    { type: 'gems', amount: 200 },
    { type: 'credits', amount: 1 },
    { type: 'gems', amount: 300 },
    { type: 'gems', amount: 500 },
    { type: 'weekly', credits: 3, wheelSpins: 5 },
];

function getRewardForDay(streakCount) {
    if (streakCount % 14 === 0) return { type: 'biweekly', credits: 5, wheelSpins: 10 };
    if (streakCount % 30 === 0) return { type: 'monthly', credits: 15 };
    if (streakCount % 7 === 0) return { type: 'weekly', credits: 3, wheelSpins: 5 };
    var dayInCycle = ((streakCount - 1) % 6) + 1;
    return STREAK_REWARDS[dayInCycle];
}

router.post('/', authenticate, bonusGuard, async function(req, res) {
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

        var today = new Date().toISOString().slice(0, 10);
        var row = await db.get('SELECT streak_count, streak_last_date FROM users WHERE id = ?', [userId]);
        if (!row) { return res.status(404).json({ error: 'User not found' }); }
        if (row.streak_last_date === today) {
            return res.json({ isNewDay: false, streakCount: row.streak_count || 0 });
        }
        // Atomic guard: claim today's streak only if not already claimed (prevents race condition)
        var claimGuard = await db.run(
            "UPDATE users SET streak_last_date = ? WHERE id = ? AND (streak_last_date IS NULL OR streak_last_date != ?)",
            [today, userId, today]
        );
        if (!claimGuard || claimGuard.changes === 0) {
            return res.json({ isNewDay: false, streakCount: row.streak_count || 0 });
        }
        var yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        var yesterdayStr = yesterday.toISOString().slice(0, 10);
        var isConsecutive = row.streak_last_date === yesterdayStr;
        var newCount = isConsecutive ? (row.streak_count || 0) + 1 : 1;
        var reward = getRewardForDay(newCount);
        if (reward) {
            await db.beginTransaction();
            try {
                if (reward.type === 'gems') {
                    await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [reward.amount, userId]);
                    await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'streak_reward', ?, ?)",
                        [userId, reward.amount, 'Daily streak reward: ' + reward.amount + ' gems (day ' + newCount + ')']);
                } else if (reward.type === 'credits') {
                    await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [reward.amount, reward.amount * 15, userId]);
                    await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'streak_reward', ?, ?)",
                        [userId, reward.amount, 'Daily streak reward: $' + reward.amount + ' bonus credits (day ' + newCount + ', 15x wagering)']);
                } else if (reward.type === 'weekly' || reward.type === 'biweekly' || reward.type === 'monthly') {
                    var creditAmount = reward.credits || reward.amount || 0;
                    if (creditAmount > 0) {
                        await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [creditAmount, creditAmount * 15, userId]);
                        await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'streak_reward', ?, ?)",
                            [userId, creditAmount, 'Daily streak reward: $' + creditAmount + ' bonus credits (' + reward.type + ' bonus, day ' + newCount + ', 15x wagering)']);
                    }
                    if (reward.wheelSpins && reward.wheelSpins > 0) {
                        await db.run('UPDATE users SET bonus_wheel_spins = COALESCE(bonus_wheel_spins, 0) + ? WHERE id = ?', [reward.wheelSpins, userId]);
                    }
                }
                await db.commit();
            } catch (txErr) {
                await db.rollback().catch(function(rbErr) { console.warn('[Streak] Rollback failed:', rbErr.message); });
                console.warn('[Streak] Reward transaction failed:', txErr.message);
            }
        }
        // streak_last_date already set by atomic guard above; only update streak_count
        await db.run('UPDATE users SET streak_count = ? WHERE id = ?', [newCount, userId]);
        // Grant streak_7 achievement when user first hits a 7-day streak
        if (newCount >= 7) {
            require('../services/achievement.service').grant(userId, 'streak_7').catch(function(err) { console.warn('[Streak] Failed to grant streak_7 achievement:', err.message); });
        }
        var balanceRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        var newBalance = balanceRow ? balanceRow.balance : 0;
        return res.json({ isNewDay: true, streakCount: newCount, reward: reward, newBalance: newBalance, isWeeklyBonus: newCount % 7 === 0 });
    } catch (err) {
        return res.status(500).json({ error: 'Streak update failed' });
    }
});

router.get('/status', authenticate, async function(req, res) {
    try {
        var userId = req.user.id;
        var today = new Date().toISOString().slice(0, 10);
        var row = await db.get('SELECT streak_count, streak_last_date FROM users WHERE id = ?', [userId]);
        if (!row) { return res.status(404).json({ error: 'User not found' }); }
        var streakCount = row.streak_count || 0;
        var lastDate = row.streak_last_date || null;
        var isActiveToday = lastDate === today;
        return res.json({ streakCount: streakCount, lastDate: lastDate, isActiveToday: isActiveToday });
    } catch (err) {
        return res.status(500).json({ error: 'Could not fetch streak status' });
    }
});

module.exports = router;
