'use strict';

/**
 * Scratch Cards — instant-win wagered game.
 *
 * Flow (provably fair commit/reveal):
 *   POST /buy    → debits the ticket price from withdrawable `balance`, seals a
 *                  9-cell outcome derived from a server seed, returns ONLY the
 *                  commitment hash (SHA-256 of the seed). The grid is hidden.
 *   POST /reveal → returns the grid + the server seed (so the player can verify
 *                  SHA-256(seed) === commitHash and recompute the grid), and
 *                  credits any winnings to `balance`. Idempotent.
 *
 * Money rules: stake debited from `balance`, wins credited to `balance` (this is
 * a real wager, like slots — NOT a free bonus). Atomic balance ops, RG checks
 * via casual-wager.service, ledgered to the shared `spins` table for VIP XP /
 * loss limits / tournaments.
 *
 * RTP ≈ 0.80 (matches platform house edge) — enforced by the weighted outcome
 * table below, NOT by random symbol placement.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const casualWager = require('../services/casual-wager.service');

const GAME_ID = 'scratch-cards';
const TIERS = [1, 2, 5, 10]; // ticket prices in dollars

// Prize symbols + multipliers + win probability. EV (sum mult*prob) ≈ 0.80.
const WIN_TABLE = [
    { symbol: 'diamond', label: '💎', multiplier: 100, prob: 0.0009 },
    { symbol: 'seven',   label: '7️⃣', multiplier: 50,  prob: 0.0018 },
    { symbol: 'bell',    label: '🔔', multiplier: 20,  prob: 0.005  },
    { symbol: 'cherry',  label: '🍒', multiplier: 10,  prob: 0.016  },
    { symbol: 'star',    label: '⭐', multiplier: 5,   prob: 0.038  },
    { symbol: 'bar',     label: '🅱️', multiplier: 2,   prob: 0.085  },
];
const ALL_SYMBOLS = WIN_TABLE.map(w => w.symbol);

// ── Schema bootstrap (no indexes — see MEMORY.md degraded-mode index trap) ──
let _ready = false;
async function ensureSchema() {
    if (_ready) return;
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS scratch_cards (' +
            '  id ' + idDef + ',' +
            '  user_id INTEGER NOT NULL,' +
            '  tier REAL NOT NULL,' +
            '  cost REAL NOT NULL,' +
            '  server_seed TEXT NOT NULL,' +
            '  commit_hash TEXT NOT NULL,' +
            '  grid_json TEXT NOT NULL,' +
            '  win_symbol TEXT,' +
            '  multiplier REAL DEFAULT 0,' +
            '  win_amount REAL DEFAULT 0,' +
            '  status TEXT DEFAULT \'sealed\',' +
            '  created_at ' + tsDef + ',' +
            '  revealed_at TEXT' +
            ')'
        );
        _ready = true;
    } catch (err) {
        console.warn('[ScratchCards] schema bootstrap error:', err.message);
    }
}
ensureSchema();

// Deterministic byte stream from the server seed (provably-fair derivation).
function makeRng(seed) {
    let counter = 0;
    let buf = Buffer.alloc(0);
    let pos = 0;
    function refill() {
        buf = crypto.createHmac('sha256', seed).update('scratch:' + counter).digest();
        counter++; pos = 0;
    }
    return function nextInt(max) {
        // Rejection-free enough for our small ranges; draw 4 bytes.
        if (pos + 4 > buf.length) refill();
        const v = buf.readUInt32BE(pos); pos += 4;
        return v % max;
    };
}

function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = rng(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

/**
 * Build a sealed 9-cell outcome from the server seed.
 * Returns { grid:[9], winSymbol|null, multiplier }.
 */
function computeOutcome(seed) {
    const rng = makeRng(seed);

    // 1. Pick outcome tier via weighted table (controls RTP exactly).
    const roll = rng(1000000) / 1000000;
    let acc = 0, win = null;
    for (const w of WIN_TABLE) {
        acc += w.prob;
        if (roll < acc) { win = w; break; }
    }

    const grid = new Array(9).fill(null);
    if (win) {
        // Place exactly three of the winning symbol on random cells.
        const positions = shuffle([0,1,2,3,4,5,6,7,8], rng);
        for (let i = 0; i < 3; i++) grid[positions[i]] = win.symbol;
        // Fill remaining 6 cells with other symbols, max 2 of any → no second 3-match.
        const others = ALL_SYMBOLS.filter(s => s !== win.symbol);
        const counts = {};
        for (let i = 3; i < 9; i++) {
            const cell = positions[i];
            let sym;
            let guard = 0;
            do { sym = others[rng(others.length)]; guard++; }
            while ((counts[sym] || 0) >= 2 && guard < 50);
            counts[sym] = (counts[sym] || 0) + 1;
            grid[cell] = sym;
        }
        return { grid, winSymbol: win.symbol, multiplier: win.multiplier };
    }

    // Losing card: fill 9 cells so NO symbol appears 3+ times (max 2 each).
    const counts = {};
    for (let i = 0; i < 9; i++) {
        let sym;
        let guard = 0;
        do { sym = ALL_SYMBOLS[rng(ALL_SYMBOLS.length)]; guard++; }
        while ((counts[sym] || 0) >= 2 && guard < 100);
        counts[sym] = (counts[sym] || 0) + 1;
        grid[i] = sym;
    }
    return { grid, winSymbol: null, multiplier: 0 };
}

function degraded(res) {
    if (db.isDegraded && db.isDegraded()) {
        res.status(503).json({ error: 'Service temporarily unavailable. Please try again shortly.' });
        return true;
    }
    return false;
}

// ── GET /config — tiers + paytable (public-ish, still authed for consistency) ──
router.get('/config', authenticate, async (req, res) => {
    res.json({
        gameId: GAME_ID,
        tiers: TIERS,
        gridSize: 9,
        matchToWin: 3,
        paytable: WIN_TABLE.map(w => ({ symbol: w.symbol, label: w.label, multiplier: w.multiplier })),
    });
});

// ── POST /buy { tier } — purchase + seal outcome ──────────────────────────
router.post('/buy', authenticate, async (req, res) => {
    try {
        if (degraded(res)) return;
        await ensureSchema();
        const userId = req.user.id;
        const tier = Number(req.body && req.body.tier);
        if (!TIERS.includes(tier)) {
            return res.status(400).json({ error: 'Invalid ticket tier. Choose $1, $2, $5 or $10.' });
        }
        const cost = tier;

        // Responsible-gambling pre-checks.
        const guard = await casualWager.precheck(userId, cost);
        if (!guard.allowed) {
            return res.status(guard.status || 403).json(Object.assign({ error: guard.error }, guard.extra || {}));
        }

        // Seal the outcome BEFORE charging (so we never charge without a card).
        const serverSeed = crypto.randomBytes(16).toString('hex');
        const commitHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        const outcome = computeOutcome(serverSeed);
        const winAmount = Math.round(cost * outcome.multiplier * 100) / 100;

        let cardId, newBalance;
        await db.beginTransaction();
        try {
            const balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            const balanceBefore = balRow ? balRow.balance : 0;
            const deduct = await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
                [cost, userId, cost]
            );
            if (!deduct || deduct.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient balance' });
            }
            const balanceAfter = Math.round((balanceBefore - cost) * 100) / 100;
            newBalance = balanceAfter;
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'bet', -cost, balanceBefore, balanceAfter, GAME_ID + ':buy']
            );
            const ins = await db.run(
                'INSERT INTO scratch_cards (user_id, tier, cost, server_seed, commit_hash, grid_json, win_symbol, multiplier, win_amount, status) ' +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sealed')",
                [userId, tier, cost, serverSeed, commitHash, JSON.stringify(outcome.grid), outcome.winSymbol, outcome.multiplier, winAmount]
            );
            cardId = ins.id || ins.lastID || ins.lastInsertRowid;
            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_) {}
            throw txErr;
        }

        // Outcome stays hidden until /reveal — only the commitment leaks.
        return res.json({ cardId, tier, cost, commitHash, newBalance });
    } catch (err) {
        console.error('[ScratchCards] buy error:', err.message);
        return res.status(500).json({ error: 'Failed to buy scratch card' });
    }
});

// ── POST /reveal { cardId } — reveal grid + credit winnings (idempotent) ──
router.post('/reveal', authenticate, async (req, res) => {
    try {
        if (degraded(res)) return;
        await ensureSchema();
        const userId = req.user.id;
        const cardId = Number(req.body && req.body.cardId);
        if (!cardId) return res.status(400).json({ error: 'cardId required' });

        const card = await db.get(
            'SELECT id, cost, server_seed, commit_hash, grid_json, win_symbol, multiplier, win_amount, status FROM scratch_cards WHERE id = ? AND user_id = ?',
            [cardId, userId]
        );
        if (!card) return res.status(404).json({ error: 'Card not found' });

        const grid = JSON.parse(card.grid_json);
        const payload = {
            cardId: card.id,
            grid,
            winSymbol: card.win_symbol,
            multiplier: card.multiplier,
            winAmount: card.win_amount,
            serverSeed: card.server_seed,
            commitHash: card.commit_hash,
        };

        if (card.status === 'revealed') {
            const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            return res.json(Object.assign(payload, { newBalance: u ? u.balance : 0, alreadyRevealed: true }));
        }

        // Atomically flip to revealed (CAS guards against double-credit).
        const flip = await db.run(
            "UPDATE scratch_cards SET status = 'revealed', revealed_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'sealed'",
            [cardId, userId]
        );
        if (!flip || flip.changes === 0) {
            // Lost the race — re-read and return current state.
            const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            return res.json(Object.assign(payload, { newBalance: u ? u.balance : 0, alreadyRevealed: true }));
        }

        let newBalance;
        if (card.win_amount > 0) {
            await db.beginTransaction();
            try {
                const balRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                const balanceBefore = balRow ? balRow.balance : 0;
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [card.win_amount, userId]);
                const balanceAfter = Math.round((balanceBefore + card.win_amount) * 100) / 100;
                newBalance = balanceAfter;
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'win', card.win_amount, balanceBefore, balanceAfter, GAME_ID + ':reveal']
                );
                await db.commit();
            } catch (txErr) {
                try { await db.rollback(); } catch (_) {}
                throw txErr;
            }
        } else {
            const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            newBalance = u ? u.balance : 0;
        }

        // Ledger + VIP XP (records the full bet+win for this card).
        await casualWager.record(userId, GAME_ID, card.cost, card.win_amount, { grid, winSymbol: card.win_symbol }, card.server_seed);

        return res.json(Object.assign(payload, { newBalance }));
    } catch (err) {
        console.error('[ScratchCards] reveal error:', err.message);
        return res.status(500).json({ error: 'Failed to reveal scratch card' });
    }
});

// ── GET /history — recent cards for this player ──────────────────────────
router.get('/history', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const userId = req.user.id;
        const rows = await db.all(
            'SELECT id, tier, cost, win_symbol, multiplier, win_amount, status, created_at, revealed_at FROM scratch_cards WHERE user_id = ? ORDER BY id DESC LIMIT 30',
            [userId]
        );
        res.json({ cards: rows, count: rows.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load history' });
    }
});

// Test hooks (pure functions — no DB).
router._test = { WIN_TABLE, ALL_SYMBOLS, computeOutcome, makeRng, TIERS, GAME_ID };

module.exports = router;
