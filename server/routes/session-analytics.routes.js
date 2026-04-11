var router = require('express').Router();
var authenticate = require('../middleware/auth').authenticate;
var db = require('../database');

var _initDone = false;
var _initPromise = null;

async function _ensureTable() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async function() {
    try {
      var isPg = db.isPg();
      var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

      // Create session_events table
      var createEventsSql = isPg
        ? `CREATE TABLE IF NOT EXISTS session_events (
             id ${idDef},
             user_id INTEGER NOT NULL,
             event_type TEXT NOT NULL,
             event_data TEXT,
             session_id TEXT NOT NULL,
             created_at ${tsDef}
           )`
        : `CREATE TABLE IF NOT EXISTS session_events (
             id ${idDef},
             user_id INTEGER NOT NULL,
             event_type TEXT NOT NULL,
             event_data TEXT,
             session_id TEXT NOT NULL,
             created_at ${tsDef}
           )`;

      await db.run(createEventsSql, []);

      // Create session_summaries table
      var createSummariesSql = isPg
        ? `CREATE TABLE IF NOT EXISTS session_summaries (
             id ${idDef},
             user_id INTEGER NOT NULL,
             session_id TEXT NOT NULL UNIQUE,
             started_at ${tsDef},
             ended_at TIMESTAMPTZ,
             total_spins INTEGER DEFAULT 0,
             total_wagered INTEGER DEFAULT 0,
             total_won INTEGER DEFAULT 0,
             net_result INTEGER DEFAULT 0,
             peak_balance INTEGER DEFAULT 0,
             lowest_balance INTEGER DEFAULT 0,
             games_played TEXT,
             deposit_count INTEGER DEFAULT 0,
             deposit_total INTEGER DEFAULT 0
           )`
        : `CREATE TABLE IF NOT EXISTS session_summaries (
             id ${idDef},
             user_id INTEGER NOT NULL,
             session_id TEXT NOT NULL UNIQUE,
             started_at ${tsDef},
             ended_at TEXT,
             total_spins INTEGER DEFAULT 0,
             total_wagered INTEGER DEFAULT 0,
             total_won INTEGER DEFAULT 0,
             net_result INTEGER DEFAULT 0,
             peak_balance INTEGER DEFAULT 0,
             lowest_balance INTEGER DEFAULT 0,
             games_played TEXT,
             deposit_count INTEGER DEFAULT 0,
             deposit_total INTEGER DEFAULT 0
           )`;

      await db.run(createSummariesSql, []);
      _initDone = true;
    } catch (err) {
      console.warn('[session-analytics] Table init error:', err.message);
      _initDone = true;
    }
  })();
  return _initPromise;
}

// POST /api/session-analytics/event
// Record a session event
router.post('/event', authenticate, async function(req, res) {
  try {
    await _ensureTable();

    var userId = req.user.id;
    var eventType = req.body.event_type;
    var eventData = req.body.event_data;
    var sessionId = req.body.session_id ? String(req.body.session_id).slice(0, 100) : null;

    if (!eventType || !sessionId) {
      return res.status(400).json({ error: 'Missing event_type or session_id' });
    }

    var validTypes = ['spin', 'deposit', 'withdrawal', 'game_change', 'feature_click', 'bonus_claim', 'session_start', 'session_end'];
    if (validTypes.indexOf(eventType) === -1) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }

    var eventDataStr = eventData ? JSON.stringify(eventData).slice(0, 2000) : null;

    var sql = 'INSERT INTO session_events (user_id, event_type, event_data, session_id, created_at) VALUES (?, ?, ?, ?, ?)';
    var result = await db.run(sql, [userId, eventType, eventDataStr, sessionId, new Date().toISOString().slice(0, 19).replace('T', ' ')]);

    res.status(201).json({
      id: result.id || result.lastID,
      message: 'Event recorded',
      event_type: eventType,
      session_id: sessionId
    });
  } catch (err) {
    console.warn('[session-analytics] POST /event error:', err.message);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

// POST /api/session-analytics/summary
// Upsert session summary
router.post('/summary', authenticate, async function(req, res) {
  try {
    await _ensureTable();

    var userId = req.user.id;
    var sessionId = req.body.session_id ? String(req.body.session_id).slice(0, 100) : null;
    var totalSpins = Math.max(0, parseInt(req.body.total_spins, 10) || 0);
    var totalWagered = Math.max(0, parseFloat(req.body.total_wagered) || 0);
    var totalWon = Math.max(0, parseFloat(req.body.total_won) || 0);
    var peakBalance = Math.max(0, parseFloat(req.body.peak_balance) || 0);
    var lowestBalance = Math.max(0, parseFloat(req.body.lowest_balance) || 0);
    var gamesPlayed = req.body.games_played ? JSON.stringify(req.body.games_played).slice(0, 5000) : null;
    var depositCount = Math.max(0, parseInt(req.body.deposit_count, 10) || 0);
    var depositTotal = Math.max(0, parseFloat(req.body.deposit_total) || 0);

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    var netResult = totalWon - totalWagered;

    // Check if summary exists
    var existingSql = 'SELECT id FROM session_summaries WHERE session_id = ?';
    var existing = await db.get(existingSql, [sessionId]);

    if (existing) {
      // Update existing
      var updateSql = `UPDATE session_summaries
        SET total_spins = ?, total_wagered = ?, total_won = ?, net_result = ?,
            peak_balance = ?, lowest_balance = ?, games_played = ?,
            deposit_count = ?, deposit_total = ?, ended_at = ?
        WHERE session_id = ?`;
      await db.run(updateSql, [
        totalSpins, totalWagered, totalWon, netResult,
        peakBalance, lowestBalance, gamesPlayed,
        depositCount, depositTotal, new Date().toISOString(), sessionId
      ]);
    } else {
      // Insert new
      var insertSql = `INSERT INTO session_summaries
        (user_id, session_id, started_at, total_spins, total_wagered, total_won, net_result,
         peak_balance, lowest_balance, games_played, deposit_count, deposit_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await db.run(insertSql, [
        userId, sessionId, new Date().toISOString(), totalSpins, totalWagered, totalWon, netResult,
        peakBalance, lowestBalance, gamesPlayed, depositCount, depositTotal
      ]);
    }

    res.status(200).json({
      message: 'Session summary saved',
      session_id: sessionId,
      net_result: netResult
    });
  } catch (err) {
    console.warn('[session-analytics] POST /summary error:', err.message);
    res.status(500).json({ error: 'Failed to save session summary' });
  }
});

// GET /api/session-analytics/admin/overview
// Admin-only: Aggregate analytics dashboard
router.get('/admin/overview', authenticate, async function(req, res) {
  try {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await _ensureTable();

    // Active sessions in last 15 minutes
    var fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    var activeSessionsSql = `SELECT COUNT(DISTINCT session_id) as count FROM session_events
      WHERE created_at > datetime(?)`;
    var activeSessions = await db.get(activeSessionsSql, [fifteenMinutesAgo]);

    // Average session duration (ended sessions)
    var avgDurationSql = `SELECT AVG(CAST((julianday(ended_at) - julianday(started_at)) * 24 * 60 AS REAL)) as avg_minutes
      FROM session_summaries WHERE ended_at IS NOT NULL`;
    var avgDurationPgSql = `SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) as avg_minutes
      FROM session_summaries WHERE ended_at IS NOT NULL`;
    var avgDuration = await db.get(db.isPg() ? avgDurationPgSql : avgDurationSql, []);

    // Revenue per session (deposits - withdrawals)
    var revenueSql = `SELECT
      COUNT(DISTINCT s.session_id) as session_count,
      SUM(s.deposit_total) as total_deposits,
      COALESCE(SUM(e.event_data::json->>'amount'), 0) as total_withdrawals
      FROM session_summaries s
      LEFT JOIN session_events e ON s.session_id = e.session_id AND e.event_type = 'withdrawal'`;
    var revenue = await db.get(revenueSql, []);

    // Top events by count
    var topEventsSql = `SELECT event_type, COUNT(*) as count
      FROM session_events GROUP BY event_type ORDER BY count DESC LIMIT 8`;
    var topEvents = await db.all(topEventsSql, []);

    // Player retention (returning within 24h)
    var retentionSql = `SELECT
      COUNT(DISTINCT user_id) as total_players,
      COUNT(DISTINCT CASE
        WHEN EXISTS (
          SELECT 1 FROM session_summaries s2
          WHERE s2.user_id = s1.user_id
          AND s2.started_at > s1.ended_at
          AND s2.started_at <= datetime(s1.ended_at, '+24 hours')
        ) THEN user_id END
      ) as returning_players
      FROM session_summaries s1 WHERE ended_at IS NOT NULL`;
    var retention = await db.get(retentionSql, []);

    res.status(200).json({
      active_sessions: activeSessions ? activeSessions.count : 0,
      average_session_duration_minutes: avgDuration && avgDuration.avg_minutes ? Math.round(avgDuration.avg_minutes) : 0,
      total_sessions: revenue ? revenue.session_count : 0,
      total_deposits: revenue ? revenue.total_deposits || 0 : 0,
      total_withdrawals: revenue ? revenue.total_withdrawals || 0 : 0,
      net_revenue: revenue ? (revenue.total_deposits || 0) - (revenue.total_withdrawals || 0) : 0,
      top_events: topEvents || [],
      total_players: retention ? retention.total_players : 0,
      returning_players: retention ? retention.returning_players : 0,
      retention_rate: retention && retention.total_players ? Math.round((retention.returning_players / retention.total_players) * 100) : 0
    });
  } catch (err) {
    console.warn('[session-analytics] GET /admin/overview error:', err.message);
    res.status(200).json({
      active_sessions: 0,
      average_session_duration_minutes: 0,
      total_sessions: 0,
      total_deposits: 0,
      total_withdrawals: 0,
      net_revenue: 0,
      top_events: [],
      total_players: 0,
      returning_players: 0,
      retention_rate: 0
    });
  }
});

// GET /api/session-analytics/admin/player/:userId
// Admin-only: Specific player's session history
router.get('/admin/player/:userId', authenticate, async function(req, res) {
  try {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await _ensureTable();

    var userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    var sql = `SELECT id, user_id, session_id, started_at, ended_at, total_spins, total_wagered, total_won, net_result, peak_balance, lowest_balance, games_played, deposit_count, deposit_total FROM session_summaries
      WHERE user_id = ? ORDER BY started_at DESC LIMIT 50`;
    var sessions = await db.all(sql, [userId]);

    // Get recent events for this player
    var eventsSql = `SELECT id, user_id, event_type, event_data, session_id, created_at FROM session_events
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`;
    var events = await db.all(eventsSql, [userId]);

    res.status(200).json({
      user_id: userId,
      session_count: sessions ? sessions.length : 0,
      sessions: sessions || [],
      recent_events: events || []
    });
  } catch (err) {
    console.warn('[session-analytics] GET /admin/player/:userId error:', err.message);
    res.status(200).json({
      user_id: parseInt(req.params.userId, 10),
      session_count: 0,
      sessions: [],
      recent_events: []
    });
  }
});

// GET /api/session-analytics/admin/revenue
// Admin-only: Daily revenue for last 30 days
router.get('/admin/revenue', authenticate, async function(req, res) {
  try {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await _ensureTable();

    // Daily revenue aggregation
    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    var revenueSql = `SELECT
      DATE(started_at) as date,
      COUNT(DISTINCT session_id) as session_count,
      SUM(deposit_total) as deposits,
      SUM(total_wagered) as total_wagered,
      ROUND(AVG(total_wagered / NULLIF(total_spins, 0)), 2) as avg_bet_size,
      SUM(net_result) as net_result
      FROM session_summaries
      WHERE started_at > ?
      GROUP BY DATE(started_at)
      ORDER BY date DESC`;

    var revenuePgSql = `SELECT
      DATE(started_at) as date,
      COUNT(DISTINCT session_id) as session_count,
      SUM(deposit_total) as deposits,
      SUM(total_wagered) as total_wagered,
      ROUND(AVG(total_wagered / NULLIF(total_spins, 0)), 2) as avg_bet_size,
      SUM(net_result) as net_result
      FROM session_summaries
      WHERE started_at > ?::timestamptz
      GROUP BY DATE(started_at)
      ORDER BY date DESC`;

    var dailyRevenue = await db.all(db.isPg() ? revenuePgSql : revenueSql, [thirtyDaysAgo]);

    // Aggregate totals
    var totalSql = `SELECT
      COUNT(DISTINCT session_id) as total_sessions,
      SUM(deposit_total) as total_deposits,
      SUM(total_wagered) as total_wagered,
      ROUND(AVG(total_wagered / NULLIF(total_spins, 0)), 2) as avg_bet_size,
      SUM(net_result) as net_result
      FROM session_summaries WHERE started_at > ?`;

    var totalPgSql = `SELECT
      COUNT(DISTINCT session_id) as total_sessions,
      SUM(deposit_total) as total_deposits,
      SUM(total_wagered) as total_wagered,
      ROUND(AVG(total_wagered / NULLIF(total_spins, 0)), 2) as avg_bet_size,
      SUM(net_result) as net_result
      FROM session_summaries WHERE started_at > ?::timestamptz`;

    var totals = await db.get(db.isPg() ? totalPgSql : totalSql, [thirtyDaysAgo]);

    res.status(200).json({
      period: 'last_30_days',
      daily_revenue: dailyRevenue || [],
      totals: {
        total_sessions: totals ? totals.total_sessions : 0,
        total_deposits: totals ? totals.total_deposits : 0,
        total_wagered: totals ? totals.total_wagered : 0,
        average_bet_size: totals ? totals.avg_bet_size : 0,
        net_revenue: totals ? totals.net_result : 0
      }
    });
  } catch (err) {
    console.warn('[session-analytics] GET /admin/revenue error:', err.message);
    res.status(200).json({
      period: 'last_30_days',
      daily_revenue: [],
      totals: {
        total_sessions: 0,
        total_deposits: 0,
        total_wagered: 0,
        average_bet_size: 0,
        net_revenue: 0
      }
    });
  }
});

module.exports = router;
