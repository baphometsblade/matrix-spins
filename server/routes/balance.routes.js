'use strict';

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
    try {
        const row = await db.get('SELECT balance_cents FROM users WHERE id = ?', [req.user.id]);
        if (!row) return res.status(404).json({ error: 'User not found.' });
        res.json({ balance: Number(row.balance_cents || 0) / 100, balance_cents: Number(row.balance_cents || 0) });
    } catch (err) {
        console.error('[balance]', err);
        res.status(500).json({ error: 'Failed to fetch balance.' });
    }
});

module.exports = router;
