'use strict';

/**
 * Activity feed — recent big wins and milestones.
 * Privacy: respects users.show_activity_feed (opt-out) and the global
 * profile_visibility setting (private profiles never appear).
 *
 *   GET  /api/activity-feed                — global feed (last 50 big wins)
 *   GET  /api/activity-feed/friends        — friends-only feed (authenticated)
 *   GET  /api/activity-feed/me             — current user's published events
 */

const express = require('express');
const db = require('../database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const BIG_WIN_MULT_THRESHOLD = 25;   // ≥ 25× bet
const BIG_WIN_AMOUNT_FLOOR   = 50;    // OR win ≥ $50

function shape(row) {
    return {
        username: row.username,
        displayName: row.display_name || row.username,
        avatarId: row.profile_avatar_id || null,
        gameId: row.game_id,
        betAmount: Number(row.bet_amount) || 0,
        winAmount: Number(row.win_amount) || 0,
        multiplier: row.bet_amount > 0 ? Number(row.win_amount) / Number(row.bet_amount) : 0,
        createdAt: row.created_at,
    };
}

// ─── GET /api/activity-feed ──────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
        const rows = await db.all(
            `SELECT s.user_id, s.game_id, s.bet_amount, s.win_amount, s.created_at,
                    u.username, u.display_name, u.profile_avatar_id
             FROM spins s JOIN users u ON u.id = s.user_id
             WHERE u.is_banned = 0
               AND COALESCE(u.show_activity_feed, 1) = 1
               AND COALESCE(u.profile_visibility, 'public') = 'public'
               AND s.win_amount > 0
               AND (
                    s.win_amount >= ? OR
                    (s.bet_amount > 0 AND s.win_amount / s.bet_amount >= ?)
               )
             ORDER BY s.created_at DESC
             LIMIT ?`,
            [BIG_WIN_AMOUNT_FLOOR, BIG_WIN_MULT_THRESHOLD, limit]
        );
        res.json({ events: rows.map(shape) });
    } catch (err) {
        logger.error('Activity feed failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

// ─── GET /api/activity-feed/friends ──────────────────────────
router.get('/friends', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
        const rows = await db.all(
            `SELECT s.user_id, s.game_id, s.bet_amount, s.win_amount, s.created_at,
                    u.username, u.display_name, u.profile_avatar_id
             FROM spins s
             JOIN users u ON u.id = s.user_id
             JOIN friendships f
                ON f.status = 'accepted'
               AND ((f.requester_id = ? AND f.addressee_id = u.id)
                 OR (f.addressee_id = ? AND f.requester_id = u.id))
             WHERE u.is_banned = 0
               AND COALESCE(u.show_activity_feed, 1) = 1
               AND s.win_amount > 0
             ORDER BY s.created_at DESC
             LIMIT ?`,
            [req.user.id, req.user.id, limit]
        );
        res.json({ events: rows.map(shape) });
    } catch (err) {
        logger.error('Friends feed failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load friends feed' });
    }
});

// ─── GET /api/activity-feed/me ───────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT s.game_id, s.bet_amount, s.win_amount, s.created_at,
                    u.username, u.display_name, u.profile_avatar_id
             FROM spins s JOIN users u ON u.id = s.user_id
             WHERE s.user_id = ? AND s.win_amount > 0
             ORDER BY s.created_at DESC LIMIT 30`,
            [req.user.id]
        );
        res.json({ events: rows.map(shape) });
    } catch (err) {
        logger.error('Self feed failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

module.exports = router;
