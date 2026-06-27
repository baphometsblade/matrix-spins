'use strict';

/**
 * Daily-Wheel deposit-bonus voucher.
 *
 * The Daily Prize Wheel can award a "10% deposit bonus" segment. Rather than
 * crediting cash up front (the player hasn't deposited yet), we store a pending
 * voucher and apply it the next time the player makes a real deposit.
 *
 * Application is wired into the canonical Stripe deposit-success path
 * (stripe.service.js) as a POST-COMMIT, fire-and-forget call. `applyOnDeposit`
 * therefore NEVER throws — a voucher problem must never affect a real deposit.
 *
 * The credited bonus follows CLAUDE.md rules: it lands in `bonus_balance` with a
 * 30x wagering requirement (deposit-match rate), is bounded by a per-voucher
 * cap, and is logged as a 'promo' transaction so it counts toward the global
 * $75/day bonus cap.
 */

const db = require('../database');
const bonusCap = require('./bonus-cap.service');

const DEPOSIT_VOUCHER_WAGERING_MULT = 30; // deposit-match rate per CLAUDE.md
const DEFAULT_MAX_BONUS = 50;             // cap one voucher's payout at $50
const DEFAULT_DAYS_VALID = 7;

let _ready = false;
async function ensureSchema() {
    if (_ready) return;
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS wheel_vouchers (' +
            '  id ' + idDef + ',' +
            '  user_id INTEGER NOT NULL,' +
            '  kind TEXT NOT NULL,' +
            '  percent REAL NOT NULL,' +
            '  max_bonus REAL NOT NULL,' +
            '  status TEXT DEFAULT \'pending\',' +
            '  created_at ' + tsDef + ',' +
            '  expires_at TEXT,' +
            '  redeemed_at TEXT' +
            ')'
        );
        _ready = true;
    } catch (err) {
        console.warn('[WheelVoucher] schema bootstrap error:', err.message);
    }
}

/**
 * Grant a pending deposit-bonus voucher (called by the wheel route).
 * Never throws.
 */
async function grantDepositVoucher(userId, percent, maxBonus, daysValid) {
    await ensureSchema();
    try {
        const expiresAt = new Date(Date.now() + (daysValid || DEFAULT_DAYS_VALID) * 86400000)
            .toISOString().slice(0, 19).replace('T', ' ');
        await db.run(
            "INSERT INTO wheel_vouchers (user_id, kind, percent, max_bonus, status, expires_at) VALUES (?, 'deposit_bonus', ?, ?, 'pending', ?)",
            [userId, percent, maxBonus || DEFAULT_MAX_BONUS, expiresAt]
        );
        return { granted: true, expiresAt };
    } catch (err) {
        console.warn('[WheelVoucher] grant failed:', err.message);
        return { granted: false };
    }
}

/** Return the user's active (pending, non-expired) deposit voucher, or null. */
async function getPendingVoucher(userId) {
    await ensureSchema();
    try {
        return await db.get(
            "SELECT id, percent, max_bonus, expires_at FROM wheel_vouchers " +
            "WHERE user_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > datetime('now')) " +
            "ORDER BY id ASC LIMIT 1",
            [userId]
        );
    } catch (err) {
        return null;
    }
}

/**
 * Apply the oldest pending deposit voucher to a just-completed deposit.
 * MUST be called post-commit. NEVER throws.
 * @returns {Promise<{applied:boolean, bonus?:number}>}
 */
async function applyOnDeposit(userId, depositAmount) {
    try {
        await ensureSchema();
        if (!(depositAmount > 0)) return { applied: false };

        const voucher = await getPendingVoucher(userId);
        if (!voucher) return { applied: false };

        // Atomically claim the voucher — guards against concurrent deposits.
        const claim = await db.run(
            "UPDATE wheel_vouchers SET status = 'redeemed', redeemed_at = datetime('now') WHERE id = ? AND status = 'pending'",
            [voucher.id]
        );
        if (!claim || claim.changes === 0) return { applied: false };

        let bonus = Math.min(depositAmount * (voucher.percent / 100), voucher.max_bonus);
        bonus = Math.round(bonus * 100) / 100;

        // Respect the global daily bonus cap.
        try {
            const cap = await bonusCap.checkDailyCap(userId);
            if (cap && cap.remaining < bonus) bonus = Math.round(cap.remaining * 100) / 100;
        } catch (_) { /* fail open on cap */ }

        if (!(bonus > 0)) return { applied: false };

        const wagerReq = Math.round(bonus * DEPOSIT_VOUCHER_WAGERING_MULT * 100) / 100;
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [bonus, wagerReq, userId]
        );
        try {
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
                [userId, 'promo', bonus, userId, userId, 'Daily Wheel ' + voucher.percent + '% deposit bonus (' + DEPOSIT_VOUCHER_WAGERING_MULT + 'x wagering)']
            );
        } catch (txErr) {
            console.warn('[WheelVoucher] tx log failed:', txErr.message);
        }
        return { applied: true, bonus };
    } catch (err) {
        console.warn('[WheelVoucher] applyOnDeposit failed (non-fatal):', err.message);
        return { applied: false };
    }
}

module.exports = {
    grantDepositVoucher,
    getPendingVoucher,
    applyOnDeposit,
    ensureSchema,
    DEPOSIT_VOUCHER_WAGERING_MULT,
};
