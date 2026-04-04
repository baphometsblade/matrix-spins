'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap: create notifications table
{
  var _isPg  = !!process.env.DATABASE_URL;
  var _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  var _tsType    = _isPg ? 'TIMESTAMPTZ' : 'TEXT';
  var _tsDefault = _isPg ? 'NOW()' : "(datetime('now'))";
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
  id ${_idDef},
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_action TEXT,
  read INTEGER DEFAULT 0,
  created_at ${_tsType} DEFAULT ${_tsDefault}
)`).catch(function(e) { if (e && !String(e.message || e).match(/already exists/i)) console.warn('[Notifications] Table create failed:', e.message || e); });
}

// GET /api/notifications — last 20, auth required
router.get('/', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var rows = await db.all(
      'SELECT id, type, title, body, link_action, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    var unreadCount = 0;
    rows.forEach(function(r) { if (!r.read) unreadCount++; });
    return res.json({ notifications: rows, unreadCount: unreadCount });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, async function(req, res) {
  try {
    await db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/read/:id
router.post('/read/:id', authenticate, async function(req, res) {
  try {
    var notifId = parseInt(req.params.id, 10);
    if (!Number.isFinite(notifId)) return res.status(400).json({ error: 'Invalid notification ID' });
    await db.run(
      'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
      [notifId, req.user.id]
    );
    return res.json({ success: true });
  } catch(err) {
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
    await db.run(
      'INSERT INTO notifications (user_id, type, title, body, link_action) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, notifBody, linkAction]
    );
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
