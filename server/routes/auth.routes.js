'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../database');
const { signToken, authenticate } = require('../middleware/auth');

const router = express.Router();

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
        res.status(201).json({ token, user: publicUser(user) });
    } catch (err) {
        console.error('[auth/register]', err);
        res.status(500).json({ error: 'Could not create account. Please try again.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    try {
        const user = await db.get(
            'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1',
            [username, username]
        );
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const token = signToken(user);
        res.json({ token, user: publicUser(user) });
    } catch (err) {
        console.error('[auth/login]', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
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

router.post('/logout', authenticate, (_req, res) => {
    // Tokens are stateless JWTs — the client just forgets them. We still
    // respond 200 so the client flow can confirm.
    res.json({ ok: true });
});

module.exports = router;
