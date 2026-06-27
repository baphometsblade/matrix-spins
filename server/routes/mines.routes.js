'use strict';

/**
 * Mines — pick safe gems, avoid the bombs, cash out before you bust.
 *
 * Provably fair: mine positions are derived from a server seed at /start and
 * sealed (only the SHA-256 commitment is returned). The seed + positions are
 * revealed when the game ends (bust or cash-out) so the player can verify.
 *
 * Money rules: stake debited from withdrawable `balance` at /start; winnings
 * (bet × multiplier) credited to `balance` on cash-out. Atomic ops, RG checks,
 * ledgered to the shared `spins` table.
 *
 * Multiplier(k) after k safe reveals on a 25-tile grid with m mines:
 *     mult = RTP × Π_{i=0}^{k-1} (25 − i) / (25 − m − i)
 * where RTP = MINES_RTP. This is the standard fair-multiplier formula scaled by
 * a house edge. Capped at MAX_WIN_MULTIPLIER.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const casualWager = require('../services/casual-wager.service');

const GAME_ID = 'mines';
const GRID = 25;
const MIN_BET = 0.10;
const MAX_BET = 100;
const MINES_RTP = 0.97; // documented operator edge for Mines (slots stay 0.80)
const MAX_MULT = (config && config.MAX_WIN_MULTIPLIER) || 200;

function multiplierFor(mines, k) {
    if (k <= 0) return 0;
    const maxSafe = GRID - mines;
    if (k > maxSafe) k = maxSafe; // can't reveal more safe tiles than exist
    let m = 1;
    for (let i = 0; i < k; i++) {
        const denom = GRID - mines - i;
        if (denom <= 0) break; // guard div-by-zero / sign flip
        m *= (GRID - i) / denom;
    }
    m *= MINES_RTP;
    if (m > MAX_MULT) m = MAX_MULT;
    return Math.round(m * 10000) / 10000;
}

// Full multiplier ladder for a given mine count (1..maxSafe).
function multiplierTable(mines) {
    const maxSafe = GRID - mines;
    const out = [];
    for (let k = 1; k <= maxSafe; k++) out.push(multiplierFor(mines, k));
    return out;
}

// Deterministic mine positions from the server seed.
function minePositions(seed, mines) {
    const idx = [];
    for (let i = 0; i < GRID; i++) idx.push(i);
    let counter = 0, buf = Buffer.alloc(0), pos = 0;
    function nextInt(max) {
        if (pos + 4 > buf.length) { buf = crypto.createHmac('sha256', seed).update('mines:' + counter).digest(); counter++; pos = 0; }
        const v = buf.readUInt32BE(pos); pos += 4; return v % max;
    }
    for (let i = idx.length - 1; i > 0; i--) {
        const j = nextInt(i + 1);
        const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    return idx.slice(0, mines).sort((a, b) => a - b);
}

let _ready = false;
async function ensureSchema() {
    if (_ready) return;
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS mines_games (' +
            '  id ' + idDef + ',' +
            '  user_id INTEGER NOT NULL,' +
            '  bet REAL NOT NULL,' +
            '  mines INTEGER NOT NULL,' +
            '  server_seed TEXT NOT NULL,' +
            '  commit_hash TEXT NOT NULL,' +
            '  positions_json TEXT NOT NULL,' +
            '  revealed_json TEXT DEFAULT \'[]\',' +
            '  status TEXT DEFAULT \'active\',' +
            '  multiplier REAL DEFAULT 0,' +
            '  win_amount REAL DEFAULT 0,' +
            '  created_at ' + tsDef + ',' +
            '  ended_at TEXT' +
            ')'
        );
        _ready = true;
    } catch (err) {
        console.warn('[Mines] schema bootstrap error:', err.message);
    }
}
ensureSchema();

function degraded(res) {
    if (db.isDegraded && db.isDegraded()) {
        res.status(503).json({ error: 'Service temporarily unavailable. Please try again shortly.' });
        return true;
    }
    return false;
}

// ── GET /config ──────────────────────────────────────────────────────────
router.get('/config', authenticate, async (req, res) => {
    res.json({ gameId: GAME_ID, gridSize: GRID, minBet: MIN_BET, maxBet: MAX_BET, minMines: 1, maxMines: 24, rtp: MINES_RTP });
});

// ── GET /active — resume an in-progress game (no mine positions leaked) ──
router.get('/active', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const g = await db.get(
            "SELECT id, bet, mines, commit_hash, revealed_json FROM mines_games WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [req.user.id]
        );
        if (!g) return res.json({ active: null });
        const revealed = JSON.parse(g.revealed_json || '[]');
        res.json({
            active: {
                gameId: g.id, bet: g.bet, mines: g.mines, commitHash: g.commit_hash,
                revealed, revealedCount: revealed.length,
                multiplier: multiplierFor(g.mines, revealed.length),
                nextMultiplier: multiplierFor(g.mines, revealed.length + 1),
                multiplierTable: multiplierTable(g.mines),
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load active game' });
    }
});

// ── POST /start { bet, mines } ───────────────────────────────────────────
router.post('/start', authenticate, async (req, res) => {
    try {
        if (degraded(res)) return;
        await ensureSchema();
        const userId = req.user.id;
        const bet = Math.round(Number(req.body && req.body.bet) * 100) / 100;
        const mines = parseInt(req.body && req.body.mines, 10);

        if (!(bet >= MIN_BET) || bet > MAX_BET) {
            return res.status(400).json({ error: 'Bet must be between $' + MIN_BET.toFixed(2) + ' and $' + MAX_BET.toFixed(2) + '.' });
        }
        if (!(mines >= 1 && mines <= 24)) {
            return res.status(400).json({ error: 'Choose between 1 and 24 mines.' });
        }

        // Block starting a second game while one is active.
        const existing = await db.get("SELECT id FROM mines_games WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
        if (existing) return res.status(409).json({ error: 'You already have a game in progress. Cash out or bust first.', gameId: existing.id });

        const guard = await casualWager.precheck(userId, bet);
        if (!guard.allowed) {
            return res.status(guard.status || 403).json(Object.assign({ error: guard.error }, guard.extra || {}));
        }

        const serverSeed = crypto.randomBytes(16).toString('hex');
        const commitHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        const positions = minePositions(serverSeed, mines);

        let gameId, newBalance;
        await db.beginTransaction();
        try {
            const balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            const balanceBefore = balRow ? balRow.balance : 0;
            const deduct = await db.run('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?', [bet, userId, bet]);
            if (!deduct || deduct.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient balance' });
            }
            const balanceAfter = Math.round((balanceBefore - bet) * 100) / 100;
            newBalance = balanceAfter;
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'bet', -bet, balanceBefore, balanceAfter, GAME_ID + ':start']
            );
            const ins = await db.run(
                "INSERT INTO mines_games (user_id, bet, mines, server_seed, commit_hash, positions_json, revealed_json, status) VALUES (?, ?, ?, ?, ?, ?, '[]', 'active')",
                [userId, bet, mines, serverSeed, commitHash, JSON.stringify(positions)]
            );
            gameId = ins.id || ins.lastID || ins.lastInsertRowid;
            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_) {}
            throw txErr;
        }

        return res.json({
            gameId, bet, mines, commitHash, gridSize: GRID,
            nextMultiplier: multiplierFor(mines, 1),
            multiplierTable: multiplierTable(mines),
            newBalance,
        });
    } catch (err) {
        console.error('[Mines] start error:', err.message);
        return res.status(500).json({ error: 'Failed to start game' });
    }
});

// ── POST /reveal { gameId, tile } ────────────────────────────────────────
router.post('/reveal', authenticate, async (req, res) => {
    try {
        if (degraded(res)) return;
        await ensureSchema();
        const userId = req.user.id;
        const gameId = Number(req.body && req.body.gameId);
        const tile = parseInt(req.body && req.body.tile, 10);
        if (!gameId || !(tile >= 0 && tile < GRID)) return res.status(400).json({ error: 'Invalid gameId or tile' });

        const g = await db.get(
            "SELECT id, bet, mines, server_seed, positions_json, revealed_json, status FROM mines_games WHERE id = ? AND user_id = ?",
            [gameId, userId]
        );
        if (!g) return res.status(404).json({ error: 'Game not found' });
        if (g.status !== 'active') return res.status(409).json({ error: 'Game already ended' });

        const positions = JSON.parse(g.positions_json);
        const revealed = JSON.parse(g.revealed_json || '[]');
        if (revealed.includes(tile)) return res.status(400).json({ error: 'Tile already revealed' });

        // ── Mine hit → bust ──────────────────────────────────────────────
        if (positions.includes(tile)) {
            const revAfter = revealed.concat([tile]);
            const flip = await db.run(
                "UPDATE mines_games SET status = 'lost', revealed_json = ?, ended_at = datetime('now') WHERE id = ? AND status = 'active'",
                [JSON.stringify(revAfter), gameId]
            );
            if (!flip || flip.changes === 0) return res.status(409).json({ error: 'Game already ended' });

            await casualWager.record(userId, GAME_ID, g.bet, 0, { mines: g.mines, hit: tile, positions }, g.server_seed);
            const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            return res.json({ gem: false, mine: true, busted: true, tile, minePositions: positions, serverSeed: g.server_seed, multiplier: 0, winAmount: 0, newBalance: u ? u.balance : 0 });
        }

        // ── Safe gem ─────────────────────────────────────────────────────
        const revAfter = revealed.concat([tile]);
        const k = revAfter.length;
        const maxSafe = GRID - g.mines;

        if (k >= maxSafe) {
            // All safe tiles cleared → auto cash-out at max multiplier.
            const mult = multiplierFor(g.mines, k);
            const win = Math.round(g.bet * mult * 100) / 100;
            const flip = await db.run(
                "UPDATE mines_games SET status = 'cashed_out', revealed_json = ?, multiplier = ?, win_amount = ?, ended_at = datetime('now') WHERE id = ? AND status = 'active'",
                [JSON.stringify(revAfter), mult, win, gameId]
            );
            if (!flip || flip.changes === 0) return res.status(409).json({ error: 'Game already ended' });

            let newBalance;
            await db.beginTransaction();
            try {
                const balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                const before = balRow ? balRow.balance : 0;
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [win, userId]);
                const after = Math.round((before + win) * 100) / 100;
                newBalance = after;
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'win', win, before, after, GAME_ID + ':cashout']
                );
                await db.commit();
            } catch (txErr) { try { await db.rollback(); } catch (_) {} throw txErr; }

            await casualWager.record(userId, GAME_ID, g.bet, win, { mines: g.mines, cleared: true, positions }, g.server_seed);
            return res.json({ gem: true, mine: false, tile, cashedOut: true, multiplier: mult, winAmount: win, minePositions: positions, serverSeed: g.server_seed, newBalance });
        }

        // Continue — CAS on revealed_json to avoid concurrent double-reveal.
        const flip = await db.run(
            "UPDATE mines_games SET revealed_json = ?, multiplier = ? WHERE id = ? AND status = 'active' AND revealed_json = ?",
            [JSON.stringify(revAfter), multiplierFor(g.mines, k), gameId, g.revealed_json || '[]']
        );
        if (!flip || flip.changes === 0) return res.status(409).json({ error: 'Reveal conflict, retry' });

        return res.json({
            gem: true, mine: false, tile,
            revealedCount: k,
            multiplier: multiplierFor(g.mines, k),
            nextMultiplier: multiplierFor(g.mines, k + 1),
            potentialWin: Math.round(g.bet * multiplierFor(g.mines, k) * 100) / 100,
            safeRemaining: maxSafe - k,
        });
    } catch (err) {
        console.error('[Mines] reveal error:', err.message);
        return res.status(500).json({ error: 'Failed to reveal tile' });
    }
});

// ── POST /cashout { gameId } ─────────────────────────────────────────────
router.post('/cashout', authenticate, async (req, res) => {
    try {
        if (degraded(res)) return;
        await ensureSchema();
        const userId = req.user.id;
        const gameId = Number(req.body && req.body.gameId);
        if (!gameId) return res.status(400).json({ error: 'gameId required' });

        const g = await db.get(
            "SELECT id, bet, mines, server_seed, positions_json, revealed_json, status FROM mines_games WHERE id = ? AND user_id = ?",
            [gameId, userId]
        );
        if (!g) return res.status(404).json({ error: 'Game not found' });
        if (g.status !== 'active') return res.status(409).json({ error: 'Game already ended' });

        const revealed = JSON.parse(g.revealed_json || '[]');
        const k = revealed.length;
        if (k < 1) return res.status(400).json({ error: 'Reveal at least one gem before cashing out.' });

        const mult = multiplierFor(g.mines, k);
        const win = Math.round(g.bet * mult * 100) / 100;

        // CAS to lock the cash-out (prevents double-credit / bust race).
        const flip = await db.run(
            "UPDATE mines_games SET status = 'cashed_out', multiplier = ?, win_amount = ?, ended_at = datetime('now') WHERE id = ? AND status = 'active'",
            [mult, win, gameId]
        );
        if (!flip || flip.changes === 0) return res.status(409).json({ error: 'Game already ended' });

        let newBalance;
        await db.beginTransaction();
        try {
            const balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            const before = balRow ? balRow.balance : 0;
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [win, userId]);
            const after = Math.round((before + win) * 100) / 100;
            newBalance = after;
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'win', win, before, after, GAME_ID + ':cashout']
            );
            await db.commit();
        } catch (txErr) { try { await db.rollback(); } catch (_) {} throw txErr; }

        const positions = JSON.parse(g.positions_json);
        await casualWager.record(userId, GAME_ID, g.bet, win, { mines: g.mines, revealed, positions }, g.server_seed);

        return res.json({ cashedOut: true, multiplier: mult, winAmount: win, revealedCount: k, minePositions: positions, serverSeed: g.server_seed, newBalance });
    } catch (err) {
        console.error('[Mines] cashout error:', err.message);
        return res.status(500).json({ error: 'Failed to cash out' });
    }
});

// Test hooks (pure functions — no DB).
router._test = { multiplierFor, multiplierTable, minePositions, GRID, MINES_RTP, MAX_MULT };

module.exports = router;
