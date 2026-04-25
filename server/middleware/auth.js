'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const db = require('../database');

function newJti() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Sign a session token. The optional `jti` lets the caller pre-mint
 * one and pass it to the sessions service so the JWT and the row
 * share the same id. Without it we generate one inline; the row is
 * lazy-created by the auth middleware on first use.
 */
function signToken(user, jti) {
    const id = jti || newJti();
    return jwt.sign(
        { id: user.id, username: user.username, is_admin: !!user.is_admin, tv: Number(user.token_version || 0), jti: id },
        config.JWT_SECRET,
        { expiresIn: '30d' }
    );
}

function sign2faChallenge(user) {
    // Challenge tokens are short-lived and not session-tracked — they
    // exist solely to bridge from /login to /login/2fa.
    return jwt.sign(
        { id: user.id, username: user.username, pending_2fa: true, tv: Number(user.token_version || 0) },
        config.JWT_SECRET,
        { expiresIn: '5m' }
    );
}

function verifyTokenString(token) {
    try {
        return jwt.verify(token, config.JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// Cache each user's current token_version briefly so we don't hit the
// DB on every authenticated request. A bump (password change, 2FA
// disable, admin revoke) invalidates the cache synchronously via
// invalidateTokenVersionCache(userId).
const TV_CACHE_TTL_MS = 30 * 1000;
const tvCache = new Map(); // userId -> { version, expiresAt }

function invalidateTokenVersionCache(userId) {
    tvCache.delete(Number(userId));
}

async function currentTokenVersion(userId) {
    const now = Date.now();
    const cached = tvCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.version;
    try {
        const row = await db.get('SELECT token_version FROM users WHERE id = ?', [userId]);
        const v = row ? Number(row.token_version || 0) : null;
        if (v != null) tvCache.set(userId, { version: v, expiresAt: now + TV_CACHE_TTL_MS });
        return v;
    } catch (err) {
        // If the DB is unavailable we must fail closed on authenticated
        // requests rather than accept potentially-stale tokens.
        return null;
    }
}

async function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyTokenString(token) : null;
    if (!payload) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    // pending_2fa tokens only allow the /login/2fa endpoint; everything
    // else must wait for a full session token.
    if (payload.pending_2fa) {
        return res.status(401).json({ error: 'Complete 2FA to continue.' });
    }
    const currentTv = await currentTokenVersion(payload.id);
    if (currentTv == null || Number(payload.tv || 0) !== currentTv) {
        return res.status(401).json({ error: 'Session revoked. Sign in again.' });
    }
    // Per-session revocation. If the JWT carries a jti, look up the
    // backing session row. Missing → lazy-create (legacy/test tokens
    // pre-dating the migration); revoked_at set → reject. The lookup
    // is cached 30s in the sessions service so the auth hot path
    // stays at "verify JWT + read user TV" cost in the common case.
    if (payload.jti) {
        const sessions = require('../services/sessions.service');
        const sess = await sessions.findByJti(payload.jti);
        if (sess && sess.revoked_at) {
            return res.status(401).json({ error: 'Session revoked. Sign in again.', code: 'session_revoked' });
        }
        if (!sess) {
            // Lazy-create. Capture the current ip + ua so the user can
            // see this session on the management page immediately.
            try { await sessions.recordSession(payload.jti, payload.id, req); } catch (e) { /* swallow */ }
        } else {
            sessions.bumpLastSeen(payload.jti);
        }
    }
    req.user = payload;
    next();
}

async function authenticateOptional(req, _res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyTokenString(token) : null;
    if (payload && !payload.pending_2fa) {
        const currentTv = await currentTokenVersion(payload.id);
        if (currentTv != null && Number(payload.tv || 0) === currentTv) {
            req.user = payload;
        }
    } else if (payload && payload.pending_2fa) {
        // Don't populate req.user for pending_2fa tokens, but also don't
        // reject at this layer — the /login/2fa endpoint verifies the
        // challenge explicitly.
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
}

async function bumpTokenVersion(userId) {
    await db.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
    invalidateTokenVersionCache(userId);
}

module.exports = {
    authenticate,
    authenticateOptional,
    requireAdmin,
    signToken,
    sign2faChallenge,
    verifyTokenString,
    bumpTokenVersion,
    invalidateTokenVersionCache,
    newJti,
};
