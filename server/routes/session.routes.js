'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const sessionTimer = require('../services/session-timer.service');

const router = express.Router();

// GET /api/session/status — current session status (elapsed, remaining, limit)
router.get('/status', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const info = sessionTimer.getSessionInfo(userId);

        if (!info) {
            return res.json({
                active: false,
                elapsed: 0,
                limit: null,
                remaining: null
            });
        }

        // Fetch limit from DB to include in response
        const limitsRow = await db.get(
            'SELECT session_time_limit FROM user_limits WHERE user_id = ?',
            [userId]
        );
        const limit = (limitsRow && limitsRow.session_time_limit != null)
            ? limitsRow.session_time_limit
            : null;

        const remaining = (limit !== null)
            ? Math.max(0, limit - info.elapsedMinutes)
            : null;

        res.json({
            active: true,
            startedAt: info.startedAt,
            elapsed: info.elapsedMinutes,
            limit,
            remaining
        });
    } catch (err) {
        console.warn('[Session] Status error:', err.message);
        res.status(500).json({ error: 'Failed to get session status' });
    }
});

// POST /api/session/start — start a new session timer
router.post('/start', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const session = sessionTimer.startSession(userId);

        res.json({
            message: 'Session started',
            startedAt: new Date(session.startedAt).toISOString()
        });
    } catch (err) {
        console.warn('[Session] Start error:', err.message);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

// POST /api/session/end — end current session
router.post('/end', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const info = sessionTimer.getSessionInfo(userId);
        sessionTimer.endSession(userId);

        res.json({
            message: 'Session ended',
            elapsed: info ? info.elapsedMinutes : 0
        });
    } catch (err) {
        console.warn('[Session] End error:', err.message);
        res.status(500).json({ error: 'Failed to end session' });
    }
});

// GET /api/session/limit — get user's configured time limit
router.get('/limit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const limitsRow = await db.get(
            'SELECT session_time_limit FROM user_limits WHERE user_id = ?',
            [userId]
        );
        const limit = (limitsRow && limitsRow.session_time_limit != null)
            ? limitsRow.session_time_limit
            : null;

        res.json({ limit });
    } catch (err) {
        console.warn('[Session] Get limit error:', err.message);
        res.status(500).json({ error: 'Failed to get session limit' });
    }
});

// PUT /api/session/limit — set session time limit (minutes, min 15, max 1440)
router.put('/limit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit } = req.body;

        // Allow null to remove the limit
        if (limit !== null && limit !== undefined) {
            const minutes = parseInt(limit, 10);
            if (isNaN(minutes) || minutes < 15 || minutes > 1440) {
                return res.status(400).json({
                    error: 'Session time limit must be between 15 and 1440 minutes (24 hours)'
                });
            }

            // Ensure user_limits row exists
            const existing = await db.get(
                'SELECT user_id FROM user_limits WHERE user_id = ?',
                [userId]
            );
            if (!existing) {
                await db.run('INSERT OR IGNORE INTO user_limits (user_id) VALUES (?)', [userId]);
            }

            await db.run(
                "UPDATE user_limits SET session_time_limit = ?, updated_at = datetime('now') WHERE user_id = ?",
                [minutes, userId]
            );

            res.json({ message: 'Session time limit updated', limit: minutes });
        } else {
            // Remove limit (set to null)
            const existing = await db.get(
                'SELECT user_id FROM user_limits WHERE user_id = ?',
                [userId]
            );
            if (!existing) {
                await db.run('INSERT OR IGNORE INTO user_limits (user_id) VALUES (?)', [userId]);
            }

            await db.run(
                "UPDATE user_limits SET session_time_limit = NULL, updated_at = datetime('now') WHERE user_id = ?",
                [userId]
            );

            res.json({ message: 'Session time limit removed', limit: null });
        }
    } catch (err) {
        console.warn('[Session] Set limit error:', err.message);
        res.status(500).json({ error: 'Failed to set session limit' });
    }
});

// POST /api/session/track — client heartbeat / activity tracking (fire-and-forget)
// Client sends periodic pings to track active session time
router.post('/track', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { event, page, duration } = req.body;

        // Touch session timer to keep it alive
        const info = sessionTimer.getSessionInfo(userId);
        if (!info) {
            sessionTimer.startSession(userId);
        }

        // Update last_active timestamp on user record
        try {
            await db.run(
                "UPDATE users SET last_login = datetime('now') WHERE id = ?",
                [userId]
            );
        } catch (dbErr) { console.warn('[Session] last_login update failed:', dbErr.message || dbErr); }

        res.json({ status: 'tracked' });
    } catch (err) {
        // Fire-and-forget — never fail the client
        res.json({ status: 'ok' });
    }
});

// ── Wager Limits (Responsible Gambling §12) ──

// GET /api/session/wager-limit — get daily wager limit + today's usage
router.get('/wager-limit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const limitsRow = await db.get(
            'SELECT daily_wager_limit FROM user_limits WHERE user_id = ?', [userId]
        );
        const limit = (limitsRow && limitsRow.daily_wager_limit != null)
            ? limitsRow.daily_wager_limit : null;

        // Calculate today's total wagered
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let todayWagered = 0;
        try {
            const row = await db.get(
                "SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ? AND created_at >= ?",
                [userId, todayStart.toISOString()]
            );
            if (row) todayWagered = row.total;
        } catch (e) { /* table may not have created_at index */ }

        res.json({ limit, todayWagered: Number(todayWagered.toFixed(2)), remaining: limit ? Math.max(0, limit - todayWagered) : null });
    } catch (err) {
        console.warn('[Session] Wager limit get error:', err.message);
        res.status(500).json({ error: 'Failed to get wager limit' });
    }
});

// PUT /api/session/wager-limit — set daily wager limit
router.put('/wager-limit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit } = req.body;

        // Ensure user_limits row exists
        const existing = await db.get('SELECT user_id, daily_wager_limit FROM user_limits WHERE user_id = ?', [userId]);
        if (!existing) {
            await db.run('INSERT OR IGNORE INTO user_limits (user_id) VALUES (?)', [userId]);
        }

        if (limit === null || limit === undefined || limit === 0) {
            await db.run("UPDATE user_limits SET daily_wager_limit = NULL, updated_at = datetime('now') WHERE user_id = ?", [userId]);
            return res.json({ message: 'Daily wager limit removed', limit: null });
        }

        const val = parseFloat(limit);
        if (!Number.isFinite(val) || val < 1 || val > 100000) {
            return res.status(400).json({ error: 'Wager limit must be between $1 and $100,000' });
        }

        // 24-hour cooling-off for increases (lowering is immediate)
        if (existing && existing.daily_wager_limit && val > existing.daily_wager_limit) {
            return res.status(400).json({
                error: 'Wager limit increases require a 24-hour cooling-off period. You can lower your limit immediately.',
                currentLimit: existing.daily_wager_limit
            });
        }

        await db.run(
            "UPDATE user_limits SET daily_wager_limit = ?, updated_at = datetime('now') WHERE user_id = ?",
            [val, userId]
        );

        res.json({ message: 'Daily wager limit set to $' + val.toFixed(2), limit: val });
    } catch (err) {
        console.warn('[Session] Wager limit set error:', err.message);
        res.status(500).json({ error: 'Failed to set wager limit' });
    }
});

module.exports = router;
