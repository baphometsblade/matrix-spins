'use strict';

/**
 * Per-user sliding-window rate limiter. Complements express-rate-limit
 * (IP-based) by keying on the authenticated user's id when available.
 * Falls back to IP for unauthenticated requests.
 */

function userRateLimit({ maxRequests = 60, windowMs = 60000 } = {}) {
    const buckets = new Map(); // key -> { count, resetAt }
    const SWEEP_MS = Math.max(windowMs, 30000);
    let lastSweep = Date.now();

    function sweep(now) {
        if (now - lastSweep < SWEEP_MS) return;
        lastSweep = now;
        for (const [k, v] of buckets) {
            if (v.resetAt <= now) buckets.delete(k);
        }
    }

    return function limiter(req, res, next) {
        const now = Date.now();
        sweep(now);
        const key = (req.user && req.user.id) ? 'u:' + req.user.id : 'ip:' + (req.ip || 'unknown');
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count++;
        if (bucket.count > maxRequests) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({ error: 'Too many requests. Please slow down.' });
        }
        next();
    };
}

module.exports = userRateLimit;
