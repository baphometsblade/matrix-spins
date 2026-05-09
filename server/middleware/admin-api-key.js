'use strict';

/**
 * Admin API-key middleware (defence in depth on top of JWT requireAdmin).
 *
 * - Reads the key from `X-Admin-API-Key` (preferred) or `X-Admin-Token` (legacy alias).
 * - Validates against `ADMIN_API_KEY` env var (32+ chars). If unset, falls back
 *   to `ADMIN_PASSWORD` to keep existing diagnostic endpoints working — but
 *   warns in production so operators wire a dedicated key.
 * - Constant-time compare to prevent timing attacks.
 *
 * Use as a SECOND layer after `authenticate` + `requireAdmin` on sensitive
 * admin write endpoints (bonus issuance, user bans, payouts, etc).
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

let warnedMissingKey = false;

function getExpectedKey() {
    return process.env.ADMIN_API_KEY || process.env.ADMIN_PASSWORD || null;
}

function timingSafeEq(a, b) {
    try {
        const ab = Buffer.from(String(a), 'utf8');
        const bb = Buffer.from(String(b), 'utf8');
        if (ab.length !== bb.length) return false;
        return crypto.timingSafeEqual(ab, bb);
    } catch (_) { return false; }
}

function adminApiKey(req, res, next) {
    const expected = getExpectedKey();
    if (!expected) {
        if (!warnedMissingKey) {
            logger.warn('admin-api-key disabled — neither ADMIN_API_KEY nor ADMIN_PASSWORD set');
            warnedMissingKey = true;
        }
        return res.status(503).json({ error: 'Admin API key not configured' });
    }
    if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY && !warnedMissingKey) {
        logger.warn('admin-api-key falling back to ADMIN_PASSWORD; set a dedicated ADMIN_API_KEY (32+ chars)');
        warnedMissingKey = true;
    }
    const provided = req.headers['x-admin-api-key'] || req.headers['x-admin-token'] || '';
    if (!provided || !timingSafeEq(provided, expected)) {
        logger.warn('admin-api-key auth failure', {
            ip: req.ip,
            path: req.path,
            requestId: req.id,
            userId: req.user && req.user.id,
        });
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

module.exports = { adminApiKey };
