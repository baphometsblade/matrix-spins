'use strict';

/**
 * Request-logging + performance-tracking middleware.
 *
 * - Captures method, path, status, duration, user ID, request ID, IP.
 * - Slow requests (> SLOW_MS) escalate to warn level.
 * - Tracks rolling per-endpoint stats (count, p50, p95, p99) accessible via
 *   getPerfSnapshot() — exposed on /api/health/detailed.
 */

const logger = require('../utils/logger');

const SLOW_MS = parseInt(process.env.SLOW_REQUEST_MS, 10) || 1500;

// Lightweight in-memory perf store. For high-volume endpoints we keep a
// fixed-size ring buffer of the last 200 latencies; older samples drop off.
const RING_SIZE = 200;
const MAX_ENDPOINTS = 200; // Cap perfMap size to prevent memory growth from unique path segments
const perfMap = new Map(); // key: "METHOD path" -> { count, errorCount, ring: [], idx, sum }

function recordLatency(key, ms, isError) {
    let entry = perfMap.get(key);
    if (!entry) {
        // Evict least-used entry if we hit the size cap (prevents unbounded growth
        // from user-controlled path segments like /api/profile/:username)
        if (perfMap.size >= MAX_ENDPOINTS) {
            let minKey = null, minCount = Infinity;
            for (const [k, v] of perfMap) {
                if (v.count < minCount) { minCount = v.count; minKey = k; }
            }
            if (minKey) perfMap.delete(minKey);
        }
        entry = { count: 0, errorCount: 0, ring: new Array(RING_SIZE).fill(null), idx: 0, sum: 0 };
        perfMap.set(key, entry);
    }
    entry.count++;
    if (isError) entry.errorCount++;
    entry.ring[entry.idx] = ms;
    entry.idx = (entry.idx + 1) % RING_SIZE;
    entry.sum += ms;
}

function percentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    const i = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
    return Math.round(sortedArr[i]);
}

function getPerfSnapshot(limit = 25) {
    const rows = [];
    for (const [key, entry] of perfMap) {
        const samples = entry.ring.filter(v => v != null).sort((a, b) => a - b);
        rows.push({
            endpoint: key,
            count: entry.count,
            errors: entry.errorCount,
            avgMs: samples.length ? Math.round(entry.sum / entry.count) : 0,
            p50: percentile(samples, 50),
            p95: percentile(samples, 95),
            p99: percentile(samples, 99),
        });
    }
    rows.sort((a, b) => b.count - a.count);
    return rows.slice(0, limit);
}

function resetPerf() {
    perfMap.clear();
}

function requestLogger(options = {}) {
    const skipPaths = new Set(options.skipPaths || ['/api/health', '/api/health/stats', '/favicon.ico']);
    return function (req, res, next) {
        if (skipPaths.has(req.path)) return next();
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const durMs = Number(process.hrtime.bigint() - start) / 1e6;
            const isError = res.statusCode >= 500;
            const isWarn = res.statusCode >= 400 || durMs > SLOW_MS;

            // Only record perf for /api/* — static-asset perf isn't actionable.
            if (req.path.startsWith('/api/')) {
                // Collapse high-cardinality IDs in the path (e.g. /api/user/123 -> /api/user/:id)
                const norm = req.path
                    .replace(/\/(\d+)(?=\/|$)/g, '/:id')
                    .replace(/\/[a-f0-9]{16,}/gi, '/:hash');
                recordLatency(`${req.method} ${norm}`, durMs, isError);
            }

            const meta = {
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Math.round(durMs),
                requestId: req.id,
                userId: req.user && req.user.id,
                ip: req.ip,
            };
            const msg = `${req.method} ${req.path} -> ${res.statusCode} ${Math.round(durMs)}ms`;
            if (isError) logger.error(msg, meta);
            else if (isWarn) logger.warn(msg, meta);
            else if (req.path.startsWith('/api/')) logger.info(msg, meta);
            else logger.debug(msg, meta);
        });
        next();
    };
}

module.exports = { requestLogger, getPerfSnapshot, resetPerf };
