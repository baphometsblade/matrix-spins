'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const boostService = require('../services/boost.service');

// GET /api/boosts — active boosts for the authenticated user
router.get('/', authenticate, async (req, res) => {
    try {
        const boosts = await boostService.getActiveBoosts(req.user.id);
        res.json({ boosts });
    } catch (err) {
        console.warn('[Boosts] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to fetch active boosts' });
    }
});

// GET /api/boosts/available — boost definitions (public, no auth)
router.get('/available', async (req, res) => {
    try {
        res.json({ boosts: boostService.getBoostDefs() });
    } catch (err) {
        console.warn('[Boosts] GET /available error:', err.message);
        res.status(500).json({ error: 'Failed to fetch boost definitions' });
    }
});

// POST /api/boosts/purchase — purchase a boost (auth required)
router.post('/purchase', authenticate, async (req, res) => {
    try {
        const { boostType } = req.body;
        if (!boostType) return res.status(400).json({ error: 'boostType required' });
        const result = await boostService.purchaseBoost(req.user.id, boostType);
        res.json(result);
    } catch (err) {
        console.warn('[Boosts] POST /purchase error:', err.message);
        // SECURITY: Only expose known safe error messages
        var safeErrors = ['boostType required', 'Invalid boost type', 'Insufficient balance', 'Boost already active'];
        var msg = safeErrors.includes(err.message) ? err.message : 'Boost purchase failed';
        res.status(400).json({ error: msg });
    }
});

module.exports = router;
