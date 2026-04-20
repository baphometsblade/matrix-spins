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

router.delete('/', authenticate, async (req, res) => {
    // Hard-deletes the user row; deposits and NFT receipts are retained
    // so refunds and accounting can still resolve, but user_id is
    // anonymized (0) so no PII persists. Matches the GDPR "right to
    // erasure" pattern used by regulated platforms.
    const { confirm_username } = req.body || {};
    try {
        const user = await db.get('SELECT username FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (confirm_username !== user.username) {
            return res.status(400).json({ error: 'To confirm deletion, send { "confirm_username": "<your username>" }.' });
        }
        const isPg = db.kind === 'pg';
        // Detach deposits and NFTs (keep the rows for accounting, drop PII)
        await db.run('UPDATE deposits SET user_id = 0 WHERE user_id = ?', [req.user.id]);
        await db.run('UPDATE nft_receipts SET user_id = 0 WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM password_resets WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM refunds WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM users WHERE id = ?', [req.user.id]);
        console.log('[user/delete] account ' + req.user.id + ' deleted');
        res.json({ ok: true });
        void isPg;
    } catch (err) {
        console.error('[user/delete]', err);
        res.status(500).json({ error: 'Failed to delete account.' });
    }
});

module.exports = router;
