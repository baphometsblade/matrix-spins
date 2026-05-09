const express = require('express');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const os = require('os');
let perfMod = null;
try { perfMod = require('../middleware/request-logger'); } catch (_) { /* optional */ }

const router = express.Router();

// Compute build info once at startup — the deployed git commit hash is
// sampled from Render's RENDER_GIT_COMMIT env var if present, else from
// the dist/index.html bundle hash (which changes per content-bundle).
const BUILD_INFO = (() => {
    const info = {
        commit: process.env.RENDER_GIT_COMMIT || null,
        builtAt: null,
        bundleJs: null,
        bundleCss: null
    };
    try {
        const distIndex = path.join(__dirname, '..', '..', 'dist', 'index.html');
        if (fs.existsSync(distIndex)) {
            const html = fs.readFileSync(distIndex, 'utf8');
            const jsMatch = html.match(/bundle\.[a-f0-9]+\.[a-z.]*js/);
            const cssMatch = html.match(/styles\.[a-f0-9]+\.[a-z.]*css/);
            info.bundleJs = jsMatch ? jsMatch[0] : null;
            info.bundleCss = cssMatch ? cssMatch[0] : null;
            info.builtAt = fs.statSync(distIndex).mtime.toISOString();
        }
    } catch (_) { /* keep nulls */ }
    return info;
})();

/**
 * GET /api/health â€” Public health check
 * Returns basic server status, uptime, and version
 */
router.get('/', async (req, res) => {
    try {
        const db = require('../database');

        // Use a generous timeout for PG cold starts on Render free tier
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB ping timeout')), 25000));

        await Promise.race([db.get('SELECT 1'), timeoutPromise]);

        const now = new Date().toISOString();
        res.json({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: now,
            version: '1.0.0'
        });
    } catch (err) {
        // Return 200 with degraded status during startup â€” load balancers
        // need a 200 response; 503 causes deploy failure on PG cold starts
        if (process.uptime() < 60) {
            res.json({
                status: 'starting',
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                note: 'DB warming up'
            });
        } else {
            res.status(503).json({
                status: 'error',
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                message: err.message
            });
        }
    }
});

/**
 * GET /api/build — Public build/deploy info
 * Lets operators verify which commit + bundle is actually live.
 * Useful for diagnosing deploy lag and cache-bust issues.
 */
router.get('/build', (req, res) => {
    res.json({
        ...BUILD_INFO,
        uptime: Math.floor(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        nodeEnv: process.env.NODE_ENV || 'development'
    });
});

/**
 * GET /api/health/detailed â€” Detailed health check (admin only)
 * Returns system info including memory, database status, user counts
 */
router.get('/detailed', authenticate, requireAdmin, async (req, res) => {
    try {
        const db = require('../database');

        // Measure DB response time
        const dbStart = Date.now();
        await db.get('SELECT 1');
        const dbResponseTime = Date.now() - dbStart;

        // Get memory usage
        const memUsage = process.memoryUsage();
        const formatBytes = (bytes) => {
            const mb = bytes / 1024 / 1024;
            return Math.round(mb * 10) / 10 + 'MB';
        };

        // Get total user count
        let totalUsers = 0;
        try {
            const userResult = await db.get('SELECT COUNT(*) as count FROM users');
            totalUsers = userResult ? userResult.count : 0;
        } catch (err) {
            console.warn('[Health] Failed to count users:', err.message);
        }

        // Get active sessions count (sessions created today)
        let activeSessionsToday = 0;
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayISO = todayStart.toISOString();

            const sessionResult = await db.get(
                'SELECT COUNT(*) as count FROM users WHERE last_login >= ?',
                [todayISO]
            );
            activeSessionsToday = sessionResult ? sessionResult.count : 0;
        } catch (err) {
            console.warn('[Health] Failed to count active sessions:', err.message);
        }

        const now = new Date().toISOString();
        const loadAvg = os.loadavg();
        const perf = perfMod && typeof perfMod.getPerfSnapshot === 'function'
            ? perfMod.getPerfSnapshot(15)
            : null;
        res.json({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: now,
            version: '1.0.0',
            memory: {
                rss: formatBytes(memUsage.rss),
                heapUsed: formatBytes(memUsage.heapUsed),
                heapTotal: formatBytes(memUsage.heapTotal),
                external: formatBytes(memUsage.external)
            },
            system: {
                platform: process.platform,
                arch: process.arch,
                cpus: os.cpus().length,
                loadAvg: loadAvg.map(n => Number(n.toFixed(2))),
                freeMemMB: Math.round(os.freemem() / 1048576),
                totalMemMB: Math.round(os.totalmem() / 1048576),
            },
            database: {
                status: 'connected',
                responseTime: dbResponseTime + 'ms'
            },
            env: config.NODE_ENV,
            nodeVersion: process.version,
            totalUsers: totalUsers,
            activeSessionsToday: activeSessionsToday,
            perf: perf,
            featureFlags: {
                stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
                webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
                adminApiKeyConfigured: !!process.env.ADMIN_API_KEY,
                geoBlockEnabled: !!process.env.ALLOWED_COUNTRIES,
            },
        });
    } catch (err) {
        console.warn('[Health] Detailed health check error:', err.message);
        res.status(503).json({
            status: 'error',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            message: err.message
        });
    }
});


/**
 * GET /api/health/stats — Public live stats for the lobby
 * Returns active session count (users active in last 15 min)
 */
router.get('/stats', async (req, res) => {
    try {
        const db = require('../database');
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        let activeSessions = 0;
        try {
            const result = await db.get(
                "SELECT COUNT(*) as count FROM users WHERE last_login >= ?",
                [cutoff]
            );
            activeSessions = result ? Math.max(result.count, 1) : 1;
        } catch (e) {
            activeSessions = 1;
        }
        res.json({ activeSessions, timestamp: new Date().toISOString() });
    } catch (err) {
        res.json({ activeSessions: 1, timestamp: new Date().toISOString() });
    }
});
module.exports = router;

