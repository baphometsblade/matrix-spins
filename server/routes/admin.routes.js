'use strict';

const express = require('express');
const db = require('../database');
const config = require('../config');
const { authenticate, requireAdmin, bumpTokenVersion } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');
const mailer = require('../services/email.service');

const router = express.Router();

router.use(authenticate, requireAdmin);

function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
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
        res.send(header + body + '\n');
    } catch (err) {
        console.error('[admin/deposits.csv]', err);
        res.status(500).json({ error: 'Export failed.' });
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

module.exports = router;
