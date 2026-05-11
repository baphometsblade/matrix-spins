'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');
let _notify;
try { _notify = require('../services/notification.service'); } catch (_) { _notify = null; }

// Bootstrap: create notifications table.
// We export a Promise so the route handlers can await it on first request —
// the original fire-and-forget design produced an unrecoverable 500 if the
// CREATE TABLE was still in-flight (or had failed) by the time the first
// authenticated GET hit /api/notifications.
const _isPg  = db.isPg();
const _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const _tsType    = _isPg ? 'TIMESTAMPTZ' : 'TEXT';
const _tsDefault = _isPg ? 'NOW()' : "(datetime('now'))";
const _tablePromise = db.run(`CREATE TABLE IF NOT EXISTS notifications (
  id ${_idDef},
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_action TEXT,
  "read" INTEGER DEFAULT 0,
  created_at ${_tsType} DEFAULT ${_tsDefault}
)`).catch(function(e) {
  if (e && !String(e.message || e).match(/already exists/i)) {
    console.warn('[Notifications] Table create failed:', e.message || e);
  }
  return null;
});

// GET /api/notifications — last 20, auth required
router.get('/', authenticate, async function(req, res) {
  try {
    await _tablePromise; // ensure table exists before first SELECT
    var userId = req.user.id;
    var rows = await db.all(
      'SELECT id, type, title, body, link_action, "read", created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    if (!Array.isArray(rows)) rows = [];
    var unreadCount = 0;
    rows.forEach(function(r) { if (!r.read) unreadCount++; });
    return res.json({ notifications: rows, unreadCount: unreadCount });
  } catch(err) {
    // Log the actual SQL error so we can diagnose; the previous handler
    // swallowed err.message into a generic "Internal server error" which
    // turned every notification-bell load into a black-box 500.
    console.warn('[Notifications] GET / failed:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal server error', code: 'notifications_query_failed' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, async function(req, res) {
  try {
    await _tablePromise;
    await db.run('UPDATE notifications SET "read" = 1 WHERE user_id = ?', [req.user.id]);
    return res.json({ success: true });
  } catch(err) {
    console.warn('[Notifications] read-all failed:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/read/:id
router.post('/read/:id', authenticate, async function(req, res) {
  try {
    await _tablePromise;
    var notifId = parseInt(req.params.id, 10);
    if (!Number.isFinite(notifId)) return res.status(400).json({ error: 'Invalid notification ID' });
    await db.run(
      'UPDATE notifications SET "read" = 1 WHERE id = ? AND user_id = ?',
      [notifId, req.user.id]
    );
    return res.json({ success: true });
  } catch(err) {
    console.warn('[Notifications] read/:id failed:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/system — internal only (no auth, must check IP or skip in dev)
router.post('/system', async function(req, res) {
  try {
    var ip = req.ip || req.connection.remoteAddress || '';
    var isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    // ROUND 61: Always restrict to localhost — old check only blocked in production,
    // allowing remote notification injection in dev/staging environments
    if (!isLocal) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    var body = req.body || {};
    var userId = body.userId;
    var type = body.type || 'info';
    var title = body.title || 'Notification';
    var notifBody = body.body || '';
    var linkAction = body.linkAction || null;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    // Prefer the notification service so connected sockets get a realtime push.
    if (_notify) {
      await _notify.notify({ userId: userId, type: type, title: title, body: notifBody, linkAction: linkAction });
    } else {
      await db.run(
        'INSERT INTO notifications (user_id, type, title, body, link_action) VALUES (?, ?, ?, ?, ?)',
        [userId, type, title, notifBody, linkAction]
      );
    }
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
