'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/game-stats — per-game RTP summary (public, no auth)
// Returns games with enough spin history (>= 20 spins) for hot/cold display
router.get('/', async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT game_id, total_spins, actual_rtp FROM game_stats WHERE total_spins >= 20 ORDER BY actual_rtp DESC'
        );
        const stats = rows.map(function(r) {
            return {
                gameId: r.game_id,
                totalSpins: parseInt(r.total_spins) || 0,
                actualRtp: parseFloat(r.actual_rtp) || 0
            };
        });
        res.json({ stats });
    } catch (err) {
        console.warn('[GameStats] Error:', err.message);
        res.status(500).json({ error: 'Failed to load game stats' });
    }
});

module.exports = router;
