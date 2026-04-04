const express = require('express');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * HEAD /api/health — Lightweight health ping for connection quality checks
 * Client-side _initConnectionQuality603() sends HEAD to measure latency;
 * without this handler Express returns 503 for HEAD on a GET-only route.
 */
router.head('/', (req, res) => {
    res.status(200).end();
});

/**
 * GET /api/health — Public health check
 * Returns basic server status, uptime, and version
 */
router.get('/', async (req, res) => {
    try {
        const db = require('../database');

        // Use a generous timeout for PG cold starts on Render free tier
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB ping timeout')), 25000));

        let dbOk = true;
        try {
            await Promise.race([db.get('SELECT 1'), timeoutPromise]);
        } catch(_) {
            dbOk = false;
        }

        const now = new Date().toISOString();
        res.json({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: now,
            version: '1.0.0',
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            nodeVersion: process.version,
            db: dbOk ? 'ok' : 'error'
        });
    } catch (err) {
        // Return 200 with degraded status during startup — load balancers
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
            // Always return 200 for basic health -- 503 causes Render deploy failures
            // DB issues are logged but don't take the service offline
            console.warn('[Health] DB check failed after startup:', err.message);
            res.json({
                status: 'degraded',
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                note: 'DB connection issue, service operational'
            });
        }
    }
});

/**
 * GET /api/health/assets — Debug: check asset directories on disk
 */
router.get('/assets', (req, res) => {
    const path = require('path');
    const fs = require('fs');
    const assetsDir = path.join(__dirname, '..', '..', 'assets');
    const gsDir = path.join(assetsDir, 'game_symbols');
    const result = { assetsExists: fs.existsSync(assetsDir), gameSymbolsExists: fs.existsSync(gsDir) };
    if (result.gameSymbolsExists) {
        try {
            const dirs = fs.readdirSync(gsDir).slice(0, 20);
            result.gameSymbolDirs = dirs;
            result.totalDirs = fs.readdirSync(gsDir).length;
            // Check first dir contents
            if (dirs.length > 0) {
                const firstDir = path.join(gsDir, dirs[0]);
                result.firstDirFiles = fs.readdirSync(firstDir);
            }
            // Check ancient_tombs specifically
            const atDir = path.join(gsDir, 'ancient_tombs');
            result.ancientTombsExists = fs.existsSync(atDir);
            if (result.ancientTombsExists) {
                result.ancientTombsFiles = fs.readdirSync(atDir);
            }
        } catch(e) { result.error = e.message; }
    }
    res.json(result);
});

/**
 * GET /api/health/detailed — Detailed health check (admin only)
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
            const todayISO = todayStart.toISOString().slice(0, 19).replace('T', ' ');

            const sessionResult = await db.get(
                'SELECT COUNT(*) as count FROM users WHERE last_login >= datetime(?)',
                [todayISO]
            );
            activeSessionsToday = sessionResult ? sessionResult.count : 0;
        } catch (err) {
            console.warn('[Health] Failed to count active sessions:', err.message);
        }

        const now = new Date().toISOString();
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
            database: {
                status: 'connected',
                responseTime: dbResponseTime + 'ms'
            },
            env: config.NODE_ENV,
            nodeVersion: process.version,
            totalUsers: totalUsers,
            activeSessionsToday: activeSessionsToday
        });
    } catch (err) {
        console.warn('[Health] Detailed health check error:', err.message);
        // ROUND 42: Don't expose internal error messages to clients
        res.status(503).json({
            status: 'error',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
