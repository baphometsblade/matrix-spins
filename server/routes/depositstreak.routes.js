'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap columns
db.run("ALTER TABLE users ADD COLUMN deposit_streak INTEGER DEFAULT 0").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN deposit_streak_last TEXT").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN deposit_streak_max INTEGER DEFAULT 0").catch(function() {});

// Streak milestones: day → { gems, credits, label }
var STREAK_REWARDS = {
    1: { gems: 100,  credits: 0,     label: 'Day 1 Bonus' },
    2: { gems: 150,  credits: 0,     label: 'Day 2 Bonus' },
    3: { gems: 300,  credits: 2.00,  label: 'Day 3 Bonus' },
    4: { gems: 300,  credits: 0,     label: 'Day 4 Bonus' },
    5: { gems: 500,  credits: 5.00,  label: 'Day 5 Bonus' },
    6: { gems: 500,  credits: 0,     label: 'Day 6 Bonus' },
    7: { gems: 1000, credits: 10.00, label: 'Day 7 MEGA Bonus' }
};

function getTodayDate() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getYesterdayDate() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

// GET /api/deposit-streak/status — auth required
router.get('/status', authenticate, async (req, res) => {
    try {
        var user = await db.get(
            'SELECT deposit_streak, deposit_streak_last, deposit_streak_max FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.json({ streak: 0, streakMax: 0, lastDate: null, rewards: STREAK_REWARDS, depositedToday: false });

        var today = getTodayDate();
        var depositedToday = (user.deposit_streak_last === today);
        var streak = user.deposit_streak || 0;

        // If last deposit was before yesterday, streak is broken (show as 0 progress going forward)
        if (user.deposit_streak_last && user.deposit_streak_last < getYesterdayDate()) {
            streak = 0;
        }

        res.json({
            streak:        depositedToday ? streak : streak,
            nextDay:       Math.min(streak + 1, 7),
            streakMax:     user.deposit_streak_max || 0,
            lastDate:      user.deposit_streak_last || null,
            depositedToday: depositedToday,
            rewards:       STREAK_REWARDS
        });
    } catch (err) {
        console.error('[DepositStreak] Status error:', err.message);
        res.status(500).json({ error: 'Failed to get streak status' });
    }
});

// POST /api/deposit-streak/record — called internally after deposit completion
// Also callable by auth'd user to trigger reward after deposit
router.post('/record', authenticate, async (req, res) => {
    try {
        var user = await db.get(
            'SELECT deposit_streak, deposit_streak_last, deposit_streak_max, balance FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        var today = getTodayDate();
        var yesterday = getYesterdayDate();

        // Already recorded today
        if (user.deposit_streak_last === today) {
            return res.json({ streak: user.deposit_streak, alreadyRecorded: true });
        }

        var prevStreak = user.deposit_streak || 0;
        var newStreak;

        if (user.deposit_streak_last === yesterday) {
            // Consecutive day — extend streak (cap at 7)
            newStreak = Math.min(prevStreak + 1, 7);
        } else {
            // Streak broken or first deposit — start at 1
            newStreak = 1;
        }

        var reward = STREAK_REWARDS[newStreak] || { gems: 0, credits: 0, label: 'Bonus' };
        var newMax = Math.max(user.deposit_streak_max || 0, newStreak);

        // Award gems
        if (reward.gems > 0) {
            await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
                [reward.gems, req.user.id]).catch(function() {});
        }

        // Award credits → bonus_balance with 15x wagering (free credit rule)
        if (reward.credits > 0) {
            var streakWager = reward.credits * 15;
            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                [reward.credits, streakWager, req.user.id]
            );
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit_streak', ?, ?)",
                [req.user.id, reward.credits, 'Deposit Streak Day ' + newStreak + ' — ' + reward.label + ' (15x wagering)']
            ).catch(function() {});
        }

        // Update streak
        await db.run(
            'UPDATE users SET deposit_streak = ?, deposit_streak_last = ?, deposit_streak_max = ? WHERE id = ?',
            [newStreak, today, newMax, req.user.id]
        );

        res.json({
            streak:       newStreak,
            gemsAwarded:  reward.gems,
            creditsAwarded: reward.credits,
            label:        reward.label,
            creditedTo:   reward.credits > 0 ? 'bonus_balance' : null
        });
    } catch (err) {
        console.error('[DepositStreak] Record error:', err.message);
        res.status(500).json({ error: 'Failed to record deposit streak' });
    }
});

// Standalone function callable from other routes (fire-and-forget)
async function recordForUser(userId) {
    var today = getTodayDate();
    var yesterday = getYesterdayDate();
    var user = await db.get(
        'SELECT deposit_streak, deposit_streak_last, deposit_streak_max, balance FROM users WHERE id = ?',
        [userId]
    );
    if (!user || user.deposit_streak_last === today) return; // already recorded

    var prevStreak = user.deposit_streak || 0;
    var newStreak = (user.deposit_streak_last === yesterday)
        ? Math.min(prevStreak + 1, 7)
        : 1;

    var reward = STREAK_REWARDS[newStreak] || { gems: 0, credits: 0, label: 'Bonus' };
    var newMax = Math.max(user.deposit_streak_max || 0, newStreak);

    if (reward.gems > 0) {
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
            [reward.gems, userId]).catch(function() {});
    }
    if (reward.credits > 0) {
        // Free credit → bonus_balance with 15x wagering
        var streakWager = reward.credits * 15;
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [reward.credits, streakWager, userId]
        );
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'deposit_streak', ?, ?)",
            [userId, reward.credits, 'Deposit Streak Day ' + newStreak + ' — ' + reward.label + ' (15x wagering)']
        ).catch(function() {});
    }
    await db.run(
        'UPDATE users SET deposit_streak = ?, deposit_streak_last = ?, deposit_streak_max = ? WHERE id = ?',
        [newStreak, today, newMax, userId]
    );
}

module.exports = router;
module.exports.recordForUser = recordForUser;
