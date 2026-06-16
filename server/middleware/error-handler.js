'use strict';

/**
 * Error handling utilities:
 *   - asyncHandler(fn)     — wraps async route handlers, forwards rejections to next()
 *   - notFoundHandler      — JSON 404 for /api/* (mounted before SPA fallback by caller)
 *   - globalErrorHandler   — final 4-arg express handler with structured logging
 *
 * The global handler:
 *   - Rolls back any open DB transaction.
 *   - Logs to winston with full stack + request context.
 *   - Returns sanitised JSON in production (no stack traces leaked).
 *   - Operators can inspect full stack via X-Debug-Token header (= ADMIN_PASSWORD).
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

function asyncHandler(fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

function notFoundApiHandler(req, res, next) {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found', path: req.path });
    }
    next();
}

function globalErrorHandler(err, req, res, _next) {
    // Best-effort transaction rollback so a thrown error mid-tx doesn't leave
    // PG holding row locks until the connection idles out.
    try {
        const dbMod = require('../database');
        if (typeof dbMod.rollback === 'function') {
            dbMod.rollback().catch(e => logger.warn('rollback after error failed', { error: e.message }));
        }
    } catch (_) { /* ignore */ }

    // Malformed JSON body from express.json() → clean user-facing message
    if (err.type === 'entity.parse.failed' && err instanceof SyntaxError) {
        return res.status(400).json({
            error: 'Malformed JSON in request body',
            requestId: req.id,
            referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase(),
        });
    }

    const status = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';
    // Timing-safe comparison to prevent token enumeration
    const debugToken = (() => {
        const adminPw = process.env.ADMIN_PASSWORD;
        const headerVal = req.headers && req.headers['x-debug-token'];
        if (!adminPw || !headerVal || adminPw.length !== headerVal.length) return false;
        try { return crypto.timingSafeEqual(Buffer.from(adminPw), Buffer.from(headerVal)); }
        catch (_) { return false; }
    })();

    const meta = {
        method: req.method,
        path: req.path,
        status,
        userId: req.user && req.user.id,
        requestId: req.id,
        ip: req.ip,
        stack: err.stack,
    };
    if (status >= 500) logger.error(`Unhandled error: ${err.message}`, meta);
    else logger.warn(`Request error: ${err.message}`, meta);

    if (res.headersSent) return; // express will close the connection

    const message = (isProd && !debugToken && status >= 500)
        ? 'Internal server error'
        : (err.message || 'Internal server error');

    res.status(status).json({
        error: message,
        stack: debugToken && err.stack ? err.stack.split('\n').slice(0, 10) : undefined,
        requestId: req.id,
        referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase(),
    });
}

module.exports = { asyncHandler, notFoundApiHandler, globalErrorHandler };
