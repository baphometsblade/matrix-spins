'use strict';

/**
 * Revenue Analytics Dashboard
 *
 * Comprehensive real-time revenue visibility for casino owners.
 * All endpoints require authenticate + requireAdmin.
 *
 * Endpoints:
 *   GET  /dashboard          — Main dashboard payload (all metrics in one call)
 *   GET  /trends             — 30-day trends with moving averages
 *   GET  /top-games          — Top 10 games by revenue contribution
 *   GET  /player-cohorts     — Cohort analysis (signup week tracking)
 *   GET  /hourly-heatmap     — Revenue by hour of day and day of week
 *   GET  /conversion-funnel  — Registration to deposit funnel
 *   POST /snapshot           — Take daily snapshot (idempotent)
 */

var router = require('express').Router();
var db = require('../database');
var { authenticate, requireAdmin } = require('../middleware/auth');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Lazy initialization pattern for revenue_snapshots table
var _initDone = false;
var _initPromise = null;

async function _ensureTable() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async function() {
    try {
      await db.get('SELECT 1 FROM revenue_snapshots LIMIT 1');
    } catch (err) {
      // Table doesn't exist, create it
      await db.run(`
        CREATE TABLE IF NOT EXISTS revenue_snapshots (
          id ${idDef},
          snapshot_date TEXT UNIQUE NOT NULL,
          total_deposits REAL DEFAULT 0,
          total_withdrawals REAL DEFAULT 0,
          net_revenue REAL DEFAULT 0,
          active_players INTEGER DEFAULT 0,
          new_signups INTEGER DEFAULT 0,
          avg_session_minutes REAL DEFAULT 0,
          top_game TEXT,
          house_edge_actual REAL DEFAULT 0,
          created_at ${tsDef}
        )
      `);
      console.warn('[RevenueAnalytics] revenue_snapshots table created');
    }
    _initDone = true;
  })();
  return _initPromise;
}

// Helper: Safe query execution (returns 0 or null on table-not-found)
async function safeQuery(sql, params) {
  try {
    var row = await db.get(sql, params || []);
    return row ? (Object.values(row)[0] || 0) : 0;
  } catch (e) {
    console.warn('[RevenueAnalytics] Query error:', e.message);
    return 0;
  }
}

// Helper: Safe multi-row query
async function safeQueryAll(sql, params) {
  try {
    var rows = await db.all(sql, params || []);
    return rows || [];
  } catch (e) {
    console.warn('[RevenueAnalytics] Query error:', e.message);
    return [];
  }
}

// Helper: Get today's date string (YYYY-MM-DD)
function getTodayStr() {
  var now = new Date();
  return now.getUTCFullYear() + '-' +
         String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(now.getUTCDate()).padStart(2, '0');
}

// Helper: Get yesterday's date string
function getYesterdayStr() {
  var now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return now.getUTCFullYear() + '-' +
         String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(now.getUTCDate()).padStart(2, '0');
}

// Helper: Get N days ago
function getNDaysAgoStr(days) {
  var now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now.getUTCFullYear() + '-' +
         String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(now.getUTCDate()).padStart(2, '0');
}

// Helper: Date filter for today
function getTodayFilter() {
  var todayStr = getTodayStr();
  if (isPg) {
    return `DATE(created_at) = '${todayStr}'::date`;
  } else {
    return `DATE(created_at) = '${todayStr}'`;
  }
}

// Helper: Date filter for a specific date
function getDateFilter(dateStr) {
  if (isPg) {
    return `DATE(created_at) = '${dateStr}'::date`;
  } else {
    return `DATE(created_at) = '${dateStr}'`;
  }
}

// ============================================================
// GET /dashboard — Full dashboard payload
// ============================================================
router.get('/dashboard', authenticate, requireAdmin, async (req, res) => {
  try {
    await _ensureTable();

    var todayStr = getTodayStr();
    var yesterdayStr = getYesterdayStr();

    // ──── TODAY'S METRICS ────

    // Today's deposits (sum from transactions table)
    var todayDeposits = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'deposit' AND ${getTodayFilter()}`,
      []
    );

    // Today's withdrawals
    var todayWithdrawals = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'withdrawal' AND ${getTodayFilter()}`,
      []
    );

    // Today's net revenue (deposits - withdrawals)
    var todayNetRevenue = todayDeposits - todayWithdrawals;

    // Today's active players (distinct users with spins)
    var todayActivePlayers = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as count FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // Today's new signups (users created today)
    var todayNewSignups = await safeQuery(
      `SELECT COUNT(*) as count FROM users
       WHERE ${getTodayFilter()}`,
      []
    );

    // Today's total spins
    var todayTotalSpins = await safeQuery(
      `SELECT COUNT(*) as count FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // Today's average bet size
    var todayAvgBet = await safeQuery(
      `SELECT COALESCE(AVG(bet_amount), 0) as avg FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // Today's total wins
    var todayTotalWins = await safeQuery(
      `SELECT COALESCE(SUM(win_amount), 0) as total FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // Today's total bets
    var todayTotalBets = await safeQuery(
      `SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // House edge actual (1 - total_wins/total_bets)
    var todayHouseEdge = 0;
    if (todayTotalBets > 0) {
      todayHouseEdge = ((todayTotalBets - todayTotalWins) / todayTotalBets) * 100;
    }

    // ──── YESTERDAY'S METRICS (for comparison) ────

    var yesterdayDeposits = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'deposit' AND ${getDateFilter(yesterdayStr)}`,
      []
    );

    var yesterdayWithdrawals = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'withdrawal' AND ${getDateFilter(yesterdayStr)}`,
      []
    );

    var yesterdayNetRevenue = yesterdayDeposits - yesterdayWithdrawals;

    var yesterdayActivePlayers = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as count FROM spins
       WHERE ${getDateFilter(yesterdayStr)}`,
      []
    );

    var yesterdayNewSignups = await safeQuery(
      `SELECT COUNT(*) as count FROM users
       WHERE ${getDateFilter(yesterdayStr)}`,
      []
    );

    var yesterdayTotalSpins = await safeQuery(
      `SELECT COUNT(*) as count FROM spins
       WHERE ${getDateFilter(yesterdayStr)}`,
      []
    );

    var yesterdayAvgBet = await safeQuery(
      `SELECT COALESCE(AVG(bet_amount), 0) as avg FROM spins
       WHERE ${getDateFilter(yesterdayStr)}`,
      []
    );

    // ──── COMPARISON CALCULATIONS ────

    function calcPercentChange(today, yesterday) {
      if (yesterday === 0) return today > 0 ? 100 : 0;
      return ((today - yesterday) / Math.abs(yesterday)) * 100;
    }

    var revenueChange = calcPercentChange(todayNetRevenue, yesterdayNetRevenue);
    var playersChange = calcPercentChange(todayActivePlayers, yesterdayActivePlayers);
    var signupsChange = calcPercentChange(todayNewSignups, yesterdayNewSignups);
    var spinsChange = calcPercentChange(todayTotalSpins, yesterdayTotalSpins);
    var avgBetChange = calcPercentChange(todayAvgBet, yesterdayAvgBet);

    res.json({
      today: {
        revenue: parseFloat(todayNetRevenue.toFixed(2)),
        deposits: parseFloat(todayDeposits.toFixed(2)),
        withdrawals: parseFloat(todayWithdrawals.toFixed(2)),
        activePlayers: parseInt(todayActivePlayers) || 0,
        newSignups: parseInt(todayNewSignups) || 0,
        totalSpins: parseInt(todayTotalSpins) || 0,
        averageBet: parseFloat(todayAvgBet.toFixed(2)),
        totalBets: parseFloat(todayTotalBets.toFixed(2)),
        totalWins: parseFloat(todayTotalWins.toFixed(2)),
        houseEdge: parseFloat(todayHouseEdge.toFixed(2))
      },
      yesterday: {
        revenue: parseFloat(yesterdayNetRevenue.toFixed(2)),
        deposits: parseFloat(yesterdayDeposits.toFixed(2)),
        withdrawals: parseFloat(yesterdayWithdrawals.toFixed(2)),
        activePlayers: parseInt(yesterdayActivePlayers) || 0,
        newSignups: parseInt(yesterdayNewSignups) || 0,
        totalSpins: parseInt(yesterdayTotalSpins) || 0,
        averageBet: parseFloat(yesterdayAvgBet.toFixed(2))
      },
      comparison: {
        revenueChangePercent: parseFloat(revenueChange.toFixed(2)),
        playersChangePercent: parseFloat(playersChange.toFixed(2)),
        signupsChangePercent: parseFloat(signupsChange.toFixed(2)),
        spinsChangePercent: parseFloat(spinsChange.toFixed(2)),
        avgBetChangePercent: parseFloat(avgBetChange.toFixed(2))
      }
    });
  } catch (e) {
    console.warn('[RevenueAnalytics] Dashboard error:', e.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ============================================================
// GET /trends — 30-day trends with moving averages
// ============================================================
router.get('/trends', authenticate, requireAdmin, async (req, res) => {
  try {
    await _ensureTable();

    var days = parseInt(req.query.days) || 30;
    var startDate = getNDaysAgoStr(days);

    // Fetch daily aggregates for last N days
    var dailyData = await safeQueryAll(
      `SELECT
         ${isPg ? "DATE(created_at)::text" : "DATE(created_at)"} as day,
         COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) as deposits,
         COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) as withdrawals,
         COUNT(DISTINCT CASE WHEN type = 'deposit' OR type = 'withdrawal' THEN user_id END) as active_on_deposits
       FROM transactions
       WHERE ${isPg ? "DATE(created_at) >= " : "DATE(created_at) >= "}
             '${startDate}'
       GROUP BY DAY
       ORDER BY DAY ASC`,
      []
    );

    var spinsData = await safeQueryAll(
      `SELECT
         ${isPg ? "DATE(created_at)::text" : "DATE(created_at)"} as day,
         COUNT(DISTINCT user_id) as active_players,
         COUNT(*) as total_spins,
         COALESCE(SUM(bet_amount), 0) as total_bets,
         COALESCE(SUM(win_amount), 0) as total_wins
       FROM spins
       WHERE ${isPg ? "DATE(created_at) >= " : "DATE(created_at) >= "}
             '${startDate}'
       GROUP BY DAY
       ORDER BY DAY ASC`,
      []
    );

    // Merge daily data
    var dailyMap = {};
    dailyData.forEach(function(row) {
      var key = row.day;
      dailyMap[key] = {
        day: key,
        deposits: row.deposits || 0,
        withdrawals: row.withdrawals || 0,
        revenue: (row.deposits || 0) - (row.withdrawals || 0),
        activePlayers: 0,
        totalSpins: 0,
        totalBets: 0,
        totalWins: 0,
        houseEdge: 0
      };
    });

    spinsData.forEach(function(row) {
      var key = row.day;
      if (!dailyMap[key]) {
        dailyMap[key] = {
          day: key,
          deposits: 0,
          withdrawals: 0,
          revenue: 0,
          activePlayers: 0,
          totalSpins: 0,
          totalBets: 0,
          totalWins: 0,
          houseEdge: 0
        };
      }
      dailyMap[key].activePlayers = row.active_players || 0;
      dailyMap[key].totalSpins = row.total_spins || 0;
      dailyMap[key].totalBets = row.total_bets || 0;
      dailyMap[key].totalWins = row.total_wins || 0;
      if ((row.total_bets || 0) > 0) {
        dailyMap[key].houseEdge = (((row.total_bets || 0) - (row.total_wins || 0)) / (row.total_bets || 0)) * 100;
      }
    });

    var dailyArray = Object.values(dailyMap).sort(function(a, b) {
      return new Date(a.day) - new Date(b.day);
    });

    // Calculate 7-day moving averages
    var movingAverage7 = [];
    for (var i = 0; i < dailyArray.length; i++) {
      var start = Math.max(0, i - 6);
      var window = dailyArray.slice(start, i + 1);
      var avgRevenue = window.reduce(function(sum, row) { return sum + row.revenue; }, 0) / window.length;
      var avgPlayers = window.reduce(function(sum, row) { return sum + row.activePlayers; }, 0) / window.length;
      var avgSpins = window.reduce(function(sum, row) { return sum + row.totalSpins; }, 0) / window.length;
      movingAverage7.push({
        day: dailyArray[i].day,
        avgRevenue: parseFloat(avgRevenue.toFixed(2)),
        avgActivePlayers: parseFloat(avgPlayers.toFixed(2)),
        avgSpins: parseFloat(avgSpins.toFixed(2))
      });
    }

    res.json({
      daily: dailyArray.map(function(row) {
        return {
          day: row.day,
          revenue: parseFloat(row.revenue.toFixed(2)),
          deposits: parseFloat(row.deposits.toFixed(2)),
          withdrawals: parseFloat(row.withdrawals.toFixed(2)),
          activePlayers: row.activePlayers,
          totalSpins: row.totalSpins,
          totalBets: parseFloat(row.totalBets.toFixed(2)),
          totalWins: parseFloat(row.totalWins.toFixed(2)),
          houseEdge: parseFloat(row.houseEdge.toFixed(2))
        };
      }),
      movingAverage7: movingAverage7
    });
  } catch (e) {
    console.warn('[RevenueAnalytics] Trends error:', e.message);
    res.status(500).json({ error: 'Failed to load trends' });
  }
});

// ============================================================
// GET /top-games — Top 10 games by revenue contribution
// ============================================================
router.get('/top-games', authenticate, requireAdmin, async (req, res) => {
  try {
    var topGames = await safeQueryAll(
      `SELECT
         game_id as game_name,
         COUNT(*) as spin_count,
         COUNT(DISTINCT user_id) as unique_players,
         COALESCE(SUM(bet_amount), 0) as total_bets,
         COALESCE(SUM(win_amount), 0) as total_wins,
         (COALESCE(SUM(bet_amount), 0) - COALESCE(SUM(win_amount), 0)) as net_revenue
       FROM spins
       GROUP BY game_id
       ORDER BY net_revenue DESC
       LIMIT 10`,
      []
    );

    res.json({
      topGames: (topGames || []).map(function(row) {
        return {
          gameName: row.game_name,
          spinCount: row.spin_count,
          uniquePlayers: row.unique_players,
          totalBets: parseFloat((row.total_bets || 0).toFixed(2)),
          totalWins: parseFloat((row.total_wins || 0).toFixed(2)),
          netRevenue: parseFloat((row.net_revenue || 0).toFixed(2))
        };
      })
    });
  } catch (e) {
    console.warn('[RevenueAnalytics] Top games error:', e.message);
    res.status(500).json({ error: 'Failed to load top games' });
  }
});

// ============================================================
// GET /player-cohorts — Cohort analysis (last 8 cohorts)
// ============================================================
router.get('/player-cohorts', authenticate, requireAdmin, async (req, res) => {
  try {
    // Group users by signup week
    var cohorts = await safeQueryAll(
      `SELECT
         ${isPg ? "DATE_TRUNC('week', created_at)::text" : "strftime('%Y-%W', created_at)"} as cohort_week,
         COUNT(*) as cohort_size
       FROM users
       GROUP BY cohort_week
       ORDER BY cohort_week DESC
       LIMIT 8`,
      []
    );

    // For each cohort, calculate retention metrics
    var cohortAnalysis = [];
    for (var i = 0; i < (cohorts || []).length; i++) {
      var cohort = cohorts[i];
      var cohortWeek = cohort.cohort_week;
      var cohortSize = cohort.cohort_size || 0;

      // Active on day 1 (users with spins in their first day)
      var day1Active = await safeQuery(
        `SELECT COUNT(DISTINCT s.user_id) as count
         FROM spins s
         JOIN users u ON s.user_id = u.id
         WHERE strftime('%Y-%W', u.created_at) = ? AND s.created_at < datetime(u.created_at, '+1 day')`,
        [cohortWeek]
      );

      // Active on day 7
      var day7Active = await safeQuery(
        `SELECT COUNT(DISTINCT s.user_id) as count
         FROM spins s
         JOIN users u ON s.user_id = u.id
         WHERE strftime('%Y-%W', u.created_at) = ? AND s.created_at < datetime(u.created_at, '+7 days')`,
        [cohortWeek]
      );

      // Active on day 30
      var day30Active = await safeQuery(
        `SELECT COUNT(DISTINCT s.user_id) as count
         FROM spins s
         JOIN users u ON s.user_id = u.id
         WHERE strftime('%Y-%W', u.created_at) = ? AND s.created_at < datetime(u.created_at, '+30 days')`,
        [cohortWeek]
      );

      // Total deposited
      var totalDeposited = await safeQuery(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE type = 'deposit' AND user_id IN (
           SELECT id FROM users WHERE strftime('%Y-%W', created_at) = ?
         )`,
        [cohortWeek]
      );

      // Average lifetime value
      var avgLTV = cohortSize > 0 ? totalDeposited / cohortSize : 0;

      cohortAnalysis.push({
        cohortWeek: cohortWeek,
        cohortSize: cohortSize,
        activeDay1: parseInt(day1Active) || 0,
        activeDay7: parseInt(day7Active) || 0,
        activeDay30: parseInt(day30Active) || 0,
        totalDeposited: parseFloat(totalDeposited.toFixed(2)),
        avgLTV: parseFloat(avgLTV.toFixed(2))
      });
    }

    res.json({ cohorts: cohortAnalysis });
  } catch (e) {
    console.warn('[RevenueAnalytics] Cohorts error:', e.message);
    res.status(500).json({ error: 'Failed to load cohort analysis' });
  }
});

// ============================================================
// GET /hourly-heatmap — Revenue by hour of day and day of week
// ============================================================
router.get('/hourly-heatmap', authenticate, requireAdmin, async (req, res) => {
  try {
    // Get hourly data aggregated by day of week
    var heatmapData = await safeQueryAll(
      `SELECT
         ${isPg ? "EXTRACT(HOUR FROM created_at)::int" : "CAST(strftime('%H', created_at) AS INTEGER)"} as hour_of_day,
         ${isPg ? "EXTRACT(DOW FROM created_at)::int" : "CAST(strftime('%w', created_at) AS INTEGER)"} as day_of_week,
         COALESCE(SUM(bet_amount), 0) as total_bets
       FROM spins
       GROUP BY hour_of_day, day_of_week
       ORDER BY day_of_week, hour_of_day`,
      []
    );

    // Build 24x7 grid (24 hours x 7 days)
    var grid = [];
    for (var day = 0; day < 7; day++) {
      for (var hour = 0; hour < 24; hour++) {
        var entry = heatmapData.find(function(row) {
          return row.hour_of_day === hour && row.day_of_week === day;
        });
        grid.push({
          hour: hour,
          dayOfWeek: day,
          totalBets: parseFloat((entry ? entry.total_bets : 0).toFixed(2))
        });
      }
    }

    res.json({ heatmap: grid });
  } catch (e) {
    console.warn('[RevenueAnalytics] Heatmap error:', e.message);
    res.status(500).json({ error: 'Failed to load hourly heatmap' });
  }
});

// ============================================================
// GET /conversion-funnel — Registration to deposit funnel
// ============================================================
router.get('/conversion-funnel', authenticate, requireAdmin, async (req, res) => {
  try {
    // Total registered users
    var totalUsers = await safeQuery(
      'SELECT COUNT(*) as count FROM users',
      []
    );

    // Users who have deposited at least once
    var firstDepositors = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as count FROM transactions
       WHERE type = 'deposit'`,
      []
    );

    // Users with multiple deposits
    var repeatDepositors = await safeQuery(
      `SELECT COUNT(*) as count FROM (
         SELECT user_id, COUNT(*) as deposit_count
         FROM transactions
         WHERE type = 'deposit'
         GROUP BY user_id
         HAVING COUNT(*) > 1
       ) as t`,
      []
    );

    // VIP players (high lifetime value, can be customized)
    // For now, define as users with total deposits > 1000
    var vipPlayers = await safeQuery(
      `SELECT COUNT(*) as count FROM (
         SELECT user_id, SUM(amount) as total_deposits
         FROM transactions
         WHERE type = 'deposit'
         GROUP BY user_id
         HAVING SUM(amount) > 1000
       ) as t`,
      []
    );

    function safeDivide(a, b) {
      return b > 0 ? ((a / b) * 100) : 0;
    }

    res.json({
      funnel: {
        totalRegistered: parseInt(totalUsers) || 0,
        firstDepositors: parseInt(firstDepositors) || 0,
        firstDepositConversion: parseFloat(safeDivide(firstDepositors, totalUsers).toFixed(2)),
        repeatDepositors: parseInt(repeatDepositors) || 0,
        repeatDepositConversion: parseFloat(safeDivide(repeatDepositors, firstDepositors).toFixed(2)),
        vipPlayers: parseInt(vipPlayers) || 0,
        vipConversion: parseFloat(safeDivide(vipPlayers, repeatDepositors).toFixed(2))
      }
    });
  } catch (e) {
    console.warn('[RevenueAnalytics] Funnel error:', e.message);
    res.status(500).json({ error: 'Failed to load conversion funnel' });
  }
});

// ============================================================
// POST /snapshot — Take a daily snapshot (idempotent)
// ============================================================
router.post('/snapshot', authenticate, requireAdmin, async (req, res) => {
  try {
    await _ensureTable();

    var todayStr = getTodayStr();

    // Get today's metrics
    var totalDeposits = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'deposit' AND ${getTodayFilter()}`,
      []
    );

    var totalWithdrawals = await safeQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'withdrawal' AND ${getTodayFilter()}`,
      []
    );

    var netRevenue = totalDeposits - totalWithdrawals;

    var activePlayers = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as count FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    var newSignups = await safeQuery(
      `SELECT COUNT(*) as count FROM users
       WHERE ${getTodayFilter()}`,
      []
    );

    var totalSpins = await safeQuery(
      `SELECT COUNT(*) as count FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    // Average session minutes (estimate based on spins count)
    // Assuming ~1 minute per 10 spins as rough average
    var avgSessionMinutes = totalSpins > 0 ? (totalSpins / 10) : 0;

    // Top game today
    var topGameRow = await db.get(
      `SELECT game_id, COUNT(*) as spin_count FROM spins
       WHERE ${getTodayFilter()}
       GROUP BY game_id
       ORDER BY spin_count DESC
       LIMIT 1`,
      []
    );
    var topGame = topGameRow ? topGameRow.game_id : null;

    // House edge
    var totalBets = await safeQuery(
      `SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    var totalWins = await safeQuery(
      `SELECT COALESCE(SUM(win_amount), 0) as total FROM spins
       WHERE ${getTodayFilter()}`,
      []
    );

    var houseEdge = 0;
    if (totalBets > 0) {
      houseEdge = ((totalBets - totalWins) / totalBets) * 100;
    }

    // Upsert snapshot (replace if exists for today)
    await db.run(
      `INSERT INTO revenue_snapshots (
         snapshot_date, total_deposits, total_withdrawals, net_revenue,
         active_players, new_signups, avg_session_minutes, top_game,
         house_edge_actual
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(snapshot_date) DO UPDATE SET
         total_deposits = ?, total_withdrawals = ?, net_revenue = ?,
         active_players = ?, new_signups = ?, avg_session_minutes = ?,
         top_game = ?, house_edge_actual = ?`,
      [
        todayStr,
        totalDeposits, totalWithdrawals, netRevenue,
        activePlayers, newSignups, avgSessionMinutes, topGame,
        houseEdge,
        // UPDATE clause values
        totalDeposits, totalWithdrawals, netRevenue,
        activePlayers, newSignups, avgSessionMinutes, topGame,
        houseEdge
      ]
    );

    res.json({
      success: true,
      snapshotDate: todayStr,
      snapshot: {
        totalDeposits: parseFloat(totalDeposits.toFixed(2)),
        totalWithdrawals: parseFloat(totalWithdrawals.toFixed(2)),
        netRevenue: parseFloat(netRevenue.toFixed(2)),
        activePlayers: parseInt(activePlayers) || 0,
        newSignups: parseInt(newSignups) || 0,
        avgSessionMinutes: parseFloat(avgSessionMinutes.toFixed(2)),
        topGame: topGame,
        houseEdgeActual: parseFloat(houseEdge.toFixed(2))
      }
    });
  } catch (e) {
    console.warn('[RevenueAnalytics] Snapshot error:', e.message);
    res.status(500).json({ error: 'Failed to take snapshot' });
  }
});

module.exports = router;
