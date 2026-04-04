'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

/**
 * GET / (authenticate) — Get personalized game recommendations
 *
 * Algorithm:
 * 1. Get user's spin history: top 5 most-played games by spin count
 * 2. Get user's most profitable games: top 5 by net_win (win_amount - bet_amount)
 * 3. Get globally popular games: top 10 by total spins across all users
 * 4. Get "hot" games: games with highest total wins in last 24 hours
 * 5. Get games the user HASN'T played yet (discovery)
 * 6. Return 4 categories: "For You", "Trending Now", "Try Something New", "Top Picks"
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const isPg = db.isPg ? db.isPg() : false;

    // 1. User's most-played games (top 5 by spin count)
    const playedGames = await db.all(
      `SELECT game_id, COUNT(*) AS play_count,
              CAST(AVG(win_amount - bet_amount) AS REAL) AS avg_net_win
       FROM spins
       WHERE user_id = ?
       GROUP BY game_id
       ORDER BY play_count DESC
       LIMIT 5`,
      [userId]
    );

    // 2. User's most profitable games (top 5 by net win)
    const profitableGames = await db.all(
      `SELECT game_id, COUNT(*) AS play_count,
              CAST(SUM(win_amount - bet_amount) AS REAL) AS total_net_win,
              CAST(AVG(win_amount - bet_amount) AS REAL) AS avg_net_win
       FROM spins
       WHERE user_id = ? AND (win_amount - bet_amount) > 0
       GROUP BY game_id
       ORDER BY total_net_win DESC
       LIMIT 5`,
      [userId]
    );

    // 3. Globally popular games (top 10 by total spins)
    const popularGames = await db.all(
      `SELECT game_id, COUNT(*) AS total_spins
       FROM spins
       GROUP BY game_id
       ORDER BY total_spins DESC
       LIMIT 10`,
      []
    );

    // 4. "Hot" games: highest total wins in last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const hotGames = await db.all(
      `SELECT game_id, COUNT(*) AS recent_spins,
              CAST(SUM(CASE WHEN win_amount > bet_amount THEN win_amount - bet_amount ELSE 0 END) AS REAL) AS total_wins
       FROM spins
       WHERE created_at >= ?
       GROUP BY game_id
       HAVING SUM(CASE WHEN win_amount > bet_amount THEN win_amount - bet_amount ELSE 0 END) > 0
       ORDER BY total_wins DESC
       LIMIT 5`,
      [twentyFourHoursAgo]
    );

    // 5. Games user HASN'T played (for discovery)
    const userPlayedGameIds = await db.all(
      `SELECT DISTINCT game_id FROM spins WHERE user_id = ? LIMIT 500`,
      [userId]
    );
    const userPlayedSet = new Set(userPlayedGameIds.map(r => r.game_id));

    // Get all distinct game IDs from spins table
    const allGames = await db.all(
      `SELECT DISTINCT game_id FROM spins ORDER BY game_id LIMIT 500`,
      []
    );

    const unplayedGames = allGames.filter(r => !userPlayedSet.has(r.game_id));
    // Pick top 5 unplayed games by global popularity
    const unplayedPopular = await db.all(
      `SELECT game_id, COUNT(*) AS total_spins
       FROM spins
       WHERE game_id IN (${unplayedGames.map(() => '?').join(',') || 'NULL'})
       GROUP BY game_id
       ORDER BY total_spins DESC
       LIMIT 5`,
      unplayedGames.map(r => r.game_id)
    );

    // Helper: Get game metadata (name from a recent spin, or fallback to game_id)
    async function getGameName(gameId) {
      const row = await db.get(
        `SELECT game_id FROM spins WHERE game_id = ? LIMIT 1`,
        [gameId]
      );
      return row ? gameId : null;
    }

    // Helper: Build recommendation card
    async function buildCard(gameId, playCount, avgWin, reason) {
      if (!gameId) return null;
      return {
        game_id: gameId,
        name: gameId,
        play_count: playCount || 0,
        avg_win: typeof avgWin === 'number' ? Math.round(avgWin * 100) / 100 : 0,
        reason: reason
      };
    }

    // Build "For You" category (mix of played profitable games + high-play count)
    const forYouSet = new Set();
    const forYouCards = [];

    // Add top profitable games first
    for (const game of profitableGames.slice(0, 3)) {
      if (forYouSet.size < 5) {
        forYouSet.add(game.game_id);
        const card = await buildCard(
          game.game_id,
          game.play_count,
          game.avg_net_win,
          `You've won $${Math.abs(Math.round(game.total_net_win))} on this game`
        );
        if (card) forYouCards.push(card);
      }
    }

    // Fill remaining spots with most-played games
    for (const game of playedGames.slice(0, 5)) {
      if (forYouSet.size < 5 && !forYouSet.has(game.game_id)) {
        forYouSet.add(game.game_id);
        const card = await buildCard(
          game.game_id,
          game.play_count,
          game.avg_net_win,
          `You've played this ${game.play_count} times`
        );
        if (card) forYouCards.push(card);
      }
    }

    // Build "Trending Now" category (hot games from last 24h)
    const trendingCards = [];
    for (const game of hotGames.slice(0, 5)) {
      const card = await buildCard(
        game.game_id,
        game.recent_spins,
        game.total_wins / game.recent_spins,
        `Hot! $${Math.round(game.total_wins)} won today`
      );
      if (card) trendingCards.push(card);
    }

    // Build "Try Something New" category (unplayed games)
    const newCards = [];
    for (const game of unplayedPopular.slice(0, 5)) {
      const card = await buildCard(
        game.game_id,
        game.total_spins,
        0,
        `New to you • Played ${game.total_spins} times`
      );
      if (card) newCards.push(card);
    }

    // Build "Top Picks" category (global popular)
    const topPicksCards = [];
    for (const game of popularGames.slice(0, 5)) {
      const card = await buildCard(
        game.game_id,
        game.total_spins,
        0,
        `Most played • ${game.total_spins} total spins`
      );
      if (card) topPicksCards.push(card);
    }

    res.json({
      forYou: forYouCards.slice(0, 5),
      trendingNow: trendingCards.slice(0, 5),
      tryNew: newCards.slice(0, 5),
      topPicks: topPicksCards.slice(0, 5)
    });

  } catch (err) {
    console.warn('[Recommend] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

/**
 * GET /trending (public) — Just the trending/hot games (for non-logged-in users)
 */
router.get('/trending', async (req, res) => {
  try {
    // Hot games: games with highest total wins in last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const hotGames = await db.all(
      `SELECT game_id, COUNT(*) AS recent_spins,
              CAST(SUM(CASE WHEN win_amount > bet_amount THEN win_amount - bet_amount ELSE 0 END) AS REAL) AS total_wins
       FROM spins
       WHERE created_at >= ?
       GROUP BY game_id
       HAVING SUM(CASE WHEN win_amount > bet_amount THEN win_amount - bet_amount ELSE 0 END) > 0
       ORDER BY total_wins DESC
       LIMIT 10`,
      [twentyFourHoursAgo]
    );

    const trendingCards = [];
    for (const game of hotGames) {
      trendingCards.push({
        game_id: game.game_id,
        name: game.game_id,
        spins: game.recent_spins,
        total_wins: Math.round(game.total_wins * 100) / 100,
        reason: `Hot! $${Math.round(game.total_wins)} won today`
      });
    }

    res.json({
      trending: trendingCards
    });

  } catch (err) {
    console.warn('[Recommend] GET /trending error:', err.message);
    res.status(500).json({ error: 'Failed to fetch trending games' });
  }
});

module.exports = router;
