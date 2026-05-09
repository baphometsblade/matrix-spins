'use strict';

/**
 * Two-Factor Authentication (TOTP) — RFC 6238
 *
 * Setup flow:
 *   1. POST /api/2fa/setup    → returns base32 secret + QR data URL
 *   2. POST /api/2fa/verify   → confirm with first 6-digit code; persists secret + 10 backup codes
 *   3. POST /api/2fa/disable  → requires fresh TOTP code
 *
 * Login flow integration: see auth.routes.js — when totp_enabled = 1,
 * /api/auth/login returns { needs2FA: true, twofaToken } instead of a
 * session JWT, and /api/2fa/login-verify exchanges the code for a JWT.
 *
 * Rate limit: 5 verification attempts per minute (mounted in server/index.js).
 */

const express = require('express');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');
const { audit } = require('../utils/audit-log');
const logger = require('../utils/logger');

const router = express.Router();

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }

// ─── Idempotent migrations ───────────────────────────────────
[
    'totp_secret TEXT',
    'totp_enabled INTEGER DEFAULT 0',
    'totp_backup_codes TEXT',
    'totp_pending_secret TEXT',
    'totp_enrolled_at TEXT',
    'totp_last_used_step INTEGER DEFAULT 0',
].forEach(function(colDef) {
    db.run('ALTER TABLE users ADD COLUMN ' + colDef).catch(function(e) {
        if (e && !String(e.message || e).match(/duplicate column|already exists|no such table/i)) {
            console.warn('[2FA] users ALTER failed:', e.message || e);
        }
    });
});

// twofa_pending — short-lived token after password OK but before TOTP code,
// used to prevent the second factor from being skippable via direct API call.
db.run(`CREATE TABLE IF NOT EXISTS twofa_pending (
    id ${_idDef()},
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at ${_tsDef()}
)`).catch(function(e) { if (e && !String(e.message||e).match(/already exists/i)) console.warn('[2FA] twofa_pending create failed:', e.message||e); });

db.run('CREATE INDEX IF NOT EXISTS idx_twofa_pending_token ON twofa_pending(token)').catch(function(){});

// ─── Rate limit ──────────────────────────────────────────────
const verifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many 2FA attempts. Please wait a minute.' },
});

// ─── Helpers ─────────────────────────────────────────────────
function generateBackupCodes(count) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        // 10 hex chars, formatted as XXXXX-XXXXX
        const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
        codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
    }
    return codes;
}

async function hashBackupCodes(codes) {
    const out = [];
    for (const c of codes) {
        const h = await bcrypt.hash(c.replace('-', ''), 8);
        out.push(h);
    }
    return out;
}

async function consumeBackupCode(stored, plaintext) {
    if (!Array.isArray(stored) || !plaintext) return null;
    const norm = String(plaintext).replace(/-/g, '').toUpperCase();
    for (let i = 0; i < stored.length; i++) {
        try {
            if (await bcrypt.compare(norm, stored[i])) {
                const remaining = stored.slice(0, i).concat(stored.slice(i + 1));
                return remaining;
            }
        } catch (_) {}
    }
    return null;
}

function verifyTotp(secret, token) {
    if (!secret || !token) return null;
    const result = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: String(token).replace(/\s/g, ''),
        window: 1, // allow ±30s clock drift
    });
    if (!result) return null;
    // Compute the time-step that was accepted, for replay defense
    const step = Math.floor(Date.now() / 1000 / 30);
    return step;
}

// ─── GET /api/2fa/status ─────────────────────────────────────
router.get('/status', authenticate, async (req, res) => {
    try {
        const u = await db.get(
            'SELECT totp_enabled, totp_enrolled_at, totp_backup_codes FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!u) return res.status(404).json({ error: 'User not found' });

        let backupCount = 0;
        if (u.totp_backup_codes) {
            try { backupCount = JSON.parse(u.totp_backup_codes).length; } catch (_) {}
        }
        res.json({
            enabled: !!u.totp_enabled,
            enrolledAt: u.totp_enrolled_at || null,
            backupCodesRemaining: backupCount,
        });
    } catch (err) {
        logger.error('2FA status failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch 2FA status' });
    }
});

// ─── POST /api/2fa/setup ─────────────────────────────────────
// Generates a secret + QR code. Secret is stored *temporarily* in
// totp_pending_secret until verified.
router.post('/setup', authenticate, async (req, res) => {
    try {
        const u = await db.get('SELECT id, username, email, totp_enabled FROM users WHERE id = ?', [req.user.id]);
        if (!u) return res.status(404).json({ error: 'User not found' });
        if (u.totp_enabled) {
            return res.status(409).json({ error: '2FA is already enabled. Disable first to re-enroll.' });
        }

        const secret = speakeasy.generateSecret({
            length: 20,
            name: 'Matrix Spins (' + u.username + ')',
            issuer: 'Matrix Spins',
        });

        const otpauth = secret.otpauth_url;
        const qrDataUrl = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: 'M', margin: 1 });

        // Store ENCRYPTED pending secret. Replaces any prior pending value.
        await db.run(
            'UPDATE users SET totp_pending_secret = ? WHERE id = ?',
            [encrypt(secret.base32), req.user.id]
        );

        res.json({
            secret: secret.base32,           // show once for manual entry
            otpauthUrl: otpauth,
            qrDataUrl: qrDataUrl,
        });
    } catch (err) {
        logger.error('2FA setup failed', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Failed to generate 2FA secret' });
    }
});

// ─── POST /api/2fa/verify ────────────────────────────────────
// Confirms the pending secret with a TOTP code, enables 2FA,
// generates 10 backup codes (returned ONCE, stored hashed).
router.post('/verify', authenticate, verifyLimiter, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'TOTP code is required' });

        const u = await db.get(
            'SELECT id, totp_pending_secret, totp_enabled FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!u || !u.totp_pending_secret) {
            return res.status(400).json({ error: 'No pending 2FA setup. Call /api/2fa/setup first.' });
        }
        if (u.totp_enabled) {
            return res.status(409).json({ error: '2FA already enabled.' });
        }

        const secret = decrypt(u.totp_pending_secret);
        if (!secret) return res.status(500).json({ error: '2FA secret could not be read. Restart setup.' });

        const step = verifyTotp(secret, code);
        if (!step) return res.status(400).json({ error: 'Invalid code. Try again.' });

        const backupPlain = generateBackupCodes(10);
        const backupHashed = await hashBackupCodes(backupPlain);

        const now = new Date().toISOString();
        await db.run(
            'UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_pending_secret = NULL, totp_backup_codes = ?, totp_enrolled_at = ?, totp_last_used_step = ? WHERE id = ?',
            [u.totp_pending_secret, JSON.stringify(backupHashed), now, step, req.user.id]
        );

        audit('2fa.enable', { userId: req.user.id, ip: req.ip, requestId: req.id }).catch(() => {});

        res.json({
            ok: true,
            message: '2FA enabled successfully. Save these backup codes — they will not be shown again.',
            backupCodes: backupPlain,
        });
    } catch (err) {
        logger.error('2FA verify failed', { error: err.message, stack: err.stack });
        res.status(500).json({ error: '2FA verification failed' });
    }
});

// ─── POST /api/2fa/disable ───────────────────────────────────
// Requires fresh TOTP code (or backup code) to prevent CSRF / hijacked-session
// attackers from disabling 2FA.
router.post('/disable', authenticate, verifyLimiter, async (req, res) => {
    try {
        const { code, backupCode } = req.body;
        if (!code && !backupCode) {
            return res.status(400).json({ error: 'TOTP code or backup code is required' });
        }

        const u = await db.get(
            'SELECT id, role, is_admin, totp_secret, totp_enabled, totp_backup_codes, totp_last_used_step FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!u || !u.totp_enabled) {
            return res.status(400).json({ error: '2FA is not enabled' });
        }
        // Admin accounts cannot disable 2FA — must keep it on per security policy.
        if (u.is_admin) {
            return res.status(403).json({ error: 'Admin accounts must keep 2FA enabled.' });
        }

        let validated = false;

        if (code) {
            const secret = decrypt(u.totp_secret);
            if (!secret) return res.status(500).json({ error: '2FA secret unreadable' });
            const step = verifyTotp(secret, code);
            if (step && step !== u.totp_last_used_step) {
                validated = true;
                await db.run('UPDATE users SET totp_last_used_step = ? WHERE id = ?', [step, u.id]);
            }
        } else if (backupCode) {
            let stored = [];
            try { stored = JSON.parse(u.totp_backup_codes || '[]'); } catch (_) {}
            const remaining = await consumeBackupCode(stored, backupCode);
            if (remaining) {
                validated = true;
                await db.run('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(remaining), u.id]);
            }
        }

        if (!validated) return res.status(400).json({ error: 'Invalid code' });

        await db.run(
            'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, totp_pending_secret = NULL, totp_enrolled_at = NULL, totp_last_used_step = 0 WHERE id = ?',
            [req.user.id]
        );

        audit('2fa.disable', { userId: req.user.id, ip: req.ip, requestId: req.id }).catch(() => {});
        res.json({ ok: true, message: '2FA disabled' });
    } catch (err) {
        logger.error('2FA disable failed', { error: err.message, stack: err.stack });
        res.status(500).json({ error: '2FA disable failed' });
    }
});

// ─── POST /api/2fa/regenerate-backup-codes ──────────────────
// Requires a current TOTP code. Old codes are wiped immediately.
router.post('/regenerate-backup-codes', authenticate, verifyLimiter, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'TOTP code is required' });

        const u = await db.get(
            'SELECT id, totp_secret, totp_enabled, totp_last_used_step FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!u || !u.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });

        const secret = decrypt(u.totp_secret);
        if (!secret) return res.status(500).json({ error: '2FA secret unreadable' });
        const step = verifyTotp(secret, code);
        if (!step || step === u.totp_last_used_step) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        const backupPlain = generateBackupCodes(10);
        const backupHashed = await hashBackupCodes(backupPlain);
        await db.run(
            'UPDATE users SET totp_backup_codes = ?, totp_last_used_step = ? WHERE id = ?',
            [JSON.stringify(backupHashed), step, req.user.id]
        );

        audit('2fa.regenerate_backup_codes', { userId: req.user.id, ip: req.ip, requestId: req.id }).catch(() => {});
        res.json({ ok: true, backupCodes: backupPlain });
    } catch (err) {
        logger.error('2FA regenerate backup failed', { error: err.message });
        res.status(500).json({ error: 'Failed to regenerate backup codes' });
    }
});

// ─── POST /api/2fa/login-verify ──────────────────────────────
// Exchange a short-lived twofaToken (issued by /api/auth/login) +
// 6-digit code (or backup code) for a session JWT.
router.post('/login-verify', verifyLimiter, async (req, res) => {
    try {
        const { twofaToken, code, backupCode } = req.body;
        if (!twofaToken || (!code && !backupCode)) {
            return res.status(400).json({ error: '2FA token and code are required' });
        }

        // Hash the incoming token to look up the DB record
        const hashed = crypto.createHash('sha256').update(String(twofaToken)).digest('hex');
        const pending = await db.get(
            'SELECT id, user_id, expires_at, used FROM twofa_pending WHERE token = ? AND used = 0',
            [hashed]
        );
        if (!pending) return res.status(401).json({ error: 'Invalid or expired 2FA session' });
        if (new Date(pending.expires_at) < new Date()) {
            await db.run('UPDATE twofa_pending SET used = 1 WHERE id = ?', [pending.id]);
            return res.status(401).json({ error: '2FA session expired. Log in again.' });
        }

        const u = await db.get(
            'SELECT id, username, email, balance, is_admin, is_banned, totp_secret, totp_enabled, totp_backup_codes, totp_last_used_step FROM users WHERE id = ?',
            [pending.user_id]
        );
        if (!u || !u.totp_enabled) {
            return res.status(401).json({ error: '2FA not enabled on account' });
        }
        if (u.is_banned) return res.status(403).json({ error: 'Account banned' });

        let validated = false;
        if (code) {
            const secret = decrypt(u.totp_secret);
            if (secret) {
                const step = verifyTotp(secret, code);
                if (step && step !== u.totp_last_used_step) {
                    validated = true;
                    await db.run('UPDATE users SET totp_last_used_step = ? WHERE id = ?', [step, u.id]);
                }
            }
        } else if (backupCode) {
            let stored = [];
            try { stored = JSON.parse(u.totp_backup_codes || '[]'); } catch (_) {}
            const remaining = await consumeBackupCode(stored, backupCode);
            if (remaining) {
                validated = true;
                await db.run('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(remaining), u.id]);
            }
        }

        if (!validated) {
            audit('2fa.login.fail', { userId: u.id, ip: req.ip, requestId: req.id }).catch(() => {});
            return res.status(400).json({ error: 'Invalid code' });
        }

        // Burn the pending token (single-use)
        await db.run('UPDATE twofa_pending SET used = 1 WHERE id = ?', [pending.id]);

        const token = jwt.sign({ userId: u.id }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
        audit('2fa.login.success', { userId: u.id, ip: req.ip, requestId: req.id }).catch(() => {});

        res.json({
            token,
            user: {
                id: u.id,
                username: u.username,
                email: u.email,
                balance: u.balance,
                is_admin: !!u.is_admin,
            },
        });
    } catch (err) {
        logger.error('2FA login-verify failed', { error: err.message, stack: err.stack });
        res.status(500).json({ error: '2FA login verification failed' });
    }
});

// ─── Internal helpers exposed for auth.routes.js ─────────────
async function issuePendingToken(userId) {
    const plaintext = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(plaintext).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '); // 5 min
    await db.run(
        'INSERT INTO twofa_pending (token, user_id, expires_at) VALUES (?, ?, ?)',
        [hashed, userId, expiresAt]
    );
    return plaintext;
}

module.exports = router;
module.exports.router = router;
module.exports.issuePendingToken = issuePendingToken;
