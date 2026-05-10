/**
 * Matrix Spins Casino — Notification Service
 *
 * Server-side notification creation + real-time delivery.
 * Notifications are stored in the `notifications` table and pushed
 * to connected sockets via the Socket.IO realtime layer (when wired).
 */
'use strict';

const db = require('../database');

let _io = null;
let _tableReady = false;

const TYPES = {
  bonus: { icon: '🎁' },
  deposit: { icon: '💰' },
  withdrawal: { icon: '💸' },
  level_up: { icon: '⬆️' },
  daily_reward: { icon: '🎯' },
  system: { icon: '🔔' },
  win: { icon: '🏆' },
  promo: { icon: '✨' },
  vip: { icon: '⭐' },
  support: { icon: '💬' },
  info: { icon: '🔔' },
};

function setIO(io) {
  _io = io;
}

function getIO() {
  return _io;
}

async function ensureTable() {
  if (_tableReady) return;
  try {
    const isPg = typeof db.isPg === 'function' && db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
    await db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id ${idDef},
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_action TEXT,
      "read" INTEGER DEFAULT 0,
      created_at ${tsType} DEFAULT ${tsDefault}
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, "read")').catch(() => {});
    _tableReady = true;
  } catch (err) {
    console.warn('[NotificationService] Table create failed:', err.message);
  }
}

/**
 * Create a notification, persist, and push to user's socket(s) if connected.
 * @param {Object} opts
 * @param {number} opts.userId - target user
 * @param {string} opts.type   - one of TYPES (bonus, deposit, withdrawal, etc.)
 * @param {string} opts.title  - short title
 * @param {string} opts.body   - body text
 * @param {string} [opts.linkAction] - URL or action key (e.g. "wallet.html")
 * @param {boolean} [opts.toast=true] - emit a toast event in addition to the bell
 * @returns {Promise<Object>} the inserted notification row
 */
async function notify(opts) {
  await ensureTable();
  const userId = opts.userId;
  const type = opts.type || 'info';
  const title = String(opts.title || 'Notification').slice(0, 200);
  const body = String(opts.body || '').slice(0, 1000);
  const linkAction = opts.linkAction || null;
  const toast = opts.toast !== false;

  if (!userId) {
    console.warn('[NotificationService] notify() called without userId');
    return null;
  }

  let row = null;
  try {
    await db.run(
      'INSERT INTO notifications (user_id, type, title, body, link_action) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, body, linkAction]
    );
    row = await db.get(
      'SELECT id, type, title, body, link_action, "read", created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    );
  } catch (err) {
    console.warn('[NotificationService] insert failed:', err.message);
    return null;
  }

  // Realtime push
  if (_io && row) {
    try {
      const payload = {
        ...row,
        icon: (TYPES[type] && TYPES[type].icon) || '🔔',
        toast,
      };
      _io.to('user:' + userId).emit('notification:new', payload);
    } catch (err) {
      console.warn('[NotificationService] socket emit failed:', err.message);
    }
  }

  return row;
}

/**
 * Convenience builders for common notification types.
 * Each writes a notification with a sensible default title/body and pushes via socket.
 */
async function bonusAwarded(userId, amount, source) {
  return notify({
    userId,
    type: 'bonus',
    title: 'Bonus Awarded',
    body: `$${Number(amount).toFixed(2)} bonus credited from ${source || 'promotion'}. Wagering requirement applies.`,
    linkAction: 'wallet.html',
  });
}

async function depositConfirmed(userId, amount, method) {
  return notify({
    userId,
    type: 'deposit',
    title: 'Deposit Confirmed',
    body: `Your $${Number(amount).toFixed(2)} deposit via ${method || 'card'} has been credited to your balance.`,
    linkAction: 'wallet.html',
  });
}

async function withdrawalProcessed(userId, amount, status) {
  const body = status === 'approved'
    ? `Your $${Number(amount).toFixed(2)} withdrawal has been approved and is on its way.`
    : status === 'rejected'
      ? `Your $${Number(amount).toFixed(2)} withdrawal could not be processed. Funds returned to your balance.`
      : `Your $${Number(amount).toFixed(2)} withdrawal is being reviewed.`;
  return notify({
    userId,
    type: 'withdrawal',
    title: 'Withdrawal Update',
    body,
    linkAction: 'wallet.html',
  });
}

async function levelUp(userId, newLevel) {
  return notify({
    userId,
    type: 'level_up',
    title: 'Level Up!',
    body: `You’ve reached Level ${newLevel}. New rewards are unlocked in your VIP track.`,
    linkAction: 'vip.html',
  });
}

async function dailyRewardAvailable(userId) {
  return notify({
    userId,
    type: 'daily_reward',
    title: 'Daily Reward Ready',
    body: 'Your daily login reward is available — claim it before midnight.',
    linkAction: 'index.html#daily',
  });
}

async function systemAnnouncement(userId, title, body, link) {
  return notify({
    userId,
    type: 'system',
    title,
    body,
    linkAction: link || null,
  });
}

/**
 * Broadcast a system announcement to all users (small wrapper around the bulk insert).
 * Use sparingly — heavy on the DB for large user bases. Prefer scheduled jobs.
 */
async function broadcastSystem(title, body, link) {
  await ensureTable();
  try {
    const users = await db.all('SELECT id FROM users WHERE is_banned = 0 OR is_banned IS NULL');
    for (const u of users) {
      await notify({ userId: u.id, type: 'system', title, body, linkAction: link || null, toast: false });
    }
    if (_io) _io.emit('notification:broadcast', { title, body, linkAction: link || null });
    return users.length;
  } catch (err) {
    console.warn('[NotificationService] broadcast failed:', err.message);
    return 0;
  }
}

module.exports = {
  setIO,
  getIO,
  ensureTable,
  notify,
  bonusAwarded,
  depositConfirmed,
  withdrawalProcessed,
  levelUp,
  dailyRewardAvailable,
  systemAnnouncement,
  broadcastSystem,
  TYPES,
};
