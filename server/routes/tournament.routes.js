'use strict';

/**
 * Tournament API
 *
 *   GET  /api/tournament              — alias for /active
 *   GET  /api/tournament/active       — list of currently running tournaments
 *   GET  /api/tournament/upcoming     — list of upcoming tournaments
 *   GET  /api/tournament/history      — completed tournaments (with winners)
 *   GET  /api/tournament/:id          — details + leaderboard top 20
 *   GET  /api/tournament/:id/leaderboard — leaderboard alone
 *   GET  /api/tournament/:id/my-rank  — current user's rank / score
 *   POST /api/tournament/:id/enter    — enter (deducts buy-in if any)
 *   POST /api/tournament/:id/record-spin — submit spin result (legacy compat)
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const tournamentService = require('../services/tournament.service');

function _nowSql() {
    return db.isPg() ? 'NOW()' : "datetime('now')";
}

async function _checkSelfExclusion(userId) {
    try {
        var row = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > " + _nowSql() + ")",
            [userId]
        );
        return !!row;
    } catch (_) { return false; }
}

router.get('/', async function (req, res) {
    try {
        var [active, upcoming] = await Promise.all([
            tournamentService.getActive(),
            tournamentService.getUpcoming(),
        ]);
        res.json({ active, upcoming, tournaments: active });
    } catch (err) {
        console.warn('[Tournament] / error:', err.message);
        res.json({ active: [], upcoming: [], tournaments: [] });
    }
});

router.get('/active', async function (req, res) {
    try {
        var rows = await tournamentService.getActive();
        res.json({ tournaments: rows });
    } catch (err) {
        console.warn('[Tournament] /active error:', err.message);
        // Return empty array instead of 500 — frontend gracefully handles empty state
        res.json({ tournaments: [] });
    }
});

router.get('/upcoming', async function (req, res) {
    try {
        var rows = await tournamentService.getUpcoming();
        res.json({ tournaments: rows });
    } catch (err) {
        res.json({ tournaments: [] });
    }
});

router.get('/history', async function (req, res) {
    try {
        var rows = await tournamentService.getCompleted(20);
        // include top-3 winners if results table exists
        var enriched = [];
        for (var i = 0; i < rows.length; i++) {
            var t = rows[i];
            var winners = [];
            try {
                winners = await db.all(
                    'SELECT tr.rank, tr.score, tr.prize, COALESCE(u.display_name, u.username) AS username ' +
                    'FROM tournament_results tr JOIN users u ON u.id = tr.user_id ' +
                    'WHERE tr.tournament_id = ? ORDER BY tr.rank ASC',
                    [t.id]
                );
            } catch (_) {}
            enriched.push(Object.assign({ winners: winners }, t));
        }
        res.json({ history: enriched });
    } catch (err) {
        console.warn('[Tournament] /history error:', err.message);
        res.json({ history: [] });
    }
});

router.get('/:id(\\d+)', async function (req, res) {
    try {
        var id = parseInt(req.params.id, 10);
        var t = await db.get(
            'SELECT id, name, description, type, entry_fee, prize_pool, start_date, end_date, status FROM tournaments WHERE id = ?',
            [id]
        );
        if (!t) return res.status(404).json({ error: 'Tournament not found' });
        var leaderboard = await tournamentService.getLeaderboard(id, 20);
        res.json({ tournament: t, leaderboard: leaderboard });
    } catch (err) {
        console.warn('[Tournament] /:id error:', err.message);
        res.status(500).json({ error: 'Failed to load tournament' });
    }
});

router.get('/:id(\\d+)/leaderboard', async function (req, res) {
    try {
        var id = parseInt(req.params.id, 10);
        var leaderboard = await tournamentService.getLeaderboard(id, 50);
        res.json({ leaderboard: leaderboard });
    } catch (err) {
        res.json({ leaderboard: [] });
    }
});

router.get('/:id(\\d+)/my-rank', authenticate, async function (req, res) {
    try {
        var id = parseInt(req.params.id, 10);
        var entry = await tournamentService.getMyEntry(id, req.user.id);
        res.json(entry);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load rank' });
    }
});

router.post('/:id(\\d+)/enter', authenticate, async function (req, res) {
    try {
        var id = parseInt(req.params.id, 10);
        if (await _checkSelfExclusion(req.user.id)) {
            return res.status(403).json({ error: 'Account is currently self-excluded.' });
        }
        var result = await tournamentService.enter(id, req.user.id);
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ success: true, message: 'Entered tournament successfully' });
    } catch (err) {
        console.warn('[Tournament] /enter error:', err.message);
        res.status(500).json({ error: 'Failed to enter tournament' });
    }
});

// SECURITY: the legacy POST /:id/record-spin endpoint that accepted
// client-supplied { winAmount, betAmount } has been REMOVED. It let any
// player submit a fake $1,000,000 win for tournament ranking and steal
// the prize pool. /api/spin already calls tournamentService.submitSpin
// with the server-computed winAmount on every real spin
// (spin.routes.js:~1182), so this endpoint was both redundant and a
// CRITICAL money-loss exploit. We return 410 Gone here so any cached
// client that still calls it sees a clear deprecation, not a silent
// no-op or a continued vulnerability.
router.post('/:id(\\d+)/record-spin', authenticate, function (req, res) {
    res.status(410).json({
        error: 'This endpoint has been removed for security reasons. ' +
               'Tournament scoring is now recorded automatically by /api/spin.'
    });
});

module.exports = router;
