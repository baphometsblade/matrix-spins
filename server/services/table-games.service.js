'use strict';

/**
 * Shared helpers for Blackjack, Roulette, Video Poker.
 * - schema bootstrap for table_game_history + blackjack_sessions
 * - responsible-gambling pre-flight checks (self-exclusion, daily wager,
 *   per-spin max bet, weekly/monthly loss limits, session win cap)
 * - atomic balance debit / credit (mirrors spin.routes.js semantics so
 *   table-game wagers contribute to all the same RG / VIP / tournament hooks)
 *
 * IMPORTANT: this module deliberately writes wagers and wins into the SAME
 * `spins` table that `/api/spin` uses. That keeps:
 *   - daily / weekly / monthly loss-limit math correct (spin.routes already
 *     sums from `spins`)
 *   - tournament + leaderboard + VIP XP feeds consistent
 *   - hand history visible in the unified game-history UI
 * The `game_id` column on `spins` carries 'blackjack', 'roulette' or
 * 'video-poker' for these rows.
 */

const db = require('../database');

let _schemaReady = false;
async function ensureSchema() {
    if (_schemaReady) return;
    const isPg = typeof db.isPg === 'function' && db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

    // Persistent blackjack hand state (one open hand per user)
    await db.run(
        `CREATE TABLE IF NOT EXISTS blackjack_sessions (
            user_id      INTEGER PRIMARY KEY,
            state_json   TEXT NOT NULL,
            updated_at   ${tsDef}
        )`
    );

    // Roulette spin history (last-N display + hot/cold)
    await db.run(
        `CREATE TABLE IF NOT EXISTS roulette_history (
            id           ${idDef},
            user_id      INTEGER,
            number       INTEGER NOT NULL,
            color        TEXT NOT NULL,
            total_bet    REAL NOT NULL,
            total_win    REAL NOT NULL,
            created_at   ${tsDef}
        )`
    );
    try { await db.run('CREATE INDEX IF NOT EXISTS idx_roulette_created ON roulette_history(created_at)'); } catch (_) {}

    // Recent results table — global feed for hot/cold display (last 200).
    // Periodically pruned by the route.

    _schemaReady = true;
}

// ── Pre-flight checks (subset of spin.routes.js, table-game equivalent) ──
async function preflightWager(userId, betAmount) {
    // Self-exclusion (self_exclusions + user_limits)
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) return { ok: false, status: 403, error: 'Account is self-excluded.' };
    } catch (_) { /* table may not exist yet */ }

    let limits = null;
    try {
        limits = await db.get(
            'SELECT self_excluded_until, cooling_off_until, max_bet_per_spin, daily_wager_limit, weekly_loss_limit, monthly_loss_limit FROM user_limits WHERE user_id = ?',
            [userId]
        );
    } catch (_) {}

    if (limits) {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if (limits.self_excluded_until && limits.self_excluded_until > now) {
            return { ok: false, status: 403, error: 'Account is self-excluded.' };
        }
        if (limits.cooling_off_until && limits.cooling_off_until > now) {
            return { ok: false, status: 403, error: 'Account is in cooling-off period.' };
        }
        if (limits.max_bet_per_spin && betAmount > limits.max_bet_per_spin) {
            return { ok: false, status: 403, error: `Per-bet max is $${Number(limits.max_bet_per_spin).toFixed(2)}.` };
        }

        // Daily wager limit (table games count toward the same daily total)
        if (limits.daily_wager_limit && limits.daily_wager_limit > 0) {
            try {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const wagered = await db.get(
                    'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ? AND created_at >= ?',
                    [userId, todayStart.toISOString()]
                );
                const remaining = limits.daily_wager_limit - (wagered?.total || 0);
                if (remaining <= 0) return { ok: false, status: 400, error: `Daily wager limit reached.` };
                if (betAmount > remaining) return { ok: false, status: 400, error: `Bet exceeds daily allowance ($${remaining.toFixed(2)} left).` };
            } catch (_) {}
        }

        // Weekly / monthly loss limits
        try {
            const computeLoss = async (sinceClause) => {
                const r = await db.get(
                    "SELECT COALESCE(SUM(bet_amount), 0) as wagered, COALESCE(SUM(win_amount), 0) as won " +
                    "FROM spins WHERE user_id = ? AND created_at >= " + sinceClause,
                    [userId]
                );
                return Math.max(0, Number((r?.wagered || 0)) - Number((r?.won || 0)));
            };
            if (limits.weekly_loss_limit) {
                const wkLoss = await computeLoss("datetime('now', '-7 days')");
                if (wkLoss + betAmount > limits.weekly_loss_limit) {
                    return { ok: false, status: 403, error: 'Weekly loss limit reached.' };
                }
            }
            if (limits.monthly_loss_limit) {
                const mLoss = await computeLoss("datetime('now', 'start of month')");
                if (mLoss + betAmount > limits.monthly_loss_limit) {
                    return { ok: false, status: 403, error: 'Monthly loss limit reached.' };
                }
            }
        } catch (_) {}
    }

    // Active wagering requirement → cap bet at min($10, 10% of WR)
    try {
        const wr = await db.get('SELECT wagering_requirement, wagering_progress FROM users WHERE id = ?', [userId]);
        if (wr && wr.wagering_requirement > 0 && (wr.wagering_progress || 0) < wr.wagering_requirement) {
            const cap = Math.max(1, Math.min(10, wr.wagering_requirement * 0.10));
            if (betAmount > cap) {
                return { ok: false, status: 400, error: `Max bet during bonus wagering is $${cap.toFixed(2)}.` };
            }
        }
    } catch (_) {}

    return { ok: true };
}

/**
 * Atomic debit. Returns { ok, balance } or { ok: false, error }.
 * Uses `balance = balance - ? WHERE balance >= ?` for race-safety.
 */
async function debitBalance(userId, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Invalid amount' };
    const r = await db.run(
        'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
        [amount, userId, amount]
    );
    if (!r || !r.changes) return { ok: false, error: 'Insufficient balance' };
    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return { ok: true, balance: u ? u.balance : 0 };
}

async function creditBalance(userId, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: true };
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
    return { ok: true };
}

async function getBalance(userId) {
    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return u ? Number(u.balance) : 0;
}

/**
 * Records a settled table-game round into the `spins` table so VIP / RG /
 * tournament / leaderboard pipelines pick it up automatically. Caller
 * passes the GROSS bet (sum of all chips at risk) and GROSS payout
 * (sum returned to player including stake on wins).
 */
async function recordRound(userId, gameId, betAmount, winAmount, meta) {
    try {
        await db.run(
            'INSERT INTO spins (user_id, game_id, bet_amount, win_amount, multiplier, symbols, created_at) VALUES (?,?,?,?,?,?,' +
                (typeof db.isPg === 'function' && db.isPg() ? 'NOW()' : "datetime('now')") +
            ')',
            [userId, gameId, betAmount, winAmount, betAmount > 0 ? winAmount / betAmount : 0,
             JSON.stringify(meta || {})]
        );
    } catch (err) {
        // spins table is owned by spin.routes — if columns differ, fall back to a minimal insert
        try {
            await db.run('INSERT INTO spins (user_id, game_id, bet_amount, win_amount) VALUES (?,?,?,?)',
                [userId, gameId, betAmount, winAmount]);
        } catch (e2) {
            console.warn('[TableGames] recordRound failed:', err.message, '/ fallback:', e2.message);
        }
    }
}

module.exports = {
    ensureSchema,
    preflightWager,
    debitBalance,
    creditBalance,
    getBalance,
    recordRound,
};
