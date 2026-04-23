'use strict';

const express = require('express');
const db = require('../database');
const config = require('../config');
const { authenticate, requireAdmin, bumpTokenVersion } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');

const router = express.Router();

router.use(authenticate, requireAdmin);

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
    try {
        const rows = await db.all(
            'SELECT id, username, email, balance_cents, is_admin, created_at FROM users ORDER BY id DESC LIMIT ?',
            [limit]
        );
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

module.exports = router;
