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
        "SELECT COUNT(DISTINCT user_id) as cnt FROM spin_results WHERE created_at > datetime('now', '-1 hour')"
      );
      spinsLastHour = spinsLastHourRow ? (spinsLastHourRow.cnt || 0) : 0;

      var usersRow = await db.get('SELECT COUNT(*) as cnt FROM users');
      registeredUsers = usersRow ? (usersRow.cnt || 0) : 0;
    } catch(e) {
      console.warn('[SocialProof] DB stats query failed:', e.message);
    }

    // Real online estimate: recent spinners are likely still playing
    var onlineNow = Math.max(spinsLastHour, 0);

    // Real platform RTP from config
    var config = require('../config');
    var platformRtp = (config.TARGET_RTP || 0.88) * 100;

    return res.json({
      onlineNow: onlineNow,
      spinsToday: spinsToday,
      registeredUsers: registeredUsers,
      platformRtp: parseFloat(platformRtp.toFixed(1))
    });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
