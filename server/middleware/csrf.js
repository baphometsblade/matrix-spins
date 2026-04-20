'use strict';

/**
 * Double-submit CSRF protection.
 *
 * GET /api/csrf-token returns a short-lived token bound to the current
 * authenticated user (or 'anon' for pre-auth flows); mutating endpoints
 * validate that the X-CSRF-Token header matches.
 *
 * Token format is three base64url segments joined by dots:
 *     b64url(userId) . b64url(issuedAtMs) . b64url(hmac)
 * where hmac = HMAC_SHA256(JWT_SECRET, userId + '.' + issuedAtMs).
 */

const crypto = require('crypto');
const config = require('../config');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WEBHOOK_PREFIXES = ['/api/payment/stripe/webhook'];

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}

function hmac(payload) {
    return crypto.createHmac('sha256', config.JWT_SECRET).update(payload).digest();
}

function issueToken(userId) {
    const uid = String(userId || 'anon');
    const issuedAt = String(Date.now());
    const mac = hmac(uid + '.' + issuedAt);
    return b64url(uid) + '.' + b64url(issuedAt) + '.' + b64url(mac);
}

function verifyToken(token, userId) {
    try {
        if (typeof token !== 'string') return false;
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const uid = b64urlDecode(parts[0]).toString('utf8');
        const issuedAt = b64urlDecode(parts[1]).toString('utf8');
        const received = b64urlDecode(parts[2]);
        if (uid !== String(userId || 'anon')) return false;
        const issuedAtMs = Number(issuedAt);
        if (!isFinite(issuedAtMs) || Date.now() - issuedAtMs > TOKEN_TTL_MS) return false;
        const expected = hmac(uid + '.' + issuedAt);
        if (expected.length !== received.length) return false;
        return crypto.timingSafeEqual(expected, received);
    } catch (err) {
        return false;
    }
}

function getCsrfTokenHandler(req, res) {
    const uid = (req.user && req.user.id) || 'anon';
    res.json({ csrfToken: issueToken(uid) });
}

function csrfMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (WEBHOOK_PREFIXES.some(p => req.path.startsWith(p))) return next();
    const uid = (req.user && req.user.id) || 'anon';
    const token = req.headers['x-csrf-token'] || req.headers['x-csrftoken'];
    if (!token) return res.status(403).json({ error: 'CSRF token missing' });
    if (!verifyToken(token, uid)) return res.status(403).json({ error: 'CSRF token invalid' });
    next();
}

module.exports = { csrfMiddleware, getCsrfTokenHandler, issueToken, verifyToken };
