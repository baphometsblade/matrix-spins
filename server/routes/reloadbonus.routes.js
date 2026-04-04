'use strict';

const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

const router = express.Router();

const MATCH_PERCENT = 0.25;
const MAX_BONUS = 2.50;
const MIN_DEPOSIT = 5.00;
const COOLDOWN_DAYS = 7;

// ROUND 28: Removed custom authenticate — it skipped blacklist, ban, and
// password_changed_at checks. Banned users could claim reload bonuses.
// Now uses centralized authenticate middleware.

// Lazy schema migration — adds columns if they do not exist yet
async function ensureSchema() {
  try {
    await db.run(`ALTER TABLE users ADD COLUMN reload_bonus_claimed_at TEXT`);
  } catch (e) {
    // Column already exists — ignore
  }
  try {
    await db.run(`ALTER TABLE users ADD COLUMN reload_bonus_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists — ignore
  }
}

let schemaReady = false;
async function withSchema(req, res, next) {
  if (!schemaReady) {
    await ensureSchema();
    schemaReady = true;
  }
  next();
}

// GET /api/reloadbonus/status
router.get('/status', authenticate, withSchema, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const user = await db.get(
      `SELECT balance, reload_bonus_claimed_at, reload_bonus_count FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const claimedAt = user.reload_bonus_claimed_at || null;
    let available = false;
    let nextAvailableAt = null;

    if (!claimedAt) {
      available = true;
    } else {
      // Check if 7 days have elapsed since last claim
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const now = new Date();
      if (now >= nextDate) {
        available = true;
      } else {
        available = false;
        nextAvailableAt = nextDate.toISOString();
      }
    }

    return res.json({
      eligible: available,
      available,
      balance: parseFloat(user.balance) || 0,
      matchPercent: Math.round(MATCH_PERCENT * 100),
      maxBonus: MAX_BONUS,
      minDeposit: MIN_DEPOSIT,
      claimedAt,
      claimsCount: user.reload_bonus_count || 0,
      nextAvailableAt
    });
  } catch (err) {
    console.warn('[reloadbonus] GET /status error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reloadbonus/claim
router.post('/claim', authenticate, bonusGuard, withSchema, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // SECURITY: Self-exclusion check
    // ROUND 30: Fail CLOSED on DB error (was silently continuing)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
    } catch (exclErr) {
      console.error('[ReloadBonus] Self-exclusion check failed:', exclErr.message);
      return res.status(500).json({ error: 'Security check failed. Please try again.' });
    }

    // SECURITY: Daily bonus cap check
    var bonusCap = require('../services/bonus-cap.service');
    var capCheck = await bonusCap.checkDailyCap(userId);
    if (!capCheck.canReceive) return res.status(400).json({ error: 'Daily bonus limit reached.' });

    const user = await db.get(
      `SELECT balance, reload_bonus_claimed_at, reload_bonus_count FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // SECURITY: Validate deposit actually occurred in the database.
    // BEFORE: Accepted client-supplied depositAmount — users could claim bonus without depositing.
    // AFTER: Only uses verified deposit records from the transactions/deposits table.
    var lastDeposit = await db.get(
      "SELECT amount, created_at FROM deposits WHERE user_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!lastDeposit || !lastDeposit.amount || lastDeposit.amount < MIN_DEPOSIT) {
      return res.status(400).json({
        error: 'A completed deposit of at least $' + MIN_DEPOSIT.toFixed(2) + ' is required to claim reload bonus.'
      });
    }
    const deposit = lastDeposit.amount;

    // Check availability
    const claimedAt = user.reload_bonus_claimed_at || null;
    let available = false;

    if (!claimedAt) {
      available = true;
    } else {
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const now = new Date();
      available = now >= nextDate;

      // Also verify deposit is newer than last claim (prevents re-using old deposits)
      if (available && lastDeposit.created_at <= claimedAt) {
        return res.status(400).json({ error: 'A new deposit is required since your last reload bonus claim.' });
      }
    }

    if (!available) {
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      return res.status(400).json({
        error: 'Reload bonus not available yet',
        nextAvailableAt: nextDate.toISOString()
      });
    }

    // Calculate bonus (capped by daily bonus cap)
    var rawBonus = parseFloat(Math.min(deposit * MATCH_PERCENT, MAX_BONUS).toFixed(2));
    const bonus = await bonusCap.capBonusAmount(userId, rawBonus);
    const WAGERING_MULTIPLIER = 15; // Must wager 15x bonus before withdrawal
    const wagerReq = parseFloat((bonus * WAGERING_MULTIPLIER).toFixed(2));

    // Update user: credit bonus to bonus_balance (NOT real balance) with wagering requirement
    await db.run(
      `UPDATE users
       SET bonus_balance = COALESCE(bonus_balance, 0) + ?,
           wagering_requirement = COALESCE(wagering_requirement, 0) + ?,
           reload_bonus_claimed_at = datetime('now'),
           reload_bonus_count = COALESCE(reload_bonus_count, 0) + 1
       WHERE id = ?`,
      [bonus, wagerReq, userId]
    );

    // Insert transaction record
    await db.run(
      `INSERT INTO transactions (user_id, type, amount, description, created_at)
       VALUES (?, 'bonus', ?, 'Weekly reload bonus (25% match) → bonus balance', datetime('now'))`,
      [userId, bonus]
    );

    const updatedUser = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [userId]);

    return res.json({
      success: true,
      bonus,
      newBalance: parseFloat(updatedUser.balance) || 0,
      bonusBalance: parseFloat(updatedUser.bonus_balance) || 0,
      wageringRequired: wagerReq,
      message: `Reload bonus of $${bonus.toFixed(2)} added to bonus balance! Wager ${WAGERING_MULTIPLIER}x to unlock.`
    });
  } catch (err) {
    console.warn('[reloadbonus] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
