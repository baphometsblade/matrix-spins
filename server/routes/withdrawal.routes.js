'use strict';

/**
 * Withdrawal routes — user-facing cash-out.
 *
 * POST /api/withdrawal/request { amount, method, destination }
 *     Atomically reserves the amount from the user's balance and logs
 *     a pending withdrawal row. An operator reviews and approves/denies
 *     via /api/admin/withdrawals (see admin.routes.js).
 *
 * GET  /api/withdrawal
 *     List the caller's own withdrawals.
 *
 * POST /api/withdrawal/:id/cancel
 *     Users can cancel a still-pending withdrawal; balance is refunded.
 *
 * Minimums, caps, and verified-email gating match the deposit side.
 */

const express = require('express');
const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { selfExclusionResponse } = require('../middleware/self-exclusion');
const userRateLimit = require('../middleware/user-ratelimit');
const mailer = require('../services/email.service');
const { verifyTotpOrRecovery, currentSecret } = require('./twofa.routes');

const router = express.Router();

const MIN_WITHDRAWAL_CENTS = 1000;    // $10
const MAX_WITHDRAWAL_CENTS = 500000;  // $5,000 per request
const ALLOWED_METHODS = new Set(['bank_transfer', 'crypto']);

// Tight per-user limiter on the request endpoint to avoid accidental
// double-submits and trivial abuse.
const reqLimiter = userRateLimit({ maxRequests: 10, windowMs: 60 * 1000 });

function sanitizeDestination(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim().slice(0, 200);
    if (!s) return null;
    // Only printable ASCII + common separators; destination is free-form
    // (account number, IBAN, wallet address) but must not contain
    // control chars or newlines that could confuse downstream logs.
    if (!/^[\x20-\x7e]+$/.test(s)) return null;
    return s;
}

router.post('/request', authenticate, reqLimiter, async (req, res) => {
    const { amount, method, destination, currency } = req.body || {};

    const amt = Number(amount);
    const cents = Math.round(amt * 100);
    if (!Number.isFinite(amt) || cents < MIN_WITHDRAWAL_CENTS || cents > MAX_WITHDRAWAL_CENTS) {
        return res.status(400).json({
            error: `Amount must be between $${MIN_WITHDRAWAL_CENTS / 100} and $${MAX_WITHDRAWAL_CENTS / 100}.`,
        });
    }
    if (!ALLOWED_METHODS.has(method)) {
        return res.status(400).json({ error: 'method must be one of: ' + Array.from(ALLOWED_METHODS).join(', ') });
    }
    const dest = sanitizeDestination(destination);
    if (!dest) {
        return res.status(400).json({ error: 'destination is required (bank account details or wallet address, ASCII, ≤ 200 chars).' });
    }
    const cur = String(currency || 'usd').toLowerCase();
    if (!/^[a-z]{3}$/.test(cur)) {
        return res.status(400).json({ error: 'Invalid currency.' });
    }

    try {
        // Same gates as a deposit: verified email + not self-excluded.
        // A self-excluded user cannot pull money — they may return
        // after their break to request a withdrawal.
        const user = await db.get(
            'SELECT id, username, email, email_verified, self_excluded_until FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (!user.email_verified) {
            return res.status(403).json({ error: 'Please verify your email address before withdrawing.', code: 'email_unverified' });
        }
        if (selfExclusionResponse(res, user)) return;

        // If the user has 2FA enabled, require a fresh TOTP (or recovery)
        // code with this request. Cashout is the highest-risk authed
        // action; it's the industry default to re-challenge even inside
        // a valid session. Users without 2FA enabled proceed as before.
        const totpRow = await currentSecret(req.user.id);
        if (totpRow && totpRow.enabled) {
            const code = req.body && req.body.totp_code;
            if (typeof code !== 'string' || !code.trim()) {
                return res.status(401).json({
                    error: 'Two-factor code required to withdraw.',
                    code: 'totp_required',
                });
            }
            const verdict = await verifyTotpOrRecovery(req.user.id, code.trim());
            if (!verdict || !verdict.ok) {
                return res.status(401).json({
                    error: 'Two-factor code does not match.',
                    code: 'totp_invalid',
                });
            }
        }

        // Atomic debit. Conditional UPDATE refuses when balance < amount
        // so no negative balance can slip through a concurrent spin.
        const debit = await db.run(
            'UPDATE users SET balance_cents = balance_cents - ? WHERE id = ? AND balance_cents >= ?',
            [cents, req.user.id, cents]
        );
        if (Number(debit && debit.changes) < 1) {
            return res.status(402).json({ error: 'Insufficient balance for this withdrawal.' });
        }

        await db.run(
            `INSERT INTO withdrawals (user_id, amount_cents, currency, method, destination, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [req.user.id, cents, cur, method, dest]
        );
        const row = await db.get(
            'SELECT id, amount_cents, currency, method, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [req.user.id]
        );

        // Best-effort notification. Doesn't block the response.
        if (user.email) {
            mailer.sendWithdrawalRequested({ to: user.email, amount: cents / 100, currency: cur })
                .catch(function (err) { console.warn('[withdrawal/request] email warn:', err && err.message); });
        }

        res.status(201).json({
            withdrawal: {
                id: row.id,
                amount: Number(row.amount_cents) / 100,
                amount_cents: Number(row.amount_cents),
                currency: row.currency,
                method: row.method,
                status: row.status,
                created_at: row.created_at,
            },
        });
    } catch (err) {
        console.error('[withdrawal/request]', err);
        res.status(500).json({ error: 'Could not request withdrawal.' });
    }
});

router.get('/', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT id, amount_cents, currency, method, status, admin_note, created_at, processed_at
               FROM withdrawals WHERE user_id = ?
              ORDER BY id DESC LIMIT 100`,
            [req.user.id]
        );
        res.json({
            withdrawals: rows.map(r => ({
                id: r.id,
                amount: Number(r.amount_cents) / 100,
                amount_cents: Number(r.amount_cents),
                currency: r.currency,
                method: r.method,
                status: r.status,
                admin_note: r.admin_note,
                created_at: r.created_at,
                processed_at: r.processed_at,
            })),
        });
    } catch (err) {
        console.error('[withdrawal/list]', err);
        res.status(500).json({ error: 'Failed to fetch withdrawals.' });
    }
});

router.post('/:id/cancel', authenticate, async (req, res) => {
    try {
        const row = await db.get(
            'SELECT id, user_id, amount_cents, status FROM withdrawals WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!row) return res.status(404).json({ error: 'Withdrawal not found.' });
        if (row.status !== 'pending') {
            return res.status(409).json({ error: 'Only pending withdrawals can be cancelled.' });
        }
        // Flip to cancelled with a status-guarded UPDATE so two concurrent
        // requests (user cancel + operator approve) can't both succeed.
        const upd = await db.run(
            "UPDATE withdrawals SET status = 'cancelled', processed_at = " + db.sqlNow() + " WHERE id = ? AND status = 'pending'",
            [row.id]
        );
        if (Number(upd && upd.changes) < 1) {
            return res.status(409).json({ error: 'Withdrawal is no longer pending.' });
        }
        // Refund balance.
        await db.run(
            'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
            [row.amount_cents, row.user_id]
        );
        res.json({ ok: true, id: row.id, status: 'cancelled' });
    } catch (err) {
        console.error('[withdrawal/cancel]', err);
        res.status(500).json({ error: 'Could not cancel withdrawal.' });
    }
});

// Internal API used by the admin routes. Kept here so all status-machine
// logic lives in one module. Exported as `{ router, internal }` —
// the admin route file pulls `internal`; server/index.js mounts `router`.
const internal = {
    async approve(withdrawalId, admin, note) {
        const row = await db.get('SELECT id, user_id, amount_cents, currency, status FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!row) { const e = new Error('Withdrawal not found.'); e.status = 404; throw e; }
        if (row.status !== 'pending') { const e = new Error('Only pending withdrawals can be approved.'); e.status = 409; throw e; }
        const upd = await db.run(
            "UPDATE withdrawals SET status = 'paid', admin_id = ?, admin_username = ?, admin_note = ?, processed_at = " + db.sqlNow() + " WHERE id = ? AND status = 'pending'",
            [admin.id, admin.username || null, note || null, row.id]
        );
        if (Number(upd && upd.changes) < 1) {
            const e = new Error('Withdrawal state changed under us.'); e.status = 409; throw e;
        }
        try {
            const u = await db.get('SELECT email FROM users WHERE id = ?', [row.user_id]);
            if (u && u.email) {
                mailer.sendWithdrawalPaid({ to: u.email, amount: Number(row.amount_cents) / 100, currency: row.currency })
                    .catch(function () {});
            }
        } catch (err) { console.warn('[withdrawal/approve] notify:', err && err.message); }
        return row.id;
    },
    async deny(withdrawalId, admin, note) {
        const row = await db.get('SELECT id, user_id, amount_cents, currency, status FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!row) { const e = new Error('Withdrawal not found.'); e.status = 404; throw e; }
        if (row.status !== 'pending') { const e = new Error('Only pending withdrawals can be denied.'); e.status = 409; throw e; }
        const upd = await db.run(
            "UPDATE withdrawals SET status = 'denied', admin_id = ?, admin_username = ?, admin_note = ?, processed_at = " + db.sqlNow() + " WHERE id = ? AND status = 'pending'",
            [admin.id, admin.username || null, note || null, row.id]
        );
        if (Number(upd && upd.changes) < 1) {
            const e = new Error('Withdrawal state changed under us.'); e.status = 409; throw e;
        }
        await db.run(
            'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
            [row.amount_cents, row.user_id]
        );
        try {
            const u = await db.get('SELECT email FROM users WHERE id = ?', [row.user_id]);
            if (u && u.email) {
                mailer.sendWithdrawalDenied({ to: u.email, amount: Number(row.amount_cents) / 100, currency: row.currency, reason: note })
                    .catch(function () {});
            }
        } catch (err) { console.warn('[withdrawal/deny] notify:', err && err.message); }
        return row.id;
    },
    async listAll({ status, limit } = {}) {
        const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const params = [];
        let sql = 'SELECT w.*, u.username AS user_username, u.email AS user_email FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id';
        if (status) { sql += ' WHERE w.status = ?'; params.push(status); }
        sql += ' ORDER BY w.id DESC LIMIT ?';
        params.push(n);
        const rows = await db.all(sql, params);
        return rows.map(r => ({
            id: r.id,
            user_id: r.user_id,
            username: r.user_username,
            user_email: r.user_email,
            amount_cents: Number(r.amount_cents),
            amount: Number(r.amount_cents) / 100,
            currency: r.currency,
            method: r.method,
            destination: r.destination,
            status: r.status,
            admin_id: r.admin_id,
            admin_username: r.admin_username,
            admin_note: r.admin_note,
            created_at: r.created_at,
            processed_at: r.processed_at,
        }));
    },
};
module.exports = { router, internal };
void config;
