'use strict';

/**
 * XP Shop — server-side validation for XP-to-reward purchases.
 *
 * Replaces the former client-side-only balance grants which were a security
 * exploit (anyone could manipulate localStorage to claim $500/$2000 for free).
 *
 * POST /api/xpshop/purchase  — validate XP, deduct, credit reward, log transaction
 * GET  /api/xpshop/xp        — return authenticated user's current server-side XP
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap: add xp column to users table if it doesn't exist yet.
// Uses the same fire-and-forget ALTER TABLE pattern as other routes (e.g. loyaltyshop).
db.run('ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[xpshop] ALTER failed:', e.message || e); });

// XP Shop catalogue — must mirror the client-side XP_SHOP_ITEMS array in js/ui-modals.js.
// type: 'balance' rewards are the only ones that require server enforcement;
//       'freespins' and 'xpboost' are cosmetic/gameplay only and are allowed
//       to fall back to client-side logic when the server is unreachable.
const XP_SHOP_ITEMS = {
    freespins5:  { cost: 100,  type: 'freespins', amount: 5 },
    balance5:    { cost: 250,  type: 'balance',   amount: 5 },
    xpboost50:   { cost: 500,  type: 'xpboost',   amount: 50 },
    balance20:   { cost: 1000, type: 'balance',   amount: 20 },
};

// POST /api/xpshop/purchase
// Body: { itemId: string }
// Validates that the authenticated user has enough XP, deducts it, grants the
// reward, and (for balance items) records an auditable transaction row.
router.post('/purchase', authenticate, bonusGuard, async function (req, res) {
    try {
        const { itemId } = req.body;
        if (!itemId || typeof itemId !== 'string') {
            return res.status(400).json({ error: 'itemId is required' });
        }

        const item = XP_SHOP_ITEMS[itemId];
        if (!item) {
            return res.status(400).json({ error: 'Unknown item: ' + itemId });
        }

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

        const user = await db.get(
            'SELECT xp, balance FROM users WHERE id = ?',
            [userId]
        );
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userXp = parseInt(user.xp, 10) || 0;
        if (userXp < item.cost) {
            return res.status(400).json({
                error: 'Insufficient XP. Need ' + item.cost + ', have ' + userXp,
                currentXp: userXp,
            });
        }

        // Wrap entire purchase in transaction — XP deduction + reward grant + audit log atomic
        await db.beginTransaction();
        try {
            // Atomic XP deduction with WHERE guard (prevents going negative)
            var deductResult = await db.run(
                'UPDATE users SET xp = xp - ? WHERE id = ? AND xp >= ?',
                [item.cost, userId, item.cost]
            );
            if (!deductResult || deductResult.changes === 0) {
                await db.rollback().catch(function(rbErr) { console.warn('[XPShop] Rollback failed:', rbErr.message); });
                return res.status(400).json({ error: 'Insufficient XP (race condition prevented)' });
            }

            let granted = {};

            if (item.type === 'balance') {
                // Credit to bonus_balance with 15x wagering (revenue protection)
                await db.run(
                    'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                    [item.amount, item.amount * 15, userId]
                );
                var postUpdate = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [userId]);
                var balAfter = postUpdate ? Number(postUpdate.balance) + Number(postUpdate.bonus_balance || 0) : 0;
                var balBefore = Math.round((balAfter - item.amount) * 100) / 100;
                await db.run(
                    "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description) VALUES (?, 'xpshop', ?, ?, ?, ?)",
                    [userId, item.amount, balBefore, balAfter, 'XP Shop: ' + itemId + ' (cost ' + item.cost + ' XP, bonus, 15x wagering)']
                );
                granted = { type: 'balance', amount: item.amount };
            } else if (item.type === 'freespins') {
                granted = { type: 'freespins', amount: item.amount };
            } else if (item.type === 'xpboost') {
                granted = { type: 'xpboost', amount: item.amount };
            }

            await db.commit();
        } catch (txErr) {
            await db.rollback().catch(function(rbErr) { console.warn('[XPShop] Rollback failed:', rbErr.message); });
            throw txErr;
        }

        const updatedUser = await db.get('SELECT xp FROM users WHERE id = ?', [userId]);
        const newXp = parseInt((updatedUser && updatedUser.xp) || 0, 10);
        const newBalance = postUpdate ? parseFloat(postUpdate.balance) : (parseFloat(user.balance) || 0);

        return res.json({
            success: true,
            newXp,
            newBalance,
            granted,
        });
    } catch (err) {
        console.warn('[XPShop] purchase error:', err.message);
        return res.status(500).json({ error: 'Purchase failed' });
    }
});

// GET /api/xpshop/xp
// Returns the authenticated user's current server-side XP balance.
// Used by the client to sync localStorage XP with the authoritative server value.
router.get('/xp', authenticate, async function (req, res) {
    try {
        const user = await db.get('SELECT xp FROM users WHERE id = ?', [req.user.id]);
        return res.json({ xp: parseInt((user && user.xp) || 0, 10) });
    } catch (err) {
        console.warn('[XPShop] GET /xp error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch XP' });
    }
});

// POST /api/xpshop/sync-xp
// Allows the client to push its locally-earned XP to the server so the two
// stay in sync. XP earned client-side (per spin, big win, etc.) is forwarded
// here. The server only accepts increases — it never decrements XP via this
// endpoint (purchases use /purchase instead).
router.post('/sync-xp', authenticate, async function (req, res) {
    try {
        const { xp } = req.body;
        const clientXp = parseInt(xp, 10);
        if (isNaN(clientXp) || clientXp < 0) {
            return res.status(400).json({ error: 'xp must be a non-negative integer' });
        }

        const userId = req.user.id;
        const user = await db.get('SELECT xp FROM users WHERE id = ?', [userId]);
        const serverXp = parseInt((user && user.xp) || 0, 10);

        // Rate-limit XP sync: max 50 XP gain per sync call to prevent client-side manipulation.
        // Legitimate play earns ~5-15 XP per spin, so 50 per call is generous.
        const MAX_XP_GAIN_PER_SYNC = 50;
        if (clientXp > serverXp) {
            const gain = clientXp - serverXp;
            const cappedXp = serverXp + Math.min(gain, MAX_XP_GAIN_PER_SYNC);
            const actualGain = Math.min(gain, MAX_XP_GAIN_PER_SYNC);
            await db.run(
                'UPDATE users SET xp = xp + ? WHERE id = ?',
                [actualGain, userId]
            );
            return res.json({ xp: serverXp + actualGain });
        }

        return res.json({ xp: serverXp });
    } catch (err) {
        console.warn('[XPShop] sync-xp error:', err.message);
        return res.status(500).json({ error: 'Failed to sync XP' });
    }
});

module.exports = router;
