'use strict';

/**
 * Newsletter Subscription API
 *
 * Routes:
 *   POST /api/newsletter/subscribe         — Subscribe to newsletter (no auth required)
 *   POST /api/newsletter/unsubscribe       — Unsubscribe from newsletter
 *   GET  /api/newsletter/admin/subscribers — List active subscribers (admin only)
 *   GET  /api/newsletter/admin/stats       — Newsletter statistics (admin only)
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

/**
 * Email validation regex — basic check for email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Extract user_id from JWT token in Authorization header
 * Returns null if no valid token is present
 */
function extractUserIdFromAuth(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    try {
        const jwt = require('jsonwebtoken');
        const config = require('../config');
        const token = authHeader.slice(7);
        const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
        return payload.userId || null;
    } catch (err) {
        return null;
    }
}

/**
 * Bootstrap newsletter_subscribers table at module load
 */
async function bootstrapTable() {
    try {
        var isPg = !!process.env.DATABASE_URL;
        var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS newsletter_subscribers (' +
            '  id ' + idDef + ',' +
            '  email TEXT UNIQUE NOT NULL,' +
            '  user_id INTEGER NULL,' +
            '  subscribed_at ' + tsDef + ',' +
            '  unsubscribed INTEGER DEFAULT 0,' +
            "  source TEXT DEFAULT 'website'" +
            ')'
        );
        console.warn('[Newsletter] Table initialized');
    } catch (err) {
        console.warn('[Newsletter] Bootstrap error:', err.message);
    }
}

// Bootstrap table at module load
bootstrapTable().catch(function(e) { console.warn('[Newsletter] Bootstrap failed:', e.message); });

/**
 * POST /api/newsletter/subscribe
 * Subscribe to newsletter
 *
 * Body: { email }
 * - Validates email format
 * - Inserts new subscriber or re-subscribes if previously unsubscribed
 * - Associates user_id if valid JWT token is present
 *
 * Returns: { success: true, message: 'Subscribed successfully' }
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email presence
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email is required' });
        }

        const trimmedEmail = email.trim().toLowerCase();

        // Validate email format
        if (!isValidEmail(trimmedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Try to extract user_id from Authorization header
        let userId = null;
        const authHeader = req.headers.authorization;
        if (authHeader) {
            userId = extractUserIdFromAuth(authHeader);
        }

        // Check if subscriber already exists
        const existing = await db.get(
            'SELECT id, unsubscribed FROM newsletter_subscribers WHERE email = ?',
            [trimmedEmail]
        );

        if (existing) {
            // If already subscribed, return success
            if (existing.unsubscribed === 0) {
                return res.json({ success: true, message: 'Already subscribed' });
            }

            // Re-subscribe if previously unsubscribed
            await db.run(
                'UPDATE newsletter_subscribers SET unsubscribed = 0, subscribed_at = datetime("now") WHERE email = ?',
                [trimmedEmail]
            );
        } else {
            // Insert new subscriber
            await db.run(
                'INSERT INTO newsletter_subscribers (email, user_id, source) VALUES (?, ?, ?)',
                [trimmedEmail, userId, 'website']
            );
        }

        res.json({ success: true, message: 'Subscribed successfully' });
    } catch (err) {
        console.warn('[Newsletter] Subscribe error:', err.message);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

/**
 * POST /api/newsletter/unsubscribe
 * Unsubscribe from newsletter
 *
 * Body: { email }
 * - Marks subscriber as unsubscribed
 *
 * Returns: { success: true }
 */
router.post('/unsubscribe', async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email presence
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email is required' });
        }

        const trimmedEmail = email.trim().toLowerCase();

        // Validate email format
        if (!isValidEmail(trimmedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Mark as unsubscribed
        await db.run(
            'UPDATE newsletter_subscribers SET unsubscribed = 1 WHERE email = ?',
            [trimmedEmail]
        );

        res.json({ success: true, message: 'Unsubscribed successfully' });
    } catch (err) {
        console.warn('[Newsletter] Unsubscribe error:', err.message);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

/**
 * GET /api/newsletter/admin/subscribers
 * List active subscribers (admin only)
 *
 * Query params:
 * - page: page number (default 1)
 * - limit: results per page (default 50)
 *
 * Returns:
 * {
 *   total: number,
 *   page: number,
 *   limit: number,
 *   subscribers: [{ id, email, user_id, subscribed_at, source }]
 * }
 */
router.get('/admin/subscribers', authenticate, requireAdmin, async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;

        // Enforce limits
        if (page < 1) page = 1;
        if (limit < 1 || limit > 500) limit = 50;

        const offset = (page - 1) * limit;

        // Get total count of active subscribers
        const countResult = await db.get(
            'SELECT COUNT(*) as total FROM newsletter_subscribers WHERE unsubscribed = 0',
            []
        );
        const total = countResult.total || 0;

        // Get paginated subscribers
        const subscribers = await db.all(
            `SELECT id, email, user_id, subscribed_at, source
             FROM newsletter_subscribers
             WHERE unsubscribed = 0
             ORDER BY subscribed_at DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        res.json({
            total: total,
            page: page,
            limit: limit,
            subscribers: subscribers || []
        });
    } catch (err) {
        console.warn('[Newsletter] Get subscribers error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve subscribers' });
    }
});

/**
 * GET /api/newsletter/admin/stats
 * Newsletter statistics (admin only)
 *
 * Returns:
 * {
 *   totalSubscribers: number,
 *   totalUnsubscribed: number,
 *   newThisWeek: number,
 *   newThisMonth: number
 * }
 */
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        // Total active subscribers
        const totalResult = await db.get(
            'SELECT COUNT(*) as count FROM newsletter_subscribers WHERE unsubscribed = 0',
            []
        );
        const totalSubscribers = totalResult.count || 0;

        // Total unsubscribed
        const unsubResult = await db.get(
            'SELECT COUNT(*) as count FROM newsletter_subscribers WHERE unsubscribed = 1',
            []
        );
        const totalUnsubscribed = unsubResult.count || 0;

        // New subscribers this week (last 7 days)
        const weekResult = await db.get(
            `SELECT COUNT(*) as count FROM newsletter_subscribers
             WHERE unsubscribed = 0 AND subscribed_at >= datetime('now', '-7 days')`,
            []
        );
        const newThisWeek = weekResult.count || 0;

        // New subscribers this month (last 30 days)
        const monthResult = await db.get(
            `SELECT COUNT(*) as count FROM newsletter_subscribers
             WHERE unsubscribed = 0 AND subscribed_at >= datetime('now', '-30 days')`,
            []
        );
        const newThisMonth = monthResult.count || 0;

        res.json({
            totalSubscribers: totalSubscribers,
            totalUnsubscribed: totalUnsubscribed,
            newThisWeek: newThisWeek,
            newThisMonth: newThisMonth
        });
    } catch (err) {
        console.warn('[Newsletter] Get stats error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
});

module.exports = router;
