'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const wageraceService = require('../services/wagerace.service');

// GET /api/wager-races — public, returns active race + leaderboard
router.get('/', async (req, res) => {
    try {
        const data = await wageraceService.getActiveRace();
        res.json(data);
    } catch (err) {
        console.warn('[WagerRace] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to load wager race' });
    }
});

// GET /api/wager-races/history — auth required, returns user's prize history
router.get('/history', authenticate, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const history = await wageraceService.getRaceHistory(req.user.id, limit);
        res.json({ history });
    } catch (err) {
        console.warn('[WagerRace] GET /history error:', err.message);
        res.status(500).json({ error: 'Failed to load race history' });
    }
});

module.exports = router;
