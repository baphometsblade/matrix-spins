'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap: create daily_login_rewards table
{
  var _isPg = !!process.env.DATABASE_URL;
  var _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  var _tsType = _isPg ? 'TIMESTAMPTZ' : 'TEXT';
  var _tsDefault = _isPg ? 'NOW()' : "(datetime('now'))";
  db.run(`CREATE TABLE IF NOT EXISTS daily_login_rewards (
    id ${_idDef},
    user_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL,
    reward_type TEXT,
    reward_amount REAL,
    claimed_at ${_tsType} DEFAULT ${_tsDefault}
  )`).catch(function(e) { if (e && !String(e.message||e).match(/already exists/i)) console.warn('[dailylogin] CREATE TABLE failed:', e.message); });
}

// Bootstrap: add login_streak and last_login_reward_date to users table
db.run('ALTER TABLE users ADD COLUMN login_streak INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[dailylogin] ALTER failed:', e.message); });
db.run('ALTER TABLE users ADD COLUMN last_login_reward_date TEXT').catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[dailylogin] ALTER failed:', e.message); });

// Reward schedule for 7-day cycle
var REWARD_SCHEDULE = [
  { day: 1, type: 'credits', amount: 0.50 },
  { day: 2, type: 'credits', amount: 1.00 },
  { day: 3, type: 'gems', amount: 100 },
  { day: 4, type: 'credits', amount: 2.00 },
  { day: 5, type: 'gems', amount: 200 },
  { day: 6, type: 'credits', amount: 5.00 },
  { day: 7, type: 'both', amount: 10.00, gemsAmount: 500 } // Jackpot day: $10 + 500 gems
];

/**
 * Get today's date in UTC as YYYY-MM-DD string
 */
function getTodayUTC() {
  var now = new Date();
  var year = now.getUTCFullYear();
  var month = String(now.getUTCMonth() + 1).padStart(2, '0');
  var day = String(now.getUTCDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/**
 * Check if two date strings (YYYY-MM-DD) are the same day
 */
function isSameDay(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return false;
  return dateStr1.substring(0, 10) === dateStr2.substring(0, 10);
}

/**
 * Check if dateStr1 is the day before dateStr2 (both YYYY-MM-DD)
 */
function isDayBefore(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return false;
  var d1 = new Date(dateStr1 + 'T00:00:00Z');
  var d2 = new Date(dateStr2 + 'T00:00:00Z');
  var diffMs = d2 - d1;
  var diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.abs(diffDays - 1) < 0.1; // Allow small rounding differences
}

/**
 * Get the reward for a given day number (1-7)
 */
function getRewardForDay(dayNum) {
  var reward = REWARD_SCHEDULE.find(function(r) { return r.day === dayNum; });
  return reward || null;
}

// GET /api/daily-login/status
router.get('/', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var today = getTodayUTC();

    var user = await db.get(
      'SELECT login_streak, last_login_reward_date FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    var streak = user.login_streak || 0;
    var lastClaimDate = user.last_login_reward_date || null;

    // Determine next reward day
    var nextRewardDay = (streak % 7) + 1;
    var nextReward = getRewardForDay(nextRewardDay);

    // Check if user can claim today
    var canClaim = !isSameDay(lastClaimDate, today);

    return res.json({
      streak: streak,
      nextReward: nextReward,
      canClaim: canClaim,
      lastClaimDate: lastClaimDate,
      today: today,
      schedule: REWARD_SCHEDULE.map(function(r) {
        return {
          day: r.day,
          type: r.type,
          amount: r.amount,
          gemsAmount: r.gemsAmount || null
        };
      })
    });
  } catch (err) {
    console.warn('[dailylogin] GET /status error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/daily-login/claim
router.post('/claim', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId = req.user.id;

    // ROUND 43: Self-exclusion check (regulatory compliance — fail-closed)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
      }
    } catch (exclErr) {
      if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
      else {
        console.error('[SelfExcl] Check failed:', exclErr.message);
        return res.status(500).json({ error: 'Security check failed' });
      }
    }

    var today = getTodayUTC();

    // Get user and current balance
    var user = await db.get(
      'SELECT login_streak, last_login_reward_date, balance, gems FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already claimed today
    if (isSameDay(user.last_login_reward_date, today)) {
      return res.status(400).json({
        error: 'Daily reward already claimed today',
        nextAvailableAt: today + 'T00:00:00Z'
      });
    }

    var currentStreak = user.login_streak || 0;
    var lastClaimDate = user.last_login_reward_date;
    var newStreak;

    // Determine new streak
    if (!lastClaimDate) {
      // First claim ever
      newStreak = 1;
    } else if (isDayBefore(lastClaimDate, today)) {
      // Claimed yesterday, increment streak (max 7, then reset to 1)
      newStreak = currentStreak + 1;
      if (newStreak > 7) {
        newStreak = 1;
      }
    } else {
      // Claimed >1 day ago or other case, reset to 1
      newStreak = 1;
    }

    // Get reward for this day (1-indexed, so day_number starts at 1)
    var dayNumber = ((newStreak - 1) % 7) + 1;
    var reward = getRewardForDay(dayNumber);

    if (!reward) {
      return res.status(500).json({ error: 'Reward schedule error' });
    }

    // Apply reward — credits go to bonus_balance with 15x wagering (not withdrawable balance)
    var creditAmount = 0;
    var newGems = user.gems || 0;

    if (reward.type === 'credits') {
      creditAmount = reward.amount;
    } else if (reward.type === 'gems') {
      newGems = newGems + reward.amount;
    } else if (reward.type === 'both') {
      creditAmount = reward.amount;
      newGems = newGems + reward.gemsAmount;
    }

    // ROUND 48: Cap credit amount to remaining daily bonus limit
    if (creditAmount > 0 && req.bonusCapRemaining !== undefined && creditAmount > req.bonusCapRemaining) {
      creditAmount = Math.max(0, Math.floor(req.bonusCapRemaining * 100) / 100);
    }

    // Update user record — credits to bonus_balance with wagering requirement
    if (creditAmount > 0) {
      await db.run(
        'UPDATE users SET login_streak = ?, last_login_reward_date = ?, bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, gems = ? WHERE id = ?',
        [newStreak, today, creditAmount, creditAmount * 15, newGems, userId]
      );
    } else {
      await db.run(
        'UPDATE users SET login_streak = ?, last_login_reward_date = ?, gems = ? WHERE id = ?',
        [newStreak, today, newGems, userId]
      );
    }

    // Log transaction for credits
    if (reward.type === 'credits' || reward.type === 'both') {
      var description = 'Daily Login Reward - Day ' + dayNumber;
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'daily_login', ?, ?)",
        [userId, reward.amount, description]
      );
    }

    // Insert into daily_login_rewards for audit
    await db.run(
      'INSERT INTO daily_login_rewards (user_id, day_number, reward_type, reward_amount) VALUES (?, ?, ?, ?)',
      [userId, dayNumber, reward.type, reward.type === 'both' ? reward.amount : reward.amount]
    );

    // ROUND 43: Fetch actual balance after update (was undefined `newBalance`)
    var updatedUser = await db.get('SELECT balance, bonus_balance, gems FROM users WHERE id = ?', [userId]);
    var finalBalance = updatedUser ? (updatedUser.balance || 0) : 0;

    return res.json({
      success: true,
      reward: {
        day: dayNumber,
        type: reward.type,
        amount: reward.amount,
        gemsAmount: reward.gemsAmount || null
      },
      newStreak: newStreak,
      newBalance: Math.round(finalBalance * 100) / 100,
      newGems: updatedUser ? (updatedUser.gems || 0) : newGems,
      claimedAt: today
    });
  } catch (err) {
    console.warn('[dailylogin] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
