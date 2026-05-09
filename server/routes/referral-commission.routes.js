'use strict';

/**
 * Referral Commission Routes — Revenue-share earnings for referrers.
 *
 * Endpoints:
 *   GET  /api/referral-commission/stats        — pending/paid totals + tier rates
 *   GET  /api/referral-commission/breakdown    — per-referee earnings table
 *   GET  /api/referral-commission/leaderboard  — top earners (public)
 *   POST /api/referral-commission/claim        — credit pending to bonus_balance
 *   GET  /api/referral-commission/history      — recent commission rows
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const commissionService = require('../services/referral-commission.service');

router.get('/stats', authenticate, async (req, res) => {
    try {
        const stats = await commissionService.getCommissionStats(req.user.id);
        res.json(stats);
    } catch (err) {
        console.warn('[RefCommission] /stats error:', err.message);
        res.status(500).json({ error: 'Failed to load commission stats' });
    }
});

router.get('/breakdown', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const rows = await commissionService.getPerRefereeBreakdown(req.user.id, limit);
        res.json({ referees: rows });
    } catch (err) {
        console.warn('[RefCommission] /breakdown error:', err.message);
        res.status(500).json({ error: 'Failed to load breakdown' });
    }
});

router.get('/history', authenticate, async (req, res) => {
    try {
        await commissionService.ensureSchema();
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const rows = await db.all(`
            SELECT
                rc.id, rc.tier, rc.bet_amount, rc.win_amount, rc.net_loss,
                rc.rate, rc.commission, rc.status, rc.created_at, rc.paid_at,
                u.username as referee_username
            FROM referral_commissions rc
            LEFT JOIN users u ON u.id = rc.referee_id
            WHERE rc.referrer_id = ?
            ORDER BY rc.created_at DESC
            LIMIT ? OFFSET ?
        `, [req.user.id, limit, offset]);

        res.json({
            history: rows.map(r => ({
                id: r.id,
                tier: r.tier,
                refereeUsername: r.referee_username || 'Unknown',
                betAmount: Number(r.bet_amount).toFixed(2),
                winAmount: Number(r.win_amount).toFixed(2),
                netLoss: Number(r.net_loss).toFixed(2),
                rate: r.rate,
                commission: Number(r.commission).toFixed(2),
                status: r.status,
                createdAt: r.created_at,
                paidAt: r.paid_at
            }))
        });
    } catch (err) {
        console.warn('[RefCommission] /history error:', err.message);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

router.get('/leaderboard', async (req, res) => {
    try {
        await commissionService.ensureSchema();
        const rows = await db.all(`
            SELECT
                u.id, u.username,
                COALESCE(SUM(rc.commission), 0) as total_earned,
                COUNT(DISTINCT rc.referee_id) as active_referees
            FROM referral_commissions rc
            JOIN users u ON u.id = rc.referrer_id
            GROUP BY u.id, u.username
            ORDER BY total_earned DESC
            LIMIT 10
        `);

        res.json({
            leaderboard: rows.map((r, idx) => ({
                rank: idx + 1,
                username: r.username,
                totalEarned: Number((r.total_earned || 0).toFixed(2)),
                activeReferees: Number(r.active_referees || 0)
            }))
        });
    } catch (err) {
        console.warn('[RefCommission] /leaderboard error:', err.message);
        res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

router.post('/claim', authenticate, async (req, res) => {
    try {
        const result = await commissionService.claimPendingCommissions(req.user.id);
        res.json({
            success: true,
            credited: result.credited,
            wageringRequirement: result.wageringRequirement,
            message: 'Credited $' + result.credited.toFixed(2) + ' to bonus balance with ' +
                     result.wageringRequirement.toFixed(2) + 'x wagering requirement.'
        });
    } catch (err) {
        if (err.code === 'self_excluded') {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'below_min') {
            return res.status(400).json({ error: err.message });
        }
        console.warn('[RefCommission] /claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim commissions' });
    }
});

module.exports = router;
