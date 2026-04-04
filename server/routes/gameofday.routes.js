'use strict';
const express = require('express');
const games = require('../../shared/game-definitions');
const db = require('../database');
const config = require('../config');
const router = express.Router();

/**
 * Returns the set of game IDs sorted deterministically (fallback rotation).
 */
function getSortedGameIds() {
    return games.map(g => g.id).sort();
}

/**
 * Returns seconds until the next UTC midnight.
 */
function secondsUntilMidnight() {
    const msUntilMidnightUTC = 86400000 - (Date.now() % 86400000);
    return Math.floor(msUntilMidnightUTC / 1000);
}

/**
 * Finds the game object by ID, returning { gameId, gameName } or nulls.
 */
function resolveGame(gameId) {
    const game = games.find(g => g.id === gameId);
    return {
        gameId: game ? game.id : null,
        gameName: game ? game.name : null
    };
}

// GET /api/game-of-day — profit-aware daily game selection
router.get('/', async (req, res) => {
    try {
        const dayIndex = Math.floor(Date.now() / 86400000);

        // Query games with enough data where actual RTP is below target (profitable for the house)
        const profitableGames = await db.all(
            `SELECT game_id, actual_rtp
             FROM game_stats
             WHERE total_spins >= 50 AND actual_rtp < ?
             ORDER BY actual_rtp ASC
             LIMIT 10`,
            [config.TARGET_RTP]
        );

        if (profitableGames && profitableGames.length > 0) {
            // Rotate among the top 10 most profitable games by day
            const pick = profitableGames[dayIndex % profitableGames.length];
            const resolved = resolveGame(pick.game_id);
            return res.json({
                ...resolved,
                secondsUntilNext: secondsUntilMidnight()
            });
        }

        // Fallback: deterministic rotation through all games (no stats data yet)
        const sortedIds = getSortedGameIds();
        const gameId = sortedIds[dayIndex % sortedIds.length];
        const resolved = resolveGame(gameId);
        res.json({
            ...resolved,
            secondsUntilNext: secondsUntilMidnight()
        });
    } catch (err) {
        console.warn('[game-of-day] Error:', err.message);
        // On DB error, fall back to deterministic rotation
        const dayIndex = Math.floor(Date.now() / 86400000);
        const sortedIds = getSortedGameIds();
        const gameId = sortedIds[dayIndex % sortedIds.length];
        const resolved = resolveGame(gameId);
        res.json({
            ...resolved,
            secondsUntilNext: secondsUntilMidnight()
        });
    }
});

// GET /api/game-of-day/featured — 6 most profitable games for lobby spotlight
router.get('/featured', async (req, res) => {
    try {
        // Select games with significant data, ordered by lowest actual RTP (highest house profit)
        const rows = await db.all(
            `SELECT game_id
             FROM game_stats
             WHERE total_spins >= 50 AND actual_rtp < ?
             ORDER BY actual_rtp ASC
             LIMIT 6`,
            [config.TARGET_RTP]
        );

        if (rows && rows.length > 0) {
            return res.json(rows.map(r => r.game_id));
        }

        // Fallback: return 6 deterministic game IDs when no stats exist
        const sortedIds = getSortedGameIds();
        const dayIndex = Math.floor(Date.now() / 86400000);
        const featured = [];
        for (let i = 0; i < 6 && i < sortedIds.length; i++) {
            featured.push(sortedIds[(dayIndex + i) % sortedIds.length]);
        }
        res.json(featured);
    } catch (err) {
        console.warn('[featured-games] Error:', err.message);
        // On DB error, return 6 deterministic game IDs
        const sortedIds = getSortedGameIds();
        const dayIndex = Math.floor(Date.now() / 86400000);
        const featured = [];
        for (let i = 0; i < 6 && i < sortedIds.length; i++) {
            featured.push(sortedIds[(dayIndex + i) % sortedIds.length]);
        }
        res.json(featured);
    }
});

module.exports = router;
