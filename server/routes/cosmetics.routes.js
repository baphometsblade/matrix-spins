'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const cosmeticsService = require('../services/cosmetics.service');

const router = express.Router();

// GET /api/cosmetics/shop — public, returns all shop items organized by category
router.get('/shop', async (req, res) => {
    try {
        const shop = await cosmeticsService.getShop();

        // Mark high-value items as time-limited (rotates every 48 h based on day number)
        const dayNum = Math.floor(Date.now() / (48 * 3600000));
        const expiresAt = new Date((dayNum + 1) * 48 * 3600000).toISOString();
        const enrichedShop = {};
        Object.keys(shop).forEach(function (category) {
            enrichedShop[category] = (shop[category] || []).map(function (item) {
                const price = item.gem_price || item.price || 0;
                if (price >= 2000) {
                    return Object.assign({}, item, {
                        is_limited: 1,
                        limited_expires_at: expiresAt,
                        limited_label: 'LIMITED'
                    });
                }
                return item;
            });
        });

        res.json({ shop: enrichedShop });
    } catch (err) {
        console.warn('[Cosmetics] Shop error:', err.message);
        res.status(500).json({ error: 'Failed to load cosmetic shop' });
    }
});

// GET /api/cosmetics/inventory — auth required, returns player's owned items
router.get('/inventory', authenticate, async (req, res) => {
    try {
        const inventory = await cosmeticsService.getInventory(req.user.id);
        res.json({ inventory });
    } catch (err) {
        console.warn('[Cosmetics] Inventory error:', err.message);
        res.status(500).json({ error: 'Failed to load inventory' });
    }
});

// POST /api/cosmetics/purchase — auth required, purchase a cosmetic with gems
router.post('/purchase', authenticate, async (req, res) => {
    try {
        const { itemId } = req.body;
        if (!itemId) {
            return res.status(400).json({ error: 'itemId is required' });
        }
        const result = await cosmeticsService.purchaseItem(req.user.id, parseInt(itemId));
        res.json(result);
    } catch (err) {
        console.warn('[Cosmetics] Purchase error:', err.message);
        // Client-facing errors (validation, balance) vs server errors
        // ROUND 28: Whitelist safe error messages instead of forwarding raw err.message
        var msg = err.message || '';
        if (msg.includes('not found')) {
            return res.status(400).json({ error: 'Item not found' });
        }
        if (msg.includes('already own')) {
            return res.status(400).json({ error: 'You already own this item' });
        }
        if (msg.includes('Not enough gems')) {
            return res.status(400).json({ error: 'Not enough gems for this purchase' });
        }
        res.status(500).json({ error: 'Purchase failed' });
    }
});

// POST /api/cosmetics/equip — auth required, equip a cosmetic item
router.post('/equip', authenticate, async (req, res) => {
    try {
        const { itemId } = req.body;
        if (!itemId) {
            return res.status(400).json({ error: 'itemId is required' });
        }
        const result = await cosmeticsService.equipItem(req.user.id, parseInt(itemId));
        res.json(result);
    } catch (err) {
        console.warn('[Cosmetics] Equip error:', err.message);
        // ROUND 28: Whitelist safe error messages instead of forwarding raw err.message
        var msg = err.message || '';
        if (msg.includes('do not own') || msg.includes('not found')) {
            return res.status(400).json({ error: 'Item not found or not owned' });
        }
        res.status(500).json({ error: 'Equip failed' });
    }
});

// GET /api/cosmetics/equipped — auth required, returns player's equipped cosmetics
router.get('/equipped', authenticate, async (req, res) => {
    try {
        const equipped = await cosmeticsService.getEquipped(req.user.id);
        res.json({ equipped });
    } catch (err) {
        console.warn('[Cosmetics] Equipped error:', err.message);
        res.status(500).json({ error: 'Failed to load equipped cosmetics' });
    }
});

module.exports = router;
