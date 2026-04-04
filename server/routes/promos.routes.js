const express = require('express');
const promoService = require('../services/promo-popups.service');
const router = express.Router();

// GET /api/promos/active - get active promotions for current user
router.get('/active', async (req, res) => {
    try {
        let userId = null;
        // Optional auth - works for both logged in and anonymous
        try {
            const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
            if (token) {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, require('../config').JWT_SECRET, { algorithms: ['HS256'] });
                userId = decoded.id;
            }
        } catch (jwtErr) { console.warn('[Promos] JWT verify failed:', jwtErr.message); }
        
        const promos = await promoService.getActivePromos(userId);
        res.json({ promos });
    } catch (err) {
        res.json({ promos: [] });
    }
});

module.exports = router;