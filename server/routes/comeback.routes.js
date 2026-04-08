'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');
const bonusCap = require('../services/bonus-cap.service');

// Bootstrap column for comeback bonus cooldown tracking
db.run('ALTER TABLE users ADD COLUMN comeback_bonus_last TEXT DEFAULT NULL').catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[comeback] ALTER failed:', e.message); });

// ── Constants ──────────────────────────────────────────
const COOLDOWN_HOURS        = 4;      // 4 hours between offers
const WAGERING_MULTIPLIER   = 10;     // 10x wagering requirement
// ROUND 42: Increased loss window from 2h to 12h. Previously: 2-hour window
// allowed manufacturing tiny losses then claiming $100 comeback every 4 hours.
const SESSION_WINDOW_HOURS  = 12;     // look at last 12 hours of play

const COMEBACK_TIERS = [
    { minLoss: 500, rate: 0.10, minBonus: 25,   maxBonus: 100, tier: 'gold'   },
    { minLoss: 200, rate: 0.08, minBonus: 10,   maxBonus: 50,  tier: 'silver' },
    { minLoss: 50,  rate: 0.05, minBonus: 2.50, maxBonus: 25,  tier: 'bronze' }
];

/**
 * Calculate the user's net session loss over the last SESSION_WINDOW_HOURS
 * and determine if they qualify for a comeback bonus.
 * Returns { eligible, amount, tier, message, netLoss }
 */
async function checkEligibility(userId) {
    // Cooldown check — only offer once per COOLDOWN_HOURS
    var user = await db.get(
        'SELECT comeback_bonus_last FROM users WHERE id = ?',
        [userId]
    );
    if (user && user.comeback_bonus_last) {
        var lastOffer = new Date(user.comeback_bonus_last).getTime();
        var now = Date.now();
        if (now - lastOffer < COOLDOWN_HOURS * 60 * 60 * 1000) {
            return { eligible: false, amount: 0, tier: null, message: null, netLoss: 0 };
        }
    }

    // Sum net losses from spins in the last SESSION_WINDOW_HOURS
    var row = await db.get(
        "SELECT COALESCE(SUM(bet_amount - win_amount), 0) AS net_loss " +
        "FROM spins " +
        "WHERE user_id = ? " +
        "  AND win_amount < bet_amount " +
        "  AND created_at >= datetime('now', '-" + SESSION_WINDOW_HOURS + " hours')",
        [userId]
    );
    var netLoss = parseFloat(row.net_loss) || 0;

    // Check against tiers (ordered highest first)
    for (var i = 0; i < COMEBACK_TIERS.length; i++) {
        var t = COMEBACK_TIERS[i];
        if (netLoss >= t.minLoss) {
            var rawAmount = netLoss * t.rate;
            var amount = Math.max(t.minBonus, Math.min(rawAmount, t.maxBonus));
            amount = Math.round(amount * 100) / 100;
            return {
                eligible: true,
                amount: amount,
                tier: t.tier,
                message: 'Tough luck! Claim your $' + amount.toFixed(2) + ' Comeback Bonus',
                netLoss: Math.round(netLoss * 100) / 100
            };
        }
    }

    return { eligible: false, amount: 0, tier: null, message: null, netLoss: Math.round(netLoss * 100) / 100 };
}

// GET /api/user/comeback-bonus — checks if user qualifies
router.get('/comeback-bonus', authenticate, async function (req, res) {
    try {
        var result = await checkEligibility(req.user.id);

        if (!result.eligible) {
            return res.json({ eligible: false });
        }

        return res.json({
            eligible: true,
            amount: result.amount,
            tier: result.tier,
            message: result.message
        });
    } catch (err) {
        console.warn('[ComebackBonus] Check error:', err.message);
        return res.status(500).json({ error: 'Failed to check comeback bonus eligibility' });
    }
});

// POST /api/user/claim-comeback-bonus — claims the bonus
router.post('/claim-comeback-bonus', authenticate, bonusGuard, async function (req, res) {
    try {
        // SECURITY: Self-exclusion check — no bonuses for excluded users
        // ROUND 29: Fail CLOSED on DB error (was silently swallowing errors → bypass)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            console.error('[ComebackBonus] Self-exclusion check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed. Please try again.' });
        }

        // Re-validate eligibility (don't trust client)
        var result = await checkEligibility(req.user.id);
        if (!result.eligible) {
            return res.status(400).json({ error: 'Not eligible for comeback bonus' });
        }

        // ROUND 42: Prevent retention bonus stacking — user cannot claim comeback
        // if they already have an active winback/comeback/retention bonus
        try {
            var activeRetention = await db.get(
                "SELECT id FROM transactions WHERE user_id = ? AND type = 'bonus' AND (description LIKE 'Comeback%' OR description LIKE 'Winback%' OR description LIKE '%retention%') AND created_at >= datetime('now', '-7 days')",
                [req.user.id]
            );
            if (activeRetention) {
                return res.status(400).json({ error: 'You already have an active retention bonus. Only one retention bonus per week.' });
            }
        } catch (stackErr) {
            if (stackErr.message && stackErr.message.includes('no such table')) { /* OK */ }
            else { console.warn('[ComebackBonus] Stacking check error:', stackErr.message); }
        }

        // ROUND 37: Wrap daily limit check + credit in a transaction to prevent
        // race condition where two concurrent requests both pass the count check.
        await db.beginTransaction();
        try {
            var claimsToday = await db.get(
                "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND type = 'bonus' AND description LIKE 'Comeback Bonus%' AND created_at >= datetime('now', '-1 day')",
                [req.user.id]
            );
            if (claimsToday && claimsToday.cnt >= 2) {
                await db.rollback();
                return res.status(400).json({ error: 'Maximum 2 comeback bonuses per day' });
            }

            var bonusAmount = await bonusCap.capBonusAmount(req.user.id, result.amount);
            if (bonusAmount <= 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Daily bonus limit reached. Try again tomorrow.' });
            }
            var wageringRequired = Math.round(bonusAmount * WAGERING_MULTIPLIER * 100) / 100;

            // Credit bonus_balance (not real balance) and update wagering requirement + cooldown
            await db.run(
                "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, " +
                "wagering_requirement = COALESCE(wagering_requirement, 0) + ?, " +
                "comeback_bonus_last = datetime('now') WHERE id = ?",
                [bonusAmount, wageringRequired, req.user.id]
            );

            // Record transaction
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                [req.user.id, bonusAmount, 'Comeback Bonus (' + result.tier + ') — $' + bonusAmount.toFixed(2) + ' cashback on $' + result.netLoss.toFixed(2) + ' session losses']
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_rbErr) { console.warn('[Comeback] rollback error:', _rbErr.message); }
            throw txErr;
        }

        var updated = await db.get(
            'SELECT balance, bonus_balance FROM users WHERE id = ?',
            [req.user.id]
        );

        return res.json({
            success: true,
            bonusAmount: bonusAmount,
            wageringRequired: wageringRequired,
            tier: result.tier,
            balance: updated ? parseFloat(updated.balance) : 0,
            bonusBalance: updated ? parseFloat(updated.bonus_balance) : 0
        });
    } catch (err) {
        console.warn('[ComebackBonus] Claim error:', err.message);
        return res.status(500).json({ error: 'Failed to claim comeback bonus' });
    }
});

module.exports = router;
