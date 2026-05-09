/**
 * Matrix Spins Casino — Support Chat Service
 *
 * Manages support conversations between players and support agents (admins).
 * Backed by SQLite/PostgreSQL via the shared db abstraction.
 *
 * Tables:
 *   support_conversations(id, user_id, status, last_message_at, created_at)
 *   support_messages(id, conversation_id, sender_type, sender_id, body, read_by_user, read_by_agent, created_at)
 */
'use strict';

const db = require('../database');

let _tableReady = false;

const STATUSES = ['open', 'pending', 'resolved', 'closed'];

async function ensureTables() {
  if (_tableReady) return;
  try {
    const isPg = typeof db.isPg === 'function' && db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";

    await db.run(`CREATE TABLE IF NOT EXISTS support_conversations (
      id ${idDef},
      user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'open',
      subject TEXT,
      last_message_at ${tsType} DEFAULT ${tsDefault},
      created_at ${tsType} DEFAULT ${tsDefault}
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations(user_id, status)').catch(() => {});
    await db.run('CREATE INDEX IF NOT EXISTS idx_support_conv_status ON support_conversations(status, last_message_at)').catch(() => {});

    await db.run(`CREATE TABLE IF NOT EXISTS support_messages (
      id ${idDef},
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id INTEGER,
      sender_name TEXT,
      body TEXT NOT NULL,
      read_by_user INTEGER DEFAULT 0,
      read_by_agent INTEGER DEFAULT 0,
      created_at ${tsType} DEFAULT ${tsDefault}
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id, id)').catch(() => {});

    _tableReady = true;
  } catch (err) {
    console.warn('[SupportChat] table create failed:', err.message);
  }
}

/**
 * Get the current open conversation for a user, or create one if none exists.
 */
async function getOrCreateConversation(userId) {
  await ensureTables();
  let conv = await db.get(
    "SELECT id, user_id, status, subject, last_message_at, created_at FROM support_conversations WHERE user_id = ? AND status IN ('open', 'pending') ORDER BY id DESC LIMIT 1",
    [userId]
  );
  if (!conv) {
    await db.run(
      'INSERT INTO support_conversations (user_id, status, subject) VALUES (?, ?, ?)',
      [userId, 'open', 'Support request']
    );
    conv = await db.get(
      'SELECT id, user_id, status, subject, last_message_at, created_at FROM support_conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    );

    // Auto-greeting from "system"
    await postMessage({
      conversationId: conv.id,
      senderType: 'system',
      senderId: null,
      senderName: 'Matrix Spins Support',
      body: "Hi! 👋 You're connected to Matrix Spins Support. Tell us what you need help with and an agent will join shortly. Most messages are answered within a few minutes.",
      autoRead: true,
    });
  }
  return conv;
}

/**
 * Append a message to a conversation. Updates last_message_at.
 * @param {Object} opts
 * @param {number} opts.conversationId
 * @param {string} opts.senderType - 'user' | 'agent' | 'system'
 * @param {number} [opts.senderId]
 * @param {string} [opts.senderName]
 * @param {string} opts.body
 * @param {boolean} [opts.autoRead] - if true, marks as read by both sides (system msgs)
 * @returns {Promise<Object>} inserted message row
 */
async function postMessage(opts) {
  await ensureTables();
  const senderType = opts.senderType;
  const conversationId = opts.conversationId;
  const senderId = opts.senderId || null;
  const senderName = opts.senderName || (senderType === 'agent' ? 'Support' : senderType === 'system' ? 'System' : 'You');
  const body = String(opts.body || '').trim().slice(0, 2000);
  if (!body) throw new Error('Empty message');
  if (!['user', 'agent', 'system'].includes(senderType)) throw new Error('Invalid sender type');
  if (!conversationId) throw new Error('Missing conversation id');

  const readByUser = opts.autoRead || senderType === 'user' ? 1 : 0;
  const readByAgent = opts.autoRead || senderType === 'agent' ? 1 : 0;

  await db.run(
    'INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, body, read_by_user, read_by_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [conversationId, senderType, senderId, senderName, body, readByUser, readByAgent]
  );

  const row = await db.get(
    'SELECT id, conversation_id, sender_type, sender_id, sender_name, body, read_by_user, read_by_agent, created_at FROM support_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
    [conversationId]
  );

  // Update conversation timestamp + bump status to 'pending' if user replied
  const newStatus = senderType === 'user' ? 'pending' : senderType === 'agent' ? 'open' : null;
  if (newStatus) {
    if (db.isPg && db.isPg()) {
      await db.run('UPDATE support_conversations SET last_message_at = NOW(), status = ? WHERE id = ?', [newStatus, conversationId]);
    } else {
      await db.run("UPDATE support_conversations SET last_message_at = datetime('now'), status = ? WHERE id = ?", [newStatus, conversationId]);
    }
  } else {
    if (db.isPg && db.isPg()) {
      await db.run('UPDATE support_conversations SET last_message_at = NOW() WHERE id = ?', [conversationId]);
    } else {
      await db.run("UPDATE support_conversations SET last_message_at = datetime('now') WHERE id = ?", [conversationId]);
    }
  }

  return row;
}

async function getMessages(conversationId, limit = 100) {
  await ensureTables();
  return db.all(
    'SELECT id, conversation_id, sender_type, sender_id, sender_name, body, read_by_user, read_by_agent, created_at FROM support_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?',
    [conversationId, limit]
  );
}

async function getConversation(id) {
  await ensureTables();
  return db.get(
    'SELECT id, user_id, status, subject, last_message_at, created_at FROM support_conversations WHERE id = ?',
    [id]
  );
}

async function listConversations(filter = {}) {
  await ensureTables();
  const status = filter.status;
  const limit = Math.min(parseInt(filter.limit, 10) || 50, 200);
  let sql = `
    SELECT c.id, c.user_id, c.status, c.subject, c.last_message_at, c.created_at,
           u.username, u.email,
           (SELECT body FROM support_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*) FROM support_messages WHERE conversation_id = c.id AND read_by_agent = 0 AND sender_type = 'user') AS unread
    FROM support_conversations c
    LEFT JOIN users u ON u.id = c.user_id
  `;
  const params = [];
  if (status && STATUSES.includes(status)) {
    sql += ' WHERE c.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY c.last_message_at DESC LIMIT ?';
  params.push(limit);
  return db.all(sql, params);
}

async function markReadByUser(conversationId, userId) {
  await ensureTables();
  await db.run(
    "UPDATE support_messages SET read_by_user = 1 WHERE conversation_id = ? AND sender_type IN ('agent', 'system')",
    [conversationId]
  );
}

async function markReadByAgent(conversationId) {
  await ensureTables();
  await db.run(
    "UPDATE support_messages SET read_by_agent = 1 WHERE conversation_id = ? AND sender_type = 'user'",
    [conversationId]
  );
}

async function setStatus(conversationId, status) {
  await ensureTables();
  if (!STATUSES.includes(status)) throw new Error('Invalid status');
  await db.run('UPDATE support_conversations SET status = ? WHERE id = ?', [status, conversationId]);
}

async function unreadCountForUser(userId) {
  await ensureTables();
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM support_messages m
     JOIN support_conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ? AND m.sender_type IN ('agent','system') AND m.read_by_user = 0`,
    [userId]
  );
  return (row && row.c) || 0;
}

async function totalUnreadForAgents() {
  await ensureTables();
  const row = await db.get(
    "SELECT COUNT(*) AS c FROM support_messages WHERE sender_type = 'user' AND read_by_agent = 0"
  );
  return (row && row.c) || 0;
}

module.exports = {
  ensureTables,
  getOrCreateConversation,
  getConversation,
  listConversations,
  postMessage,
  getMessages,
  markReadByUser,
  markReadByAgent,
  setStatus,
  unreadCountForUser,
  totalUnreadForAgents,
  STATUSES,
};
