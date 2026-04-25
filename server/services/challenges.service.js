'use strict';

const _crypto = require('crypto');

var CHALLENGE_TEMPLATES = [
    // Easy
    { type: 'total_spins', difficulty: 'easy', target: 20, credits: 2, gems: 20, desc: 'Spin {target} times' },
    { type: 'total_spins', difficulty: 'easy', target: 30, credits: 3, gems: 25, desc: 'Spin {target} times' },
    { type: 'total_wager', difficulty: 'easy', target: 50, credits: 3, gems: 20, desc: 'Wager at least ${target}' },
    { type: 'any_win', difficulty: 'easy', target: 5, credits: 2, gems: 15, desc: 'Win {target} times' },
    // Medium
    { type: 'total_spins', difficulty: 'medium', target: 75, credits: 5, gems: 50, desc: 'Spin {target} times' },
    { type: 'total_wager', difficulty: 'medium', target: 200, credits: 8, gems: 60, desc: 'Wager at least ${target}' },
    { type: 'different_games', difficulty: 'medium', target: 5, credits: 5, gems: 40, desc: 'Play {target} different games' },
    { type: 'big_win', difficulty: 'medium', target: 25, credits: 8, gems: 50, desc: 'Hit a single win of ${target}+' },
    // Hard
    { type: 'total_spins', difficulty: 'hard', target: 200, credits: 15, gems: 100, desc: 'Spin {target} times' },
    { type: 'total_wager', difficulty: 'hard', target: 500, credits: 20, gems: 150, desc: 'Wager at least ${target}' },
    { type: 'big_win', difficulty: 'hard', target: 100, credits: 25, gems: 200, desc: 'Hit a single win of ${target}+' },
    { type: 'different_games', difficulty: 'hard', target: 10, credits: 15, gems: 120, desc: 'Play {target} different games' }
];

var STREAK_BONUSES = [
    { days: 3, gems: 50, credits: 0 },
    { days: 7, gems: 200, credits: 5 },
    { days: 14, gems: 500, credits: 15 },
    { days: 30, gems: 1500, credits: 50 }
];

var SKIP_COST = 150;

/**
 * Initialize daily_challenges and challenge_streaks tables.
 */
async function initSchema() {
    const db = require('../database');
    const isPg  = !!process.env.DATABASE_URL;
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";

    await db.run(`
        CREATE TABLE IF NOT EXISTS daily_challenges (
            id ${idDef},
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            challenge_type TEXT NOT NULL,
            target INTEGER NOT NULL,
            progress INTEGER DEFAULT 0,
            reward_credits REAL DEFAULT 0,
            reward_gems INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            difficulty TEXT NOT NULL,
            description TEXT,
            created_at ${tsType} DEFAULT ${tsDefault}
        )
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS challenge_streaks (
            user_id INTEGER PRIMARY KEY,
            current_streak INTEGER DEFAULT 0,
            best_streak INTEGER DEFAULT 0,
            last_completed_date TEXT
        )
    `);
}

/**
 * Pick one random item from an array.
 */
function _pickRandom(arr) {
    return arr[_crypto.randomInt(arr.length)];
}

/**
 * Format a challenge description by replacing {target} with the actual value.
 */
function _formatDesc(template, target) {
    return template.replace(/\{target\}/g, String(target));
}

/**
 * Get (or generate) today's 3 daily challenges for a user.
 * Returns { challenges: [...], streak: {...} }.
 */
async function getDailyChallenges(userId) {
    const db = require('../database');

    // Check if challenges already exist for today
    var existing = await db.all(
        "SELECT * FROM daily_challenges WHERE user_id = ? AND date = date('now') ORDER BY id",
        [userId]
    );

    if (existing && existing.length > 0) {
        // Format descriptions and return
        var challenges = existing.map(function (c) {
            return Object.assign({}, c, {
                description: c.description || ''
            });
        });
        var streak = await getStreak(userId);
        return { challenges: challenges, streak: streak };
    }

    // Generate 3 new challenges: 1 easy, 1 medium, 1 hard
    var easyTemplates = CHALLENGE_TEMPLATES.filter(function (t) { return t.difficulty === 'easy'; });
    var mediumTemplates = CHALLENGE_TEMPLATES.filter(function (t) { return t.difficulty === 'medium'; });
    var hardTemplates = CHALLENGE_TEMPLATES.filter(function (t) { return t.difficulty === 'hard'; });

    var picks = [
        _pickRandom(easyTemplates),
        _pickRandom(mediumTemplates),
        _pickRandom(hardTemplates)
    ];

    var inserted = [];
    for (var i = 0; i < picks.length; i++) {
        var tpl = picks[i];
        var desc = _formatDesc(tpl.desc, tpl.target);
        var result = await db.run(
            "INSERT INTO daily_challenges (user_id, date, challenge_type, target, progress, reward_credits, reward_gems, completed, difficulty, description) VALUES (?, date('now'), ?, ?, 0, ?, ?, 0, ?, ?)",
            [userId, tpl.type, tpl.target, tpl.credits, tpl.gems, tpl.difficulty, desc]
        );

        // Retrieve the inserted row
        var row = await db.get(
            "SELECT * FROM daily_challenges WHERE user_id = ? AND date = date('now') AND challenge_type = ? AND difficulty = ? ORDER BY id DESC LIMIT 1",
            [userId, tpl.type, tpl.difficulty]
        );
        if (row) {
            inserted.push(row);
        }
    }

    var streak = await getStreak(userId);
    return { challenges: inserted, streak: streak };
}

/**
 * Update progress on daily challenges matching a given type.
 * Returns { updated: true, completed: boolean, rewards: { credits, gems } } or { updated: false }.
 */
async function updateProgress(userId, challengeType, amount, extra) {
    const db = require('../database');

    // Find uncompleted challenges of this type for today
    var challenges = await db.all(
        "SELECT * FROM daily_challenges WHERE user_id = ? AND date = date('now') AND challenge_type = ? AND completed = 0",
        [userId, challengeType]
    );

    if (!challenges || challenges.length === 0) {
        return { updated: false };
    }

    var totalCredits = 0;
    var totalGems = 0;
    var anyCompleted = false;

    for (var i = 0; i < challenges.length; i++) {
        var ch = challenges[i];
        var newProgress = ch.progress + amount;
        var nowCompleted = newProgress >= ch.target ? 1 : 0;

        await db.run(
            "UPDATE daily_challenges SET progress = ?, completed = ? WHERE id = ?",
            [newProgress, nowCompleted, ch.id]
        );

        if (nowCompleted && !ch.completed) {
            anyCompleted = true;
            totalCredits += ch.reward_credits;
            totalGems += ch.reward_gems;

            // Award credits
            if (ch.reward_credits > 0) {
                var _balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                var _balBefore = _balRow ? _balRow.balance : 0;
                await db.run(
                    'UPDATE users SET balance = balance + ? WHERE id = ?',
                    [ch.reward_credits, userId]
                );
                try {
                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, 'challenge_reward', ch.reward_credits, _balBefore, _balBefore + ch.reward_credits, 'challenge:' + ch.id]
                    );
                } catch (_txErr) { /* non-critical — balance already credited */ }
            }

            // Award gems
            if (ch.reward_gems > 0) {
                try {
                    var gemsService = require('./gems.service');
                    await gemsService.addGems(userId, ch.reward_gems, 'Challenge reward');
                } catch (e) {
                    // gems service may not be available
                }
            }
        }
    }

    // Check if all 3 of today's challenges are now completed
    if (anyCompleted) {
        var remaining = await db.get(
            "SELECT COUNT(*) as cnt FROM daily_challenges WHERE user_id = ? AND date = date('now') AND completed = 0",
            [userId]
        );
        if (remaining && remaining.cnt === 0) {
            await _updateStreak(userId);
        }
    }

    return {
        updated: true,
        completed: anyCompleted,
        rewards: { credits: totalCredits, gems: totalGems }
    };
}

/**
 * Update the user's challenge streak after completing all daily challenges.
 */
async function _updateStreak(userId) {
    const db = require('../database');

    var row = await db.get(
        'SELECT * FROM challenge_streaks WHERE user_id = ?',
        [userId]
    );

    if (!row) {
        // First time completing all challenges
        await db.run(
            "INSERT INTO challenge_streaks (user_id, current_streak, best_streak, last_completed_date) VALUES (?, 1, 1, date('now'))",
            [userId]
        );
        // Check streak bonuses for day 1 (none defined, but be safe)
        await _checkStreakBonuses(userId, 1);
        return;
    }

    // Get today and yesterday as strings for comparison
    var todayRow = await db.get("SELECT date('now') as today");
    var yesterdayRow = await db.get("SELECT date('now', '-1 day') as yesterday");
    var today = todayRow.today;
    var yesterday = yesterdayRow.yesterday;

    if (row.last_completed_date === today) {
        // Already updated today, skip
        return;
    }

    var newStreak;
    if (row.last_completed_date === yesterday) {
        // Consecutive day — increment streak
        newStreak = row.current_streak + 1;
    } else {
        // Streak broken — reset to 1
        newStreak = 1;
    }

    var newBest = Math.max(newStreak, row.best_streak);

    await db.run(
        "UPDATE challenge_streaks SET current_streak = ?, best_streak = ?, last_completed_date = date('now') WHERE user_id = ?",
        [newStreak, newBest, userId]
    );

    await _checkStreakBonuses(userId, newStreak);
}

/**
 * Check and award streak bonuses if the current streak matches a bonus threshold.
 */
async function _checkStreakBonuses(userId, currentStreak) {
    const db = require('../database');

    for (var i = 0; i < STREAK_BONUSES.length; i++) {
        var bonus = STREAK_BONUSES[i];
        if (currentStreak === bonus.days) {
            // Award bonus credits
            if (bonus.credits > 0) {
                var _sBalRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                var _sBalBefore = _sBalRow ? _sBalRow.balance : 0;
                await db.run(
                    'UPDATE users SET balance = balance + ? WHERE id = ?',
                    [bonus.credits, userId]
                );
                try {
                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, 'streak_bonus', bonus.credits, _sBalBefore, _sBalBefore + bonus.credits, 'challenge_streak:' + bonus.days + 'days']
                    );
                } catch (_txErr) { /* non-critical */ }
            }
            // Award bonus gems
            if (bonus.gems > 0) {
                try {
                    var gemsService = require('./gems.service');
                    await gemsService.addGems(userId, bonus.gems, 'Challenge streak bonus (' + bonus.days + ' days)');
                } catch (e) {
                    // gems service may not be available
                }
            }
            break;
        }
    }
}

/**
 * Skip a challenge by spending gems. Marks it completed and grants rewards.
 */
async function skipChallenge(userId, challengeId) {
    const db = require('../database');

    // Verify challenge belongs to user and is not completed
    var challenge = await db.get(
        "SELECT * FROM daily_challenges WHERE id = ? AND user_id = ? AND date = date('now')",
        [challengeId, userId]
    );

    if (!challenge) {
        throw new Error('Challenge not found');
    }

    if (challenge.completed) {
        throw new Error('Challenge already completed');
    }

    // Spend gems (will throw if insufficient)
    var gemsService = require('./gems.service');
    await gemsService.spendGems(userId, SKIP_COST, 'Skip daily challenge');

    // Mark completed and grant rewards
    await db.run(
        "UPDATE daily_challenges SET completed = 1, progress = target WHERE id = ?",
        [challengeId]
    );

    // Award credits
    if (challenge.reward_credits > 0) {
        await db.run(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [challenge.reward_credits, userId]
        );
    }

    // Award gems
    if (challenge.reward_gems > 0) {
        try {
            await gemsService.addGems(userId, challenge.reward_gems, 'Challenge reward (skipped)');
        } catch (e) {
            // gems service may not be available for adding
        }
    }

    // Check if all 3 of today's challenges are now completed
    var remaining = await db.get(
        "SELECT COUNT(*) as cnt FROM daily_challenges WHERE user_id = ? AND date = date('now') AND completed = 0",
        [userId]
    );
    if (remaining && remaining.cnt === 0) {
        await _updateStreak(userId);
    }

    return {
        success: true,
        skipCost: SKIP_COST,
        rewards: { credits: challenge.reward_credits, gems: challenge.reward_gems }
    };
}

/**
 * Get the user's current challenge streak info.
 */
async function getStreak(userId) {
    const db = require('../database');

    var row = await db.get(
        'SELECT * FROM challenge_streaks WHERE user_id = ?',
        [userId]
    );

    if (!row) {
        return { current_streak: 0, best_streak: 0, last_completed_date: null };
    }

    return row;
}

module.exports = { initSchema, getDailyChallenges, updateProgress, skipChallenge, getStreak };
