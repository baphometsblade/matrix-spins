'use strict';

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');
const mailer = require('../services/email.service');

function reqIp(req) {
    const fwd = req && req.headers && req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return (req && req.ip) || null;
}
function reqUa(req) {
    return (req && req.headers && req.headers['user-agent']) || null;
}

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userPublic(u) {
    return {
        id: u.id,
        username: u.username,
        email: u.email,
        display_name: u.display_name || null,
        date_of_birth: u.date_of_birth,
        balance: Number(u.balance_cents || 0) / 100,
        balance_cents: Number(u.balance_cents || 0),
        is_admin: !!u.is_admin,
        created_at: u.created_at,
    };
}

router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, username, email, display_name, date_of_birth, balance_cents, is_admin, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: userPublic(user) });
    } catch (err) {
        console.error('[user/me]', err);
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
});

router.patch('/me', authenticate, async (req, res) => {
    const { email, display_name } = req.body || {};
    const updates = [];
    const params = [];

    if (email !== undefined) {
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }
        const conflict = await db.get(
            'SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?',
            [email.trim(), req.user.id]
        );
        if (conflict) return res.status(409).json({ error: 'That email is already in use.' });
        updates.push('email = ?');
        params.push(email.trim());
    }
    if (display_name !== undefined) {
        if (display_name !== null) {
            if (typeof display_name !== 'string') return res.status(400).json({ error: 'display_name must be a string.' });
            const name = display_name.trim();
            if (name.length > 40) return res.status(400).json({ error: 'display_name must be ≤ 40 characters.' });
            if (name && !/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) {
                return res.status(400).json({ error: 'display_name contains unsupported characters.' });
            }
            updates.push('display_name = ?');
            params.push(name || null);
        } else {
            updates.push('display_name = NULL');
        }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });
    params.push(req.user.id);

    try {
        const before = await db.get('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
        await db.run('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', params);
        const updated = await db.get(
            'SELECT id, username, email, display_name, date_of_birth, balance_cents, is_admin, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        await authEvents.log({ userId: req.user.id, username: req.user.username, eventType: 'profile_update', outcome: 'success', req });
        // If the email address changed, alert BOTH addresses — the old
        // one so a compromised account surfaces the change, the new
        // one so we don't rely solely on a potentially-attacker inbox.
        if (before && before.email && email !== undefined && email.trim() && email.trim().toLowerCase() !== String(before.email).toLowerCase()) {
            for (const to of new Set([before.email, email.trim()])) {
                mailer.sendSecurityAlert({
                    to: to, username: req.user.username, event: 'email_change',
                    ip: reqIp(req), userAgent: reqUa(req),
                }).catch(function (err) { console.warn('[user/me] email alert failed:', err && err.message); });
            }
        }
        res.json({ user: userPublic(updated) });
    } catch (err) {
        console.error('[user/me PATCH]', err);
        res.status(500).json({ error: 'Failed to update profile.' });
    }
});

router.get('/login-history', authenticate, async (req, res) => {
    try {
        const rows = await authEvents.recentForUser(req.user.id, req.query.limit || 50);
        res.json({
            events: rows.map(r => ({
                id: r.id,
                type: r.event_type,
                outcome: r.outcome,
                ip: r.ip,
                user_agent: r.user_agent,
                reason: r.reason,
                at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[user/login-history]', err);
        res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

router.get('/deposits.csv', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT id, amount_cents, currency, status, provider, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 5000',
            [req.user.id]
        );
        const header = 'id,amount,currency,status,provider,created_at,completed_at\n';
        const body = rows.map(r => [
            r.id,
            (Number(r.amount_cents) / 100).toFixed(2),
            r.currency, r.status, r.provider, r.created_at, r.completed_at,
        ].map(csvEscape).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="my-deposits-' + new Date().toISOString().slice(0, 10) + '.csv"');
        res.send(header + body + '\n');
    } catch (err) {
        console.error('[user/deposits.csv]', err);
        res.status(500).json({ error: 'Export failed.' });
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
