'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap column for loss-streak offer cooldown tracking
db.run('ALTER TABLE users ADD COLUMN loss_streak_offer_last TEXT DEFAULT NULL').catch(function () {});

// ── Constants ──────────────────────────────────────────
const LOSS_STREAK_THRESHOLD = 8;     // 8 of last 10 spins must be losses
const RECENT_SPINS_WINDOW   = 10;    // check last 10 spins
const MATCH_PCT             = 0.50;  // 50% deposit match
const MAX_MATCH             = 25;    // $25 cap
const MIN_DEPOSIT           = 10;    // $10 minimum deposit
const COOLDOWN_HOURS        = 4;     // 4 hours between offers
const WAGERING_MULTIPLIER   = 15;    // 15x wagering requirement

/**
 * Check whether the user has had enough recent losses and is within
 * the cooldown window.
 * Returns { eligible, lossCount } or throws on DB error.
 */
async function checkEligibility(userId) {
    // Cooldown check — only show once per 4 hours
    var user = await db.get(
        'SELECT loss_streak_offer_last FROM users WHERE id = ?',
        [userId]
    );
    if (user && user.loss_streak_offer_last) {
        var lastOffer = new Date(user.loss_streak_offer_last).getTime();
        var now = Date.now();
        if (now - lastOffer < COOLDOWN_HOURS * 60 * 60 * 1000) {
            return { eligible: false, lossCount: 0 };
        }
    }

    // SECURITY: Max 2 loss streak claims per 24 hours to prevent abuse
    var MAX_CLAIMS_PER_DAY = 2;
    var claimsToday = await db.get(
        "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND type = 'bonus' AND description LIKE 'Loss Streak%' AND created_at >= datetime('now', '-1 day')",
        [userId]
    );
    if (claimsToday && claimsToday.cnt >= MAX_CLAIMS_PER_DAY) {
        return { eligible: false, lossCount: 0 };
    }

    // Query last 10 spins
    var recentSpins = await db.all(
        'SELECT win_amount FROM spins WHERE user_id = ? ORDER BY id DESC LIMIT ?',
        [userId, RECENT_SPINS_WINDOW]
    );

    if (recentSpins.length < RECENT_SPINS_WINDOW) {
        return { eligible: false, lossCount: 0 };
    }

    var lossCount = 0;
    for (var i = 0; i < recentSpins.length; i++) {
        if (parseFloat(recentSpins[i].win_amount) === 0) {
            lossCount++;
        }
    }

    return {
        eligible: lossCount >= LOSS_STREAK_THRESHOLD,
        lossCount: lossCount
    };
}

// GET /api/user/loss-streak-offer
router.get('/loss-streak-offer', authenticate, async function (req, res) {
    try {
        var result = await checkEligibility(req.user.id);

        if (!result.eligible) {
            return res.json({ eligible: false });
        }

        return res.json({
            eligible: true,
            offer: {
                matchPct: Math.round(MATCH_PCT * 100),
                maxMatch: MAX_MATCH,
                minDeposit: MIN_DEPOSIT
            }
        });
    } catch (err) {
        console.warn('[LossStreak] Offer check error:', err.message);
        return res.status(500).json({ error: 'Failed to check loss streak offer' });
    }
});

// POST /api/user/claim-loss-offer
router.post('/claim-loss-offer', authenticate, bonusGuard, async function (req, res) {
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
            console.error('[LossStreak] Self-exclusion check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed. Please try again.' });
        }

        var depositAmount = parseFloat(req.body.depositAmount);
        if (!Number.isFinite(depositAmount) || depositAmount < MIN_DEPOSIT) {
            return res.status(400).json({
                error: 'Minimum deposit is $' + MIN_DEPOSIT
            });
        }

        // Re-verify eligibility
        var result = await checkEligibility(req.user.id);
        if (!result.eligible) {
            return res.status(400).json({ error: 'Not eligible for loss streak offer' });
        }

        // Calculate bonus
        var bonusAmount = Math.min(depositAmount * MATCH_PCT, MAX_MATCH);
        bonusAmount = Math.round(bonusAmount * 100) / 100;

        // ROUND 53: Cap to remaining daily bonus limit
        if (bonusAmount > 0 && req.bonusCapRemaining !== undefined && bonusAmount > req.bonusCapRemaining) {
            bonusAmount = Math.max(0, Math.floor(req.bonusCapRemaining * 100) / 100);
            if (bonusAmount <= 0) {
                return res.status(400).json({ error: 'Daily bonus limit reached' });
            }
        }

        var wageringRequired = Math.round(bonusAmount * WAGERING_MULTIPLIER * 100) / 100;

        // Credit bonus_balance and update wagering requirement
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, loss_streak_offer_last = datetime(\'now\') WHERE id = ?',
            [bonusAmount, wageringRequired, req.user.id]
        );

        // Record transaction
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
            [req.user.id, bonusAmount, 'Loss Streak Deposit Match ' + Math.round(MATCH_PCT * 100) + '% — $' + bonusAmount.toFixed(2)]
        );

        var updated = await db.get(
            'SELECT balance, bonus_balance FROM users WHERE id = ?',
            [req.user.id]
        );

        return res.json({
            success: true,
            bonusAmount: bonusAmount,
            wageringRequired: wageringRequired,
            balance: updated ? updated.balance : 0,
            bonusBalance: updated ? updated.bonus_balance : 0
        });
    } catch (err) {
        console.warn('[LossStreak] Claim error:', err.message);
        return res.status(500).json({ error: 'Failed to claim loss streak offer' });
    }
});

module.exports = router;
