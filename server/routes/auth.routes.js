'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const db = require('../database');
const { signToken, sign2faChallenge, authenticate, verifyTokenString } = require('../middleware/auth');
const email = require('../services/email.service');
const authEvents = require('../services/auth-events.service');
const { verifyTotpOrRecovery, currentSecret } = require('./twofa.routes');

const router = express.Router();

const RESET_TOKEN_BYTES = 32;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function nowIso() { return new Date().toISOString(); }
function expiryIso() { return new Date(Date.now() + RESET_TTL_MS).toISOString(); }

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        date_of_birth: row.date_of_birth,
        balance: Number(row.balance_cents || 0) / 100,
        balance_cents: Number(row.balance_cents || 0),
        is_admin: !!row.is_admin,
        created_at: row.created_at,
    };
}

function ageInYears(dobStr) {
    if (!dobStr) return null;
    const dob = new Date(dobStr);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const m = now.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
    return age;
}

router.post('/register', async (req, res) => {
    const { username, email, password, date_of_birth } = req.body || {};

    if (!username || !USERNAME_RE.test(String(username))) {
        return res.status(400).json({ error: 'Username must be 3-32 chars (letters, digits, . _ -).' });
    }
    if (!email || !EMAIL_RE.test(String(email))) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const age = ageInYears(date_of_birth);
    if (age == null) {
        return res.status(400).json({ error: 'Please provide your date of birth.' });
    }
    if (age < 18) {
        return res.status(400).json({ error: 'You must be at least 18 years old to register.' });
    }
    if (age > 120) {
        return res.status(400).json({ error: 'Please provide a valid date of birth.' });
    }

    try {
        const existing = await db.get(
            'SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1',
            [username, email]
        );
        if (existing) {
            return res.status(409).json({ error: 'Username or email is already registered.' });
        }

        const hash = await bcrypt.hash(password, 12);
        const isPg = db.kind === 'pg';
        const insertSql = isPg
            ? 'INSERT INTO users (username, email, password_hash, date_of_birth) VALUES (?, ?, ?, ?) RETURNING id'
            : 'INSERT INTO users (username, email, password_hash, date_of_birth) VALUES (?, ?, ?, ?)';
        let userId;
        if (isPg) {
            const row = await db.get(insertSql, [username, email, hash, date_of_birth]);
            userId = row && row.id;
        } else {
            await db.run(insertSql, [username, email, hash, date_of_birth]);
            const row = await db.get('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
            userId = row && row.id;
        }
        if (!userId) throw new Error('User id not returned after insert');

        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        const token = signToken(user);
        await authEvents.log({ userId: user.id, username: user.username, eventType: 'register', outcome: 'success', req });
        res.status(201).json({ token, user: publicUser(user) });
    } catch (err) {
        console.error('[auth/register]', err);
        await authEvents.log({ username, eventType: 'register', outcome: 'failed', reason: err.message, req });
        res.status(500).json({ error: 'Could not create account. Please try again.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Account lockout: refuse the attempt before touching the hash so
    // a brute-force burst can't keep bcrypt pegged. Window is per-username.
    if (await authEvents.isLockedOut(username)) {
        await authEvents.log({ username, eventType: 'login', outcome: 'locked_out', req });
        return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    try {
        const user = await db.get(
            'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1',
            [username, username]
        );
        if (!user) {
            await authEvents.log({ username, eventType: 'login', outcome: 'failed', reason: 'unknown_user', req });
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            await authEvents.log({ userId: user.id, username: user.username, eventType: 'login', outcome: 'failed', reason: 'bad_password', req });
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        // If this user has 2FA enabled, return a short-lived challenge
        // instead of a full session token.
        const totpRow = await currentSecret(user.id);
        if (totpRow && totpRow.enabled) {
            const challenge = sign2faChallenge(user);
            await authEvents.log({ userId: user.id, username: user.username, eventType: 'login', outcome: 'challenge', req });
            return res.json({ requires_2fa: true, challenge, user: { id: user.id, username: user.username } });
        }

        const token = signToken(user);
        await authEvents.log({ userId: user.id, username: user.username, eventType: 'login', outcome: 'success', req });
        res.json({ token, user: publicUser(user) });
    } catch (err) {
        console.error('[auth/login]', err);
        await authEvents.log({ username, eventType: 'login', outcome: 'error', reason: err.message, req });
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

router.post('/login/2fa', async (req, res) => {
    const { challenge, code } = req.body || {};
    if (typeof challenge !== 'string' || typeof code !== 'string') {
        return res.status(400).json({ error: 'Challenge and code are required.' });
    }
    const payload = verifyTokenString(challenge);
    if (!payload || !payload.pending_2fa || !payload.id) {
        return res.status(401).json({ error: 'Invalid or expired 2FA challenge. Sign in again.' });
    }
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [payload.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const verdict = await verifyTotpOrRecovery(user.id, code);
        if (!verdict.ok) {
            await authEvents.log({ userId: user.id, username: user.username, eventType: 'login', outcome: 'failed', reason: '2fa_wrong_code', req });
            return res.status(401).json({ error: 'Code does not match.' });
        }
        const token = signToken(user);
        await authEvents.log({ userId: user.id, username: user.username, eventType: 'login', outcome: 'success', reason: verdict.via, req });
        res.json({ token, user: publicUser(user), via: verdict.via });
    } catch (err) {
        console.error('[auth/login/2fa]', err);
        res.status(500).json({ error: '2FA verification failed.' });
    }
});

router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: publicUser(user) });
    } catch (err) {
        console.error('[auth/me]', err);
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
});

router.post('/logout', authenticate, async (req, res) => {
    // Tokens are stateless JWTs — the client just forgets them. We still
    // respond 200 so the client flow can confirm.
    await authEvents.log({ userId: req.user.id, username: req.user.username, eventType: 'logout', outcome: 'success', req });
    res.json({ ok: true });
});

router.post('/change-password', authenticate, async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (typeof current_password !== 'string' || typeof new_password !== 'string') {
        return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (new_password === current_password) return res.status(400).json({ error: 'New password must differ from the current one.' });
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const ok = await bcrypt.compare(current_password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
        const hash = await bcrypt.hash(new_password, 12);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
        await authEvents.log({ userId: user.id, username: user.username, eventType: 'password_change', outcome: 'success', req });
        res.json({ ok: true });
    } catch (err) {
        console.error('[auth/change-password]', err);
        res.status(500).json({ error: 'Failed to change password.' });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email: emailAddr } = req.body || {};
    // Always respond 200 to avoid revealing which emails are registered.
    const okResponse = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
    if (typeof emailAddr !== 'string' || !emailAddr.trim()) return res.json(okResponse);
    try {
        const user = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', [emailAddr.trim()]);
        if (!user) return res.json(okResponse); // silent no-op

        const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
        const tokenHash = hashResetToken(rawToken);
        await db.run(
            'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [user.id, tokenHash, expiryIso()]
        );
        const resetUrl = config.PUBLIC_URL + '/#reset-password=' + rawToken;
        await email.sendPasswordResetLink({
            to: user.email,
            username: user.username,
            resetUrl,
        });
        // Whether or not the message actually left the building is NOT
        // reported to the client — revealing success would leak which
        // emails are registered. Send failures are logged server-side.
        res.json(okResponse);
    } catch (err) {
        console.error('[auth/forgot-password]', err);
        // Still return ok to not leak existence
        res.json(okResponse);
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, new_password } = req.body || {};
    if (typeof token !== 'string' || typeof new_password !== 'string') {
        return res.status(400).json({ error: 'Token and new_password are required.' });
    }
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    try {
        const tokenHash = hashResetToken(token);
        const row = await db.get('SELECT * FROM password_resets WHERE token_hash = ?', [tokenHash]);
        if (!row) return res.status(400).json({ error: 'Reset link is invalid or has already been used.' });
        if (row.used_at) return res.status(400).json({ error: 'Reset link has already been used.' });
        if (new Date(row.expires_at).getTime() < Date.now()) {
            return res.status(400).json({ error: 'Reset link has expired. Request a new one.' });
        }
        const hash = await bcrypt.hash(new_password, 12);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
        await db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', [nowIso(), row.id]);
        await authEvents.log({ userId: row.user_id, eventType: 'password_reset', outcome: 'success', req });
        res.json({ ok: true });
    } catch (err) {
        console.error('[auth/reset-password]', err);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

module.exports = router;
