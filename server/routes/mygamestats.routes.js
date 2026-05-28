'use strict';

/**
 * GET /api/games/:id/my-stats
 *
 * Per-game personal-stats aggregate for the authenticated player.
 * Returns: spinCount, sessionsPlayed, totalWagered, totalWon, netResult,
 *          biggestWin, averageBet, firstPlayed, lastPlayed.
 *
 * Why this exists:
 *   Premium operators (Push Gaming, Nolimit City, Hacksaw) surface a
 *   "your biggest win here was $312" card on every game's info modal.
 *   It's a powerful retention signal — "I have history with this game"
 *   beats "this is a random new slot" every time. The audit flagged
 *   the absence as a major missing premium feature.
 *
 * Schema notes:
 *   - `spins.game_id` stores the hyphenated slug verbatim for the 100
 *     production games (e.g. 'golden-cherry-cascade'). No translation
 *     needed from req.params.id.
 *   - Existing composite indexes (idx_spins_user_date, idx_spins_user)
 *     cover the WHERE clause efficiently.
 *   - COUNT(DISTINCT DATE(created_at)) is portable across SQLite + PG.
 *
 * Rate limiting: the global /api/ limiter at server/index.js:198-205
 * (100 req/min/IP) already covers this route.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const games = require('../../shared/game-definitions');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Build the set of known game IDs. We accept BOTH the legacy underscore
// catalog (shared/game-definitions.js) AND the production hyphenated
// registry (js/game-registry.js) — either form may have been written
// to spins.game_id at some point in the past.
//
// Registry IDs come out via `String.matchAll` over the trusted shipped
// file (no eval / new Function / vm).
const knownGameIds = new Set();
(Array.isArray(games) ? games : []).forEach(g => { if (g && g.id) knownGameIds.add(g.id); });
try {
    const registryPath = path.resolve(__dirname, '../../js/game-registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf8');
    const idPattern = /\bid:\s*'([a-z0-9_-]+)'/g;
    const matches = registryCode.matchAll(idPattern);
    for (const m of matches) {
        knownGameIds.add(m[1]);
    }
} catch (err) {
    console.warn('[my-game-stats] registry load failed (continuing with definitions only):', err.message);
}

router.get('/:id/my-stats', authenticate, async (req, res) => {
    const userId = req.user && req.user.id;
    const gameId = String(req.params.id || '').trim();

    if (!gameId || gameId.length > 60 || !knownGameIds.has(gameId)) {
        return res.status(404).json({ error: 'Unknown game' });
    }

    try {
        const row = await db.get(
            `SELECT
                COUNT(*)                                    AS spin_count,
                COALESCE(SUM(bet_amount), 0)                AS total_wagered,
                COALESCE(SUM(win_amount), 0)                AS total_won,
                COALESCE(MAX(win_amount), 0)                AS biggest_win,
                COALESCE(AVG(bet_amount), 0)                AS average_bet,
                MIN(created_at)                             AS first_played,
                MAX(created_at)                             AS last_played,
                COUNT(DISTINCT DATE(created_at))            AS sessions_played
             FROM spins
             WHERE user_id = ? AND game_id = ?`,
            [userId, gameId]
        );

        const totalWagered = parseFloat(row && row.total_wagered) || 0;
        const totalWon     = parseFloat(row && row.total_won)     || 0;

        res.json({
            gameId: gameId,
            spinCount:      (row && row.spin_count) || 0,
            sessionsPlayed: (row && row.sessions_played) || 0,
            totalWagered:   +totalWagered.toFixed(2),
            totalWon:       +totalWon.toFixed(2),
            netResult:      +(totalWon - totalWagered).toFixed(2),
            biggestWin:     +(parseFloat(row && row.biggest_win) || 0).toFixed(2),
            averageBet:     +(parseFloat(row && row.average_bet) || 0).toFixed(2),
            firstPlayed:    (row && row.first_played) || null,
            lastPlayed:     (row && row.last_played)  || null,
        });
    } catch (err) {
        console.warn('[my-game-stats] query failed:', err.message);
        // Return a zeroed shape so the client can render an empty stats
        // card instead of an error toast — stats are decorative, not
        // gating, so a DB hiccup shouldn't break the info modal.
        res.json({
            gameId: gameId,
            spinCount: 0, sessionsPlayed: 0,
            totalWagered: 0, totalWon: 0, netResult: 0,
            biggestWin: 0, averageBet: 0,
            firstPlayed: null, lastPlayed: null,
            unavailable: true,
        });
    }
});

module.exports = router;
