/**
 * Affiliate/UTM Tracking Routes
 * Handles tracking of affiliate visits and conversions
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Bootstrap affiliate_tracking table
 */
async function initAffiliateTable() {
    try {
        const sql = `
            CREATE TABLE IF NOT EXISTS affiliate_tracking (
                id ${idDef},
                user_id INTEGER,
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                utm_content TEXT,
                affiliate_id TEXT,
                landing_page TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at ${tsDef}
            )
        `;

        await db.run(sql, []);
        console.warn('[Affiliate] Table initialized: affiliate_tracking');
    } catch (err) {
        console.warn('[Affiliate] Failed to initialize table:', err.message);
    }
}

// Table initialization deferred to server startup (see server/index.js)

/**
 * Get client IP address from request
 */
function getClientIp(req) {
    return (
        req.headers['x-forwarded-for'] ||
        req.headers['cf-connecting-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket?.remoteAddress ||
        'unknown'
    ).split(',')[0].trim();
}

/**
 * POST /api/affiliate/track
 * Records a visit/conversion without authentication
 * Body: { utmSource, utmMedium, utmCampaign, utmContent, affiliateId, landingPage }
 */
router.post('/track', async (req, res) => {
    try {
        const {
            utmSource,
            utmMedium,
            utmCampaign,
            utmContent,
            affiliateId,
            landingPage
        } = req.body;

        // All fields optional — track whatever is provided
        const ipAddress = getClientIp(req);
        const userAgent = req.headers['user-agent'] || 'unknown';

        const sql = `
            INSERT INTO affiliate_tracking (
                utm_source,
                utm_medium,
                utm_campaign,
                utm_content,
                affiliate_id,
                landing_page,
                ip_address,
                user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            utmSource || null,
            utmMedium || null,
            utmCampaign || null,
            utmContent || null,
            affiliateId || null,
            landingPage || null,
            ipAddress,
            userAgent
        ];

        await db.run(sql, params);

        console.warn('[Affiliate] Tracked visit:', {
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
            affiliate_id: affiliateId,
            ip: ipAddress
        });

        res.json({ tracked: true });
    } catch (err) {
        console.warn('[Affiliate] Track error:', err.message);
        res.status(500).json({ error: 'Failed to track attribution' });
    }
});

/**
 * POST /api/affiliate/convert
 * Links an existing user_id to a tracked attribution record
 * Used during registration to update the tracking record with user_id
 * Requires authentication
 * Body: { utmSource, utmMedium, utmCampaign, utmContent, affiliateId }
 */
router.post('/convert', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            utmSource,
            utmMedium,
            utmCampaign,
            utmContent,
            affiliateId
        } = req.body;

        // Try to find and update the most recent matching attribution record
        // Match on affiliate_id or if no affiliate_id, just use most recent with any params
        let sql;
        let params;

        if (affiliateId) {
            sql = `
                UPDATE affiliate_tracking
                SET user_id = ?
                WHERE affiliate_id = ? AND user_id IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            `;
            params = [userId, affiliateId];
        } else if (utmSource || utmMedium || utmCampaign || utmContent) {
            // Match on UTM params
            sql = `
                UPDATE affiliate_tracking
                SET user_id = ?
                WHERE user_id IS NULL
                AND (
                    (utm_source = ? AND utm_source IS NOT NULL) OR
                    (utm_medium = ? AND utm_medium IS NOT NULL) OR
                    (utm_campaign = ? AND utm_campaign IS NOT NULL) OR
                    (utm_content = ? AND utm_content IS NOT NULL)
                )
                ORDER BY created_at DESC
                LIMIT 1
            `;
            params = [userId, utmSource, utmMedium, utmCampaign, utmContent];
        } else {
            // No attribution data provided
            return res.status(400).json({ error: 'No attribution data provided' });
        }

        const result = await db.run(sql, params);

        console.warn('[Affiliate] Conversion recorded for user:', {
            user_id: userId,
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
            affiliate_id: affiliateId,
            updated_rows: result.changes || 0
        });

        res.json({ converted: true, updated: result.changes || 0 });
    } catch (err) {
        console.warn('[Affiliate] Convert error:', err.message);
        res.status(500).json({ error: 'Failed to record conversion' });
    }
});

/**
 * GET /api/affiliate/stats
 * Returns aggregate stats grouped by utm_source
 * Admin only
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        // Check admin status
        const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
        if (!user || !user.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // Get aggregate stats grouped by utm_source
        const sql = `
            SELECT
                utm_source,
                utm_medium,
                utm_campaign,
                COUNT(*) as total_visits,
                SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) as conversions,
                ROUND(100.0 * SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as conversion_rate,
                MIN(created_at) as first_visit,
                MAX(created_at) as last_visit
            FROM affiliate_tracking
            WHERE utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL
            GROUP BY utm_source, utm_medium, utm_campaign
            ORDER BY total_visits DESC
        `;

        const stats = await db.all(sql, []);

        // Also get affiliate_id stats
        const affiliateSql = `
            SELECT
                affiliate_id,
                COUNT(*) as total_visits,
                SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) as conversions,
                ROUND(100.0 * SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as conversion_rate,
                MIN(created_at) as first_visit,
                MAX(created_at) as last_visit
            FROM affiliate_tracking
            WHERE affiliate_id IS NOT NULL
            GROUP BY affiliate_id
            ORDER BY total_visits DESC
        `;

        const affiliateStats = await db.all(affiliateSql, []);

        res.json({
            utm_stats: stats || [],
            affiliate_stats: affiliateStats || [],
            generated_at: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[Affiliate] Stats error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve stats' });
    }
});

/**
 * GET /api/affiliate/stats/detail
 * Returns detailed individual tracking records
 * Admin only
 * Query params: ?limit=100&offset=0&source=google
 */
router.get('/stats/detail', authenticate, async (req, res) => {
    try {
        // Check admin status
        const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
        if (!user || !user.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 1000));
        const offset = parseInt(req.query.offset, 10) || 0;
        const source = req.query.source;

        let sql = 'SELECT * FROM affiliate_tracking WHERE 1=1'; /* admin-only: all columns intentional */
        let params = [];

        if (source) {
            sql += ' AND utm_source = ?';
            params.push(source);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const records = await db.all(sql, params);

        // Get total count
        let countSql = 'SELECT COUNT(*) as count FROM affiliate_tracking WHERE 1=1';
        if (source) {
            countSql += ' AND utm_source = ?';
        }

        const countResult = await db.get(
            countSql,
            source ? [source] : []
        );
        const total = countResult?.count || 0;

        res.json({
            records: records || [],
            total: total,
            limit: limit,
            offset: offset,
            generated_at: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[Affiliate] Detail stats error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve detail stats' });
    }
});

module.exports = router;
module.exports.bootstrapAffiliateTables = initAffiliateTable;
