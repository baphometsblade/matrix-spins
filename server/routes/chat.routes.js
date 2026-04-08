const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Profanity filter - basic server-side list
const PROFANITY_FILTER = [
  'badword1', 'badword2', 'badword3', 'badword4', 'badword5',
  'offensive', 'inappropriate', 'vulgar', 'crude', 'nasty',
  'spam', 'scam', 'hack', 'cheat', 'bot'
];

/**
 * Strip all HTML tags and dangerous characters (defense-in-depth XSS prevention).
 * Client already escapes output, but belt-and-suspenders is industry standard.
 */
function stripHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_MESSAGE_LENGTH = 200;
const RATE_LIMIT_WINDOW_MS = 5000; // 5 seconds
const MESSAGES_LIMIT = 50;

// Track user message timestamps for rate limiting
const userRateLimits = new Map();
// Periodic cleanup — prevents memory leak from stale entries (runs every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [id, time] of userRateLimits.entries()) {
        if (now - time > 10000) userRateLimits.delete(id);
    }
}, 5 * 60 * 1000);

/**
 * Bootstrap the chat_messages table (idempotent — safe to call multiple times)
 */
var _chatTableReady = false;
async function bootstrapChatTable() {
  if (_chatTableReady) return;
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id ${idDef},
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at ${tsDef}
      )`
    );
    _chatTableReady = true;
    console.warn('[Chat] chat_messages table ready');
  } catch (err) {
    console.warn('[Chat] Failed to create table:', err.message);
  }
}

/**
 * Filter profanity from text
 */
function filterProfanity(text) {
  let filtered = text;
  PROFANITY_FILTER.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  });
  return filtered;
}

/**
 * Check and enforce rate limiting
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const lastMessageTime = userRateLimits.get(userId) || 0;
  const timeSinceLast = now - lastMessageTime;

  if (timeSinceLast < RATE_LIMIT_WINDOW_MS) {
    const waitMs = RATE_LIMIT_WINDOW_MS - timeSinceLast;
    return {
      allowed: false,
      message: `Rate limited. Please wait ${Math.ceil(waitMs / 1000)} second(s).`,
      nextAvailableAt: now + waitMs
    };
  }

  return { allowed: true };
}

/**
 * Update rate limit for user
 */
function updateRateLimit(userId) {
  userRateLimits.set(userId, Date.now());

  // Cleanup old entries periodically
  if (userRateLimits.size > 1000) {
    const cutoffTime = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
    for (const [id, time] of userRateLimits.entries()) {
      if (time < cutoffTime) {
        userRateLimits.delete(id);
      }
    }
  }
}

/**
 * GET /api/chat/messages
 * Fetch chat messages — public read, authenticated for full features
 * Query params:
 *   - since: (optional) only fetch messages with id > since
 */
router.get('/messages', async (req, res) => {
  try {
    // Ensure table exists before querying (handles cold-start race)
    await bootstrapChatTable();

    const sinceId = req.query.since ? parseInt(req.query.since, 10) : 0;

    let query = 'SELECT id, user_id, username, message, created_at FROM chat_messages';
    const params = [];

    if (sinceId > 0) {
      query += ' WHERE id > ?';
      params.push(sinceId);
    }

    query += ' ORDER BY id ASC LIMIT ?';
    params.push(MESSAGES_LIMIT);

    const rows = await db.all(query, params);

    res.json({
      messages: rows || []
    });
  } catch (err) {
    console.warn('[Chat] Failed to fetch messages:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/chat/send
 * Send a chat message (authenticated via JWT)
 * Body: { message: string }
 */
router.post('/send', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username || `Player${userId}`;
    const message = req.body.message;

    // ── REGULATORY: Self-exclusion blocks all platform activity incl. chat ──
    // ROUND 30: Fail CLOSED on DB error (was silently continuing)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Your account is self-excluded from all platform activities' });
      }
    } catch (exclErr) {
      if (exclErr.message && exclErr.message.includes('no such table')) {
        // Table doesn't exist yet — OK to proceed
      } else {
        console.error('[Chat] Self-exclusion check failed:', exclErr.message);
        return res.status(500).json({ error: 'Security check failed. Please try again.' });
      }
    }

    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`
      });
    }

    // Check rate limit
    const rateLimitCheck = checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: rateLimitCheck.message,
        retryAfterMs: rateLimitCheck.nextAvailableAt - Date.now()
      });
    }

    // Filter profanity
    const filteredMessage = filterProfanity(trimmedMessage);

    // Server-side HTML sanitization (defense-in-depth — client also escapes)
    const sanitizedMessage = stripHtml(filteredMessage);

    // Validate username contains only safe characters
    const safeUsername = /^[a-zA-Z0-9_\-\.]{1,50}$/.test(username) ? username : ('Player' + userId);

    // Insert message
    await db.run(
      'INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)',
      [userId, safeUsername, sanitizedMessage]
    );

    // Update rate limit
    updateRateLimit(userId);

    // Fetch the created message
    const row = await db.get(
      'SELECT id, user_id, username, message, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    );

    res.status(201).json({
      message: row
    });
  } catch (err) {
    console.warn('[Chat] Failed to send message:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Initialize table on load
bootstrapChatTable().catch(function(e) { console.warn('[Chat] Bootstrap failed:', e.message); });

module.exports = router;
