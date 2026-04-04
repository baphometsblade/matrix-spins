'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap: add subscription columns (silently ignore if already exist)
db.run("ALTER TABLE users ADD COLUMN subscription_active INTEGER DEFAULT 0").catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
db.run("ALTER TABLE users ADD COLUMN subscription_tier TEXT").catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
db.run("ALTER TABLE users ADD COLUMN subscription_expires TEXT").catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
db.run("ALTER TABLE users ADD COLUMN subscription_daily_claimed TEXT").catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });

var PASS_CONFIG = {
    basic: {
        name: 'Casino Pass Basic',
        price: 9.99,
        gemsPerDay: 100,
        depositBonus: 0.05,
        description: '100 gems/day + 5% deposit bonus'
    },
    premium: {
        name: 'Casino Pass Premium',
        price: 24.99,
        gemsPerDay: 300,
        depositBonus: 0.10,
        description: '300 gems/day + 10% deposit bonus + Silver VIP fast-track'
    }
};

function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
}

// GET /api/subscription/status — auth required
router.get('/status', authenticate, async (req, res) => {
    try {
        var user = await db.get(
            'SELECT subscription_active, subscription_tier, subscription_expires, subscription_daily_claimed FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user) {
            return res.json({ active: false, tier: null, expiresAt: null, config: null, dailyClaimedToday: false, todayDate: getTodayDate() });
        }

        var active = user.subscription_active === 1;
        var tier = user.subscription_tier || null;
        var expiresAt = user.subscription_expires || null;
        var today = getTodayDate();

        // Check if subscription is expired
        if (active && expiresAt) {
            var expDate = new Date(expiresAt);
            if (expDate < new Date()) {
                active = false;
                // Mark inactive in DB (fire and forget)
                db.run('UPDATE users SET subscription_active = 0 WHERE id = ?', [req.user.id]).catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
            }
        }

        var dailyClaimedToday = !!(user.subscription_daily_claimed && user.subscription_daily_claimed === today);
        var config = (active && tier && PASS_CONFIG[tier]) ? PASS_CONFIG[tier] : null;

        res.json({
            active: active,
            tier: active ? tier : null,
            expiresAt: expiresAt,
            config: config,
            dailyClaimedToday: dailyClaimedToday,
            todayDate: today
        });
    } catch (err) {
        // Handle gracefully if columns don't exist yet
        res.json({ active: false, tier: null, expiresAt: null, config: null, dailyClaimedToday: false, todayDate: getTodayDate() });
    }
});

// POST /api/subscription/activate — auth required
router.post('/activate', authenticate, async (req, res) => {
    try {
        // ROUND 34: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Purchases are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }

        var tier = req.body.tier;
        if (!tier || !PASS_CONFIG[tier]) {
            return res.status(400).json({ error: 'Invalid tier. Must be "basic" or "premium".' });
        }

        var passConf = PASS_CONFIG[tier];
        var price = passConf.price;

        var user = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.balance < price) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // ROUND 54: Atomic debit with WHERE guard prevents race-condition overdraft
        // ROUND 42: Wrapped in transaction so subscription activation failure rolls back the debit
        await db.beginTransaction();
        try {
            var debitResult = await db.run('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?', [price, req.user.id, price]);
            if (!debitResult || debitResult.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient balance (concurrent transaction)' });
            }

            // Set subscription
            await db.run(
                "UPDATE users SET subscription_active = 1, subscription_tier = ?, subscription_expires = datetime('now', '+30 days') WHERE id = ?",
                [tier, req.user.id]
            );

            // Insert transaction record
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'subscription', ?, ?)",
                [req.user.id, -price, 'Casino Pass ' + tier + ' (30 days)']
            );

            await db.commit();
        } catch (txErr) {
            await db.rollback().catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
            console.error('[Subscription] Transaction failed:', txErr.message);
            return res.status(500).json({ error: 'Subscription purchase failed. Balance not charged.' });
        }

        // Fetch updated data
        var updated = await db.get('SELECT balance, subscription_expires FROM users WHERE id = ?', [req.user.id]);

        res.json({
            success: true,
            tier: tier,
            expiresAt: updated.subscription_expires,
            newBalance: updated.balance
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to activate subscription' });
    }
});

// POST /api/subscription/claim-daily — auth required
router.post('/claim-daily', authenticate, async (req, res) => {
    try {
        var user = await db.get(
            'SELECT subscription_active, subscription_tier, subscription_expires, subscription_daily_claimed FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user || user.subscription_active !== 1) {
            return res.status(400).json({ error: 'No active subscription' });
        }

        // Check expiry
        if (user.subscription_expires) {
            var expDate = new Date(user.subscription_expires);
            if (expDate < new Date()) {
                await db.run('UPDATE users SET subscription_active = 0 WHERE id = ?', [req.user.id]).catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });
                return res.status(400).json({ error: 'Subscription has expired' });
            }
        }

        var today = getTodayDate();
        if (user.subscription_daily_claimed === today) {
            return res.status(400).json({ error: 'Daily gems already claimed today' });
        }

        var tier = user.subscription_tier;
        var passConf = PASS_CONFIG[tier];
        if (!passConf) {
            return res.status(400).json({ error: 'Invalid subscription tier' });
        }

        var gemsPerDay = passConf.gemsPerDay;

        // Try to award gems via gems column
        try {
            await db.run(
                'UPDATE users SET gems = COALESCE(gems, 0) + ?, subscription_daily_claimed = ? WHERE id = ?',
                [gemsPerDay, today, req.user.id]
            );
        } catch (gemsErr) {
            // gems column may not exist — just update the claim date and record a transaction
            await db.run(
                'UPDATE users SET subscription_daily_claimed = ? WHERE id = ?',
                [today, req.user.id]
            );
        }

        // Always record a transaction for audit trail
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'subscription_daily', ?, ?)",
            [req.user.id, gemsPerDay, 'Daily gems — Casino Pass ' + tier + ' (' + today + ')']
        ).catch(function(e) { console.warn('[Subscription] fire-and-forget error:', e.message); });

        res.json({
            success: true,
            gemsAwarded: gemsPerDay,
            tier: tier
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to claim daily gems' });
    }
});

module.exports = router;
