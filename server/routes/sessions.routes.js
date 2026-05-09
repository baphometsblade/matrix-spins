'use strict';

/**
 * Player Sessions API
 *
 * Derives play sessions from the spins table by grouping consecutive spins.
 * A new session starts when the gap between two spins exceeds SESSION_GAP_MIN.
 *
 * Routes:
 *   GET /api/sessions                — list of sessions (paginated)
 *   GET /api/sessions/extended-stats — aggregate stats (total wagered/won, biggest win,
 *                                      favorite game, lucky game, average bet, win rate)
 *   GET /api/sessions/timeseries     — daily P/L timeseries for charts
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const SESSION_GAP_MIN = 30; // minutes — gap that ends a session

function toNum(v) { return parseFloat(v) || 0; }

/**
 * GET /api/sessions
 * Returns derived sessions sorted by most-recent first.
 *
 * Query: limit (default 30, max 100)
 * Response: { sessions: [{ startedAt, endedAt, durationMinutes, spins, wagered, won, net, games: [game_id...] }] }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));

    // Pull last 1000 spins (sufficient for ~30 sessions of typical play)
    const spins = await db.all(
      `SELECT id, game_id, bet_amount, win_amount, created_at
       FROM spins
       WHERE user_id = ?
       ORDER BY created_at ASC`,
      [userId]
    );

    if (!spins || spins.length === 0) {
      return res.json({ sessions: [] });
    }

    const sessions = [];
    let cur = null;
    const gapMs = SESSION_GAP_MIN * 60 * 1000;

    for (const s of spins) {
      const ts = new Date(s.created_at).getTime();
      if (!cur || ts - cur._lastTs > gapMs) {
        if (cur) sessions.push(finalizeSession(cur));
        cur = {
          startedAt: s.created_at,
          endedAt: s.created_at,
          _firstTs: ts,
          _lastTs: ts,
          spins: 0,
          wagered: 0,
          won: 0,
          gamesSet: new Set(),
          biggestWin: 0
        };
      }
      cur._lastTs = ts;
      cur.endedAt = s.created_at;
      cur.spins += 1;
      cur.wagered += toNum(s.bet_amount);
      cur.won += toNum(s.win_amount);
      cur.gamesSet.add(s.game_id);
      if (toNum(s.win_amount) > cur.biggestWin) cur.biggestWin = toNum(s.win_amount);
    }
    if (cur) sessions.push(finalizeSession(cur));

    // Newest first, limit
    sessions.reverse();
    res.json({ sessions: sessions.slice(0, limit) });
  } catch (err) {
    console.warn('[Sessions] List error:', err.message);
    res.status(500).json({ error: 'Failed to derive sessions' });
  }
});

function finalizeSession(s) {
  const durationMin = Math.max(1, Math.round((s._lastTs - s._firstTs) / 60000)) || 1;
  const net = +(s.won - s.wagered).toFixed(2);
  return {
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMinutes: durationMin,
    spins: s.spins,
    spinsPerMinute: +(s.spins / durationMin).toFixed(2),
    wagered: +s.wagered.toFixed(2),
    won: +s.won.toFixed(2),
    net,
    biggestWin: +s.biggestWin.toFixed(2),
    games: Array.from(s.gamesSet),
    gameCount: s.gamesSet.size
  };
}

/**
 * GET /api/sessions/extended-stats
 * Aggregate stats including lucky game (highest RTP for player), average bet, win rate.
 */
router.get('/extended-stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const totals = await db.get(
      `SELECT
         COUNT(*)                                                              AS total_spins,
         COALESCE(SUM(bet_amount), 0)                                          AS total_wagered,
         COALESCE(SUM(win_amount), 0)                                          AS total_won,
         COALESCE(MAX(win_amount), 0)                                          AS biggest_win,
         COALESCE(AVG(bet_amount), 0)                                          AS avg_bet,
         COALESCE(SUM(CASE WHEN win_amount > bet_amount THEN 1 ELSE 0 END), 0) AS winning_spins
       FROM spins WHERE user_id = ?`,
      [userId]
    );

    const favorite = await db.get(
      `SELECT game_id, COUNT(*) AS spin_count
       FROM spins WHERE user_id = ?
       GROUP BY game_id ORDER BY spin_count DESC LIMIT 1`,
      [userId]
    );

    // Lucky game = highest player-RTP among games with at least 20 spins
    const lucky = await db.get(
      `SELECT
         game_id,
         COUNT(*) AS n,
         SUM(bet_amount) AS wagered,
         SUM(win_amount) AS won
       FROM spins WHERE user_id = ?
       GROUP BY game_id
       HAVING COUNT(*) >= 20 AND SUM(bet_amount) > 0
       ORDER BY (SUM(win_amount) / SUM(bet_amount)) DESC
       LIMIT 1`,
      [userId]
    );

    const totalWagered = toNum(totals.total_wagered);
    const totalWon = toNum(totals.total_won);
    const totalSpins = parseInt(totals.total_spins) || 0;
    const winningSpins = parseInt(totals.winning_spins) || 0;
    const winRate = totalSpins > 0 ? +((winningSpins / totalSpins) * 100).toFixed(1) : 0;
    const playerRtp = totalWagered > 0 ? +((totalWon / totalWagered) * 100).toFixed(2) : 0;

    res.json({
      totalSpins,
      totalWagered: +totalWagered.toFixed(2),
      totalWon: +totalWon.toFixed(2),
      netPl: +(totalWon - totalWagered).toFixed(2),
      biggestWin: +toNum(totals.biggest_win).toFixed(2),
      averageBet: +toNum(totals.avg_bet).toFixed(2),
      winningSpins,
      winRate,
      playerRtp,
      favoriteGame: favorite ? favorite.game_id : null,
      favoriteGameSpins: favorite ? favorite.spin_count : 0,
      luckyGame: lucky ? lucky.game_id : null,
      luckyGameRtp: lucky && toNum(lucky.wagered) > 0
        ? +((toNum(lucky.won) / toNum(lucky.wagered)) * 100).toFixed(2)
        : null
    });
  } catch (err) {
    console.warn('[Sessions] Extended-stats error:', err.message);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

/**
 * GET /api/sessions/timeseries?days=30
 * Returns daily aggregates for charting: { day, wagered, won, net, spins }
 */
router.get('/timeseries', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    // Use sqlite-compatible date(...) function which is also valid in PG
    const isPg = typeof db.isPg === 'function' ? db.isPg() : !!process.env.DATABASE_URL;
    const dayExpr = isPg
      ? "to_char(created_at, 'YYYY-MM-DD')"
      : "strftime('%Y-%m-%d', created_at)";
    const cutoffExpr = isPg
      ? `(NOW() - INTERVAL '${days} days')`
      : `datetime('now', '-${days} days')`;

    const rows = await db.all(
      `SELECT
         ${dayExpr} AS day,
         COUNT(*) AS spins,
         SUM(bet_amount) AS wagered,
         SUM(win_amount) AS won
       FROM spins
       WHERE user_id = ? AND created_at >= ${cutoffExpr}
       GROUP BY ${dayExpr}
       ORDER BY day ASC`,
      [userId]
    );

    const data = (rows || []).map(r => ({
      day: r.day,
      spins: parseInt(r.spins) || 0,
      wagered: +toNum(r.wagered).toFixed(2),
      won: +toNum(r.won).toFixed(2),
      net: +(toNum(r.won) - toNum(r.wagered)).toFixed(2)
    }));

    res.json({ days, data });
  } catch (err) {
    console.warn('[Sessions] Timeseries error:', err.message);
    res.status(500).json({ error: 'Failed to load timeseries' });
  }
});

module.exports = router;
