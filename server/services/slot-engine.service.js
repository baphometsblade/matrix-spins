'use strict';

/**
 * Server-authoritative slot engine.
 *
 * Every spin is settled here:
 *   1. We atomically debit the bet (conditional UPDATE prevents oversending).
 *   2. We derive reel positions from HMAC-SHA256(server_seed, client_seed:nonce:i).
 *   3. We evaluate the paytable for the game.
 *   4. We credit any win.
 *   5. We log the round with the revealed seed.
 *   6. We roll a fresh commit so the next spin binds to a new server seed.
 *
 * Provably-fair contract
 *   Before the spin, the client sees sha256(server_seed) via
 *   /api/slot/commit. After the spin, the response reveals the actual
 *   server_seed; the client can verify sha256(server_seed) matches.
 *   The client may supply a client_seed of its own to mix in extra
 *   entropy the server cannot choose.
 *
 * Games
 *   One game is wired today — "classic_777", a 3-reel single-payline
 *   fruit machine with a 10-symbol reel strip tuned to ~95% RTP. The
 *   structure here (games registry) accepts more games without any
 *   engine changes — define the reel strip + paytable and add it to
 *   GAMES.
 */

const crypto = require('crypto');
const db = require('../database');
const featureFlags = require('./feature-flags.service');

/* ────────────────────────────── games ────────────────────────────── */

/**
 * classic_777 — 3 reels × 1 payline (center row), reel length 10.
 *
 * Reel strip (one per reel, same composition on all three for RTP math):
 *   cherry × 4, lemon × 2, orange × 2, bar × 1, seven × 1
 *
 * Paytable (multiplier × bet for 3-of-a-kind on payline):
 *   cherry =   3x   →  4³  = 64  × 3  =  192
 *   lemon  =  10x   →  2³  =  8  × 10 =   80
 *   orange =  15x   →  2³  =  8  × 15 =  120
 *   bar    =  60x   →  1³  =  1  × 60 =   60
 *   seven  = 500x   →  1³  =  1  × 500=  500
 *                                       ────
 *                                       952 / 1000 = 95.2% RTP
 *
 * No partial wins, no scatter, no wild — one payline, center row,
 * matching three. Small and verifiable.
 */
const CLASSIC_777_REEL = [
    'cherry', 'cherry', 'cherry', 'cherry',
    'lemon', 'lemon',
    'orange', 'orange',
    'bar',
    'seven',
];

const CLASSIC_777_PAYTABLE = {
    cherry: 3,
    lemon: 10,
    orange: 15,
    bar: 60,
    seven: 500,
};

/**
 * neon_burst — 5 reels × reel-length-15, single payline (5-of-a-kind on
 * the center row). Reel composition is identical on each reel so RTP
 * math is closed-form: P(5-of-a-kind for symbol with count c) = (c/15)^5,
 * contribution = pay × c^5 / 15^5.
 *
 * Counts: neon=5, pulse=4, star=3, comet=2, nova=1 (sum 15).
 *
 * Theoretical RTP:
 *   neon  0.4 × 3125 = 1250
 *   pulse 1   × 1024 = 1024
 *   star  8   ×  243 = 1944
 *   comet 60  ×   32 = 1920
 *   nova  1100 ×   1 = 1100
 *   total       7238 / 759375 = 0.9532 → 95.32% RTP
 */
const NEON_BURST_REEL = [
    'neon', 'neon', 'neon', 'neon', 'neon',
    'pulse', 'pulse', 'pulse', 'pulse',
    'star', 'star', 'star',
    'comet', 'comet',
    'nova',
];

const NEON_BURST_PAYTABLE = {
    neon: 0.4,
    pulse: 1,
    star: 8,
    comet: 60,
    nova: 1100,
};

const GAMES = {
    classic_777: {
        name: 'Classic 777',
        reels: [CLASSIC_777_REEL, CLASSIC_777_REEL, CLASSIC_777_REEL],
        paytable: CLASSIC_777_PAYTABLE,
        min_bet_cents: 10,      // $0.10
        max_bet_cents: 10000,   // $100
        rtp: 0.952,
    },
    neon_burst: {
        name: 'Neon Burst',
        reels: [NEON_BURST_REEL, NEON_BURST_REEL, NEON_BURST_REEL, NEON_BURST_REEL, NEON_BURST_REEL],
        paytable: NEON_BURST_PAYTABLE,
        min_bet_cents: 10,
        max_bet_cents: 10000,
        rtp: 0.9532,
    },
};

function listGames() {
    return Object.entries(GAMES).map(([id, g]) => ({
        id,
        name: g.name,
        min_bet_cents: g.min_bet_cents,
        max_bet_cents: g.max_bet_cents,
        rtp: g.rtp,
        // The full game definition is public on purpose: the verifier
        // page reimplements the RNG client-side and needs the reel
        // strips + paytable to recompute outcomes. Server-side seeds +
        // nonces are still revealed only post-spin, so the public reels
        // do not leak future spin results.
        reels_count: g.reels.length,
        reel_length: g.reels[0].length,
        symbols: Array.from(new Set(g.reels.flat())).sort(),
        paytable: g.paytable,
        reels: g.reels,
    }));
}

function hasGame(id) { return !!GAMES[id]; }

/* ─────────────────────────── RNG / reveal ─────────────────────────── */

function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function hmacSha256Hex(key, message) {
    return crypto.createHmac('sha256', key).update(message).digest('hex');
}

function newServerSeed() {
    // 32 random bytes → 64-hex-char string. Stored and later revealed.
    return crypto.randomBytes(32).toString('hex');
}

function normalizeClientSeed(raw) {
    // A user-supplied string. Anything up to 64 chars, ASCII printable.
    // Empty is allowed — we substitute a stable placeholder so HMAC
    // input is still well-defined.
    if (raw == null) return 'default';
    const s = String(raw).slice(0, 64).replace(/[^\x20-\x7e]/g, '');
    return s || 'default';
}

/**
 * Derive `count` floats in [0, 1) from HMAC-SHA256 output.
 *
 * Each float consumes 4 hex bytes (8 hex chars) → uint32. We read
 * sequentially from HMAC(server_seed, client_seed:nonce:round). If one
 * HMAC block (32 bytes → 8 floats) isn't enough we rehash with a
 * bumped round counter. 3-reel classic slot only needs 3 floats so
 * one block is always sufficient, but the helper is written to scale.
 */
function deriveFloats(serverSeed, clientSeed, nonce, count) {
    const out = [];
    let round = 0;
    while (out.length < count) {
        const mac = hmacSha256Hex(serverSeed, clientSeed + ':' + nonce + ':' + round);
        for (let i = 0; i + 8 <= mac.length && out.length < count; i += 8) {
            const hex = mac.slice(i, i + 8);
            const u32 = parseInt(hex, 16);
            out.push(u32 / 0x100000000);
        }
        round += 1;
    }
    return out;
}

function spinReels(game, serverSeed, clientSeed, nonce) {
    const floats = deriveFloats(serverSeed, clientSeed, nonce, game.reels.length);
    return game.reels.map((reel, i) => {
        const idx = Math.floor(floats[i] * reel.length);
        // Guard against the astronomically unlikely float === 1.0.
        const safeIdx = idx >= reel.length ? reel.length - 1 : idx;
        return { index: safeIdx, symbol: reel[safeIdx] };
    });
}

function evaluate(game, stops, betCents) {
    const symbols = stops.map(s => s.symbol);
    const first = symbols[0];
    const allMatch = symbols.every(s => s === first);
    if (!allMatch) return { win_cents: 0, line: null };
    const multiplier = Number(game.paytable[first] || 0);
    const win = Math.round(multiplier * betCents);
    return { win_cents: win, line: { symbols, multiplier } };
}

/* ──────────────────────── commit/reveal store ─────────────────────── */

async function getOrCreateCommit(userId) {
    const row = await db.get('SELECT user_id, server_seed, server_seed_hash, nonce FROM user_slot_seeds WHERE user_id = ?', [userId]);
    if (row) return row;
    const seed = newServerSeed();
    const hash = sha256Hex(seed);
    await db.run(
        'INSERT INTO user_slot_seeds (user_id, server_seed, server_seed_hash, nonce) VALUES (?, ?, ?, ?)',
        [userId, seed, hash, 0]
    );
    return { user_id: userId, server_seed: seed, server_seed_hash: hash, nonce: 0 };
}

async function rollNewCommit(userId) {
    const seed = newServerSeed();
    const hash = sha256Hex(seed);
    await db.run(
        'UPDATE user_slot_seeds SET server_seed = ?, server_seed_hash = ?, nonce = 0 WHERE user_id = ?',
        [seed, hash, userId]
    );
    return { server_seed: seed, server_seed_hash: hash, nonce: 0 };
}

async function publicCommit(userId) {
    const c = await getOrCreateCommit(userId);
    return { server_seed_hash: c.server_seed_hash, nonce: Number(c.nonce) };
}

/* ─────────────────────── persistent client seed ────────────────────── */

/**
 * Stake-style rotatable client seed. Stored on users.slot_client_seed
 * (NULL = treated as 'default'). Per-spin overrides via the request
 * body still win — the persistent seed is the default the engine uses
 * when the caller didn't supply one.
 *
 * Validation here is strict (typed + length + printable-ASCII). The
 * per-spin path goes through normalizeClientSeed() which is lossy by
 * design (silently strips non-printable). Asymmetric on purpose: the
 * persistent value must round-trip cleanly; per-spin tolerates noise.
 */
function validateClientSeed(raw) {
    if (typeof raw !== 'string') return { ok: false, error: 'client_seed must be a string.' };
    if (raw.length < 1 || raw.length > 64) return { ok: false, error: 'client_seed must be 1–64 chars.' };
    if (/[^\x20-\x7e]/.test(raw)) return { ok: false, error: 'client_seed must be printable ASCII.' };
    return { ok: true, normalized: raw };
}

async function getClientSeed(userId) {
    const row = await db.get('SELECT slot_client_seed FROM users WHERE id = ?', [userId]);
    return normalizeClientSeed(row && row.slot_client_seed);
}

async function setClientSeed(userId, raw) {
    const v = validateClientSeed(raw);
    if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
    await db.run('UPDATE users SET slot_client_seed = ? WHERE id = ?', [v.normalized, userId]);
    return v.normalized;
}

/* ───────────────────────── loss-limit helper ──────────────────────── */

/**
 * Rolling-window net loss for `userId` over the last `sinceSec` seconds.
 *
 * Sign convention: positive `used` = money lost in the window. A net-
 * winning window clamps to 0 — a user who is up on the day does not
 * "earn" headroom against their loss limit (that would defeat the
 * purpose of the gate).
 *
 * Returns `oldestAt` so callers can derive a soft reset_at = that
 * round's created_at + window. Oldest-out-ages-first is the honest
 * read of a rolling window; at that instant the oldest contribution
 * leaves, not the whole balance.
 */
async function sumNetLossSince(userId, sinceSec) {
    const row = await db.get(
        db.kind === 'pg'
            ? `SELECT COALESCE(SUM(bet_cents - win_cents), 0) AS net_loss,
                      MIN(created_at) AS oldest_at
                 FROM slot_rounds
                WHERE user_id = ?
                  AND created_at >= NOW() - (? * INTERVAL '1 second')`
            : `SELECT COALESCE(SUM(bet_cents - win_cents), 0) AS net_loss,
                      MIN(created_at) AS oldest_at
                 FROM slot_rounds
                WHERE user_id = ?
                  AND created_at >= datetime('now', ? || ' seconds')`,
        db.kind === 'pg' ? [userId, sinceSec] : [userId, '-' + sinceSec]
    );
    const net = Number((row && row.net_loss) || 0);
    return { used: Math.max(0, net), oldestAt: (row && row.oldest_at) || null };
}

/* ──────────────────────── per-user spin lock ──────────────────────── */

/**
 * Serializes spins per-user inside a single Node process.
 *
 * Why this exists: the loss-limit gate reads SUM(bet_cents - win_cents)
 * over slot_rounds and compares to the user's cap. The check + the
 * subsequent atomic balance debit + the round insert are not in one DB
 * transaction. Without serialization, two concurrent spins from the
 * same user can both observe used=X, both pass the gate, both debit,
 * both insert — net loss can exceed the cap by N×bet. That's a
 * regulator-mandated responsible-gambling control being bypassed under
 * pipelined requests.
 *
 * Single-instance fix: chain each user's spin off a Promise queue.
 * Within one process this is correct and cheap. The deploy target
 * (Render, single instance) makes this enough today.
 *
 * If we ever scale to multiple app instances we need DB-side
 * serialization too — pg_advisory_xact_lock(userId) inside a
 * transaction is the canonical answer; sqlite's single-writer file
 * lock already gives us cross-instance serialization for that backend.
 * Track this as a hard prerequisite of horizontal-scale work.
 */
const userSpinLocks = new Map(); // userId -> Promise

async function withSpinLock(userId, fn) {
    const prev = userSpinLocks.get(userId) || Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    const chained = prev.then(() => next);
    userSpinLocks.set(userId, chained);
    try {
        await prev;
        return await fn();
    } finally {
        release();
        // Drop the entry only if a later caller hasn't already replaced
        // our slot — otherwise we'd leak that caller's promise off
        // the queue and break ordering for subsequent spins.
        if (userSpinLocks.get(userId) === chained) {
            userSpinLocks.delete(userId);
        }
    }
}

/* ──────────────────────────── spin handler ────────────────────────── */

async function spin(args) {
    // The spin body runs under a per-user lock so the loss-limit
    // check-and-debit cannot race against a concurrent spin from the
    // same user. The pause-flag check and bet validation could run
    // outside the lock, but keeping everything inside makes the
    // failure modes easier to reason about (errors surface from one
    // place) and the lock is only contended on hot per-user spam.
    return withSpinLock(args.userId, () => spinImpl(args));
}

async function spinImpl({ userId, gameId, betCents, clientSeed }) {
    // Operator kill switch. If an ops engineer flipped the slot-engine
    // paused flag (incident response, suspected exploit, maintenance
    // window), every spin refuses with 503 until the flag is cleared.
    // The flag read is cached in-process for 5s so this adds ~microseconds
    // to the hot path once the cache is warm.
    const pauseFlag = await featureFlags.getFlag('slot.paused', { paused: false, reason: null });
    if (pauseFlag && pauseFlag.paused) {
        const e = new Error(pauseFlag.reason
            ? 'Slot engine is paused: ' + pauseFlag.reason
            : 'Slot engine is temporarily paused for maintenance.');
        e.status = 503;
        e.code = 'slot_paused';
        throw e;
    }

    // Per-game pause: ops can take down a single game (e.g. a suspect
    // paytable, a partial deploy) without disabling the whole engine.
    // Same shape as the global flag; the same in-memory cache makes
    // the second read free after warm-up.
    const gamePause = await featureFlags.getFlag('slot.paused.' + gameId, { paused: false, reason: null });
    if (gamePause && gamePause.paused) {
        const e = new Error(gamePause.reason
            ? gameId + ' is paused: ' + gamePause.reason
            : gameId + ' is temporarily unavailable.');
        e.status = 503;
        e.code = 'slot_paused';
        e.game_id = gameId;
        throw e;
    }

    const game = GAMES[gameId];
    if (!game) { const e = new Error('Unknown game.'); e.status = 404; throw e; }
    const bet = Math.round(Number(betCents));
    if (!Number.isFinite(bet) || bet < game.min_bet_cents || bet > game.max_bet_cents) {
        const e = new Error(`Bet must be between ${game.min_bet_cents} and ${game.max_bet_cents} cents.`);
        e.status = 400;
        throw e;
    }

    // Loss-limit gate. Runs after bet validation so absurd bets fail fast,
    // and before the debit so we never record a round we'd have to void.
    // Not folded into the debit UPDATE because the rolling-window aggregate
    // would run on every spin even when the user has no limit set — this
    // branch is skipped entirely when loss_limit_daily_cents is 0.
    // Folded SELECT: loss-limit + persistent client seed in one round trip.
    const userRow = await db.get(
        'SELECT loss_limit_daily_cents, slot_client_seed FROM users WHERE id = ?',
        [userId]
    );
    const lossLimit = Number((userRow && userRow.loss_limit_daily_cents) || 0);
    const persistedClientSeed = userRow && userRow.slot_client_seed;
    if (lossLimit > 0) {
        const { used, oldestAt } = await sumNetLossSince(userId, 86400);
        if (used + bet > lossLimit) {
            const resetAt = oldestAt
                ? new Date(Date.parse(oldestAt) + 86400 * 1000).toISOString()
                : new Date(Date.now() + 86400 * 1000).toISOString();
            const e = new Error('Daily loss limit reached.');
            e.status = 403;
            e.code = 'loss_limit_reached';
            e.limit_cents = lossLimit;
            e.used_cents = used;
            e.reset_at = resetAt;
            throw e;
        }
    }

    // 1) Atomically debit the bet AND gate self-exclusion in a single
    //    UPDATE. If the user isn't funded OR the account is paused,
    //    zero rows change and we disambiguate with ONE SELECT. Happy
    //    path: one UPDATE per spin, no gate-SELECT at all.
    const debit = await db.run(
        'UPDATE users SET balance_cents = balance_cents - ? ' +
        'WHERE id = ? AND balance_cents >= ? ' +
        'AND (self_excluded_until IS NULL OR self_excluded_until < ' + db.sqlNow() + ')',
        [bet, userId, bet]
    );
    if (Number(debit && debit.changes) < 1) {
        const u = await db.get('SELECT balance_cents, self_excluded_until FROM users WHERE id = ?', [userId]);
        if (u && u.self_excluded_until && Date.parse(u.self_excluded_until) > Date.now()) {
            const untilIso = new Date(Date.parse(u.self_excluded_until)).toISOString();
            const e = new Error('Your account is self-excluded until ' + untilIso + '.');
            e.status = 403;
            e.code = 'self_excluded';
            e.until = untilIso;
            throw e;
        }
        const e = new Error('Insufficient balance.');
        e.status = 402;
        throw e;
    }

    // 2) Pull (or lazy-create) the commit, bump nonce, derive stops.
    const commit = await getOrCreateCommit(userId);
    const nonce = Number(commit.nonce) + 1;
    // Per-spin override beats the persistent seed (back-compat for the
    // existing API tests that pass client_seed in the body, and for
    // power users hitting the API directly). Otherwise fall back to
    // the user's rotatable seed; normalize handles NULL → 'default'.
    const effectiveSeed = (clientSeed != null && clientSeed !== '') ? clientSeed : persistedClientSeed;
    const normalizedClientSeed = normalizeClientSeed(effectiveSeed);
    const stops = spinReels(game, commit.server_seed, normalizedClientSeed, nonce);
    const { win_cents, line } = evaluate(game, stops, bet);

    // 3) Credit any win.
    if (win_cents > 0) {
        await db.run(
            'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
            [win_cents, userId]
        );
    }

    // 4) Read the new balance for the response + round log.
    const balRow = await db.get('SELECT balance_cents FROM users WHERE id = ?', [userId]);
    const balanceAfter = Number((balRow && balRow.balance_cents) || 0);

    // 5) Persist the round with the revealed seed.
    const outcome = { stops, line, reels_meta: { length: game.reels[0].length, count: game.reels.length } };
    await db.run(
        `INSERT INTO slot_rounds
            (user_id, game_id, bet_cents, win_cents, balance_after_cents,
             server_seed, server_seed_hash, client_seed, nonce, outcome_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, gameId, bet, win_cents, balanceAfter,
         commit.server_seed, commit.server_seed_hash, normalizedClientSeed, nonce, JSON.stringify(outcome)]
    );
    const roundRow = await db.get(
        'SELECT id FROM slot_rounds WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [userId]
    );
    const roundId = roundRow && roundRow.id;

    // 6) Attribute the bet to any active bonus grants (FIFO, spill-
    //    over). Best-effort — failures don't unwind the spin since
    //    the slot_rounds row is the source of truth and ops can
    //    backfill from there. Inside the per-user spin lock so
    //    concurrent attribution races are impossible.
    try {
        await require('./bonus-grants.service').recordWager(userId, bet);
    } catch (err) {
        console.warn('[slot/spin] bonus wager attribution warn:', err && err.message);
    }

    // 7) Roll a fresh commit for the next spin so the just-revealed seed
    //    can never be reused. The client immediately sees the next hash
    //    in `next_commit` and can verify the one it just consumed.
    const next = await rollNewCommit(userId);

    return {
        round_id: roundId,
        game_id: gameId,
        bet_cents: bet,
        win_cents,
        balance_cents: balanceAfter,
        outcome,
        revealed: {
            server_seed: commit.server_seed,
            server_seed_hash: commit.server_seed_hash,
            client_seed: normalizedClientSeed,
            nonce,
        },
        next_commit: {
            server_seed_hash: next.server_seed_hash,
        },
    };
}

const ROUND_COLUMNS = `id, game_id, bet_cents, win_cents, balance_after_cents,
        server_seed, server_seed_hash, client_seed, nonce, outcome_json, created_at`;

function normalizeRoundRow(r) {
    if (!r) return null;
    let outcome = null;
    try { outcome = JSON.parse(r.outcome_json); } catch { /* leave null */ }
    return {
        id: r.id,
        game_id: r.game_id,
        bet_cents: Number(r.bet_cents),
        win_cents: Number(r.win_cents),
        balance_after_cents: Number(r.balance_after_cents),
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        nonce: Number(r.nonce),
        outcome: outcome,
        created_at: r.created_at,
    };
}

async function listRounds(userId, limit) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await db.all(
        `SELECT ${ROUND_COLUMNS} FROM slot_rounds WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        [userId, n]
    );
    return rows.map(normalizeRoundRow);
}

async function getRound(userId, roundId) {
    const r = await db.get(
        `SELECT ${ROUND_COLUMNS} FROM slot_rounds WHERE user_id = ? AND id = ?`,
        [userId, Number(roundId)]
    );
    return normalizeRoundRow(r);
}

module.exports = {
    // public API
    listGames,
    hasGame,
    publicCommit,
    spin,
    listRounds,
    getRound,
    sumNetLossSince,
    getClientSeed,
    setClientSeed,
    validateClientSeed,
    getOrCreateCommit,
    rollNewCommit,
    // exposed for tests — pure helpers with no side effects
    _internals: {
        sha256Hex,
        deriveFloats,
        spinReels,
        evaluate,
        GAMES,
    },
};
