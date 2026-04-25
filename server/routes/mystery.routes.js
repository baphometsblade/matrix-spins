const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap: add mystery_next_drop column if it doesn't exist
db.run('ALTER TABLE users ADD COLUMN mystery_next_drop INTEGER DEFAULT 0').catch(function() {});

// Helper: random integer between min and max inclusive
function randInt(min, max) { return secureInt((max - min + 1)) + min; }

// Helper: pick random reward
function pickReward() {
    var roll = secureFloat();
    if (roll < 0.40) return { type: 'gems', amount: randInt(50, 500) };
    if (roll < 0.70) return { type: 'credits', amount: randInt(1, 10) };
    if (roll < 0.90) return { type: 'wheel_spins', amount: randInt(3, 10) };
    return { type: 'promo', code: 'MYSTERY' + randInt(1000, 9999) };
}

// GET /api/mystery — status check (auth required)
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

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
router.post('/claim', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const spinRow = await db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]);
        const totalSpins = spinRow ? (spinRow.cnt || 0) : 0;

        const userRow = await db.get('SELECT mystery_next_drop FROM users WHERE id = ?', [userId]);
        const nextDrop = userRow ? (userRow.mystery_next_drop || 0) : 0;

        if (totalSpins < nextDrop) {
            return res.status(400).json({ error: 'Drop not ready yet' });
        }

        const reward = pickReward();

        if (reward.type === 'credits') {
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [reward.amount, userId]);
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                [userId, 'mystery_drop', reward.amount, 'Mystery Drop: ' + reward.amount + ' credits']
            );
        } else if (reward.type === 'gems') {
            try {
                await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [reward.amount, userId]);
            } catch (e) {}
            try {
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                    [userId, 'mystery_drop_gems', 0, 'Mystery Drop: ' + reward.amount + ' gems']
                );
            } catch (e) {}
        } else if (reward.type === 'wheel_spins') {
            try {
                await db.run('UPDATE users SET bonus_wheel_spins = COALESCE(bonus_wheel_spins, 0) + ? WHERE id = ?', [reward.amount, userId]);
            } catch (e) {}
        } else if (reward.type === 'promo') {
            try {
                await db.run(
                    "INSERT INTO campaigns (name, type, bonus_pct, max_bonus, wagering_mult, min_deposit, end_at, promo_code) VALUES (?, 'promo_code', 0, 0, 1, 0, datetime('now', '+7 days'), ?)",
                    ['Mystery Drop Promo', reward.code]
                );
            } catch (e) {}
        }

        const newNextDrop = totalSpins + randInt(50, 250);
        await db.run('UPDATE users SET mystery_next_drop = ? WHERE id = ?', [newNextDrop, userId]);

        const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        const newBalance = updatedUser ? (updatedUser.balance || 0) : 0;

        res.json({ success: true, reward, newBalance });
    } catch (err) {
        res.status(500).json({ error: 'Failed to claim mystery drop' });
    }
});

module.exports = router;
