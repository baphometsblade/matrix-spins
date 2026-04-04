'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const gemsService = require('../services/gems.service');

// Achievement Catalog

const ACHIEVEMENTS = [
    {
        "id": "first_spin",
        "name": "First Spin",
        "icon": "🎰",
        "description": "Spin for the first time",
        "rewardType": "gems",
        "rewardAmount": 50
    },
    {
        "id": "first_win",
        "name": "First Win",
        "icon": "🏆",
        "description": "Win your first spin",
        "rewardType": "gems",
        "rewardAmount": 100
    },
    {
        "id": "big_winner",
        "name": "Big Winner",
        "icon": "💰",
        "description": "Hit a 10x win or higher",
        "rewardType": "credits",
        "rewardAmount": 5
    },
    {
        "id": "high_roller",
        "name": "High Roller",
        "icon": "💎",
        "description": "Place a single bet of $5+",
        "rewardType": "gems",
        "rewardAmount": 200
    },
    {
        "id": "centurion",
        "name": "Centurion",
        "icon": "💯",
        "description": "Complete 100 total spins",
        "rewardType": "credits",
        "rewardAmount": 2
    },
    {
        "id": "jackpot_chaser",
        "name": "Jackpot Chaser",
        "icon": "🎯",
        "description": "Hit a 50x win",
        "rewardType": "credits",
        "rewardAmount": 10
    },
    {
        "id": "mega_hit",
        "name": "Mega Hit",
        "icon": "🔥",
        "description": "Hit a 100x win",
        "rewardType": "gems",
        "rewardAmount": 500
    },
    {
        "id": "globe_trotter",
        "name": "Globe Trotter",
        "icon": "🌍",
        "description": "Play 10 different games",
        "rewardType": "gems",
        "rewardAmount": 100
    },
    {
        "id": "explorer",
        "name": "Explorer",
        "icon": "🗺️",
        "description": "Play 25 different games",
        "rewardType": "gems",
        "rewardAmount": 300
    },
    {
        "id": "depositor",
        "name": "First Deposit",
        "icon": "💳",
        "description": "Make your first deposit",
        "rewardType": "credits",
        "rewardAmount": 5
    },
    {
        "id": "loyal_player",
        "name": "Loyal Player",
        "icon": "⭐",
        "description": "Play on 7 different days",
        "rewardType": "credits",
        "rewardAmount": 3
    },
    {
        "id": "whale",
        "name": "Whale",
        "icon": "🐋",
        "description": "Wager $500 total",
        "rewardType": "credits",
        "rewardAmount": 15
    },
    {
        "id": "legend",
        "name": "Legend",
        "icon": "👑",
        "description": "Wager $5,000 total",
        "rewardType": "gems",
        "rewardAmount": 2000
    },
    {
        "id": "veteran",
        "name": "Veteran",
        "icon": "🏖️",
        "description": "Complete 1,000 total spins",
        "rewardType": "credits",
        "rewardAmount": 20
    },
    {
        "id": "all_rounder",
        "name": "All Rounder",
        "icon": "🌟",
        "description": "Unlock 10 achievements",
        "rewardType": "gems",
        "rewardAmount": 500
    }
];
// GET /api/achievements

router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

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


        const rows = await db.all(
            'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
            [userId]
        );

        const unlockedMap = {};
        for (const row of rows) {
            unlockedMap[row.achievement_id] = row.unlocked_at;
        }

        let gemsEarned = 0;
        let creditsEarned = 0;
        let unlockedCount = 0;

        const achievements = ACHIEVEMENTS.map(a => {
            const isUnlocked = Object.prototype.hasOwnProperty.call(unlockedMap, a.id);
            if (isUnlocked) {
                unlockedCount++;
                if (a.rewardType === 'gems') {
                    gemsEarned += a.rewardAmount;
                } else {
                    creditsEarned += a.rewardAmount;
                }
            }
            return {
                id: a.id,
                name: a.name,
                icon: a.icon,
                description: a.description,
                rewardType: a.rewardType,
                rewardAmount: a.rewardAmount,
                unlocked: isUnlocked,
                unlockedAt: isUnlocked ? unlockedMap[a.id] : null,
            };
        });

        res.json({
            achievements,
            stats: {
                total: ACHIEVEMENTS.length,
                unlocked: unlockedCount,
                gemsEarned,
                creditsEarned,
            },
        });
    } catch (err) {
        console.warn('[Achievements] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});
// POST /api/achievements/check

router.post('/check', authenticate, bonusGuard, async (req, res) => {
    try {
        const userId = req.user.id;

        // ROUND 43: Self-exclusion check (regulatory compliance — fail-closed)
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

        const alreadyUnlockedRows = await db.all(
            'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
            [userId]
        );
        const alreadyUnlocked = new Set(alreadyUnlockedRows.map(r => r.achievement_id));
        const unlockedCount = alreadyUnlocked.size;

        const lockedIds = ACHIEVEMENTS.filter(a => !alreadyUnlocked.has(a.id)).map(a => a.id);
        if (lockedIds.length === 0) {
            return res.json({ newlyUnlocked: [] });
        }
        const [
            spinRow,
            winRow,
            multRow,
            betRow,
            gamesRow,
            daysRow,
            wageredRow,
            depositRow,
        ] = await Promise.all([
            db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ? AND win_amount > 0', [userId]),
            db.get('SELECT MAX(win_amount / CAST(bet_amount AS REAL)) as mult FROM spins WHERE user_id = ? AND bet_amount > 0', [userId]),
            db.get('SELECT MAX(bet_amount) as mx FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COUNT(DISTINCT game_id) as cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COUNT(DISTINCT DATE(created_at)) as cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?', [userId]),
            db.get("SELECT COUNT(*) as cnt FROM deposits WHERE user_id = ? AND status = 'completed'", [userId]),
        ]);
        const totalSpins    = (spinRow    && spinRow.cnt    != null) ? Number(spinRow.cnt)        : 0;
        const totalWins     = (winRow     && winRow.cnt     != null) ? Number(winRow.cnt)         : 0;
        const maxMultiplier = (multRow    && multRow.mult   != null) ? Number(multRow.mult)       : 0;
        const maxBet        = (betRow     && betRow.mx      != null) ? Number(betRow.mx)          : 0;
        const distinctGames = (gamesRow   && gamesRow.cnt   != null) ? Number(gamesRow.cnt)       : 0;
        const daysWithSpins = (daysRow    && daysRow.cnt    != null) ? Number(daysRow.cnt)        : 0;
        const totalWagered  = (wageredRow && wageredRow.total != null) ? Number(wageredRow.total) : 0;
        const deposits      = (depositRow && depositRow.cnt != null) ? Number(depositRow.cnt)     : 0;

        const conditions = {
            first_spin:     totalSpins    >= 1,
            first_win:      totalWins     >= 1,
            big_winner:     maxMultiplier >= 10,
            high_roller:    maxBet        >= 5,
            centurion:      totalSpins    >= 100,
            jackpot_chaser: maxMultiplier >= 50,
            mega_hit:       maxMultiplier >= 100,
            globe_trotter:  distinctGames >= 10,
            explorer:       distinctGames >= 25,
            depositor:      deposits      >= 1,
            loyal_player:   daysWithSpins >= 7,
            whale:          totalWagered  >= 500,
            legend:         totalWagered  >= 5000,
            veteran:        totalSpins    >= 1000,
        };

        const newlyUnlocked = [];
        for (const ach of ACHIEVEMENTS) {
            if (ach.id === 'all_rounder') continue;
            if (alreadyUnlocked.has(ach.id)) continue;
            if (conditions[ach.id]) {
                newlyUnlocked.push(ach);
            }
        }

        const projectedUnlockedCount = unlockedCount + newlyUnlocked.length;
        if (!alreadyUnlocked.has('all_rounder') && projectedUnlockedCount >= 10) {
            const allRounderAch = ACHIEVEMENTS.find(a => a.id === 'all_rounder');
            if (allRounderAch) newlyUnlocked.push(allRounderAch);
        }
        // ROUND 43: Fixed race condition — only credit reward if INSERT actually
        // inserted (changes > 0). Previously: INSERT OR IGNORE silently ignored
        // duplicates but reward credit still ran, allowing double-pay on concurrent requests.
        for (const ach of newlyUnlocked) {
            try {
                const insertResult = await db.run(
                    'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
                    [userId, ach.id]
                );

                // Only credit reward if we actually inserted (not a duplicate)
                if (!insertResult || insertResult.changes === 0) {
                    console.warn('[Achievements] Skipping duplicate reward for', ach.id, 'user', userId);
                    continue;
                }

                if (ach.rewardType === 'gems') {
                    await gemsService.addGems(userId, ach.rewardAmount, 'Achievement reward: ' + ach.name);
                } else {
                    const userRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                    const balanceBefore = userRow ? Number(userRow.balance) : 0;
                    const balanceAfter  = balanceBefore + ach.rewardAmount;

                    await db.run(
                        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                        [ach.rewardAmount, ach.rewardAmount * 15, userId]
                    );

                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, 'achievement_reward', ach.rewardAmount, balanceBefore, balanceAfter, 'Achievement: ' + ach.name + ' (bonus, 15x wagering)']
                    );
                }
            } catch (rewardErr) {
                console.warn('[Achievements] Failed to credit reward for', ach.id, ':', rewardErr.message);
            }
        }

        res.json({
            newlyUnlocked: newlyUnlocked.map(a => ({
                id: a.id,
                name: a.name,
                icon: a.icon,
                description: a.description,
                rewardType: a.rewardType,
                rewardAmount: a.rewardAmount,
            })),
        });
    } catch (err) {
        console.warn('[Achievements] POST /check error:', err.message);
        res.status(500).json({ error: 'Failed to check achievements' });
    }
});

module.exports = router;
