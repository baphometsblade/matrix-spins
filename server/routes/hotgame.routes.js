'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

// ROUND 62: Dynamically pull hot games from game-definitions instead of hardcoding stale IDs
const games = require('../../shared/game-definitions');
const HOT_GAME_IDS = (Array.isArray(games) ? games : [])
  .filter(g => g && g.hot)
  .map(g => g.id)
  .slice(0, 15); // Rotate through up to 15 hot games

/**
 * Returns the hot game for the current hour window plus its expiry timestamp.
 * Rotation index = floor(epoch_ms / 3600000) % gameCount — changes every 60 min.
 */
function getCurrentHotGame() {
  const hourIndex = Math.floor(Date.now() / 3600000);
  const gameId = HOT_GAME_IDS[hourIndex % HOT_GAME_IDS.length];

  // expiresAt = start of the *next* hour in UTC
  const nextHourMs = (hourIndex + 1) * 3600000;
  const expiresAt = new Date(nextHourMs).toISOString();

  return { gameId, expiresAt };
}

// GET /api/hotgame/current — public, no auth required
router.get('/current', function (req, res) {
  try {
    const { gameId, expiresAt } = getCurrentHotGame();
    return res.json({
      gameId,
      label: '+20% RTP Boost!',
      expiresAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hotgame/played — auth required
// Returns whether the authenticated user has played the current hot game today (UTC day).
router.get('/played', authenticate, async function (req, res) {
  try {
    const userId = req.user.id;
    const { gameId } = getCurrentHotGame();

    // Today in YYYY-MM-DD format (UTC)
    const todayStr = new Date().toISOString().slice(0, 10);

    const row = await db.get(
      "SELECT COUNT(*) AS cnt FROM spins WHERE user_id = ? AND game_id = ? AND strftime('%Y-%m-%d', created_at) = ?",
      [userId, gameId, todayStr]
    );

    const played = row ? (parseInt(row.cnt, 10) > 0) : false;
    return res.json({ played });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
