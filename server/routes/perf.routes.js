const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/perf
 * Store performance metrics from frontend
 * No authentication required (fire-and-forget)
 */
router.post('/', async (req, res) => {
    try {
        const {
            pageLoadTime,
            fcp,
            lcp,
            tti,
            domNodes,
            memory,
            url,
            userAgent,
            timestamp,
        } = req.body;

        // Validate that we have at least some data
        if (!timestamp && !url) {
            // Silently accept empty payloads (client may send before page ready)
            return res.status(204).end();
        }

        // Insert into perf_metrics table
        await db.run(
            `INSERT INTO perf_metrics (
                page_load_time, fcp, lcp, tti, dom_nodes,
                memory_used_mb, memory_total_mb, memory_limit_mb,
                url, user_agent, collected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pageLoadTime || null,
                fcp || null,
                lcp || null,
                tti || null,
                domNodes || null,
                memory?.usedJSHeapSize || null,
                memory?.totalJSHeapSize || null,
                memory?.jsHeapSizeLimit || null,
                url || null,
                userAgent || null,
                timestamp || new Date().toISOString(),
            ]
        );

        // Return 200 OK (no content needed — fire-and-forget)
        res.status(200).json({ status: 'recorded' });
    } catch (err) {
        // Log error but don't fail the response (fire-and-forget)
        console.warn('[Perf] Failed to record metrics:', err.message);
        // ROUND 42: Don't expose internal error messages to clients
        res.status(200).json({ status: 'error' });
    }
});

/**
 * POST /api/perf/client
 * Alias for POST /api/perf — client-side bundle sends metrics here
 */
router.post('/client', async (req, res) => {
    try {
        const {
            pageLoadTime, fcp, lcp, tti, domNodes,
            memory, url, userAgent, timestamp,
        } = req.body;

        if (!timestamp && !url) {
            // Silently accept empty payloads (client may send before page ready)
            return res.status(204).end();
        }

        await db.run(
            `INSERT INTO perf_metrics (
                page_load_time, fcp, lcp, tti, dom_nodes,
                memory_used_mb, memory_total_mb, memory_limit_mb,
                url, user_agent, collected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pageLoadTime || null, fcp || null, lcp || null,
                tti || null, domNodes || null,
                memory?.usedJSHeapSize || null,
                memory?.totalJSHeapSize || null,
                memory?.jsHeapSizeLimit || null,
                url || null, userAgent || null,
                timestamp || new Date().toISOString(),
            ]
        );

        res.status(200).json({ status: 'recorded' });
    } catch (err) {
        console.warn('[Perf] Failed to record client metrics:', err.message);
        res.status(200).json({ status: 'error' });
    }
});

/**
 * GET /api/perf/summary
 * Returns aggregate performance statistics (admin only)
 */
router.get('/summary', requireAdmin, async (req, res) => {
    try {
        // Get aggregate stats
        const stats = await db.get(
            `SELECT
                COUNT(*) as total_samples,
                ROUND(AVG(page_load_time), 2) as avg_page_load_time,
                ROUND(AVG(fcp), 2) as avg_fcp,
                ROUND(AVG(lcp), 2) as avg_lcp,
                ROUND(AVG(tti), 2) as avg_tti,
                ROUND(AVG(dom_nodes), 0) as avg_dom_nodes,
                ROUND(AVG(memory_used_mb), 2) as avg_memory_used_mb,
                ROUND(AVG(memory_total_mb), 2) as avg_memory_total_mb,
                MAX(page_load_time) as max_page_load_time,
                MAX(lcp) as max_lcp,
                MIN(page_load_time) as min_page_load_time,
                MIN(lcp) as min_lcp
            FROM perf_metrics
            WHERE collected_at >= datetime('now', '-7 days')`,
            []
        );

        // Get stats by URL (top 10 slowest pages)
        const byUrl = await db.all(
            `SELECT
                url,
                COUNT(*) as samples,
                ROUND(AVG(page_load_time), 2) as avg_load_time,
                ROUND(AVG(lcp), 2) as avg_lcp,
                MAX(page_load_time) as max_load_time
            FROM perf_metrics
            WHERE collected_at >= datetime('now', '-7 days')
            GROUP BY url
            ORDER BY avg_load_time DESC
            LIMIT 10`,
            []
        );

        // Get recent samples (last 20)
        const recent = await db.all(
            `SELECT
                id,
                page_load_time,
                fcp,
                lcp,
                tti,
                dom_nodes,
                url,
                collected_at
            FROM perf_metrics
            ORDER BY collected_at DESC
            LIMIT 20`,
            []
        );

        res.json({
            summary: stats,
            byUrl: byUrl,
            recentSamples: recent,
            timeRange: 'Last 7 days',
        });
    } catch (err) {
        console.warn('[Perf] Failed to fetch summary:', err.message);
        res.status(500).json({ error: 'Failed to fetch performance summary' });
    }
});

module.exports = router;
