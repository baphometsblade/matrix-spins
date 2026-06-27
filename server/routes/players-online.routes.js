'use strict';

/**
 * Players-Online API
 *
 * GET /api/players-online
 *   Returns a live "players online" figure for the lobby header.
 *
 *   The headline number is the count of currently-connected Socket.IO clients
 *   (the realtime service). On a quiet site that can dip very low, so we blend
 *   it with a second REAL signal — distinct users who spun in the last 15
 *   minutes — and take the larger of the two. Both are real, no mock padding.
 */

const router = require('express').Router();
const db = require('../database');

let realtime;
try { realtime = require('../services/realtime.service'); } catch (_) { realtime = null; }

// Tiny in-process cache so a busy lobby doesn't hammer the DB every poll.
let _cache = { value: null, at: 0 };
const CACHE_MS = 5000;

router.get('/', async (req, res) => {
  try {
    const sockets = realtime && typeof realtime.getClientCount === 'function'
      ? realtime.getClientCount()
      : 0;

    let recentSpinners = 0;
    const now = Date.now();
    if (_cache.value !== null && (now - _cache.at) < CACHE_MS) {
      recentSpinners = _cache.value;
    } else {
      try {
        const row = await db.get(
          "SELECT COUNT(DISTINCT user_id) AS cnt FROM spins WHERE created_at >= datetime('now', '-15 minutes')"
        );
        recentSpinners = row && row.cnt ? Number(row.cnt) : 0;
        _cache = { value: recentSpinners, at: now };
      } catch (_) {
        // spins table unavailable / degraded — fall back to sockets only
        recentSpinners = 0;
      }
    }

    const online = Math.max(sockets, recentSpinners);

    res.set('Cache-Control', 'public, max-age=5');
    res.json({ online, sockets, recentSpinners });
  } catch (err) {
    console.warn('[players-online] error:', err.message);
    // Never 500 a cosmetic counter — degrade gracefully.
    res.json({ online: 0, sockets: 0, recentSpinners: 0 });
  }
});

module.exports = router;
