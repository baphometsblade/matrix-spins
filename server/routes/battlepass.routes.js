'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const battlepass = require('../services/battlepass.service');

// GET /api/battlepass — current season + player progress
router.get('/', authenticate, async (req, res) => {
    try {
        const progress = await battlepass.getProgress(req.user.id);
        if (!progress) return res.status(404).json({ error: 'No active season' });
        res.json(progress);
    } catch (err) {
        console.warn('[BattlePass] getProgress error:', err.message);
        res.status(500).json({ error: 'Failed to load battle pass' });
    }
});

// POST /api/battlepass/buy-premium — purchase premium track
router.post('/buy-premium', authenticate, async (req, res) => {
    try {
        const result = await battlepass.buyPremium(req.user.id);
        res.json(result);
    } catch (err) {
        console.warn('[BattlePass] buyPremium error:', err.message);
        var safeErrors = ['Insufficient balance', 'Already premium', 'No active season'];
        var msg = safeErrors.includes(err.message) ? err.message : 'Purchase failed';
        res.status(400).json({ error: msg });
    }
});

// POST /api/battlepass/claim/:level — claim a tier reward
router.post('/claim/:level', authenticate, async (req, res) => {
    try {
        const level = parseInt(req.params.level, 10);
        if (!Number.isFinite(level) || level < 1 || level > 100) {
            return res.status(400).json({ error: 'Invalid level' });
        }
        const track = req.body.track === 'premium' ? 'premium' : 'free';
        const result = await battlepass.claimReward(req.user.id, level, track);
        res.json(result);
    } catch (err) {
        console.warn('[BattlePass] claimReward error:', err.message);
        var safeErrors = ['Invalid level', 'Already claimed', 'Level not reached', 'Premium required'];
        var msg = safeErrors.includes(err.message) ? err.message : 'Claim failed';
        res.status(400).json({ error: msg });
    }
});

module.exports = router;
