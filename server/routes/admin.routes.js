'use strict';

const express = require('express');
const db = require('../database');
const config = require('../config');
const { authenticate, requireAdmin, bumpTokenVersion } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');
const mailer = require('../services/email.service');

const router = express.Router();

router.use(authenticate, requireAdmin);

// Same shape as the user-side helper — kept duplicated rather than
// imported to avoid a route-to-route require. See user.routes.js for
// the full rationale on the formula-injection defuse.
function csvEscape(v) {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

/**
 * POST /api/admin/deposits/:id/refund
 *
 * Initiates a Stripe refund for a paid deposit. Stripe then fires the
 * charge.refunded webhook which our existing handler processes
 * (decrements balance, flips deposit status, records refunds row).
 * This endpoint does NOT mutate balance directly — it only instructs
 * Stripe to refund, and trusts the webhook as the source of truth.
 */
router.post('/deposits/:id/refund', async (req, res) => {
    const depositId = parseInt(req.params.id, 10);
    if (!isFinite(depositId) || depositId <= 0) return res.status(400).json({ error: 'Invalid deposit id.' });
    const { amount_cents, reason } = req.body || {};
    try {
        const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [depositId]);
        if (!deposit) return res.status(404).json({ error: 'Deposit not found.' });
        if (deposit.status !== 'paid' && deposit.status !== 'partial_refund') {
            return res.status(400).json({ error: 'Only paid or partial_refund deposits can be refunded (status: ' + deposit.status + ').' });
        }
        if (!config.hasStripe) return res.status(503).json({ error: 'Stripe not configured.' });
        if (!deposit.provider_ref) return res.status(400).json({ error: 'No provider reference on deposit; cannot refund.' });

        const Stripe = require('stripe');
        const stripe = new Stripe(config.STRIPE_SECRET_KEY);
        // Retrieve the Checkout Session to find the payment_intent id.
        const session = await stripe.checkout.sessions.retrieve(deposit.provider_ref);
        if (!session || !session.payment_intent) {
            return res.status(400).json({ error: 'Could not resolve payment intent for this deposit.' });
        }
        const refundParams = { payment_intent: session.payment_intent };
        if (isFinite(Number(amount_cents)) && Number(amount_cents) > 0) {
            refundParams.amount = Number(amount_cents);
        }
        if (reason && typeof reason === 'string') {
            // Stripe reason is enumerated; default to requested_by_customer.
            refundParams.reason = ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason) ? reason : 'requested_by_customer';
        }
        const refund = await stripe.refunds.create(refundParams);
        await authEvents.log({
            userId: deposit.user_id,
            eventType: 'admin_refund',
            outcome: 'success',
            reason: 'admin=' + (req.user && req.user.username) + ' deposit=' + depositId + ' refund=' + refund.id,
            req,
        });
        res.json({ ok: true, refund_id: refund.id, status: refund.status, amount: Number(refund.amount || 0) / 100 });
    } catch (err) {
        console.error('[admin/refund]', err);
        res.status(500).json({ error: err.message || 'Refund failed.' });
    }
});

/**
 * POST /api/admin/users/:id/revoke-sessions
 *
 * Bumps the user's token_version so every existing JWT is immediately
 * invalidated. Useful when an account is compromised.
 */
router.post('/users/:id/revoke-sessions', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user id.' });
    try {
        const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        await bumpTokenVersion(userId);
        await authEvents.log({
            userId: userId,
            eventType: 'session_revoke',
            outcome: 'success',
            reason: 'admin=' + (req.user && req.user.username),
            req,
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('[admin/revoke-sessions]', err);
        res.status(500).json({ error: 'Failed to revoke sessions.' });
    }
});

router.get('/login-events', async (req, res) => {
    try {
        const rows = await authEvents.recentAll(req.query.limit || 100);
        res.json({
            events: rows.map(r => ({
                id: r.id,
                user_id: r.user_id,
                username: r.username,
                type: r.event_type,
                outcome: r.outcome,
                ip: r.ip,
                user_agent: r.user_agent,
                reason: r.reason,
                at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[admin/login-events]', err);
        res.status(500).json({ error: 'Failed to fetch events.' });
    }
});

router.get('/overview', async (_req, res) => {
    try {
        const [users, deposits, refunds, recentPaid, recentPending] = await Promise.all([
            db.get('SELECT COUNT(*) AS n FROM users'),
            db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total_cents FROM deposits WHERE status IN ('paid','partial_refund','refunded')`),
            db.get('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total_cents FROM refunds'),
            db.all(`SELECT d.id, d.user_id, u.username, d.amount_cents, d.currency, d.status, d.completed_at
                      FROM deposits d LEFT JOIN users u ON u.id = d.user_id
                     WHERE d.status IN ('paid','partial_refund','refunded')
                  ORDER BY d.completed_at DESC NULLS LAST
                     LIMIT 20`.replace('NULLS LAST', db.kind === 'pg' ? 'NULLS LAST' : '')),
            db.all(`SELECT d.id, d.user_id, u.username, d.amount_cents, d.currency, d.status, d.created_at
                      FROM deposits d LEFT JOIN users u ON u.id = d.user_id
                     WHERE d.status = 'pending'
                  ORDER BY d.created_at DESC
                     LIMIT 20`),
        ]);
        res.json({
            users: { total: Number(users.n) },
            deposits: {
                count: Number(deposits.n),
                volume_cents: Number(deposits.total_cents),
                volume: Number(deposits.total_cents) / 100,
            },
            refunds: {
                count: Number(refunds.n),
                volume_cents: Number(refunds.total_cents),
                volume: Number(refunds.total_cents) / 100,
            },
            recent_paid: recentPaid.map(r => ({
                id: r.id,
                user_id: r.user_id,
                username: r.username,
                amount: Number(r.amount_cents) / 100,
                currency: r.currency,
                status: r.status,
                completed_at: r.completed_at,
            })),
            recent_pending: recentPending.map(r => ({
                id: r.id,
                user_id: r.user_id,
                username: r.username,
                amount: Number(r.amount_cents) / 100,
                currency: r.currency,
                status: r.status,
                created_at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[admin/overview]', err);
        res.status(500).json({ error: 'Failed to build overview.' });
    }
});

router.get('/deposits', async (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
    try {
        let rows;
        if (statusFilter) {
            rows = await db.all(
                `SELECT d.id, d.user_id, u.username, d.amount_cents, d.currency, d.status,
                        d.provider_ref, d.created_at, d.completed_at
                   FROM deposits d LEFT JOIN users u ON u.id = d.user_id
                  WHERE d.status = ?
               ORDER BY d.id DESC LIMIT ?`,
                [statusFilter, limit]
            );
        } else {
            rows = await db.all(
                `SELECT d.id, d.user_id, u.username, d.amount_cents, d.currency, d.status,
                        d.provider_ref, d.created_at, d.completed_at
                   FROM deposits d LEFT JOIN users u ON u.id = d.user_id
               ORDER BY d.id DESC LIMIT ?`,
                [limit]
            );
        }
        res.json({
            deposits: rows.map(r => ({
                id: r.id,
                user_id: r.user_id,
                username: r.username,
                amount: Number(r.amount_cents) / 100,
                amount_cents: Number(r.amount_cents),
                currency: r.currency,
                status: r.status,
                provider_ref: r.provider_ref,
                created_at: r.created_at,
                completed_at: r.completed_at,
            })),
        });
    } catch (err) {
        console.error('[admin/deposits]', err);
        res.status(500).json({ error: 'Failed to list deposits.' });
    }
});

router.get('/users', async (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    try {
        let rows;
        if (q) {
            const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
            rows = await db.all(
                `SELECT id, username, email, balance_cents, is_admin, created_at FROM users
                  WHERE lower(username) LIKE lower(?) OR lower(email) LIKE lower(?)
               ORDER BY id DESC LIMIT ?`,
                [like, like, limit]
            );
        } else {
            rows = await db.all(
                'SELECT id, username, email, balance_cents, is_admin, created_at FROM users ORDER BY id DESC LIMIT ?',
                [limit]
            );
        }
        res.json({
            users: rows.map(r => ({
                id: r.id,
                username: r.username,
                email: r.email,
                balance: Number(r.balance_cents || 0) / 100,
                balance_cents: Number(r.balance_cents || 0),
                is_admin: !!r.is_admin,
                created_at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[admin/users]', err);
        res.status(500).json({ error: 'Failed to list users.' });
    }
});

/**
 * GET /api/admin/search?q=<query>
 * Cross-table lookup. Matches users by username/email and deposits by
 * id (numeric) or provider_ref (Stripe session id like "cs_…").
 */
router.get('/search', async (req, res) => {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    if (!q) return res.json({ users: [], deposits: [] });
    try {
        const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
        const numericId = /^\d+$/.test(q) ? parseInt(q, 10) : null;
        const userRows = await db.all(
            `SELECT id, username, email, balance_cents, is_admin, created_at FROM users
              WHERE lower(username) LIKE lower(?) OR lower(email) LIKE lower(?)
           ORDER BY id DESC LIMIT 20`,
            [like, like]
        );
        const depRows = await db.all(
            `SELECT d.id, d.user_id, u.username, d.amount_cents, d.currency, d.status,
                    d.provider_ref, d.created_at, d.completed_at
               FROM deposits d LEFT JOIN users u ON u.id = d.user_id
              WHERE d.id = ? OR lower(d.provider_ref) LIKE lower(?)
           ORDER BY d.id DESC LIMIT 20`,
            [numericId == null ? -1 : numericId, like]
        );
        res.json({
            users: userRows.map(r => ({
                id: r.id,
                username: r.username,
                email: r.email,
                balance: Number(r.balance_cents || 0) / 100,
                is_admin: !!r.is_admin,
                created_at: r.created_at,
            })),
            deposits: depRows.map(r => ({
                id: r.id,
                user_id: r.user_id,
                username: r.username,
                amount: Number(r.amount_cents) / 100,
                currency: r.currency,
                status: r.status,
                provider_ref: r.provider_ref,
                created_at: r.created_at,
                completed_at: r.completed_at,
            })),
        });
    } catch (err) {
        console.error('[admin/search]', err);
        res.status(500).json({ error: 'Search failed.' });
    }
});

/**
 * POST /api/admin/users/:id/adjust-balance
 *
 * Manual credit / debit performed by an operator. Writes to a dedicated
 * balance_adjustments audit table (immutable ledger) AND updates the
 * user balance in the same logical action. Requires a non-empty reason
 * string so audits are not blind. Emails the user with the delta.
 *
 * delta_cents may be negative (debit). Balance cannot go below zero.
 */
router.post('/users/:id/adjust-balance', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user id.' });
    const { delta_cents, reason } = req.body || {};
    const delta = Number(delta_cents);
    if (!isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
        return res.status(400).json({ error: 'delta_cents must be a non-zero integer.' });
    }
    // Guard against obvious fat-finger: cap a single adjustment at ±$100,000.
    if (Math.abs(delta) > 10000000) {
        return res.status(400).json({ error: 'Single adjustment cannot exceed $100,000.' });
    }
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) {
        return res.status(400).json({ error: 'A reason (3–500 chars) is required for audit.' });
    }
    try {
        const user = await db.get('SELECT id, username, email, balance_cents FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const before = Number(user.balance_cents || 0);
        const after = before + delta;
        if (after < 0) return res.status(400).json({ error: 'Adjustment would make balance negative (current: ' + (before / 100).toFixed(2) + ').' });

        await db.run('UPDATE users SET balance_cents = ? WHERE id = ?', [after, userId]);
        await db.run(
            `INSERT INTO balance_adjustments (user_id, admin_id, admin_username, delta_cents, balance_after_cents, reason)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, req.user.id, req.user.username || null, delta, after, reason.trim()]
        );
        await authEvents.log({
            userId: userId,
            eventType: 'admin_balance_adjustment',
            outcome: 'success',
            reason: 'admin=' + (req.user && req.user.username) + ' delta=' + delta + ' reason=' + reason.trim().slice(0, 80),
            req,
        });
        // Notify the user. Fire-and-forget — their inbox being down must
        // not roll back the audit entry.
        if (user.email) {
            const direction = delta > 0 ? 'credited to' : 'debited from';
            const magnitude = '$' + (Math.abs(delta) / 100).toFixed(2);
            mailer.send({
                to: user.email,
                subject: 'Matrix Spins balance adjustment',
                text: 'Hi ' + (user.username || 'there') + ',\n\n' +
                    magnitude + ' has been ' + direction + ' your Matrix Spins account by our team.\n' +
                    'Reason: ' + reason.trim() + '\n' +
                    'New balance: $' + (after / 100).toFixed(2) + '\n\n' +
                    'If you did not expect this, reply to this email.\n\n— Matrix Spins',
                html: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
                    '<h1 style="color:#d4af37;margin:0 0 8px;font-size:18px">Balance adjustment</h1>' +
                    '<p><strong style="color:' + (delta > 0 ? '#7fec7f' : '#ffbb7f') + '">' + (delta > 0 ? '+' : '−') + ' ' + magnitude + '</strong> ' + direction + ' your account by our team.</p>' +
                    '<p style="color:#b0b0b0">Reason: ' + reason.trim().replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]) + '</p>' +
                    '<p style="color:#b0b0b0">New balance: <strong>$' + (after / 100).toFixed(2) + '</strong></p>' +
                    '<p style="color:#8a8a8a;font-size:13px">If you did not expect this, reply to this email.</p>' +
                '</div>',
            }).catch(function (err) { console.warn('[admin/adjust-balance] email failed:', err && err.message); });
        }
        res.json({
            ok: true,
            user_id: userId,
            delta_cents: delta,
            balance_before_cents: before,
            balance_after_cents: after,
        });
    } catch (err) {
        console.error('[admin/adjust-balance]', err);
        res.status(500).json({ error: 'Failed to adjust balance.' });
    }
});

router.get('/users/:id/adjustments', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user id.' });
    try {
        const rows = await db.all(
            `SELECT id, admin_id, admin_username, delta_cents, balance_after_cents, reason, created_at
               FROM balance_adjustments WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
            [userId]
        );
        res.json({ adjustments: rows });
    } catch (err) {
        console.error('[admin/adjustments]', err);
        res.status(500).json({ error: 'Failed to fetch adjustments.' });
    }
});

/**
 * GET /api/admin/deposits.csv?status=paid
 * Streams (well, sends) a CSV of deposits. Useful for accounting export.
 */
router.get('/deposits.csv', async (req, res) => {
    const limit = Math.max(1, Math.min(10000, parseInt(req.query.limit, 10) || 1000));
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
    try {
        let rows;
        if (statusFilter) {
            rows = await db.all(
                `SELECT d.id, d.user_id, u.username, u.email, d.amount_cents, d.currency, d.status,
                        d.provider, d.provider_ref, d.created_at, d.completed_at
                   FROM deposits d LEFT JOIN users u ON u.id = d.user_id
                  WHERE d.status = ? ORDER BY d.id DESC LIMIT ?`,
                [statusFilter, limit]
            );
        } else {
            rows = await db.all(
                `SELECT d.id, d.user_id, u.username, u.email, d.amount_cents, d.currency, d.status,
                        d.provider, d.provider_ref, d.created_at, d.completed_at
                   FROM deposits d LEFT JOIN users u ON u.id = d.user_id
               ORDER BY d.id DESC LIMIT ?`,
                [limit]
            );
        }
        const header = 'id,user_id,username,email,amount,currency,status,provider,provider_ref,created_at,completed_at\n';
        const body = rows.map(r => [
            r.id, r.user_id, r.username, r.email,
            (Number(r.amount_cents) / 100).toFixed(2), r.currency, r.status,
            r.provider, r.provider_ref, r.created_at, r.completed_at,
        ].map(csvEscape).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="deposits-' + new Date().toISOString().slice(0, 10) + '.csv"');
        // Prepend a UTF-8 BOM so Excel (Windows) doesn't interpret the
        // file as Windows-1252 and mojibake unicode characters.
        res.send('﻿' + header + body + '\n');
    } catch (err) {
        console.error('[admin/deposits.csv]', err);
        res.status(500).json({ error: 'Export failed.' });
    }
});

/**
 * GET /api/admin/webhook-events?type=<filter>&limit=<n>
 * Lists recent processed Stripe webhook events.
 */
router.get('/webhook-events', async (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    const typeFilter = typeof req.query.type === 'string' && req.query.type.trim() ? req.query.type.trim() : null;
    try {
        let rows;
        if (typeFilter) {
            rows = await db.all(
                `SELECT id, provider, event_id, event_type, processed_at
                   FROM processed_webhook_events WHERE event_type = ? ORDER BY id DESC LIMIT ?`,
                [typeFilter, limit]
            );
        } else {
            rows = await db.all(
                `SELECT id, provider, event_id, event_type, processed_at
                   FROM processed_webhook_events ORDER BY id DESC LIMIT ?`,
                [limit]
            );
        }
        res.json({ events: rows });
    } catch (err) {
        console.error('[admin/webhook-events]', err);
        res.status(500).json({ error: 'Failed to fetch webhook events.' });
    }
});

/**
 * POST /api/admin/users/:id/unlock
 * Clears the recent failed-login + locked_out auth_events so a customer
 * can sign in again without waiting out the 15-minute lockout window.
 * Writes an audit row noting which operator unlocked them.
 */
router.post('/users/:id/unlock', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user id.' });
    try {
        const user = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
        const r = await db.run(
            `DELETE FROM auth_events
              WHERE lower(username) = lower(?)
                AND event_type = 'login'
                AND outcome IN ('failed','locked_out')
                AND created_at >= ?`,
            [user.username, sinceIso]
        );
        await authEvents.log({
            userId: user.id,
            username: user.username,
            eventType: 'admin_unlock',
            outcome: 'success',
            reason: 'admin=' + (req.user && req.user.username) + ' cleared=' + (r && r.changes || 0),
            req,
        });
        res.json({ ok: true, cleared: (r && r.changes) || 0 });
    } catch (err) {
        console.error('[admin/unlock]', err);
        res.status(500).json({ error: 'Unlock failed.' });
    }
});

/**
 * GET /api/admin/users/:id/detail
 *
 * Single-round-trip support lookup. Returns profile + ledger
 * components + deposit history + refund history + balance adjustments
 * + 2FA status + NFT count + recent auth events. Password hash, TOTP
 * secret, and recovery-code hashes are NEVER returned.
 */
router.get('/users/:id/detail', async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user id.' });
    try {
        const user = await db.get(
            `SELECT id, username, email, display_name, date_of_birth, balance_cents, is_admin,
                    deposit_limit_daily_cents, deposit_limit_weekly_cents, deposit_limit_monthly_cents,
                    token_version, created_at
               FROM users WHERE id = ?`,
            [userId]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const [paidRow, refundsRow, adjRow, depositRows, refundRows, adjustmentRows, twofa, recoveryCount, nftCount, events] = await Promise.all([
            db.get(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM deposits WHERE user_id = ? AND status IN ('paid','partial_refund')`, [userId]),
            db.get('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE user_id = ?', [userId]),
            db.get('SELECT COALESCE(SUM(delta_cents), 0) AS total FROM balance_adjustments WHERE user_id = ?', [userId]),
            db.all(`SELECT id, amount_cents, currency, status, provider, provider_ref, created_at, completed_at
                      FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [userId]),
            db.all(`SELECT id, deposit_id, amount_cents, provider_ref, reason, created_at
                      FROM refunds WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [userId]),
            db.all(`SELECT id, admin_username, delta_cents, balance_after_cents, reason, created_at
                      FROM balance_adjustments WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [userId]),
            db.get(`SELECT enabled, created_at, enabled_at FROM user_totp_secrets WHERE user_id = ?`, [userId]),
            db.get(`SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`, [userId]),
            db.get(`SELECT COUNT(*) AS n FROM nft_receipts WHERE user_id = ?`, [userId]),
            db.all(`SELECT id, event_type, outcome, ip, user_agent, reason, created_at
                      FROM auth_events WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [userId]),
        ]);

        const paid = Number((paidRow && paidRow.total) || 0);
        const refunded = Number((refundsRow && refundsRow.total) || 0);
        const adjusted = Number((adjRow && adjRow.total) || 0);
        const expected = paid - refunded + adjusted;
        const actual = Number(user.balance_cents || 0);

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                display_name: user.display_name,
                date_of_birth: user.date_of_birth,
                is_admin: !!user.is_admin,
                token_version: user.token_version,
                created_at: user.created_at,
            },
            balance: {
                actual_cents: actual,
                expected_cents: expected,
                drift_cents: actual - expected,
                paid_cents: paid,
                refunded_cents: refunded,
                adjusted_cents: adjusted,
            },
            limits: {
                daily_cents: Number(user.deposit_limit_daily_cents || 0),
                weekly_cents: Number(user.deposit_limit_weekly_cents || 0),
                monthly_cents: Number(user.deposit_limit_monthly_cents || 0),
            },
            two_factor: {
                enabled: !!(twofa && twofa.enabled),
                configured_at: twofa && twofa.created_at,
                enabled_at: twofa && twofa.enabled_at,
                recovery_codes_remaining: Number((recoveryCount && recoveryCount.n) || 0),
            },
            nft_count: Number((nftCount && nftCount.n) || 0),
            recent_deposits: depositRows,
            recent_refunds: refundRows,
            recent_adjustments: adjustmentRows,
            recent_events: events,
        });
    } catch (err) {
        console.error('[admin/users/:id/detail]', err);
        res.status(500).json({ error: 'Failed to fetch user detail.' });
    }
});

/**
 * GET /api/admin/audit/balances?user_id=N
 *
 * Compares every user's stored balance_cents against the ledger
 * derived from deposits + refunds + adjustments. Returns any drift.
 * The expected formula is:
 *
 *   expected = SUM(paid_and_partial_refund deposits)
 *            - SUM(refunds)
 *            + SUM(adjustments)
 *
 * Drift of zero for every user means our money is real money.
 * Run this on a schedule or before every accounting close.
 */
router.get('/audit/balances', async (req, res) => {
    const userIdFilter = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    try {
        const whereUser = userIdFilter ? ' WHERE id = ?' : '';
        const params = userIdFilter ? [userIdFilter] : [];
        const users = await db.all(
            'SELECT id, username, email, balance_cents FROM users' + whereUser + ' ORDER BY id',
            params
        );
        const out = [];
        for (const u of users) {
            const paidRow = await db.get(
                `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM deposits
                  WHERE user_id = ? AND status IN ('paid', 'partial_refund')`,
                [u.id]
            );
            const refundsRow = await db.get(
                'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE user_id = ?',
                [u.id]
            );
            const adjRow = await db.get(
                'SELECT COALESCE(SUM(delta_cents), 0) AS total FROM balance_adjustments WHERE user_id = ?',
                [u.id]
            );
            const paid = Number((paidRow && paidRow.total) || 0);
            const refunded = Number((refundsRow && refundsRow.total) || 0);
            const adjusted = Number((adjRow && adjRow.total) || 0);
            const expected = paid - refunded + adjusted;
            const actual = Number(u.balance_cents || 0);
            const drift = actual - expected;
            if (drift !== 0 || userIdFilter) {
                out.push({
                    user_id: u.id,
                    username: u.username,
                    email: u.email,
                    expected_cents: expected,
                    actual_cents: actual,
                    drift_cents: drift,
                    paid_cents: paid,
                    refunded_cents: refunded,
                    adjusted_cents: adjusted,
                });
            }
        }
        res.json({ count: out.length, drifted: out });
    } catch (err) {
        console.error('[admin/audit/balances]', err);
        res.status(500).json({ error: 'Audit failed.' });
    }
});

/**
 * POST /api/admin/reconcile-now
 * Triggers an immediate pending-deposit reconciliation pass against
 * Stripe. Same code path as the scheduled cron.
 */
router.post('/reconcile-now', async (_req, res) => {
    try {
        const reconciler = require('../services/deposit-reconciler.service');
        const out = await reconciler.reconcileOnce();
        res.json(out);
    } catch (err) {
        console.error('[admin/reconcile-now]', err);
        res.status(500).json({ error: err.message || 'Reconciliation failed.' });
    }
});

/**
 * Withdrawal ops. The user-facing side (POST /api/withdrawal/request
 * and friends) debits the balance into a pending row; the operator
 * decides here whether it's paid or denied. All status-machine logic
 * lives in routes/withdrawal.routes.js -> internal.
 */
router.get('/withdrawals', async (req, res) => {
    try {
        const { status, limit } = req.query || {};
        if (status && !['pending', 'paid', 'denied', 'cancelled'].includes(String(status))) {
            return res.status(400).json({ error: 'status must be one of pending|paid|denied|cancelled.' });
        }
        const { internal } = require('./withdrawal.routes');
        const rows = await internal.listAll({ status: status || null, limit });
        res.json({ withdrawals: rows });
    } catch (err) {
        console.error('[admin/withdrawals]', err);
        res.status(500).json({ error: 'Failed to list withdrawals.' });
    }
});

router.post('/withdrawals/:id/approve', async (req, res) => {
    try {
        const { internal } = require('./withdrawal.routes');
        const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 500) : null;
        const id = await internal.approve(Number(req.params.id), req.user, note);
        await require('../services/auth-events.service').log({
            userId: req.user.id, username: req.user.username,
            eventType: 'admin_action', outcome: 'success', req,
            reason: 'withdrawal_approve id=' + id,
        });
        res.json({ ok: true, id, status: 'paid' });
    } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        console.error('[admin/withdrawal/approve]', err);
        res.status(500).json({ error: 'Approve failed.' });
    }
});

router.post('/withdrawals/:id/deny', async (req, res) => {
    try {
        const { internal } = require('./withdrawal.routes');
        const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 500) : null;
        if (!note) return res.status(400).json({ error: 'note is required when denying a withdrawal so the user sees a reason.' });
        const id = await internal.deny(Number(req.params.id), req.user, note);
        await require('../services/auth-events.service').log({
            userId: req.user.id, username: req.user.username,
            eventType: 'admin_action', outcome: 'success', req,
            reason: 'withdrawal_deny id=' + id,
        });
        res.json({ ok: true, id, status: 'denied' });
    } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        console.error('[admin/withdrawal/deny]', err);
        res.status(500).json({ error: 'Deny failed.' });
    }
});

/**
 * Slot-rounds viewer — the audit surface for the server-authoritative
 * slot engine. Returns recent rounds across all users with the joined
 * username so ops can scan for anomalies (e.g. a user hitting the 500×
 * jackpot multiple times in a row, an unexpected spike in volume).
 *
 * Filters: any combination of
 *   ?user_id=<n>            scope to one user
 *   ?username=<s>           scope by exact username (case-insensitive)
 *   ?round_id=<n>           jump to one round
 *   ?server_seed_hash=<h>   find the round bound to a specific commit
 *                           (dispute investigation: a user emails a
 *                           screenshot, ops pastes the hash here)
 *   ?limit=<n>              capped at 500.
 *
 * Revealed seeds are included by design — an operator reviewing a
 * dispute can plug (server_seed, client_seed, nonce) into the
 * /verify-round.html page to confirm the outcome matches what we
 * returned to the user.
 */
router.get('/slot-rounds', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

        const where = [];
        const params = [];

        const userId = req.query.user_id ? Number(req.query.user_id) : null;
        if (Number.isFinite(userId) && userId > 0) {
            where.push('r.user_id = ?');
            params.push(userId);
        }

        const username = (req.query.username || '').toString().trim();
        if (username) {
            where.push('lower(u.username) = lower(?)');
            params.push(username);
        }

        const roundId = req.query.round_id ? Number(req.query.round_id) : null;
        if (Number.isFinite(roundId) && roundId > 0) {
            where.push('r.id = ?');
            params.push(roundId);
        }

        const seedHash = (req.query.server_seed_hash || '').toString().trim().toLowerCase();
        if (seedHash) {
            // Strict format gate so a typo'd hash doesn't silently scan
            // every row. Real hashes from the engine are 64 hex chars.
            if (!/^[0-9a-f]{64}$/.test(seedHash)) {
                return res.status(400).json({ error: 'server_seed_hash must be 64 hex characters.' });
            }
            where.push('r.server_seed_hash = ?');
            params.push(seedHash);
        }

        const sql =
            'SELECT r.id, r.user_id, u.username, r.game_id, r.bet_cents, r.win_cents, ' +
            'r.balance_after_cents, r.server_seed, r.server_seed_hash, r.client_seed, ' +
            'r.nonce, r.outcome_json, r.created_at ' +
            'FROM slot_rounds r LEFT JOIN users u ON u.id = r.user_id ' +
            (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
            'ORDER BY r.id DESC LIMIT ?';
        params.push(limit);

        const rows = await db.all(sql, params);
        res.json({
            rounds: rows.map(r => {
                let outcome = null;
                try { outcome = JSON.parse(r.outcome_json); } catch { /* leave null */ }
                return {
                    id: r.id,
                    user_id: r.user_id,
                    username: r.username,
                    game_id: r.game_id,
                    bet_cents: Number(r.bet_cents),
                    win_cents: Number(r.win_cents),
                    balance_after_cents: Number(r.balance_after_cents),
                    server_seed: r.server_seed,
                    server_seed_hash: r.server_seed_hash,
                    client_seed: r.client_seed,
                    nonce: Number(r.nonce),
                    outcome,
                    created_at: r.created_at,
                };
            }),
        });
    } catch (err) {
        console.error('[admin/slot-rounds]', err);
        res.status(500).json({ error: 'Failed to list slot rounds.' });
    }
});

/**
 * Feature flags — operator toggles.
 *
 * Today's keys:
 *   slot.paused                 = { paused: bool, reason: string|null }   global kill switch
 *   slot.paused.<game_id>       = { paused: bool, reason: string|null }   per-game kill switch
 *
 * PUT accepts any well-formed JSON value; per-key shape validation
 * lives in the handler. The allowlist is built from the engine's live
 * games registry so adding a new game registers its pause key
 * automatically.
 */
function allowedFeatureFlagKeys() {
    const engine = require('../services/slot-engine.service');
    const keys = new Set(['slot.paused']);
    for (const g of engine.listGames()) {
        keys.add('slot.paused.' + g.id);
    }
    return keys;
}

function validatePauseValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 'value must be { paused: bool, reason: string|null }.';
    }
    if (typeof value.paused !== 'boolean') {
        return 'value.paused must be a boolean.';
    }
    if (value.reason != null && (typeof value.reason !== 'string' || value.reason.length > 500)) {
        return 'value.reason must be null or a string ≤ 500 chars.';
    }
    return null;
}

router.get('/feature-flags', async (_req, res) => {
    try {
        const flags = await require('../services/feature-flags.service').listAll();
        res.json({ flags });
    } catch (err) {
        console.error('[admin/feature-flags GET]', err);
        res.status(500).json({ error: 'Failed to list feature flags.' });
    }
});

router.put('/feature-flags/:key', async (req, res) => {
    const key = req.params.key;
    const allowed = allowedFeatureFlagKeys();
    if (!allowed.has(key)) {
        return res.status(400).json({ error: 'Unknown feature flag key.', allowed: Array.from(allowed) });
    }
    const value = req.body && req.body.value;
    // All current keys (slot.paused + slot.paused.<game_id>) share the
    // pause-shape contract.
    if (key === 'slot.paused' || key.indexOf('slot.paused.') === 0) {
        const err = validatePauseValue(value);
        if (err) return res.status(400).json({ error: key + ': ' + err });
    }
    try {
        const flags = require('../services/feature-flags.service');
        const written = await flags.setFlag(key, value, req.user);
        await require('../services/auth-events.service').log({
            userId: req.user.id, username: req.user.username,
            eventType: 'admin_action', outcome: 'success', req,
            reason: 'feature_flag ' + key + '=' + JSON.stringify(written),
        });
        res.json({ key, value: written });
    } catch (err) {
        console.error('[admin/feature-flags PUT]', err);
        res.status(500).json({ error: 'Failed to update feature flag.' });
    }
});

/**
 * Slot analytics — per-game observability for ops. Returns lifetime
 * + last-window aggregates and the drift between empirical and
 * theoretical RTP. Pair with `slot.paused.<game_id>` (the per-game
 * kill switch) for a complete detect → pause → investigate loop.
 *
 * Query: ?window_days=N (default 30, capped to 365). Lifetime totals
 * are unbounded; the rolling-window aggregates respect this knob.
 *
 * Drift is empirical minus theoretical, expressed as a percentage of
 * theoretical. Negative = paying out less than designed (suspicious
 * for a hot game; cold variance is normal at low volume). Positive
 * is the more dangerous direction (paying out more than designed —
 * potential exploit). The `drift_warn` flag fires when |drift_pct|
 * exceeds DRIFT_WARN_PCT for games with at least
 * MIN_SPINS_FOR_DRIFT_WARN spins (small samples are too noisy to
 * trust).
 */
const DRIFT_WARN_PCT = 5;
const MIN_SPINS_FOR_DRIFT_WARN = 1000;

router.get('/slot-analytics', async (req, res) => {
    try {
        let windowDays = Number(req.query.window_days);
        if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 365) {
            windowDays = 30;
        }
        const sinceSec = windowDays * 86400;

        // Lifetime aggregate per game.
        const lifetime = await db.all(
            `SELECT game_id,
                    COUNT(*)                      AS spins,
                    COALESCE(SUM(bet_cents), 0)   AS wagered,
                    COALESCE(SUM(win_cents), 0)   AS won,
                    COALESCE(MAX(win_cents), 0)   AS biggest_win,
                    COUNT(DISTINCT user_id)       AS unique_players
               FROM slot_rounds
              GROUP BY game_id`
        );

        // Windowed aggregate per game (last N days).
        const isPg = db.kind === 'pg';
        const windowSql = isPg
            ? `SELECT game_id,
                      COUNT(*)                    AS spins,
                      COALESCE(SUM(bet_cents), 0) AS wagered,
                      COALESCE(SUM(win_cents), 0) AS won
                 FROM slot_rounds
                WHERE created_at >= NOW() - (? * INTERVAL '1 second')
                GROUP BY game_id`
            : `SELECT game_id,
                      COUNT(*)                    AS spins,
                      COALESCE(SUM(bet_cents), 0) AS wagered,
                      COALESCE(SUM(win_cents), 0) AS won
                 FROM slot_rounds
                WHERE created_at >= datetime('now', ? || ' seconds')
                GROUP BY game_id`;
        const windowParam = isPg ? sinceSec : ('-' + sinceSec);
        const windowed = await db.all(windowSql, [windowParam]);
        const windowedMap = new Map(windowed.map(r => [r.game_id, r]));
        const lifetimeMap = new Map(lifetime.map(r => [r.game_id, r]));

        const engine = require('../services/slot-engine.service');
        const games = engine.listGames();

        const out = games.map(g => {
            const life = lifetimeMap.get(g.id) || { spins: 0, wagered: 0, won: 0, biggest_win: 0, unique_players: 0 };
            const win = windowedMap.get(g.id) || { spins: 0, wagered: 0, won: 0 };
            const lifeWagered = Number(life.wagered) || 0;
            const lifeWon = Number(life.won) || 0;
            const winWagered = Number(win.wagered) || 0;
            const winWon = Number(win.won) || 0;
            const empirical = lifeWagered > 0 ? lifeWon / lifeWagered : null;
            const empiricalWindow = winWagered > 0 ? winWon / winWagered : null;
            const driftPct = (empirical != null) ? ((empirical - g.rtp) / g.rtp) * 100 : null;
            const driftWarn = (driftPct != null)
                && Number(life.spins) >= MIN_SPINS_FOR_DRIFT_WARN
                && Math.abs(driftPct) > DRIFT_WARN_PCT;
            return {
                game_id: g.id,
                name: g.name,
                theoretical_rtp: g.rtp,
                spins: Number(life.spins) || 0,
                wagered_cents: lifeWagered,
                won_cents: lifeWon,
                net_cents: lifeWagered - lifeWon, // house net (positive = house ahead)
                biggest_win_cents: Number(life.biggest_win) || 0,
                unique_players: Number(life.unique_players) || 0,
                empirical_rtp: empirical,
                drift_pct: driftPct,
                drift_warn: driftWarn,
                window: {
                    days: windowDays,
                    spins: Number(win.spins) || 0,
                    wagered_cents: winWagered,
                    won_cents: winWon,
                    empirical_rtp: empiricalWindow,
                },
            };
        });

        res.json({
            window_days: windowDays,
            drift_warn_pct: DRIFT_WARN_PCT,
            min_spins_for_drift_warn: MIN_SPINS_FOR_DRIFT_WARN,
            games: out,
        });
    } catch (err) {
        console.error('[admin/slot-analytics]', err);
        res.status(500).json({ error: 'Failed to compute slot analytics.' });
    }
});

module.exports = router;
