const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Initialize activity_log table if it doesn't exist
 */
async function initActivityLogTable() {
  const schema = `
    CREATE TABLE IF NOT EXISTS activity_log (
      id ${idDef},
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at ${tsDef}
    )
  `;

  try {
    await db.run(schema);
  } catch (err) {
    console.warn('Failed to initialize activity_log table:', err.message);
  }
}

/**
 * Log user activity (non-blocking, fire-and-forget)
 * @param {number} userId - User ID
 * @param {string} action - Action type (login, register, deposit, etc.)
 * @param {string} details - Optional JSON details about the action
 * @param {object} req - Express request object (for IP and user agent)
 */
function logActivity(userId, action, details, req) {
  // Extract IP address
  const ipAddress = req.ip ||
                   req.connection.remoteAddress ||
                   req.socket.remoteAddress ||
                   req.connection.socket?.remoteAddress ||
                   'unknown';

  // Extract user agent
  const userAgent = req.get('user-agent') || 'unknown';

  // Serialize details if it's an object
  const serializedDetails = details ?
    (typeof details === 'string' ? details : JSON.stringify(details)) :
    null;

  // Non-blocking insert
  setImmediate(() => {
    try {
      const stmt = db.prepare(`
        INSERT INTO activity_log (user_id, action, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(userId, action, serializedDetails, ipAddress, userAgent);
    } catch (err) {
      console.warn('Failed to log activity:', err.message);
    }
  });
}

/**
 * GET /api/activity-log
 * Authenticated - returns user's own recent activity (last 50)
 */
router.get('/', authenticate, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, user_id, action, details, ip_address, user_agent, created_at
      FROM activity_log
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const logs = stmt.all(req.user.id);

    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err) {
    console.warn('Error fetching activity log:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity log'
    });
  }
});

/**
 * GET /api/activity-log/admin
 * Admin only - returns all recent activity with optional filters
 * Query params: ?userId=X&action=login&limit=100
 */
router.get('/admin', authenticate, requireAdmin, (req, res) => {
  try {
    const { userId, action, limit = 100 } = req.query;

    // Validate limit
    const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000));

    let query = 'SELECT id, user_id, action, details, ip_address, user_agent, created_at FROM activity_log WHERE 1=1';
    const params = [];

    // Optional filters
    if (userId) {
      query += ' AND user_id = ?';
      params.push(parseInt(userId, 10));
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parsedLimit);

    const stmt = db.prepare(query);
    const logs = stmt.all(...params);

    res.json({
      success: true,
      count: logs.length,
      limit: parsedLimit,
      filters: {
        userId: userId || null,
        action: action || null
      },
      data: logs
    });
  } catch (err) {
    console.warn('Error fetching admin activity log:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity log'
    });
  }
});

// Table initialization deferred to server startup (see server/index.js)

module.exports = router;
module.exports.logActivity = logActivity;
module.exports.bootstrapActivityLogTable = initActivityLogTable;
