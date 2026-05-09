'use strict';

/**
 * Friends system
 *   POST   /api/friends/request   { username }
 *   POST   /api/friends/accept    { requestId }
 *   POST   /api/friends/decline   { requestId }
 *   POST   /api/friends/cancel    { requestId }      — withdraw a request you sent
 *   DELETE /api/friends/:userId                       — unfriend
 *   GET    /api/friends                               — accepted list
 *   GET    /api/friends/requests                      — incoming + outgoing pending
 *   GET    /api/friends/search?q=<username>          — find users by username
 */

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }

db.run(`CREATE TABLE IF NOT EXISTS friendships (
    id ${_idDef()},
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at ${_tsDef()},
    accepted_at TEXT,
    UNIQUE (requester_id, addressee_id)
)`).catch(function(e){ if (e && !String(e.message||e).match(/already exists/i)) console.warn('[Friends] create failed:', e.message||e); });

db.run('CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)').catch(function(){});
db.run('CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)').catch(function(){});

const MAX_FRIENDS = 200;
const MAX_PENDING_OUT = 30;

async function getRelation(a, b) {
    return db.get(
        `SELECT id, requester_id, addressee_id, status FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
         LIMIT 1`,
        [a, b, b, a]
    );
}

// ─── POST /api/friends/request ───────────────────────────────
router.post('/request', authenticate, async (req, res) => {
    try {
        const { username } = req.body || {};
        if (!username || typeof username !== 'string') return res.status(400).json({ error: 'username required' });

        const target = await db.get('SELECT id, username, is_banned FROM users WHERE username = ?', [username.trim()]);
        if (!target || target.is_banned) return res.status(404).json({ error: 'User not found' });
        if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

        const existing = await getRelation(req.user.id, target.id);
        if (existing) {
            if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
            if (existing.status === 'pending') return res.status(409).json({ error: 'Request already pending' });
            if (existing.status === 'blocked') return res.status(403).json({ error: 'Cannot send request' });
        }

        // Cap outgoing pending requests to prevent spam
        const pendingOut = await db.get(
            "SELECT COUNT(*) as c FROM friendships WHERE requester_id = ? AND status = 'pending'",
            [req.user.id]
        );
        if ((pendingOut && Number(pendingOut.c)) >= MAX_PENDING_OUT) {
            return res.status(429).json({ error: 'Too many pending friend requests. Wait for some to resolve.' });
        }

        const accepted = await db.get(
            "SELECT COUNT(*) as c FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'",
            [req.user.id, req.user.id]
        );
        if ((accepted && Number(accepted.c)) >= MAX_FRIENDS) {
            return res.status(429).json({ error: 'Friends list full (' + MAX_FRIENDS + ')' });
        }

        await db.run(
            "INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')",
            [req.user.id, target.id]
        );

        res.json({ ok: true });
    } catch (err) {
        logger.error('Friend request failed', { error: err.message });
        res.status(500).json({ error: 'Friend request failed' });
    }
});

// ─── POST /api/friends/accept ────────────────────────────────
router.post('/accept', authenticate, async (req, res) => {
    try {
        const { requestId } = req.body || {};
        const id = parseInt(requestId, 10);
        if (!id) return res.status(400).json({ error: 'requestId required' });

        const row = await db.get('SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: 'Request not found' });
        if (row.addressee_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
        if (row.status !== 'pending') return res.status(400).json({ error: 'Request not pending' });

        const now = new Date().toISOString();
        await db.run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE id = ?", [now, id]);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Friend accept failed', { error: err.message });
        res.status(500).json({ error: 'Accept failed' });
    }
});

// ─── POST /api/friends/decline ───────────────────────────────
router.post('/decline', authenticate, async (req, res) => {
    try {
        const { requestId } = req.body || {};
        const id = parseInt(requestId, 10);
        if (!id) return res.status(400).json({ error: 'requestId required' });

        const row = await db.get('SELECT id, addressee_id, status FROM friendships WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: 'Request not found' });
        if (row.addressee_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
        if (row.status !== 'pending') return res.status(400).json({ error: 'Not pending' });

        await db.run('DELETE FROM friendships WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Friend decline failed', { error: err.message });
        res.status(500).json({ error: 'Decline failed' });
    }
});

// ─── POST /api/friends/cancel ────────────────────────────────
router.post('/cancel', authenticate, async (req, res) => {
    try {
        const { requestId } = req.body || {};
        const id = parseInt(requestId, 10);
        if (!id) return res.status(400).json({ error: 'requestId required' });

        const row = await db.get('SELECT id, requester_id, status FROM friendships WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: 'Request not found' });
        if (row.requester_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
        if (row.status !== 'pending') return res.status(400).json({ error: 'Not pending' });

        await db.run('DELETE FROM friendships WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Friend cancel failed', { error: err.message });
        res.status(500).json({ error: 'Cancel failed' });
    }
});

// ─── DELETE /api/friends/:userId ─────────────────────────────
router.delete('/:userId', authenticate, async (req, res) => {
    try {
        const otherId = parseInt(req.params.userId, 10);
        if (!otherId) return res.status(400).json({ error: 'Invalid user id' });
        const row = await getRelation(req.user.id, otherId);
        if (!row || row.status !== 'accepted') return res.status(404).json({ error: 'Not friends' });
        await db.run('DELETE FROM friendships WHERE id = ?', [row.id]);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Unfriend failed', { error: err.message });
        res.status(500).json({ error: 'Unfriend failed' });
    }
});

// ─── GET /api/friends ────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT f.id, f.requester_id, f.addressee_id, f.accepted_at,
                    u.id as friend_id, u.username, u.display_name, u.profile_avatar_id, u.subscription_active
             FROM friendships f
             JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
             WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
             ORDER BY u.username`,
            [req.user.id, req.user.id, req.user.id]
        );
        res.json({ friends: rows });
    } catch (err) {
        logger.error('Friends list failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load friends' });
    }
});

// ─── GET /api/friends/requests ───────────────────────────────
router.get('/requests', authenticate, async (req, res) => {
    try {
        const incoming = await db.all(
            `SELECT f.id, f.created_at, u.id as user_id, u.username, u.display_name, u.profile_avatar_id
             FROM friendships f JOIN users u ON u.id = f.requester_id
             WHERE f.addressee_id = ? AND f.status = 'pending'
             ORDER BY f.created_at DESC`,
            [req.user.id]
        );
        const outgoing = await db.all(
            `SELECT f.id, f.created_at, u.id as user_id, u.username, u.display_name, u.profile_avatar_id
             FROM friendships f JOIN users u ON u.id = f.addressee_id
             WHERE f.requester_id = ? AND f.status = 'pending'
             ORDER BY f.created_at DESC`,
            [req.user.id]
        );
        res.json({ incoming, outgoing });
    } catch (err) {
        logger.error('Friend requests failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load requests' });
    }
});

// ─── GET /api/friends/search?q= ─────────────────────────────
router.get('/search', authenticate, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.status(400).json({ error: 'Query must be ≥ 2 chars' });
        if (q.length > 30) return res.status(400).json({ error: 'Query too long' });
        const like = q.replace(/[%_\\]/g, '\\$&') + '%';
        const rows = await db.all(
            `SELECT id, username, display_name, profile_avatar_id, subscription_active
             FROM users
             WHERE username LIKE ? AND is_banned = 0 AND id != ?
             ORDER BY username
             LIMIT 20`,
            [like, req.user.id]
        );
        res.json({ results: rows });
    } catch (err) {
        logger.error('Friend search failed', { error: err.message });
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
