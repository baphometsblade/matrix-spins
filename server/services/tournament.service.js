'use strict';

const db = require('../database');

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function addHours(h) {
    return new Date(Date.now() + h * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', '');
}

const HOURLY_CONFIG = {
    type: 'hourly',
    name: '⚡ Hourly Blitz',
    prize_pool: 50,
    entry_fee: 0,
    durationHours: 1,
    prizes: [25, 15, 10],       // top 3
};

const DAILY_CONFIG = {
    type: 'daily',
    name: '🏆 Daily Grand',
    prize_pool: 500,
    entry_fee: 0,
    durationHours: 24,
    prizes: [200, 100, 75, 75, 50], // top 5
};

// ── Core functions ────────────────────────────────────────────────────────────

async function ensureActive() {
    for (const cfg of [HOURLY_CONFIG, DAILY_CONFIG]) {
        const existing = await db.get(
            "SELECT id FROM tournaments WHERE type = ? AND status IN ('upcoming','active')",
            [cfg.type]
        );
        if (!existing) {
            const now = nowIso();
            const ends = addHours(cfg.durationHours);
            await db.run(
                "INSERT INTO tournaments (name, type, prize_pool, entry_fee, status, starts_at, ends_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
                [cfg.name, cfg.type, cfg.prize_pool, cfg.entry_fee, now, ends]
            );
        }
    }
}

async function getActive() {
    const rows = await db.all(
        "SELECT t.id, t.name, t.type, t.prize_pool, t.entry_fee, t.starts_at, t.ends_at, COUNT(te.id) as entry_count FROM tournaments t LEFT JOIN tournament_entries te ON te.tournament_id = t.id WHERE t.status = 'active' AND t.ends_at > datetime('now') GROUP BY t.id ORDER BY t.type ASC"
    );
    return rows;
}

async function getUpcoming() {
    const rows = await db.all(
        "SELECT id, name, type, prize_pool, entry_fee, starts_at, ends_at FROM tournaments WHERE status = 'upcoming' ORDER BY starts_at ASC LIMIT 5"
    );
    return rows;
}

async function join(tournamentId, userId) {
    try {
        await db.run(
            "INSERT OR IGNORE INTO tournament_entries (tournament_id, user_id) VALUES (?, ?)",
            [tournamentId, userId]
        );
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function submitScore(tournamentId, userId, winMult) {
    if (!winMult || winMult <= 0) return;
    // Auto-join if not already entered
    await db.run(
        "INSERT OR IGNORE INTO tournament_entries (tournament_id, user_id) VALUES (?, ?)",
        [tournamentId, userId]
    );
    // Update best_mult if this spin beat their record
    await db.run(
        "UPDATE tournament_entries SET best_mult = MAX(best_mult, ?), spins = spins + 1 WHERE tournament_id = ? AND user_id = ?",
        [winMult, tournamentId, userId]
    );
}

async function getLeaderboard(tournamentId) {
    const rows = await db.all(
        `SELECT te.best_mult, te.spins, te.joined_at, u.username
         FROM tournament_entries te
         JOIN users u ON te.user_id = u.id
         WHERE te.tournament_id = ?
         ORDER BY te.best_mult DESC
         LIMIT 10`,
        [tournamentId]
    );
    return rows.map((r, i) => ({ rank: i + 1, username: r.username, best_mult: r.best_mult, spins: r.spins }));
}

async function _completeTournament(t, cfg) {
    await db.run("UPDATE tournaments SET status = 'completed' WHERE id = ?", [t.id]);
    const board = await getLeaderboard(t.id);
    const prizeList = cfg ? cfg.prizes : [];
    for (let i = 0; i < Math.min(board.length, prizeList.length); i++) {
        const prize = prizeList[i];
        if (!prize || prize <= 0) continue;
        // Find user_id for this entry
        const entry = await db.get(
            "SELECT te.user_id FROM tournament_entries te JOIN users u ON te.user_id = u.id WHERE te.tournament_id = ? AND u.username = ?",
            [t.id, board[i].username]
        );
        if (!entry) continue;
        try {
            // Atomic: credit + audit log in single transaction per winner
            await db.beginTransaction();
            try {
                await db.run(
                    "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?",
                    [prize, prize * 15, entry.user_id]
                );
                // Read actual balance AFTER credit for accurate audit trail
                var postUpdate = await db.get("SELECT balance, bonus_balance FROM users WHERE id = ?", [entry.user_id]);
                var balAfter = postUpdate ? Number(postUpdate.balance) + Number(postUpdate.bonus_balance || 0) : 0;
                var balBefore = balAfter - prize;
                await db.run(
                    "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, 'tournament_prize', ?, ?, ?, ?)",
                    [entry.user_id, prize, balBefore, balAfter, `tournament:${t.id}:rank${i + 1} (bonus, 15x wagering)`]
                );
                await db.commit();
            } catch (txErr) {
                await db.rollback().catch(function(rbErr) { console.warn('[Tournament] Rollback failed:', rbErr.message); });
                throw txErr;
            }
        } catch (e) {
            console.warn('[Tournament] Prize credit error:', e.message);
        }
    }
}

async function tick() {
    // Transition upcoming → active
    await db.run(
        "UPDATE tournaments SET status = 'active' WHERE status = 'upcoming' AND starts_at <= datetime('now')"
    );

    // Find expired active tournaments
    const expired = await db.all(
        "SELECT id, type FROM tournaments WHERE status = 'active' AND ends_at < datetime('now')"
    );
    for (const t of expired) {
        const cfg = t.type === 'hourly' ? HOURLY_CONFIG : DAILY_CONFIG;
        try {
            await _completeTournament(t, cfg);
        } catch (e) {
            console.warn('[Tournament] Complete error:', e.message);
        }
    }

    // Create new tournaments for any type that just ran out
    await ensureActive();
}

module.exports = { ensureActive, getActive, getUpcoming, join, submitScore, getLeaderboard, tick };
