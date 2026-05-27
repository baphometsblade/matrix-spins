'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap: add mystery_next_drop column if it doesn't exist
db.run('ALTER TABLE users ADD COLUMN mystery_next_drop INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[mystery] ALTER failed:', e.message || e); });

// Helper: random integer between min and max inclusive
function randInt(min, max) { return Math.floor((crypto.randomBytes(4).readUInt32BE(0) / 0x100000000) * (max - min + 1)) + min; }

// Helper: pick random reward
function pickReward() {
    var roll = (crypto.randomBytes(4).readUInt32BE(0) / 0x100000000);
    if (roll < 0.40) return { type: 'gems', amount: randInt(50, 500) };
    if (roll < 0.70) return { type: 'credits', amount: randInt(1, 10) };
    if (roll < 0.90) return { type: 'wheel_spins', amount: randInt(3, 10) };
    return { type: 'promo', code: 'MYSTERY' + randInt(1000, 9999) };
}

// GET /api/mystery — status check (auth required)
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


        const spinRow = await db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]);
        const totalSpins = spinRow ? (spinRow.cnt || 0) : 0;

        const userRow = await db.get('SELECT mystery_next_drop FROM users WHERE id = ?', [userId]);
        let nextDrop = userRow ? (userRow.mystery_next_drop || 0) : 0;

        if (!nextDrop || nextDrop === 0) {
            nextDrop = totalSpins + randInt(50, 250);
            await db.run('UPDATE users SET mystery_next_drop = ? WHERE id = ?', [nextDrop, userId]);
        }

        const spinsUntilDrop = Math.max(0, nextDrop - totalSpins);

        res.json({ pending: totalSpins >= nextDrop, spinsUntilDrop, totalSpins, nextDrop });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch mystery status' });
    }
});

// POST /api/mystery/claim — claim reward (auth required)
// Uses atomic UPDATE to prevent race condition double-claim
var { bonusGuard } = require('../middleware/bonus-guard');
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
    try {
        const userId = req.user.id;

        // Self-exclusion check (regulatory compliance)
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

        const spinRow = await db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]);
        const totalSpins = spinRow ? (spinRow.cnt || 0) : 0;

        const userRow = await db.get('SELECT mystery_next_drop FROM users WHERE id = ?', [userId]);
        const nextDrop = userRow ? (userRow.mystery_next_drop || 0) : 0;

        if (totalSpins < nextDrop) {
            return res.status(400).json({ error: 'Drop not ready yet' });
        }

        // Atomic: set next drop target FIRST with WHERE guard to prevent double-claim
        // Only succeeds if mystery_next_drop still matches what we read (no concurrent claim)
        const newNextDrop = totalSpins + randInt(50, 250);
        const claimResult = await db.run(
            'UPDATE users SET mystery_next_drop = ? WHERE id = ? AND mystery_next_drop = ?',
            [newNextDrop, userId, nextDrop]
        );
        if (claimResult.changes === 0) {
            return res.status(400).json({ error: 'Drop already claimed or not ready' });
        }

        const reward = pickReward();

        // Grant reward atomically
        await db.beginTransaction();
        try {
            if (reward.type === 'credits') {
                var bonusCapSvc = require('../services/bonus-cap.service');
                reward.amount = await bonusCapSvc.capBonusAmount(userId, reward.amount);
                if (reward.amount <= 0) {
                    await db.rollback().catch(function(rbErr) { console.warn('[Mystery] Rollback failed:', rbErr.message); });
                    return res.json({ success: true, reward: { type: 'gems', amount: 50 }, note: 'Daily bonus cap reached — awarded gems instead' });
                }
                await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [reward.amount, reward.amount * 15, userId]);
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
                    [userId, 'mystery_drop', reward.amount, userId, userId, 'Mystery Drop: ' + reward.amount + ' bonus credits (15x wagering)']
                );
            } else if (reward.type === 'gems') {
                await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [reward.amount, userId]);
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
                    [userId, 'mystery_drop_gems', 0, userId, userId, 'Mystery Drop: ' + reward.amount + ' gems']
                );
            } else if (reward.type === 'wheel_spins') {
                await db.run('UPDATE users SET bonus_wheel_spins = COALESCE(bonus_wheel_spins, 0) + ? WHERE id = ?', [reward.amount, userId]);
            } else if (reward.type === 'promo') {
                await db.run(
                    "INSERT INTO campaigns (name, type, bonus_pct, max_bonus, wagering_mult, min_deposit, end_at, promo_code) VALUES (?, 'promo_code', 0, 0, 1, 0, datetime('now', '+7 days'), ?)",
                    ['Mystery Drop Promo', reward.code]
                );
            }
            await db.commit();
        } catch (txErr) {
            await db.rollback().catch(function(rbErr) { console.warn('[MysteryDrop] Rollback failed:', rbErr.message); });
            console.warn('[MysteryDrop] Reward grant failed:', txErr.message);
        }

        const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        const newBalance = updatedUser ? (updatedUser.balance || 0) : 0;

        res.json({ success: true, reward, newBalance });
    } catch (err) {
        res.status(500).json({ error: 'Failed to claim mystery drop' });
    }
});

module.exports = router;
