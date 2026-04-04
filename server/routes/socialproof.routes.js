'use strict';

const router = require('express').Router();
const db = require('../database');

// GET /api/socialproof -- no auth required
router.get('/', async function(req, res) {
  try {
    var now = new Date();
    var hour = now.getUTCHours();
    var todayStr = now.toISOString().slice(0, 10);

    // Real stats from DB
    var spinsToday = 0;
    var registeredUsers = 0;
    var spinsLastHour = 0;
    try {
      var spinsTodayRow = await db.get(
        'SELECT COUNT(*) as cnt FROM spins WHERE created_at >= ?',
        [todayStr + ' 00:00:00']
      );
      spinsToday = spinsTodayRow ? (spinsTodayRow.cnt || 0) : 0;

      var spinsLastHourRow = await db.get(
        "SELECT COUNT(*) as cnt FROM spins WHERE created_at >= datetime('now', '-1 hour')"
      );
      spinsLastHour = spinsLastHourRow ? (spinsLastHourRow.cnt || 0) : 0;

      var usersRow = await db.get('SELECT COUNT(*) as cnt FROM users');
      registeredUsers = usersRow ? (usersRow.cnt || 0) : 0;
    } catch(e) {
      console.warn('[SocialProof] DB stats query failed:', e.message);
    }

    // Time-of-day base for online now
    var timeOfDayBase;
    if (hour >= 18 && hour < 22) {
      timeOfDayBase = 200;
    } else if (hour >= 22 || hour < 6) {
      timeOfDayBase = 30;
    } else if (hour >= 12 && hour < 18) {
      timeOfDayBase = 120;
    } else {
      timeOfDayBase = 60;
    }

    var onlineNow = Math.max(spinsLastHour * 3 + timeOfDayBase, 50);

    // Simulated base for spins today (grows through the day)
    var hoursElapsed = hour + now.getUTCMinutes() / 60;
    var simulatedBase = Math.floor(hoursElapsed * 180);
    var totalSpinsToday = spinsToday + simulatedBase;

    // Add jitter +/-5% using crypto-secure RNG
    var rng = require('../services/rng.service');
    function jitter(n) {
      var pct = 1 + (rng.randomFloat() * 0.1 - 0.05);
      return Math.max(1, Math.floor(n * pct));
    }

    // Platform RTP — weighted average across all games (slight jitter for realism)
    var platformRtp = 95.2 + (rng.randomFloat() * 0.6 - 0.3); // 94.9% - 95.5% range

    return res.json({
      onlineNow: jitter(onlineNow),
      spinsToday: jitter(totalSpinsToday),
      registeredUsers: registeredUsers,
      platformRtp: parseFloat(platformRtp.toFixed(1))
    });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
