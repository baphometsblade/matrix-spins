'use strict';

/**
 * VIP / Loyalty API
 *
 * GET  /api/vip/tiers             — public tier ladder + benefits
 * GET  /api/vip/status            — current user's tier, XP, progress, cashback
 * POST /api/vip/cashback/claim    — claim available monthly cashback (bonus_balance, 10x WR)
 * GET  /api/vip/leaderboard       — top VIPs by lifetime XP
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const vipService = require('../services/vip.service');
const db = require('../database');

router.get('/tiers', function (req, res) {
    res.json({ tiers: vipService.getTiers() });
});

router.get('/status', authenticate, async function (req, res) {
    try {
        var status = await vipService.getStatus(req.user.id);
        if (!status) return res.status(404).json({ error: 'User not found' });
        res.json(status);
    } catch (err) {
        console.warn('[VIP] /status error:', err.message);
        res.status(500).json({ error: 'Failed to load VIP status' });
    }
});

router.post('/cashback/claim', authenticate, bonusGuard, async function (req, res) {
    try {
        var result = await vipService.claimCashback(req.user.id);
        if (!result.credited) {
            return res.status(400).json({ error: result.reason || 'Cashback not available' });
        }
        res.json({
            success: true,
            amount: result.amount,
            wagering: result.wagering,
            tier: result.tier,
            message: 'Cashback credited to bonus balance with 10x wagering requirement.'
        });
    } catch (err) {
        console.warn('[VIP] /cashback/claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim cashback' });
    }
});

router.get('/leaderboard', async function (req, res) {
    try {
        var rows = await db.all(
            'SELECT id, COALESCE(display_name, username) AS username, ' +
            "COALESCE(vip_tier, 'Bronze') AS vip_tier, " +
            'COALESCE(vip_xp_lifetime, 0) AS xp ' +
            'FROM users ' +
            'WHERE COALESCE(vip_xp_lifetime, 0) > 0 ' +
            'ORDER BY vip_xp_lifetime DESC ' +
            'LIMIT 50'
        );
        res.json({
            leaderboard: rows.map(function (r, i) {
                return { rank: i + 1, username: r.username, tier: r.vip_tier, xp: Number(r.xp) };
            })
        });
    } catch (err) {
        console.warn('[VIP] /leaderboard error:', err.message);
        res.json({ leaderboard: [] });
    }
});

module.exports = router;
