'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database');

/**
 * GET /api/feed
 * Returns last 20 big wins (>=15x multiplier), usernames masked for privacy.
 * Public — no auth required.
 */
router.get('/', async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT u.username,
                    s.game_id,
                    s.win_amount,
                    s.bet_amount,
                    ROUND(s.win_amount / s.bet_amount, 1) AS mult,
                    s.created_at
             FROM spins s
             JOIN users u ON s.user_id = u.id
             WHERE s.win_amount >= s.bet_amount * 15
               AND s.bet_amount > 0
             ORDER BY s.created_at DESC
             LIMIT 20`
        );

        // Mask usernames: first 2 chars + ***
        const feed = rows.map(r => ({
            username: (r.username || 'Player').slice(0, 2) + '***',
            gameId:   r.game_id,
            win:      r.win_amount,
            bet:      r.bet_amount,
            mult:     r.mult,
            ts:       r.created_at,
        }));

        res.json({ feed });
    } catch (err) {
        console.warn('[Feed] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

module.exports = router;
