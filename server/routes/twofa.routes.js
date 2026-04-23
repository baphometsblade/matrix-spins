'use strict';

/**
 * RFC 6238 TOTP 2FA routes.
 *
 * Lifecycle:
 *   POST /api/auth/2fa/setup    (authed)    rotate a fresh secret and
 *                                           return the base32 +
 *                                           otpauth URL. Does NOT enable
 *                                           2FA until the user proves
 *                                           they provisioned it.
 *   POST /api/auth/2fa/enable   (authed)    verify a 6-digit code against
 *                                           the pending secret, mark it
 *                                           enabled, and return a fresh
 *                                           set of 10 recovery codes.
 *   POST /api/auth/2fa/disable  (authed)    require password + TOTP code
 *                                           (or recovery code) before
 *                                           wiping the secret.
 *   GET  /api/auth/2fa/status   (authed)    { enabled, configured }
 *
 * Login interaction lives in auth.routes: when a user has 2FA enabled,
 * POST /api/auth/login returns { requires_2fa: true, challenge } instead
 * of a session token. The client then POSTs /api/auth/login/2fa with
 * the challenge + TOTP/recovery code to receive the real token.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../database');
const { authenticate, bumpTokenVersion } = require('../middleware/auth');
const totp = require('../services/totp.service');
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

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function hashRecovery(code) {
    return crypto.createHash('sha256').update(String(code).toUpperCase()).digest('hex');
}

function randomRecoveryCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    const buf = crypto.randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i++) out += alphabet[buf[i] % alphabet.length];
    return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
}

async function currentSecret(userId) {
    return db.get('SELECT * FROM user_totp_secrets WHERE user_id = ?', [userId]);
}

async function consumeRecoveryCode(userId, code) {
    if (!RECOVERY_CODE_RE.test(String(code || '').toUpperCase())) return false;
    const hash = hashRecovery(code);
    const row = await db.get(
        'SELECT id, used_at FROM user_recovery_codes WHERE user_id = ? AND code_hash = ?',
        [userId, hash]
    );
    if (!row || row.used_at) return false;
    const nowIso = new Date().toISOString();
    const r = await db.run(
        'UPDATE user_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
        [nowIso, row.id]
    );
    return r && r.changes > 0;
}

async function verifyTotpOrRecovery(userId, code) {
    if (!code) return { ok: false, via: null };
    const row = await currentSecret(userId);
    if (row && row.enabled && totp.verifyCode(row.secret, String(code))) {
        return { ok: true, via: 'totp' };
    }
    if (await consumeRecoveryCode(userId, code)) {
        return { ok: true, via: 'recovery' };
    }
    return { ok: false, via: null };
}

router.get('/status', authenticate, async (req, res) => {
    try {
        const row = await currentSecret(req.user.id);
        const remaining = await db.get(
            'SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL',
            [req.user.id]
        );
        res.json({
            enabled: !!(row && row.enabled),
            configured: !!row,
            recovery_codes_remaining: Number((remaining && remaining.n) || 0),
        });
    } catch (err) {
        console.error('[2fa/status]', err);
        res.status(500).json({ error: 'Failed to fetch 2FA status.' });
    }
});

router.post('/setup', authenticate, async (req, res) => {
    try {
        const user = await db.get('SELECT username, email FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const secret = totp.generateSecret();
        const nowIso = new Date().toISOString();
        const existing = await currentSecret(req.user.id);
        if (existing) {
            await db.run(
                'UPDATE user_totp_secrets SET secret = ?, ' + (db.kind === 'pg' ? 'enabled = false' : 'enabled = 0') + ', enabled_at = NULL WHERE user_id = ?',
                [secret, req.user.id]
            );
        } else {
            await db.run(
                'INSERT INTO user_totp_secrets (user_id, secret, created_at) VALUES (?, ?, ?)',
                [req.user.id, secret, nowIso]
            );
        }
        const issuer = 'Matrix Spins';
        const url = totp.otpauthUrl({ issuer, account: user.email || user.username, secretBase32: secret });
        // Render the otpauth URL as an SVG QR on the server so the
        // client doesn't need a QR library and the secret never
        // leaves our origin via a third-party QR service.
        const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 240 });
        res.json({ secret, otpauth_url: url, qr_svg: qrSvg });
    } catch (err) {
        console.error('[2fa/setup]', err);
        res.status(500).json({ error: 'Failed to generate 2FA secret.' });
    }
});

router.post('/enable', authenticate, async (req, res) => {
    const { code } = req.body || {};
    try {
        const row = await currentSecret(req.user.id);
        if (!row) return res.status(400).json({ error: 'Run /api/auth/2fa/setup first.' });
        if (!totp.verifyCode(row.secret, String(code || ''))) {
            return res.status(401).json({ error: 'Code does not match. Check your authenticator app clock and try again.' });
        }
        const nowIso = new Date().toISOString();
        await db.run(
            'UPDATE user_totp_secrets SET ' + (db.kind === 'pg' ? 'enabled = true' : 'enabled = 1') + ', enabled_at = ? WHERE user_id = ?',
            [nowIso, req.user.id]
        );
        // Mint a fresh set of recovery codes; clear any old ones.
        await db.run('DELETE FROM user_recovery_codes WHERE user_id = ?', [req.user.id]);
        const recovery = [];
        for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
            const code = randomRecoveryCode();
            recovery.push(code);
            await db.run(
                'INSERT INTO user_recovery_codes (user_id, code_hash) VALUES (?, ?)',
                [req.user.id, hashRecovery(code)]
            );
        }
        await authEvents.log({ userId: req.user.id, username: req.user.username, eventType: '2fa_enable', outcome: 'success', req });
        try {
            const u = await db.get('SELECT username, email FROM users WHERE id = ?', [req.user.id]);
            if (u && u.email) {
                mailer.sendSecurityAlert({
                    to: u.email, username: u.username, event: 'twofa_enabled',
                    ip: reqIp(req), userAgent: reqUa(req),
                }).catch(function (err) { console.warn('[2fa/enable] alert email failed:', err && err.message); });
            }
        } catch (err) { /* ignore */ }
        res.json({ ok: true, recovery_codes: recovery });
    } catch (err) {
        console.error('[2fa/enable]', err);
        res.status(500).json({ error: 'Failed to enable 2FA.' });
    }
});

router.post('/disable', authenticate, async (req, res) => {
    const { password, code } = req.body || {};
    if (typeof password !== 'string') return res.status(400).json({ error: 'Password is required.' });
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });
        const verdict = await verifyTotpOrRecovery(req.user.id, code);
        if (!verdict.ok) return res.status(401).json({ error: 'Code does not match.' });
        await db.run('DELETE FROM user_totp_secrets WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM user_recovery_codes WHERE user_id = ?', [req.user.id]);
        // Disabling 2FA is a sensitive action — invalidate every other
        // session too in case the disable was performed by an attacker
        // who had phished the current token + one-time code.
        await bumpTokenVersion(req.user.id);
        await authEvents.log({ userId: req.user.id, username: req.user.username, eventType: '2fa_disable', outcome: 'success', reason: verdict.via, req });
        try {
            if (user && user.email) {
                mailer.sendSecurityAlert({
                    to: user.email, username: user.username, event: 'twofa_disabled',
                    ip: reqIp(req), userAgent: reqUa(req),
                }).catch(function (err) { console.warn('[2fa/disable] alert email failed:', err && err.message); });
            }
        } catch (err) { /* ignore */ }
        // Issue a fresh token so the caller isn't immediately logged out.
        const fresh = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const { signToken } = require('../middleware/auth');
        res.json({ ok: true, token: signToken(fresh) });
    } catch (err) {
        console.error('[2fa/disable]', err);
        res.status(500).json({ error: 'Failed to disable 2FA.' });
    }
});

module.exports = { router, verifyTotpOrRecovery, currentSecret };
// Suppress unused-var lint while still importing config
void config;
