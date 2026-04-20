'use strict';

const express = require('express');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');

const router = express.Router();

router.use(authenticate, requireAdmin);

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
