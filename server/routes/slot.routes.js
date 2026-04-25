'use strict';

/**
 * Slot routes — the server-authoritative spin surface.
 *
 * GET  /api/slot/games                    List wired games + bet limits.
 * GET  /api/slot/commit                   Current server_seed_hash (+ nonce).
 * POST /api/slot/spin                     Debit + spin + credit + log.
 * GET  /api/slot/rounds                   Recent rounds with revealed seeds.
 * GET  /api/slot/rounds/:id               One round with revealed seed.
 * GET  /api/slot/client-seed              Current persistent client seed.
 * PUT  /api/slot/client-seed              Rotate the persistent client seed.
 * POST /api/slot/rotate-commit            Force-reveal current server seed
 *                                         and roll a fresh commit.
 *
 * All routes require a session (JWT) and CSRF on writes.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const userRateLimit = require('../middleware/user-ratelimit');
const engine = require('../services/slot-engine.service');

const router = express.Router();

// Per-user spin rate limit. A human cannot spin faster than ~2/s; a
// motivated script could hammer the engine and churn the DB. 30 spins
// in 10 s covers turbo-spin and double-click recovery while cutting
// off scripted abuse and constraining per-user DB write load.
const spinLimiter = userRateLimit({ maxRequests: 30, windowMs: 10 * 1000 });

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

router.post('/spin', authenticate, spinLimiter, async (req, res) => {
    const { game_id, bet_cents, client_seed } = req.body || {};

    if (!engine.hasGame(game_id)) return res.status(404).json({ error: 'Unknown game.' });

    try {
        const result = await engine.spin({
            userId: req.user.id,
            gameId: game_id,
            betCents: bet_cents,
            clientSeed: client_seed,
        });
        res.json(result);
    } catch (err) {
        if (err && err.status) {
            const body = { error: err.message };
            if (err.code) body.code = err.code;
            if (err.until) body.until = err.until;
            if (err.limit_cents != null) body.limit_cents = err.limit_cents;
            if (err.used_cents != null) body.used_cents = err.used_cents;
            if (err.reset_at) body.reset_at = err.reset_at;
            return res.status(err.status).json(body);
        }
        console.error('[slot/spin]', err);
        res.status(500).json({ error: 'Spin failed.' });
    }
});

router.get('/client-seed', authenticate, async (req, res) => {
    try {
        const seed = await engine.getClientSeed(req.user.id);
        res.json({ client_seed: seed });
    } catch (err) {
        console.error('[slot/client-seed GET]', err);
        res.status(500).json({ error: 'Failed to fetch client seed.' });
    }
});

router.put('/client-seed', authenticate, async (req, res) => {
    const { client_seed } = req.body || {};
    try {
        const saved = await engine.setClientSeed(req.user.id, client_seed);
        res.json({ client_seed: saved });
    } catch (err) {
        if (err && err.status === 400) return res.status(400).json({ error: err.message });
        console.error('[slot/client-seed PUT]', err);
        res.status(500).json({ error: 'Failed to save client seed.' });
    }
});

/**
 * Reveal the current server commit and roll a fresh one. The user can
 * verify any spins they made under the revealed seed via the
 * verify-round page. NOT under the per-user spin lock — a concurrent
 * spin landing in the small race window will bind to either the old
 * or the new commit, both of which are honest. If we ever drop the
 * post-spin auto-roll, wrap this in withSpinLock.
 */
router.post('/rotate-commit', authenticate, async (req, res) => {
    try {
        const cur = await engine.getOrCreateCommit(req.user.id);
        const next = await engine.rollNewCommit(req.user.id);
        res.json({
            revealed: { server_seed: cur.server_seed, server_seed_hash: cur.server_seed_hash },
            next_commit: { server_seed_hash: next.server_seed_hash, nonce: 0 },
        });
    } catch (err) {
        console.error('[slot/rotate-commit]', err);
        res.status(500).json({ error: 'Failed to rotate commit.' });
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
