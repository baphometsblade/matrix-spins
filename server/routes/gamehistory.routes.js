'use strict';

/**
 * Game History API
 *
 * Routes:
 *   GET  /api/game-history/          — paginated spin history with filters
 *   GET  /api/game-history/summary   — aggregate statistics
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/game-history
 * Returns paginated spin history with optional filters
 *
 * Query params:
 * - page: page number (default 1)
 * - limit: records per page (default 20, max 100)
 * - game: filter by game_id (optional)
 * - from: ISO date or timestamp for start date (optional)
 * - to: ISO date or timestamp for end date (optional)
 *
 * Response: { page, limit, total, data: [...spins] }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    let page = Math.max(1, parseInt(req.query.page) || 1);
    let limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const gameFilter = req.query.game ? String(req.query.game).trim() : null;
    const dateFrom = req.query.from ? String(req.query.from).trim() : null;
    const dateTo = req.query.to ? String(req.query.to).trim() : null;

    // Build WHERE clause
    let whereClause = 'WHERE user_id = ?';
    const params = [userId];

    if (gameFilter) {
      whereClause += ' AND game_id = ?';
      params.push(gameFilter);
    }

    if (dateFrom) {
      whereClause += ' AND created_at >= datetime(?)';
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClause += ' AND created_at <= datetime(?)';
      params.push(dateTo);
    }

    // Get total count
    const countRow = await db.get(
      `SELECT COUNT(*) as total FROM spins ${whereClause}`,
      params
    );
    const total = countRow.total || 0;

    // Get paginated records
    const offset = (page - 1) * limit;
    const spins = await db.all(
      `SELECT
        id,
        user_id,
        game_id,
        bet_amount,
        win_amount,
        result_grid,
        created_at
      FROM spins
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Transform response
    const data = spins.map(spin => {
      const bet = parseFloat(spin.bet_amount) || 0;
      const win = parseFloat(spin.win_amount) || 0;
      const multiplier = bet > 0 ? (win / bet).toFixed(2) : '0.00';
      let resultType = 'loss';

      if (win > bet) {
        resultType = 'win';
        // Check for jackpot (multiplier >= 100x)
        if (multiplier >= 100) {
          resultType = 'jackpot';
        }
      } else if (win === bet) {
        resultType = 'break-even';
      }

      return {
        id: spin.id,
        timestamp: spin.created_at,
        gameName: spin.game_id,
        betAmount: parseFloat(bet).toFixed(2),
        winAmount: parseFloat(win).toFixed(2),
        multiplier: multiplier,
        resultType: resultType
      };
    });

    res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    console.warn('[GameHistory] Get history error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve game history' });
  }
});

/**
 * GET /api/game-history/summary
 * Returns aggregate statistics for the player
 *
 * Response: { totalSpins, totalWagered, totalWon, netPl, biggestWin, favoriteGame }
 */
router.get('/summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get aggregate stats
    const stats = await db.get(
      `SELECT
        COUNT(*) as total_spins,
        COALESCE(SUM(bet_amount), 0) as total_wagered,
        COALESCE(SUM(win_amount), 0) as total_won,
        COALESCE(MAX(win_amount), 0) as biggest_win,
        COALESCE(MAX(CASE WHEN win_amount > bet_amount THEN win_amount ELSE 0 END), 0) as biggest_win_amount
       FROM spins WHERE user_id = ?`,
      [userId]
    );

    // Get favorite game
    const favoriteGameRow = await db.get(
      `SELECT game_id, COUNT(*) as spin_count FROM spins WHERE user_id = ?
       GROUP BY game_id ORDER BY spin_count DESC LIMIT 1`,
      [userId]
    );

    const totalWagered = parseFloat(stats.total_wagered) || 0;
    const totalWon = parseFloat(stats.total_won) || 0;
    const netPl = totalWon - totalWagered;

    res.json({
      totalSpins: stats.total_spins || 0,
      totalWagered: parseFloat(totalWagered.toFixed(2)),
      totalWon: parseFloat(totalWon.toFixed(2)),
      netPl: parseFloat(netPl.toFixed(2)),
      biggestWin: parseFloat(stats.biggest_win_amount).toFixed(2),
      favoriteGame: favoriteGameRow ? favoriteGameRow.game_id : null,
      favoriteGameSpins: favoriteGameRow ? favoriteGameRow.spin_count : 0
    });
  } catch (err) {
    console.warn('[GameHistory] Get summary error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve summary' });
  }
});

module.exports = router;
