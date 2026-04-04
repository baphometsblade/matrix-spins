'use strict';

/**
 * Dynamic Session RTP Manager
 *
 * Adjusts house edge per-player based on session behavior to maximize revenue
 * while keeping players engaged. RTP adjustments are logged and invisible to players.
 *
 * Endpoints:
 *   GET  /profile           (auth) — get current user's RTP profile for their session
 *   POST /adjust            (auth) — internal: called after each spin to recalculate RTP
 *   GET  /admin/overview    (admin) — overview of all active RTP profiles
 *   GET  /admin/player/:userId (admin) — detailed RTP history for specific player
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

var _initDone = false;
var _initPromise = null;

/**
 * Lazy initialization of session_rtp_profiles table.
 * Tables are NOT created at require() time — only on first use via _ensureProfilesTable().
 */
async function _ensureProfilesTable() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async function() {
    try {
      const sql = `
        CREATE TABLE IF NOT EXISTS session_rtp_profiles (
          id ${idDef},
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          current_rtp REAL NOT NULL DEFAULT 0.88,
          base_rtp REAL NOT NULL DEFAULT 0.88,
          adjustments_log TEXT,
          spin_count INTEGER NOT NULL DEFAULT 0,
          net_result REAL NOT NULL DEFAULT 0,
          last_adjusted_at ${tsDef},
          created_at ${tsDef}
        )
      `;
      await db.run(sql);
      _initDone = true;
    } catch (err) {
      console.warn('[DynamicRTP] Failed to ensure session_rtp_profiles table:', err.message);
      _initDone = true;
    }
  })();

  return _initPromise;
}

/**
 * ── GET /profile ──────────────────────────────────────────────────────────
 * Get the current user's RTP profile for their active session.
 *
 * Query parameters (optional):
 *   sessionId: string — If provided, fetch RTP for that specific session.
 *                       If not provided, fetch the most recent profile.
 *
 * Response:
 *   {
 *     id: number,
 *     userId: number,
 *     sessionId: string,
 *     currentRtp: number,        (0.78 - 0.96)
 *     baseRtp: number,           (0.88)
 *     spinCount: number,
 *     netResult: number,
 *     lastAdjustedAt: string,
 *     createdAt: string
 *   }
 *
 * Notes:
 *   - RTP is not displayed to users; this endpoint is for internal use only.
 *   - If no profile exists for the user, one is created with default RTP 0.88.
 */
router.get('/profile', authenticate, async function(req, res) {
  try {
    await _ensureProfilesTable();

    const userId = req.user.id;
    const sessionId = req.query.sessionId ? String(req.query.sessionId).trim() : null;

    // Try to fetch existing profile
    let profile;
    if (sessionId) {
      profile = await db.get(
        'SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? AND session_id = ? LIMIT 1',
        [userId, sessionId]
      );
    } else {
      // Most recent profile for this user
      profile = await db.get(
        'SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
    }

    // If profile doesn't exist, create one with default RTP
    if (!profile) {
      const newSessionId = sessionId || 'session_' + Date.now() + '_' + require('crypto').randomBytes(6).toString('hex');
      await db.run(
        `INSERT INTO session_rtp_profiles
         (user_id, session_id, current_rtp, base_rtp, adjustments_log, spin_count, net_result)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, newSessionId, 0.88, 0.88, JSON.stringify([]), 0, 0]
      );
      profile = await db.get(
        'SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? AND session_id = ? LIMIT 1',
        [userId, newSessionId]
      );
    }

    return res.json({
      id: profile.id,
      userId: profile.user_id,
      sessionId: profile.session_id,
      currentRtp: parseFloat(profile.current_rtp),
      baseRtp: parseFloat(profile.base_rtp),
      spinCount: parseInt(profile.spin_count, 10),
      netResult: parseFloat(profile.net_result),
      lastAdjustedAt: profile.last_adjusted_at,
      createdAt: profile.created_at
    });
  } catch (err) {
    console.warn('[DynamicRTP] GET /profile error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch RTP profile' });
  }
});

/**
 * ── POST /adjust ──────────────────────────────────────────────────────────
 * Internal endpoint called after each spin to recalculate and update RTP.
 *
 * Request body:
 *   {
 *     sessionId: string,        (required) Session ID
 *     spinData: {               (required)
 *       won: boolean,           — Did the spin result in a win?
 *       amount: number,         — Winnings (0 if lost)
 *       bet: number,            — Bet amount for this spin
 *       balance: number,        — Current balance after spin
 *       consecutiveLosses: number, — Count of consecutive losses
 *       sessionWagered: number, — Total wagered in this session
 *       sessionElapsedMs: number, — Time elapsed in session (ms)
 *       betHistory: number[]    — Last N bets (array of bet amounts)
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     newRtp: number,           (adjusted RTP after this spin)
 *     adjustmentReason: string  (why RTP was adjusted)
 *   }
 *
 * Notes:
 *   - This is a fire-and-forget endpoint (from the client).
 *   - RTP is clamped between 0.78 and 0.96.
 *   - All adjustments are logged in adjustments_log JSON array.
 */
router.post('/adjust', authenticate, async function(req, res) {
  try {
    await _ensureProfilesTable();

    const userId = req.user.id;
    const sessionId = String(req.body.sessionId || '').trim();
    const spinData = req.body.spinData || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    // SECURITY: Validate spinData against actual spin records in the database.
    // Prevents client-side manipulation of RTP profiles by fabricating spin outcomes.
    if (spinData.bet || spinData.amount) {
      try {
        var lastSpin = await db.get(
          'SELECT bet_amount, win_amount FROM spins WHERE user_id = ? ORDER BY id DESC LIMIT 1',
          [userId]
        );
        if (lastSpin) {
          var reportedBet = parseFloat(spinData.bet) || 0;
          var reportedAmount = parseFloat(spinData.amount) || 0;
          var actualBet = parseFloat(lastSpin.bet_amount) || 0;
          var actualWin = parseFloat(lastSpin.win_amount) || 0;
          // Allow 1% tolerance for rounding
          if (reportedBet > 0 && Math.abs(reportedBet - actualBet) > actualBet * 0.01 + 0.01) {
            console.warn('[DynamicRTP] Rejected mismatched bet data from user ' + userId + ': reported=' + reportedBet + ' actual=' + actualBet);
            return res.status(200).json({ success: true, rejected: true });
          }
          if (Math.abs(reportedAmount - actualWin) > actualWin * 0.01 + 0.01) {
            console.warn('[DynamicRTP] Rejected mismatched win data from user ' + userId + ': reported=' + reportedAmount + ' actual=' + actualWin);
            return res.status(200).json({ success: true, rejected: true });
          }
        }
      } catch (validationErr) {
        // ROUND 31: Fail closed on validation errors — was continuing past failed checks.
        // If we can't validate, reject the RTP adjustment to prevent poisoning.
        console.warn('[DynamicRTP] Spin validation error:', validationErr.message);
        return res.status(200).json({ success: true, rejected: true });
      }
    }

    // Fetch current profile
    let profile = await db.get(
      'SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? AND session_id = ?',
      [userId, sessionId]
    );

    // Create profile if it doesn't exist
    if (!profile) {
      await db.run(
        `INSERT INTO session_rtp_profiles
         (user_id, session_id, current_rtp, base_rtp, adjustments_log, spin_count, net_result)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, sessionId, 0.88, 0.88, JSON.stringify([]), 0, 0]
      );
      profile = await db.get(
        'SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? AND session_id = ?',
        [userId, sessionId]
      );
    }

    // Calculate new RTP based on session behavior
    const currentRtp = parseFloat(profile.current_rtp);
    const spinCount = parseInt(profile.spin_count, 10);
    const netResult = parseFloat(profile.net_result);

    const won = spinData.won === true;
    // ROUND 56: Clamp all user-supplied values — reject Infinity/NaN with fallback to 0
    const amount = Number.isFinite(parseFloat(spinData.amount)) ? parseFloat(spinData.amount) : 0;
    const bet = Number.isFinite(parseFloat(spinData.bet)) ? parseFloat(spinData.bet) : 0;
    const balance = Number.isFinite(parseFloat(spinData.balance)) ? parseFloat(spinData.balance) : 0;
    const consecutiveLosses = Number.isFinite(parseInt(spinData.consecutiveLosses, 10)) ? parseInt(spinData.consecutiveLosses, 10) : 0;
    const sessionWagered = Number.isFinite(parseFloat(spinData.sessionWagered)) ? parseFloat(spinData.sessionWagered) : 0;
    const sessionElapsedMs = Number.isFinite(parseInt(spinData.sessionElapsedMs, 10)) ? parseInt(spinData.sessionElapsedMs, 10) : 0;
    const betHistory = Array.isArray(spinData.betHistory) ? spinData.betHistory : [];

    // Calculate new RTP and adjustment reason
    const { newRtp, reason, adjustmentValue } = _calculateRtp(
      spinCount,
      consecutiveLosses,
      sessionWagered,
      sessionElapsedMs,
      balance,
      bet,
      amount,
      won,
      betHistory
    );

    // Update profile
    const updatedNetResult = netResult + (won ? amount : -bet);
    const adjustmentsLog = profile.adjustments_log ? JSON.parse(profile.adjustments_log) : [];
    adjustmentsLog.push({
      spinNum: spinCount + 1,
      timestamp: new Date().toISOString(),
      fromRtp: parseFloat(currentRtp.toFixed(4)),
      toRtp: parseFloat(newRtp.toFixed(4)),
      delta: parseFloat((newRtp - currentRtp).toFixed(4)),
      reason: reason,
      spinData: { won, bet, amount }
    });

    await db.run(
      `UPDATE session_rtp_profiles
       SET current_rtp = ?, spin_count = ?, net_result = ?, adjustments_log = ?, last_adjusted_at = ${isPg ? 'NOW()' : "datetime('now')"}
       WHERE id = ?`,
      [newRtp, spinCount + 1, updatedNetResult, JSON.stringify(adjustmentsLog), profile.id]
    );

    return res.json({
      success: true,
      newRtp: parseFloat(newRtp.toFixed(4)),
      adjustmentReason: reason
    });
  } catch (err) {
    console.warn('[DynamicRTP] POST /adjust error:', err.message);
    // Fire-and-forget semantics: return 200 but flag the error so client knows
    return res.status(200).json({ success: false, error: 'profile_update_failed' });
  }
});

/**
 * ── GET /admin/overview ────────────────────────────────────────────────────
 * Admin-only endpoint: Overview of all active RTP profiles.
 *
 * Response:
 *   {
 *     success: true,
 *     totalPlayers: number,
 *     activeProfiles: number,
 *     averageRtp: number,
 *     rtpDistribution: {
 *       loose: number,    (0.92+)
 *       normal: number,   (0.84-0.91)
 *       tight: number     (<0.84)
 *     },
 *     totalSessionWagered: number,
 *     estimatedHouseTake: number   (wagered * (1 - avgRtp))
 *   }
 */
router.get('/admin/overview', authenticate, requireAdmin, async function(req, res) {
  try {
    await _ensureProfilesTable();

    // Get overview stats
    const stats = await db.get(`
      SELECT
        COUNT(DISTINCT user_id) as total_players,
        COUNT(*) as active_profiles,
        AVG(current_rtp) as avg_rtp,
        SUM(CASE WHEN current_rtp >= 0.92 THEN 1 ELSE 0 END) as loose_count,
        SUM(CASE WHEN current_rtp >= 0.84 AND current_rtp < 0.92 THEN 1 ELSE 0 END) as normal_count,
        SUM(CASE WHEN current_rtp < 0.84 THEN 1 ELSE 0 END) as tight_count,
        SUM(ABS(net_result)) as total_session_wagered
      FROM session_rtp_profiles
      WHERE created_at > datetime('now', '-7 days')
    `, []);

    const totalPlayers = parseInt(stats.total_players, 10) || 0;
    const activeProfiles = parseInt(stats.active_profiles, 10) || 0;
    const avgRtp = parseFloat(stats.avg_rtp) || 0.88;
    const totalWagered = parseFloat(stats.total_session_wagered) || 0;

    const rtpDistribution = {
      loose: parseInt(stats.loose_count, 10) || 0,
      normal: parseInt(stats.normal_count, 10) || 0,
      tight: parseInt(stats.tight_count, 10) || 0
    };

    const estimatedHouseTake = totalWagered * (1 - avgRtp);

    return res.json({
      success: true,
      totalPlayers: totalPlayers,
      activeProfiles: activeProfiles,
      averageRtp: parseFloat(avgRtp.toFixed(4)),
      rtpDistribution: rtpDistribution,
      totalSessionWagered: parseFloat(totalWagered.toFixed(2)),
      estimatedHouseTake: parseFloat(estimatedHouseTake.toFixed(2))
    });
  } catch (err) {
    console.warn('[DynamicRTP] GET /admin/overview error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch RTP overview' });
  }
});

/**
 * ── GET /admin/player/:userId ─────────────────────────────────────────────
 * Admin-only endpoint: Detailed RTP history for a specific player.
 *
 * Path parameters:
 *   userId: number — User ID to fetch history for
 *
 * Response:
 *   {
 *     success: true,
 *     userId: number,
 *     profiles: [
 *       {
 *         sessionId: string,
 *         currentRtp: number,
 *         spinCount: number,
 *         netResult: number,
 *         adjustmentsLog: array,  (with reason, delta, timestamp per adjustment)
 *         createdAt: string
 *       },
 *       ...
 *     ]
 *   }
 */
router.get('/admin/player/:userId', authenticate, requireAdmin, async function(req, res) {
  try {
    await _ensureProfilesTable();

    const userId = parseInt(req.params.userId, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    // Fetch all profiles for this user
    const profiles = await db.all(
      `SELECT id, user_id, session_id, current_rtp, base_rtp, spin_count, net_result, adjustments_log, last_adjusted_at, created_at FROM session_rtp_profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    const result = {
      success: true,
      userId: userId,
      profiles: profiles.map(function(p) {
        return {
          sessionId: p.session_id,
          currentRtp: parseFloat(p.current_rtp),
          spinCount: parseInt(p.spin_count, 10),
          netResult: parseFloat(p.net_result),
          adjustmentsLog: p.adjustments_log ? JSON.parse(p.adjustments_log) : [],
          createdAt: p.created_at
        };
      })
    };

    return res.json(result);
  } catch (err) {
    console.warn('[DynamicRTP] GET /admin/player/:userId error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch player RTP history' });
  }
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * INTERNAL: RTP ADJUSTMENT LOGIC
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The revenue engine. Adjusts RTP based on:
 *   1. New player hook (first 50 spins): 0.94 RTP — let them win early
 *   2. Big win clawback: 0.82 RTP for 30 spins after >20x bet win
 *   3. Losing streak prevention: 0.92 RTP on 10+ consecutive losses
 *   4. Whale squeeze: 0.86 RTP when session wagered >$500
 *   5. Win-chasing pattern: 0.84 RTP when increasing bets after losses
 *   6. Time decay: After 30 min, gradually tighten by 0.005 per 10 min
 *   7. Balance near zero: 0.95 RTP for 5 spins when balance <10% of deposit
 *
 * RTP is clamped between 0.78 and 0.96 to ensure viability.
 */
function _calculateRtp(
  spinCount,
  consecutiveLosses,
  sessionWagered,
  sessionElapsedMs,
  balance,
  bet,
  amount,
  won,
  betHistory
) {
  var baseRtp = 0.88;
  var newRtp = baseRtp;
  var reason = 'baseline';

  // 1. New player hook: first 50 spins get boosted RTP
  if (spinCount < 50) {
    newRtp = 0.94;
    reason = 'new_player_hook';
    return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: 0.06 };
  }

  // 2. Big win clawback: after big win (>20x bet), tighten for 30 spins
  if (won && amount > bet * 20) {
    newRtp = 0.82;
    reason = 'big_win_clawback';
    return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: -0.06 };
  }

  // 3. Losing streak prevention: 10+ consecutive losses
  if (consecutiveLosses >= 10) {
    newRtp = 0.92;
    reason = 'losing_streak_prevention';
    return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: 0.04 };
  }

  // 4. Whale detection: session wagered >$500
  if (sessionWagered > 500) {
    newRtp = 0.86;
    reason = 'whale_squeeze';
    return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: -0.02 };
  }

  // 5. Win-chasing pattern: increasing bets after losses
  if (betHistory.length >= 2) {
    var lastBet = betHistory[betHistory.length - 1];
    var prevBet = betHistory[betHistory.length - 2];
    if (!won && lastBet > prevBet) {
      // Player is chasing losses with larger bets (emotional commitment)
      newRtp = 0.84;
      reason = 'win_chasing_pattern';
      return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: -0.04 };
    }
  }

  // 6. Time decay: after 30 min, gradually tighten
  var thirtyMinMs = 30 * 60 * 1000;
  if (sessionElapsedMs > thirtyMinMs) {
    var minutesOver = Math.floor((sessionElapsedMs - thirtyMinMs) / (10 * 60 * 1000));
    var timeDecayAmount = minutesOver * 0.005;
    newRtp = baseRtp - timeDecayAmount;
    reason = 'time_decay_fatigue';
  }

  // 7. Balance near zero: if balance <10% of initial (approx), boost to keep playing
  // Assuming initial deposit was roughly 10x current spin bet (heuristic)
  if (balance > 0 && balance < bet * 10) {
    newRtp = 0.95;
    reason = 'balance_recovery_boost';
    return { newRtp: _clampRtp(newRtp), reason: reason, adjustmentValue: 0.07 };
  }

  return {
    newRtp: _clampRtp(newRtp),
    reason: reason,
    adjustmentValue: newRtp - baseRtp
  };
}

/**
 * Clamp RTP between 0.78 and 0.96.
 */
function _clampRtp(rtp) {
  var MIN_RTP = 0.78;
  var MAX_RTP = 0.96;
  if (rtp < MIN_RTP) return MIN_RTP;
  if (rtp > MAX_RTP) return MAX_RTP;
  return rtp;
}

module.exports = router;
