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
// Step 1: create table if absent.
// Step 2: defensively ADD COLUMN for every field we expect — older
// production schemas were created without `body`, `link_action`, and
// `"read"` columns (live Postgres returned `column "body" does not exist`
// against the full SELECT). With CREATE TABLE IF NOT EXISTS those
// columns would never be backfilled; we have to ALTER TABLE explicitly.
//
// Both Postgres and modern SQLite accept the column adds idempotently:
//   - Postgres ≥9.6: `ADD COLUMN IF NOT EXISTS`
//   - SQLite ≥3.35:  `ADD COLUMN IF NOT EXISTS` (3.35+) or errors on
//     duplicate with "duplicate column name" which we catch and swallow.
function _safeAlter(sql) {
  return db.run(sql).catch(function(e) {
    var msg = String(e && e.message || e);
    if (/already exists|duplicate column/i.test(msg)) return; // benign
    console.warn('[Notifications] ALTER failed (' + sql.slice(0, 60) + '...):', msg);
  });
}
const _tablePromise = db.run(`CREATE TABLE IF NOT EXISTS notifications (
  id ${_idDef},
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_action TEXT,
  "read" INTEGER DEFAULT 0,
  created_at ${_tsType} DEFAULT ${_tsDefault}
)`).catch(function(e) {
  if (e && !String(e.message || e).match(/already exists/i)) {
    console.warn('[Notifications] Table create failed:', e.message || e);
  }
  return null;
}).then(async function() {
  // Backfill any columns missing from older schemas.
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'info'`);
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT ''`);
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_action TEXT`);
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "read" INTEGER DEFAULT 0`);
  await _safeAlter(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at ${_tsType} DEFAULT ${_tsDefault}`);
});

// GET /api/notifications — last 20, auth required.
// Resilient strategy: try a minimal SELECT first (omits the `"read"` column
// in case it was created as an identifier that doesn't match the SQL
// standard's read-keyword handling on the live Postgres instance). If
// that works, the route still returns an unreadCount of 0 — clients
// mark-read in-memory until /read/:id POST persists. Better than the
// black-box 500 the previous handler returned to every authed page load.
router.get('/', authenticate, async function(req, res) {
  try {
    await _tablePromise; // ensure table exists + columns backfilled before first SELECT
    var userId = req.user.id;
    var rows;
    try {
      rows = await db.all(
        'SELECT id, type, title, body, link_action, "read", created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        [userId]
      );
    } catch (innerErr) {
      // Fall back to a query that doesn't reference the "read" column. If
      // this also fails, we let the outer catch surface the error.
      console.warn('[Notifications] full SELECT failed, retrying without "read":', innerErr && innerErr.message ? innerErr.message : innerErr);
      rows = await db.all(
        'SELECT id, type, title, body, link_action, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        [userId]
      );
      // Synthesize the read flag: assume all rows are unread so the bell badge
      // still works. Clients call POST /read/:id to mark individually after view.
      if (Array.isArray(rows)) rows.forEach(function(r) { r.read = 0; });
    }
    if (!Array.isArray(rows)) rows = [];
    var unreadCount = 0;
    rows.forEach(function(r) { if (!r.read) unreadCount++; });
    return res.json({ notifications: rows, unreadCount: unreadCount });
  } catch(err) {
    var msg = err && err.message ? err.message : String(err || 'unknown');
    console.warn('[Notifications] GET / failed:', msg);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'notifications_query_failed',
      detail: msg.slice(0, 200),
    });
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
