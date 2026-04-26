'use strict';

/**
 * Free-spin / bonus session manager.
 *
 * A bonus session is opened when a base spin's outcome trips the
 * trigger condition (today: scatter_count >= 3 on a game whose
 * catalog declares freeSpinsCount > 0). Subsequent spins in the same
 * session do not debit balance — the player gets `freeSpinsCount`
 * spins on the house, all wins credited normally.
 *
 * State machine
 *   active     → spins_remaining > 0; consumed via spin()
 *   completed  → spins_remaining == 0; row preserved as audit trail
 *
 * Retrigger
 *   If a free spin lands the trigger condition again, the session's
 *   spins_remaining is bumped by `freeSpinsRetrigger` (catalog flag).
 *   Some games allow it (most modern slots), others do not.
 *
 * Concurrency
 *   The host engine already serializes spins per-user via withSpinLock,
 *   so the session's spins_remaining can't race against itself. The
 *   atomic conditional UPDATE here is belt-and-suspenders for the
 *   future case where the lock is removed in favor of DB-level locks.
 */

const db = require('../database');

/**
 * Look up the user's active bonus session, if any. At most one
 * session is open at a time per user — opening a new session while
 * one is active is treated as a retrigger on the existing session.
 */
async function getActiveForUser(userId) {
    const row = await db.get(
        "SELECT id, user_id, game_id, bonus_type, original_bet_cents, " +
        "spins_remaining, spins_consumed, total_win_cents, status, state_json " +
        "FROM bonus_sessions WHERE user_id = ? AND status = 'active' " +
        "ORDER BY id DESC LIMIT 1",
        [userId]
    );
    return row || null;
}

async function getById(sessionId) {
    return await db.get(
        "SELECT id, user_id, game_id, bonus_type, original_bet_cents, " +
        "spins_remaining, spins_consumed, total_win_cents, status, state_json " +
        "FROM bonus_sessions WHERE id = ?",
        [sessionId]
    );
}

/**
 * Open a fresh free-spin session. Returns the new id, or null if the
 * game's catalog entry doesn't declare a positive freeSpinsCount (no
 * bonus to award).
 */
async function open({ userId, gameId, gameDef, betCents, triggerRoundId }) {
    const spins = Number(gameDef.freeSpinsCount) || 0;
    if (spins <= 0) return null;
    const bonusType = gameDef.bonusType || 'free_spins';
    const result = await db.run(
        "INSERT INTO bonus_sessions " +
        "(user_id, game_id, bonus_type, trigger_round_id, original_bet_cents, " +
        " spins_remaining, spins_consumed, total_win_cents, state_json, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, 0, 0, '{}', 'active')",
        [userId, gameId, bonusType, triggerRoundId || null, betCents, spins]
    );
    // SQLite returns lastID on the result; pg returns nothing — fetch by latest.
    if (result && result.lastID) return result.lastID;
    const row = await db.get(
        "SELECT id FROM bonus_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [userId]
    );
    return row && row.id;
}

/**
 * Add retrigger spins to an active session. Atomic: only modifies
 * a session that is still active. Returns the new spins_remaining.
 */
async function addRetriggerSpins(sessionId, count) {
    if (!Number.isFinite(count) || count <= 0) return null;
    await db.run(
        "UPDATE bonus_sessions SET spins_remaining = spins_remaining + ? " +
        "WHERE id = ? AND status = 'active'",
        [count, sessionId]
    );
    const row = await db.get(
        "SELECT spins_remaining FROM bonus_sessions WHERE id = ?",
        [sessionId]
    );
    return row && Number(row.spins_remaining);
}

/**
 * Consume one spin and credit any win to the running total. Marks the
 * session completed when spins_remaining hits zero. Returns the
 * post-update view (spins_remaining, total_win_cents, status).
 */
async function consumeSpin(sessionId, winCents) {
    // Atomic decrement guards against double-consume in the freak case
    // where the per-user spin lock is bypassed (e.g. multi-instance).
    const dec = await db.run(
        "UPDATE bonus_sessions SET " +
        "  spins_remaining = spins_remaining - 1, " +
        "  spins_consumed = spins_consumed + 1, " +
        "  total_win_cents = total_win_cents + ? " +
        "WHERE id = ? AND status = 'active' AND spins_remaining > 0",
        [Math.max(0, Number(winCents) || 0), sessionId]
    );
    if (Number(dec && dec.changes) < 1) {
        // Session already complete or doesn't exist.
        return null;
    }
    const row = await db.get(
        "SELECT spins_remaining, spins_consumed, total_win_cents, status " +
        "FROM bonus_sessions WHERE id = ?",
        [sessionId]
    );
    if (row && Number(row.spins_remaining) <= 0 && row.status === 'active') {
        await db.run(
            "UPDATE bonus_sessions SET status = 'completed', completed_at = " +
            db.sqlNow() + " WHERE id = ? AND status = 'active'",
            [sessionId]
        );
        row.status = 'completed';
    }
    return row;
}

/**
 * Trim the public-safe shape used in API responses.
 */
function publicShape(s) {
    if (!s) return null;
    return {
        id: Number(s.id),
        game_id: s.game_id,
        bonus_type: s.bonus_type,
        original_bet_cents: Number(s.original_bet_cents),
        spins_remaining: Number(s.spins_remaining),
        spins_consumed: Number(s.spins_consumed),
        total_win_cents: Number(s.total_win_cents),
        status: s.status,
    };
}

module.exports = {
    getActiveForUser,
    getById,
    open,
    addRetriggerSpins,
    consumeSpin,
    publicShape,
};
