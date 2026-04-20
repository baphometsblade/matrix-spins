'use strict';

/**
 * Per-request correlation id + access log. Every incoming request gets
 * a short random id attached as req.id and echoed as the X-Request-Id
 * response header so support can grep logs by that id from a customer
 * report. One line per completed request:
 *
 *   [req:a1b2c3d4] 200 POST /api/auth/login 42ms user=17 ip=203.0.113.5
 */

const crypto = require('crypto');

const HEALTH_PATH_RE = /^\/api\/health($|\/)/;

function shortId() {
    return crypto.randomBytes(4).toString('hex');
}

function clientIp(req) {
    const fwd = req.headers && req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.ip || '-';
}

module.exports = function requestLog(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(incoming)) ? incoming : shortId();
    req.id = id;
    res.setHeader('X-Request-Id', id);

    // Skip access log for health checks — Render hits /api/health every
    // 5 seconds and the noise drowns out real signal.
    const quiet = HEALTH_PATH_RE.test(req.path);
    const start = Date.now();

    res.on('finish', () => {
        if (quiet) return;
        const ms = Date.now() - start;
        const uid = (req.user && req.user.id) ? 'u=' + req.user.id : 'u=-';
        const line = `[req:${id}] ${res.statusCode} ${req.method} ${req.originalUrl || req.url} ${ms}ms ${uid} ip=${clientIp(req)}`;
        if (res.statusCode >= 500) console.error(line);
        else if (res.statusCode >= 400) console.warn(line);
        else console.log(line);
    });
    next();
};
