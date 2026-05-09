'use strict';

/**
 * IP-based suspicious-activity detector.
 *
 * Tracks recent failures (4xx/5xx) per IP and blocks an IP for BLOCK_MS once
 * it exceeds FAIL_THRESHOLD failures within WINDOW_MS. Operates on top of the
 * normal rate limiters — those bucket *requests*; this one buckets *failures*
 * so a credential-stuffing or scanner pattern gets clipped early.
 *
 * Memory-bounded: keeps at most MAX_TRACKED_IPS entries; oldest evicted on
 * insert. Safe for single-instance deployments. For multi-instance use Redis.
 */

const logger = require('../utils/logger');

const WINDOW_MS = 5 * 60 * 1000;        // 5 min sliding window
const FAIL_THRESHOLD = 30;              // 30 failures => block
const BLOCK_MS = 15 * 60 * 1000;        // 15 min block
const MAX_TRACKED_IPS = 50000;
const TRUSTED_IPS = new Set((process.env.TRUSTED_IPS || '').split(',').map(s => s.trim()).filter(Boolean));

const ipState = new Map(); // ip -> { failures: [...timestamps], blockedUntil }

function clientIp(req) {
    return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function pruneFailures(failures, now) {
    while (failures.length && failures[0] < now - WINDOW_MS) failures.shift();
    return failures;
}

function isBlocked(ip) {
    const s = ipState.get(ip);
    if (!s || !s.blockedUntil) return false;
    if (s.blockedUntil > Date.now()) return true;
    s.blockedUntil = 0;
    return false;
}

function recordFailure(ip) {
    if (TRUSTED_IPS.has(ip)) return;
    let s = ipState.get(ip);
    if (!s) {
        if (ipState.size >= MAX_TRACKED_IPS) {
            // Evict oldest (Map iteration order = insertion order)
            const firstKey = ipState.keys().next().value;
            if (firstKey) ipState.delete(firstKey);
        }
        s = { failures: [], blockedUntil: 0 };
        ipState.set(ip, s);
    }
    const now = Date.now();
    s.failures.push(now);
    pruneFailures(s.failures, now);
    if (s.failures.length >= FAIL_THRESHOLD && !s.blockedUntil) {
        s.blockedUntil = now + BLOCK_MS;
        logger.warn('IP blocked for suspicious activity', { ip, failures: s.failures.length, blockedFor: BLOCK_MS });
    }
}

function suspiciousActivity(req, res, next) {
    const ip = clientIp(req);
    if (isBlocked(ip)) {
        return res.status(429).json({ error: 'Temporarily blocked due to suspicious activity. Try again later.' });
    }
    res.on('finish', () => {
        // Treat any 4xx/5xx other than 404 noise as a failure signal.
        // 401 + 403 + 422 + 429 + 5xx are the meaningful ones.
        const s = res.statusCode;
        if (s === 401 || s === 403 || s === 422 || s === 429 || s >= 500) {
            recordFailure(ip);
        }
    });
    next();
}

function unblockIp(ip) {
    const s = ipState.get(ip);
    if (s) { s.failures = []; s.blockedUntil = 0; }
}

function getBlockedIps() {
    const now = Date.now();
    const rows = [];
    for (const [ip, s] of ipState) {
        if (s.blockedUntil && s.blockedUntil > now) {
            rows.push({ ip, blockedUntil: s.blockedUntil, failures: s.failures.length });
        }
    }
    return rows;
}

// Periodic prune
setInterval(() => {
    const now = Date.now();
    for (const [ip, s] of ipState) {
        pruneFailures(s.failures, now);
        if (!s.failures.length && (!s.blockedUntil || s.blockedUntil < now)) {
            ipState.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

module.exports = { suspiciousActivity, recordFailure, unblockIp, getBlockedIps };
