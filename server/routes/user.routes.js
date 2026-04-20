'use strict';

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, username, email, date_of_birth, balance_cents, is_admin, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                date_of_birth: user.date_of_birth,
                balance: Number(user.balance_cents || 0) / 100,
                balance_cents: Number(user.balance_cents || 0),
                is_admin: !!user.is_admin,
                created_at: user.created_at,
            },
        });
    } catch (err) {
        console.error('[user/me]', err);
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
});

router.get('/deposits', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT id, amount_cents, currency, status, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 100',
            [req.user.id]
        );
        res.json({
            deposits: rows.map(r => ({
                id: r.id,
                amount: Number(r.amount_cents) / 100,
                amount_cents: Number(r.amount_cents),
                currency: r.currency,
                status: r.status,
                created_at: r.created_at,
                completed_at: r.completed_at,
            })),
        });
    } catch (err) {
        console.error('[user/deposits]', err);
        res.status(500).json({ error: 'Failed to fetch deposit history.' });
    }
});

module.exports = router;
