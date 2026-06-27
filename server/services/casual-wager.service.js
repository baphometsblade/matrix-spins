'use strict';

/**
 * Casual-game wager guard + ledger helper.
 *
 * Scratch Cards and Mines are REAL-money wagered games (like slots): the stake
 * is debited from withdrawable `balance` and wins are credited to `balance`.
 * They therefore must honour the same responsible-gambling stack the slot route
 * enforces, and must feed the shared `spins` table so RG limits / VIP XP /
 * tournaments account for them (MEMORY.md: "All wagers go through shared spins
 * table").
 *
 * This module centralises the pre-wager checks (instead of copy-pasting the
 * spin.routes.js logic into two more files) and the post-wager bookkeeping.
 *
 * Failure policy mirrors spin.routes.js:
 *   • Self-exclusion  → fail CLOSED (block on DB error)
 *   • Optional limits → fail OPEN on transient errors (log + continue), but
 *                       block when a real configured limit is exceeded.
 */

const db = require('../database');

let _lossLimitService = null;
let _sessionTimer = null;
let _vipService = null;
function lossLimitService() { return _lossLimitService || (_lossLimitService = require('./loss-limit.service')); }
function sessionTimer()    { return _sessionTimer    || (_sessionTimer    = require('./session-timer.service')); }
function vipService()      { return _vipService      || (_vipService      = require('./vip.service')); }

/**
 * Run all responsible-gambling pre-checks for a real-money wager.
 * @returns {Promise<{allowed:boolean, status?:number, error?:string, extra?:object}>}
 */
async function precheck(userId, bet) {
    // ── 1. Self-exclusion — fail CLOSED ──────────────────────────────────
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            return { allowed: false, status: 403, error: 'Your account is currently self-excluded from playing.' };
        }
    } catch (exclErr) {
        if (exclErr.message && exclErr.message.includes('no such table')) {
            // table not bootstrapped yet — tolerate
        } else {
            console.error('[CasualWager] Self-exclusion check failed:', exclErr.message);
            return { allowed: false, status: 500, error: 'Security check failed. Please try again.' };
        }
    }

    // ── 2. Per-spin max-bet + daily wager limit (user_limits + spins sum) ──
    let limitsRow = null;
    try {
        limitsRow = await db.get(
            'SELECT daily_wager_limit, max_bet_per_spin, pending_max_bet, pending_max_bet_at ' +
            'FROM user_limits WHERE user_id = ?',
            [userId]
        );
    } catch (ulErr) {
        if (ulErr.message && !/no such column|no such table|column .* does not exist/i.test(ulErr.message)) {
            console.warn('[CasualWager] user_limits prefetch failed:', ulErr.message);
        }
    }

    if (limitsRow) {
        let effectiveMax = limitsRow.max_bet_per_spin;
        if (limitsRow.pending_max_bet && limitsRow.pending_max_bet_at &&
            new Date(limitsRow.pending_max_bet_at) <= new Date()) {
            effectiveMax = limitsRow.pending_max_bet;
        }
        if (effectiveMax !== null && effectiveMax !== undefined && bet > effectiveMax) {
            return {
                allowed: false, status: 403, error: 'max_bet_per_spin',
                extra: { message: 'Your per-bet maximum is $' + Number(effectiveMax).toFixed(2) + '.', limit: Number(effectiveMax) }
            };
        }

        if (limitsRow.daily_wager_limit > 0) {
            try {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayWagered = await db.get(
                    "SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ? AND created_at >= ?",
                    [userId, todayStart.toISOString()]
                );
                if (todayWagered) {
                    const remaining = limitsRow.daily_wager_limit - todayWagered.total;
                    if (remaining <= 0) {
                        return { allowed: false, status: 400, error: 'Daily wager limit reached. Limit resets at midnight.', extra: { dailyWagerLimitReached: true } };
                    }
                    if (bet > remaining) {
                        return { allowed: false, status: 400, error: 'Bet exceeds remaining daily wager allowance ($' + remaining.toFixed(2) + ' left).', extra: { dailyWagerRemaining: remaining } };
                    }
                }
            } catch (twErr) {
                console.warn('[CasualWager] daily wager sum failed:', twErr.message);
            }
        }
    }

    // ── 3. Daily loss limit (loss-limit.service) ─────────────────────────
    try {
        const lossCheck = await lossLimitService().checkDailyLossLimit(userId, bet);
        if (lossCheck && !lossCheck.allowed) {
            return {
                allowed: false, status: 403, error: 'daily_loss_limit',
                extra: { message: 'Daily loss limit reached', dailyLoss: lossCheck.dailyLoss, limit: lossCheck.limit }
            };
        }
    } catch (llErr) {
        console.warn('[CasualWager] daily loss check error:', llErr.message);
    }

    // ── 4. Session time limit (session-timer.service) ────────────────────
    try {
        const sessionCheck = await sessionTimer().checkSession(userId);
        if (sessionCheck && !sessionCheck.allowed) {
            return {
                allowed: false, status: 403, error: 'session_time_limit',
                extra: { message: 'You have reached your session time limit. Please take a break and return later.', elapsed: sessionCheck.elapsed, limit: sessionCheck.limit }
            };
        }
    } catch (stErr) {
        console.warn('[CasualWager] session check error:', stErr.message);
    }

    return { allowed: true };
}

/**
 * Record a settled wager into the shared `spins` ledger and award VIP XP.
 * Fire-and-forget safe — never throws. Call AFTER the balance transaction
 * commits.
 */
async function record(userId, gameId, betAmount, winAmount, resultObj, seed) {
    // Ledger row (feeds RG loss limits, tournaments, RTP, VIP net-loss).
    try {
        await db.run(
            'INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, rng_seed) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, gameId, betAmount, JSON.stringify(resultObj || {}), winAmount, seed || null]
        );
    } catch (insErr) {
        console.warn('[CasualWager] spins ledger insert failed:', insErr.message);
    }

    // VIP XP (1 XP per $1 wagered) + monthly net-loss tracking for cashback.
    if (betAmount > 0) {
        try {
            await vipService().addXp(userId, betAmount);
            const netLoss = betAmount - (winAmount || 0);
            if (netLoss > 0) await vipService().trackNetLoss(userId, netLoss);
        } catch (xpErr) {
            console.warn('[CasualWager] VIP XP error:', xpErr.message);
        }
    }
}

module.exports = { precheck, record };
