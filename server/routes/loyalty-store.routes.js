'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { db } = require('../database');

// Hardcoded reward catalog
var REWARD_CATALOG = {
    'gem_pack_small': { name: 'Small Gem Pack', description: 'Earn 500 gems', pointsCost: 100, rewardType: 'gems', rewardValue: 500 },
    'gem_pack_medium': { name: 'Medium Gem Pack', description: 'Earn 1,500 gems', pointsCost: 250, rewardType: 'gems', rewardValue: 1500 },
    'gem_pack_large': { name: 'Large Gem Pack', description: 'Earn 4,000 gems', pointsCost: 500, rewardType: 'gems', rewardValue: 4000 },
    'free_spins_5': { name: '5 Free Spins', description: 'Spin 5 times free', pointsCost: 75, rewardType: 'free_spins', rewardValue: 5 },
    'free_spins_20': { name: '20 Free Spins', description: 'Spin 20 times free', pointsCost: 250, rewardType: 'free_spins', rewardValue: 20 },
    'cashback_boost': { name: '24h Cashback Boost', description: 'Double cashback for 24 hours', pointsCost: 150, rewardType: 'boost', rewardValue: 2 },
    'vip_boost': { name: '24h VIP Status', description: 'VIP perks for 24 hours', pointsCost: 300, rewardType: 'vip_boost', rewardValue: 1 },
    'mystery_box': { name: 'Mystery Box', description: 'Random reward (100-2000 gems)', pointsCost: 50, rewardType: 'mystery', rewardValue: 1 }
};

// Lazy initialization: ensure loyalty tables exist
async function _ensureLoyaltyTables() {
    var isPg = !!process.env.DATABASE_URL;

    var loyaltyPointsSQL = isPg ? `
        CREATE TABLE IF NOT EXISTS loyalty_points (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
            total_earned INTEGER DEFAULT 0,
            current_balance INTEGER DEFAULT 0,
            lifetime_redeemed INTEGER DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    ` : `
        CREATE TABLE IF NOT EXISTS loyalty_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            total_earned INTEGER DEFAULT 0,
            current_balance INTEGER DEFAULT 0,
            lifetime_redeemed INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `;

    var loyaltyTransactionsSQL = isPg ? `
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ` : `
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            description TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `;

    var loyaltyRedemptionsSQL = isPg ? `
        CREATE TABLE IF NOT EXISTS loyalty_redemptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            reward_id TEXT NOT NULL,
            points_spent INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ` : `
        CREATE TABLE IF NOT EXISTS loyalty_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reward_id TEXT NOT NULL,
            points_spent INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `;

    try {
        await db.run(loyaltyPointsSQL);
        await db.run(loyaltyTransactionsSQL);
        await db.run(loyaltyRedemptionsSQL);
    } catch(e) {
        console.warn('[LoyaltyStore] Table init error (may be benign):', e.message);
    }
}

// GET /api/loyalty/balance — current points balance + lifetime earned
router.get('/balance', authenticate, async (req, res) => {
    try {
        await _ensureLoyaltyTables();
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


        var row = await db.get(
            'SELECT current_balance, total_earned, lifetime_redeemed FROM loyalty_points WHERE user_id = ?',
            [userId]
        );

        if (!row) {
            await db.run(
                'INSERT OR IGNORE INTO loyalty_points (user_id, current_balance, total_earned, lifetime_redeemed) VALUES (?, ?, ?, ?)',
                [userId, 0, 0, 0]
            );
            return res.json({ currentBalance: 0, totalEarned: 0, lifetimeRedeemed: 0 });
        }

        res.json({
            currentBalance: row.current_balance || 0,
            totalEarned: row.total_earned || 0,
            lifetimeRedeemed: row.lifetime_redeemed || 0
        });
    } catch(err) {
        console.warn('[LoyaltyStore] GET /balance error:', err.message);
        res.status(500).json({ error: 'Failed to fetch loyalty balance' });
    }
});

// GET /api/loyalty/store — available rewards catalog with affordability
router.get('/store', authenticate, async (req, res) => {
    try {
        await _ensureLoyaltyTables();
        var userId = req.user.id;

        var row = await db.get(
            'SELECT current_balance FROM loyalty_points WHERE user_id = ?',
            [userId]
        );
        var balance = (row && row.current_balance) || 0;

        var rewards = [];
        Object.keys(REWARD_CATALOG).forEach(function(rewardId) {
            var reward = REWARD_CATALOG[rewardId];
            rewards.push({
                id: rewardId,
                name: reward.name,
                description: reward.description,
                pointsCost: reward.pointsCost,
                rewardType: reward.rewardType,
                rewardValue: reward.rewardValue,
                isAffordable: balance >= reward.pointsCost
            });
        });

        res.json({ rewards: rewards });
    } catch(err) {
        console.warn('[LoyaltyStore] GET /store error:', err.message);
        res.status(500).json({ error: 'Failed to fetch store' });
    }
});

// POST /api/loyalty/earn — record points earned from spins
router.post('/earn', authenticate, async (req, res) => {
    try {
        await _ensureLoyaltyTables();
        var userId = req.user.id;
        var betAmount = parseInt(req.body.betAmount, 10) || 0;

        // ROUND 54: Cap betAmount to prevent inflated point farming
        // Max betAmount accepted is 5000 (matches max bet across all games)
        betAmount = Math.min(Math.max(0, betAmount), 5000);

        var pointsEarned = Math.floor(betAmount / 10);

        if (pointsEarned <= 0) {
            return res.json({ pointsEarned: 0, newBalance: 0 });
        }

        // ROUND 54: Rate limit — max 500 points per minute per user
        // Prevents rapid-fire automated calls from farming unlimited points
        var recentEarns = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_transactions WHERE user_id = ? AND type = 'earn' AND created_at >= datetime('now', '-1 minute')",
            [userId]
        );
        if (recentEarns && recentEarns.total >= 500) {
            return res.status(429).json({ error: 'Too many earn requests. Please slow down.' });
        }

        await db.run(
            'INSERT OR IGNORE INTO loyalty_points (user_id, current_balance, total_earned, lifetime_redeemed) VALUES (?, ?, ?, ?)',
            [userId, 0, 0, 0]
        );

        await db.run(
            'UPDATE loyalty_points SET current_balance = current_balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?',
            [pointsEarned, pointsEarned, userId]
        );

        await db.run(
            'INSERT INTO loyalty_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [userId, 'earn', pointsEarned, 'Earned from wager: ' + betAmount + ' gems']
        );

        var updated = await db.get(
            'SELECT current_balance FROM loyalty_points WHERE user_id = ?',
            [userId]
        );

        res.json({ pointsEarned: pointsEarned, newBalance: updated.current_balance });
    } catch(err) {
        console.warn('[LoyaltyStore] POST /earn error:', err.message);
        res.status(400).json({ error: 'Failed to earn loyalty points' });
    }
});

// POST /api/loyalty/redeem — redeem points for a reward
router.post('/redeem', authenticate, async (req, res) => {
    try {
        await _ensureLoyaltyTables();
        var userId = req.user.id;
        var rewardId = (req.body.rewardId || '').slice(0, 64);

        if (!REWARD_CATALOG[rewardId]) {
            return res.status(400).json({ error: 'Invalid reward ID' });
        }

        var reward = REWARD_CATALOG[rewardId];
        var pointsCost = reward.pointsCost;

        // ── Wrap redemption in transaction with atomic balance guard ──
        // Prevents race condition: two concurrent redemptions both see sufficient balance
        await db.beginTransaction();
        try {
            // Atomic deduction with balance guard in WHERE clause
            var deductResult = await db.run(
                "UPDATE loyalty_points SET current_balance = current_balance - ?, lifetime_redeemed = lifetime_redeemed + ?, updated_at = datetime('now') WHERE user_id = ? AND current_balance >= ?",
                [pointsCost, pointsCost, userId, pointsCost]
            );

            if (!deductResult || deductResult.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient loyalty points' });
            }

            await db.run(
                'INSERT INTO loyalty_redemptions (user_id, reward_id, points_spent) VALUES (?, ?, ?)',
                [userId, rewardId, pointsCost]
            );

            await db.run(
                'INSERT INTO loyalty_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                [userId, 'redeem', -pointsCost, 'Redeemed for: ' + reward.name]
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_rbErr) { console.warn('[LoyaltyStore] rollback error:', _rbErr.message); }
            throw txErr;
        }

        var updated = await db.get(
            'SELECT current_balance FROM loyalty_points WHERE user_id = ?',
            [userId]
        );

        res.json({
            success: true,
            rewardId: rewardId,
            reward: reward,
            pointsSpent: pointsCost,
            newBalance: updated ? updated.current_balance : 0
        });
    } catch(err) {
        console.warn('[LoyaltyStore] POST /redeem error:', err.message);
        var safeErrors = ['Invalid reward', 'Insufficient points', 'Reward unavailable'];
        var msg = safeErrors.includes(err.message) ? err.message : 'Redemption failed';
        res.status(400).json({ error: msg });
    }
});

// GET /api/loyalty/history — transaction history (last 50)
router.get('/history', authenticate, async (req, res) => {
    try {
        await _ensureLoyaltyTables();
        var userId = req.user.id;

        var transactions = await db.all(
            'SELECT id, type, amount, description, created_at FROM loyalty_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId]
        );

        res.json({ transactions: transactions || [] });
    } catch(err) {
        console.warn('[LoyaltyStore] GET /history error:', err.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

module.exports = router;
