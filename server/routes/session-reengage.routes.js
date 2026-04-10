'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard'); // ROUND 49
const db = require('../database');

// Bootstrap: create session_reengage_claims table
const isPg = db.isPg();
const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const tsType = isPg ? 'TIMESTAMPTZ' : 'TEXT';
const tsDefault = isPg ? 'NOW()' : "datetime('now')";

db.run(
  `CREATE TABLE IF NOT EXISTS session_reengage_claims (
    id ${idDef},
    user_id INTEGER NOT NULL,
    bonus_amount REAL NOT NULL,
    claimed_at ${tsType} DEFAULT ${tsDefault},
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`
).catch(function(e) { if (e && !String(e.message||e).match(/already exists/i)) console.warn('[session-reengage] CREATE TABLE failed:', e.message); });

// Constant: valid bonus amount range
const MIN_BONUS = 5;
const MAX_BONUS = 25;
const COOLDOWN_MINUTES = 30;

// POST /api/session-reengage/claim
router.post('/claim', authenticate, bonusGuard, async function(req, res) { // ROUND 49: Added bonusGuard
  try {
    var userId = req.user.id;

    // ROUND 38: Self-exclusion check (regulatory compliance)
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

    var body = req.body || {};
    var amount = parseFloat(body.amount) || 0;

    // Validate amount is in range
    if (amount < MIN_BONUS || amount > MAX_BONUS) {
      return res.status(400).json({
        error: 'Bonus amount must be between $' + MIN_BONUS + ' and $' + MAX_BONUS,
        minBonus: MIN_BONUS,
        maxBonus: MAX_BONUS
      });
    }

    // ROUND 42: Daily cap on session re-engagement bonuses ($100/day, max 3 claims)
    // Previously: only 30-min cooldown, allowing $1,200/day in bonus farming.
    var dailyClaims = await db.get(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(bonus_amount), 0) as total FROM session_reengage_claims WHERE user_id = ? AND claimed_at >= datetime('now', '-1 day')",
      [userId]
    );
    if (dailyClaims && (dailyClaims.cnt >= 3 || dailyClaims.total >= 100)) {
      return res.status(400).json({
        error: 'Daily session re-engagement limit reached (max 3 claims or $100/day)',
        dailyClaims: dailyClaims.cnt,
        dailyTotal: dailyClaims.total
      });
    }

    // Check if user has claimed in the last 30 minutes
    var lastClaim = await db.get(
      'SELECT claimed_at FROM session_reengage_claims WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1',
      [userId]
    );

    if (lastClaim) {
      var lastClaimTime = new Date(lastClaim.claimed_at).getTime();
      var timeSinceLastClaim = Date.now() - lastClaimTime;
      var cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

      if (timeSinceLastClaim < cooldownMs) {
        var remainingMs = cooldownMs - timeSinceLastClaim;
        var remainingMinutes = Math.ceil(remainingMs / 60000);
        return res.status(400).json({
          error: 'You can claim re-engagement bonus again in ' + remainingMinutes + ' minutes',
          nextAvailableAt: new Date(lastClaimTime + cooldownMs).toISOString(),
          remainingSeconds: Math.ceil(remainingMs / 1000)
        });
      }
    }

    // ROUND 29: Insert claim FIRST as atomic lock — if two requests race,
    // only one can insert within the cooldown window. Then credit bonus.
    // Previously: credited bonus first, then recorded claim. Two concurrent
    // requests could both pass the cooldown check and both receive bonus.
    await db.run(
      'INSERT INTO session_reengage_claims (user_id, bonus_amount) VALUES (?, ?)',
      [userId, amount]
    );

    // Credit amount to bonus_balance with 15x wagering requirement
    await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
      [amount, amount * 15, userId]
    );

    // Record transaction
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'session_bonus', ?, 'Session re-engagement bonus')",
      [userId, amount]
    );

    // Fetch updated balance
    var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var newBalance = updated ? parseFloat(updated.balance) || 0 : 0;

    return res.json({
      success: true,
      amount: parseFloat(amount.toFixed(2)),
      newBalance: parseFloat(newBalance.toFixed(2))
    });
  } catch (err) {
    console.warn('[session-reengage] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/session-reengage/stats
router.get('/stats', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;

    // Count claims today
    var todayStats = await db.get(
      `SELECT
        COUNT(*) as claim_count,
        COALESCE(SUM(bonus_amount), 0) as total_bonus
      FROM session_reengage_claims
      WHERE user_id = ? AND DATE(claimed_at) = DATE(?)`,
      isPg
        ? [userId, new Date().toISOString()]
        : [userId, "datetime('now')"]
    );

    var claimCount = todayStats ? (todayStats.claim_count || 0) : 0;
    var totalBonus = todayStats ? parseFloat(todayStats.total_bonus || 0) : 0;

    return res.json({
      claimsToday: claimCount,
      totalBonusToday: parseFloat(totalBonus.toFixed(2))
    });
  } catch (err) {
    console.warn('[session-reengage] GET /stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
