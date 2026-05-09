'use strict';

/**
 * User search — public read-only endpoint with privacy filtering
 *   GET  /api/user-search?q=<prefix>
 *
 * Only returns:
 *   - non-banned users
 *   - whose profile_visibility is 'public'
 *
 * Returns minimal public fields. Used by lobby search bar + friend-add UI.
 */

const express = require('express');
const db = require('../database');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.status(400).json({ error: 'Query must be ≥ 2 chars' });
        if (q.length > 30) return res.status(400).json({ error: 'Query too long' });
        if (!/^[a-zA-Z0-9_]+$/.test(q)) return res.status(400).json({ error: 'Invalid characters in query' });

        const like = q + '%';
        const rows = await db.all(
            `SELECT id, username, display_name, profile_avatar_id, subscription_active
             FROM users
             WHERE username LIKE ?
               AND is_banned = 0
               AND COALESCE(profile_visibility, 'public') = 'public'
             ORDER BY username
             LIMIT 20`,
            [like]
        );
        res.json({
            results: rows.map(r => ({
                id: r.id,
                username: r.username,
                displayName: r.display_name || r.username,
                avatarId: r.profile_avatar_id || null,
                isVip: !!r.subscription_active,
            })),
        });
    } catch (err) {
        logger.error('User search failed', { error: err.message });
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
