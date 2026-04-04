'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

/**
 * Mask a username: show first 2 chars, then '***'
 * e.g. "johnsmith" -> "jo***"
 */
function maskUsername(username) {
    if (!username || username.length < 1) return '***';
    var prefix = username.length >= 2 ? username.slice(0, 2) : username.slice(0, 1);
    return prefix + '***';
}

// ---------------------------------------------------------------------------
// GET /api/gifts/inbox — pending gifts for current user
// ---------------------------------------------------------------------------
router.get('/inbox', authenticate, async (req, res) => {
    try {
        var rows = await db.all(
            'SELECT g.id, u.username as fromUsername, g.amount, g.message, g.created_at ' +
            'FROM gifts g JOIN users u ON g.from_user_id = u.id ' +
            'WHERE g.to_user_id = ? AND g.status = \'pending\' ' +
            'ORDER BY g.created_at DESC LIMIT 20',
            [req.user.id]
        );
        var gifts = rows.map(function (row) {
            return {
                id: row.id,
                fromUsername: maskUsername(row.fromUsername),
                amount: row.amount,
                message: row.message || '',
                createdAt: row.created_at
            };
        });
        res.json({ gifts: gifts });
    } catch (err) {
        console.warn('[Gifts] GET /inbox error:', err.message);
        res.status(500).json({ error: 'Failed to fetch inbox' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/gifts/sent — gifts sent by current user (last 20)
// ---------------------------------------------------------------------------
router.get('/sent', authenticate, async (req, res) => {
    try {
        var rows = await db.all(
            'SELECT g.id, u.username as toUsername, g.amount, g.message, g.status, g.created_at ' +
            'FROM gifts g JOIN users u ON g.to_user_id = u.id ' +
            'WHERE g.from_user_id = ? ' +
            'ORDER BY g.created_at DESC LIMIT 20',
            [req.user.id]
        );
        var gifts = rows.map(function (row) {
            return {
                id: row.id,
                toUsername: maskUsername(row.toUsername),
                amount: row.amount,
                message: row.message || '',
                status: row.status,
                createdAt: row.created_at
            };
        });
        res.json({ gifts: gifts });
    } catch (err) {
        console.warn('[Gifts] GET /sent error:', err.message);
        res.status(500).json({ error: 'Failed to fetch sent gifts' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/gifts/send — send a gift to another player
// ---------------------------------------------------------------------------
router.post('/send', authenticate, async (req, res) => {
    try {
        var toUsername = req.body.toUsername;
        var amount     = parseFloat(req.body.amount);
        var message    = typeof req.body.message === 'string'
            ? req.body.message.trim().slice(0, 100)
            : '';

        // --- Validation ---
        if (!toUsername || typeof toUsername !== 'string' || !toUsername.trim()) {
            return res.status(400).json({ error: 'Recipient username is required' });
        }
        toUsername = toUsername.trim();

        // Enforce server-side gifting limits (matching config.js GIFTING values)
        var GIFT_MIN = 10;
        var GIFT_MAX = 200;
        var GIFT_DAILY_LIMIT = 3;
        var GIFT_DAILY_MAX_TOTAL = 500;

        if (!Number.isFinite(amount) || amount < GIFT_MIN || amount > GIFT_MAX) {
            return res.status(400).json({ error: 'Amount must be between $' + GIFT_MIN + ' and $' + GIFT_MAX });
        }

        // --- Look up recipient ---
        var recipient = await db.get('SELECT id FROM users WHERE username = ?', [toUsername]);
        if (!recipient) {
            return res.status(404).json({ error: 'User not found' });
        }

        // --- Cannot gift yourself ---
        if (recipient.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot gift yourself' });
        }

        // ROUND 42: Anti-circular gifting — block gifts between accounts that have
        // exchanged gifts in the last 48 hours. Prevents A→B→A value laundering.
        try {
            var recentGiftBack = await db.get(
                "SELECT id FROM gifts WHERE from_user_id = ? AND to_user_id = ? AND created_at >= datetime('now', '-48 hours')",
                [recipient.id, req.user.id]
            );
            if (recentGiftBack) {
                return res.status(400).json({ error: 'Cannot exchange gifts with this user within 48 hours of receiving a gift from them' });
            }
        } catch (circErr) {
            if (circErr.message && circErr.message.includes('no such table')) { /* OK */ }
            else { console.warn('[Gifts] Circular check error:', circErr.message); }
        }

        // --- Enforce daily gifting limits ---
        var dailyGifts = await db.get(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total FROM gifts WHERE from_user_id = ? AND created_at >= datetime('now', '-24 hours')",
            [req.user.id]
        );
        if (dailyGifts && dailyGifts.cnt >= GIFT_DAILY_LIMIT) {
            return res.status(400).json({ error: 'Daily gift limit reached (' + GIFT_DAILY_LIMIT + ' gifts per day)' });
        }
        if (dailyGifts && (parseFloat(dailyGifts.total) || 0) + amount > GIFT_DAILY_MAX_TOTAL) {
            return res.status(400).json({ error: 'Daily gift total limit exceeded ($' + GIFT_DAILY_MAX_TOTAL + ' per day)' });
        }

        // ROUND 42: Atomic balance deduction with WHERE guard (prevents double-spend race)
        // Previously: SELECT balance then UPDATE — race condition allowed overspending.
        var deductResult = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [amount, req.user.id, amount]
        );
        if (!deductResult || deductResult.changes === 0) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        var sender = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        var balanceAfter = sender ? sender.balance : 0;
        var balanceBefore = balanceAfter + amount;

        // --- Insert gift record ---
        await db.run(
            'INSERT INTO gifts (from_user_id, to_user_id, amount, message) VALUES (?, ?, ?, ?)',
            [req.user.id, recipient.id, amount, message]
        );

        // --- Insert transaction record ---
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, 'gift_sent', -amount, balanceBefore, balanceAfter, 'Gift to ' + toUsername]
        );

        res.json({ ok: true, newBalance: balanceAfter });
    } catch (err) {
        console.warn('[Gifts] POST /send error:', err.message);
        res.status(500).json({ error: 'Failed to send gift' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/gifts/claim/:id — claim a pending gift
// ---------------------------------------------------------------------------
router.post('/claim/:id', authenticate, bonusGuard, async (req, res) => {
    try {
        // ROUND 34: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
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

        var giftId = parseInt(req.params.id, 10);
        if (isNaN(giftId)) {
            return res.status(400).json({ error: 'Invalid gift ID' });
        }

        // --- Fetch the gift (must be pending and addressed to this user) ---
        var gift = await db.get(
            'SELECT id, to_user_id, amount, status FROM gifts WHERE id = ? AND to_user_id = ? AND status = \'pending\'',
            [giftId, req.user.id]
        );
        if (!gift) {
            return res.status(404).json({ error: 'Gift not found or already claimed' });
        }

        // --- Mark gift as claimed ---
        await db.run(
            'UPDATE gifts SET status = \'claimed\', claimed_at = datetime(\'now\') WHERE id = ?',
            [giftId]
        );

        // --- Credit recipient bonus_balance with 15x wagering (prevents chip dumping/laundering) ---
        var recipient = await db.get('SELECT bonus_balance FROM users WHERE id = ?', [req.user.id]);
        var balanceBefore = recipient ? (recipient.bonus_balance || 0) : 0;
        var balanceAfter  = balanceBefore + gift.amount;

        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [gift.amount, gift.amount * 15, req.user.id]
        );

        // --- Insert transaction record ---
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, 'gift_claimed', gift.amount, balanceBefore, balanceAfter, 'Gift #' + giftId]
        );

        // --- Fetch confirmed new balance ---
        var updated = await db.get('SELECT bonus_balance FROM users WHERE id = ?', [req.user.id]);

        res.json({ ok: true, newBonusBalance: updated ? updated.bonus_balance : balanceAfter });
    } catch (err) {
        console.warn('[Gifts] POST /claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim gift' });
    }
});

module.exports = router;
