'use strict';

/**
 * Slot routes — the server-authoritative spin surface.
 *
 * GET  /api/slot/games                    List wired games + bet limits.
 * GET  /api/slot/commit                   Current server_seed_hash (+ nonce).
 * POST /api/slot/spin                     Debit + spin + credit + log.
 * GET  /api/slot/rounds                   Recent rounds with revealed seeds.
 * GET  /api/slot/rounds/:id               One round with revealed seed.
 *
 * All routes require a session (JWT) and CSRF on writes.
 */

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const engine = require('../services/slot-engine.service');

const router = express.Router();

router.get('/games', authenticate, (_req, res) => {
    res.json({ games: engine.listGames() });
});

router.get('/commit', authenticate, async (req, res) => {
    try {
        const c = await engine.publicCommit(req.user.id);
        res.json(c);
    } catch (err) {
        console.error('[slot/commit]', err);
        res.status(500).json({ error: 'Failed to fetch commit.' });
    }
});

router.post('/spin', authenticate, async (req, res) => {
    const { game_id, bet_cents, client_seed } = req.body || {};

    if (!engine.hasGame(game_id)) return res.status(404).json({ error: 'Unknown game.' });

    // Honor the same self-exclusion gate that blocks deposits — a paused
    // account should not be able to place bets with its existing balance.
    const gate = await db.get('SELECT self_excluded_until FROM users WHERE id = ?', [req.user.id]);
    if (gate && gate.self_excluded_until) {
        const untilMs = Date.parse(gate.self_excluded_until);
        if (Number.isFinite(untilMs) && untilMs > Date.now()) {
            return res.status(403).json({
                error: 'Your account is self-excluded until ' + new Date(untilMs).toISOString() + '.',
                code: 'self_excluded',
                until: new Date(untilMs).toISOString(),
            });
        }
    }

    try {
        const result = await engine.spin({
            userId: req.user.id,
            gameId: game_id,
            betCents: bet_cents,
            clientSeed: client_seed,
        });
        res.json(result);
    } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        console.error('[slot/spin]', err);
        res.status(500).json({ error: 'Spin failed.' });
    }
});

router.get('/rounds', authenticate, async (req, res) => {
    try {
        const rounds = await engine.listRounds(req.user.id, req.query.limit);
        res.json({ rounds });
    } catch (err) {
        console.error('[slot/rounds]', err);
        res.status(500).json({ error: 'Failed to fetch rounds.' });
    }
});

router.get('/rounds/:id', authenticate, async (req, res) => {
    try {
        const round = await engine.getRound(req.user.id, req.params.id);
        if (!round) return res.status(404).json({ error: 'Round not found.' });
        res.json({ round });
    } catch (err) {
        console.error('[slot/rounds/:id]', err);
        res.status(500).json({ error: 'Failed to fetch round.' });
    }
});

module.exports = router;
