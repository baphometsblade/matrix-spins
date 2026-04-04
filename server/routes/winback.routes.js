'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const winbackService = require('../services/winback.service');
const db = require('../database');

// ── Return-status tier config ──────────────────────────────────────────────
// Maps absence duration (days) to offer tier details.
// Tiers are evaluated in descending order (longest absence first).
var RETURN_TIERS = [
    { minDays: 14, tier: 'platinum', bonusPercent: 100, freeSpins: 20,
      message: "We really missed you! Here's our best exclusive offer just for you" },
    { minDays: 7,  tier: 'gold',     bonusPercent: 75,  freeSpins: 10,
      message: "We missed you! Here's an exclusive offer just for you" },
    { minDays: 3,  tier: 'silver',   bonusPercent: 50,  freeSpins: 5,
      message: "Good to see you back! We have a special offer waiting for you" },
    { minDays: 1,  tier: 'bronze',   bonusPercent: 25,  freeSpins: 0,
      message: "Welcome back! Here's a little something for returning today" },
];

// Minimum days away before we consider it a "return" worth showing the overlay
var RETURN_THRESHOLD_DAYS = 3;

// POST /api/admin/run-winback — manually trigger a win-back cycle (admin only)
router.post('/admin/run-winback', authenticate, requireAdmin, async function (req, res) {
    try {
        const result = await winbackService.runWinBackCycle();
        res.json({
            success: true,
            processed: result.processed,
            totalBonused: result.totalBonused,
        });
    } catch (err) {
        console.warn('[WinBack] Run cycle error:', err.message);
        res.status(500).json({ error: 'Failed to run win-back cycle' });
    }
});

// GET /api/user/winback-status — check if current user has an active win-back bonus
router.get('/user/winback-status', authenticate, async function (req, res) {
    try {
        const user = await db.get(
            'SELECT bonus_balance, wagering_requirement FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const recentWinback = await db.get(
            `SELECT amount, created_at FROM transactions
             WHERE user_id = ? AND type = 'winback_bonus'
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.id]
        );

        const hasActiveWinback = user.bonus_balance > 0 && recentWinback != null;

        res.json({
            hasActiveWinback,
            bonusBalance: user.bonus_balance,
            wageringRequirement: user.wagering_requirement,
            lastWinbackBonus: recentWinback ? {
                amount: recentWinback.amount,
                grantedAt: recentWinback.created_at,
            } : null,
        });
    } catch (err) {
        console.warn('[WinBack] Status check error:', err.message);
        res.status(500).json({ error: 'Failed to check win-back status' });
    }
});

// GET /api/user/return-status — personalized welcome-back offer for returning players
// Returns isReturn:true only when the user has been absent for RETURN_THRESHOLD_DAYS+.
// The daysAway calculation uses the most recent of:
//   1. Most recent spin created_at (most reliable signal of active play)
//   2. Most recent transaction created_at (deposit/withdrawal activity)
//   3. updated_at column on the users row (set by profile edits / auth flows)
//   4. created_at (account creation — fallback when user has never done anything)
router.get('/user/return-status', authenticate, async function (req, res) {
    try {
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


        // Fetch the timestamp of the most recent spin
        var lastSpinRow = await db.get(
            'SELECT created_at FROM spins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        // Fetch the most recent non-return-offer transaction
        var lastTxRow = await db.get(
            "SELECT created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            [userId]
        );

        // Fetch user metadata columns
        var userRow = await db.get(
            'SELECT created_at, updated_at FROM users WHERE id = ?',
            [userId]
        );

        if (!userRow) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Pick the most recent activity timestamp across all sources
        var candidates = [];
        if (lastSpinRow && lastSpinRow.created_at) candidates.push(new Date(lastSpinRow.created_at).getTime());
        if (lastTxRow   && lastTxRow.created_at)   candidates.push(new Date(lastTxRow.created_at).getTime());
        if (userRow.updated_at)                     candidates.push(new Date(userRow.updated_at).getTime());
        if (userRow.created_at)                     candidates.push(new Date(userRow.created_at).getTime());

        // Filter out NaN values that result from unparseable timestamps
        candidates = candidates.filter(function (ts) { return !isNaN(ts); });

        var lastActiveMs = candidates.length > 0 ? Math.max.apply(null, candidates) : Date.now();
        var nowMs = Date.now();
        var daysAway = Math.floor((nowMs - lastActiveMs) / (1000 * 60 * 60 * 24));

        if (daysAway < RETURN_THRESHOLD_DAYS) {
            return res.json({ isReturn: false, daysAway: daysAway });
        }

        // Determine tier
        var matchedTier = null;
        for (var i = 0; i < RETURN_TIERS.length; i++) {
            if (daysAway >= RETURN_TIERS[i].minDays) {
                matchedTier = RETURN_TIERS[i];
                break;
            }
        }

        if (!matchedTier) {
            // Should not happen given RETURN_THRESHOLD_DAYS >= 3, but guard anyway
            return res.json({ isReturn: false, daysAway: daysAway });
        }

        return res.json({
            isReturn: true,
            daysAway: daysAway,
            offerTier: matchedTier.tier,
            bonusPercent: matchedTier.bonusPercent,
            freeSpins: matchedTier.freeSpins,
            message: matchedTier.message,
        });
    } catch (err) {
        console.warn('[ReturnStatus] Error:', err.message);
        return res.status(500).json({ error: 'Failed to check return status' });
    }
});

module.exports = router;
