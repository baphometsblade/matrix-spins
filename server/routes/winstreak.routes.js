'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap columns
db.run('ALTER TABLE users ADD COLUMN win_streak_current INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[winstreak] ALTER failed:', e.message || e); });
db.run('ALTER TABLE users ADD COLUMN win_streak_max INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[winstreak] ALTER failed:', e.message || e); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMultiplierInfo(streak) {
  if (streak >= 5) return { multiplier: 1.5, label: 'UNSTOPPABLE!' };
  if (streak >= 3) return { multiplier: 1.25, label: 'On Fire!' };
  if (streak >= 2) return { multiplier: 1.1, label: 'Hot Streak!' };
  return { multiplier: 1.0, label: '' };
}

// ---------------------------------------------------------------------------
// GET /api/winstreak/status
// Returns current win streak state for the authenticated user.
// ---------------------------------------------------------------------------
router.get('/status', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var row = await db.get(
      'SELECT win_streak_current, win_streak_max FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    var streak = row.win_streak_current || 0;
    var maxStreak = row.win_streak_max || 0;
    var info = getMultiplierInfo(streak);

    return res.json({
      streak: streak,
      multiplier: info.multiplier,
      label: info.label,
      maxStreak: maxStreak
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/winstreak/record
// Body: { won: true|false }
// Increments streak on win, resets to 0 on loss. Tracks all-time max.
// ---------------------------------------------------------------------------
router.post('/record', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var won = req.body && req.body.won === true;

    // Atomic update in SQL — prevents lost-update race where two concurrent
    // requests both read the same streak value and overwrite each other.
    // On win: increment streak. On loss: reset to 0.
    // MAX ensures win_streak_max is always >= current.
    await db.run(
      'UPDATE users SET ' +
        'win_streak_current = CASE WHEN ? THEN COALESCE(win_streak_current, 0) + 1 ELSE 0 END, ' +
        'win_streak_max = MAX(COALESCE(win_streak_max, 0), CASE WHEN ? THEN COALESCE(win_streak_current, 0) + 1 ELSE 0 END) ' +
      'WHERE id = ?',
      [won ? 1 : 0, won ? 1 : 0, userId]
    );

    var row = await db.get(
      'SELECT win_streak_current, win_streak_max FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    var newStreak = row.win_streak_current || 0;
    var info = getMultiplierInfo(newStreak);

    return res.json({
      streak: newStreak,
      multiplier: info.multiplier,
      label: info.label
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/winstreak/reset
// Resets streak to 0 (called on session end or game change).
// ---------------------------------------------------------------------------
router.post('/reset', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;

    await db.run(
      'UPDATE users SET win_streak_current = 0 WHERE id = ?',
      [userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
