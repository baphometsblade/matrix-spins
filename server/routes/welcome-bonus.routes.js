'use strict';

/**
 * Welcome Bonus — 100% match up to $500 on first deposit, 35x wagering.
 *
 * This sits alongside firstdeposit.routes.js (which awards a fixed gem reward).
 * The welcome bonus matches the user's deposit amount up to MAX_MATCH and locks
 * it in bonus_balance with a 35x wagering requirement (per spec).
 *
 * One-time per user, gated by users.welcome_bonus_claimed column.
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

const MATCH_PCT = 1.00;        // 100% match
const MAX_MATCH = 500;         // Capped at $500
const WAGERING_MULT = 35;      // 35x — per user spec

// Bootstrap: add column if missing
db.run('ALTER TABLE users ADD COLUMN welcome_bonus_claimed INTEGER DEFAULT 0').catch(e => {
  if (e && !/already exists|duplicate column/i.test(String(e.message || e))) {
    console.warn('[welcome-bonus] ALTER failed:', e.message);
  }
});

// GET /api/welcome-bonus/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.get(
      'SELECT welcome_bonus_claimed FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const claimed = !!user.welcome_bonus_claimed;
    const firstDeposit = await db.get(
      "SELECT id, amount, created_at FROM transactions WHERE user_id = ? AND type = 'deposit' ORDER BY created_at ASC LIMIT 1",
      [userId]
    );
    const eligible = !claimed && !!firstDeposit;
    const projectedBonus = firstDeposit
      ? Math.min(parseFloat(firstDeposit.amount) * MATCH_PCT, MAX_MATCH)
      : 0;

    res.json({
      eligible,
      claimed,
      matchPercent: MATCH_PCT * 100,
      maxMatch: MAX_MATCH,
      wageringMultiplier: WAGERING_MULT,
      projectedBonus: Math.round(projectedBonus * 100) / 100,
      firstDeposit: firstDeposit
        ? { amount: parseFloat(firstDeposit.amount), at: firstDeposit.created_at }
        : null,
    });
  } catch (err) {
    console.warn('[welcome-bonus] status error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/welcome-bonus/claim
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.get(
      'SELECT welcome_bonus_claimed FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.welcome_bonus_claimed) {
      return res.status(400).json({ error: 'Welcome bonus already claimed' });
    }

    const firstDeposit = await db.get(
      "SELECT id, amount FROM transactions WHERE user_id = ? AND type = 'deposit' ORDER BY created_at ASC LIMIT 1",
      [userId]
    );
    if (!firstDeposit) {
      return res.status(400).json({ error: 'Make a deposit before claiming the welcome bonus' });
    }

    const depositAmount = parseFloat(firstDeposit.amount) || 0;
    const bonusAmount = Math.min(depositAmount * MATCH_PCT, MAX_MATCH);
    if (bonusAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount too small for bonus' });
    }
    const wageringAdd = bonusAmount * WAGERING_MULT;

    await db.beginTransaction();
    try {
      // Atomic: set claimed=1 only if currently 0 to prevent races
      const claim = await db.run(
        'UPDATE users SET welcome_bonus_claimed = 1, bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ? AND (welcome_bonus_claimed IS NULL OR welcome_bonus_claimed = 0)',
        [bonusAmount, wageringAdd, userId]
      );
      if (!claim || claim.changes === 0) {
        await db.rollback();
        return res.status(409).json({ error: 'Already claimed (concurrent)' });
      }
      // transactions schema requires balance_before/balance_after
      const u2 = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      const bal = u2 ? parseFloat(u2.balance) || 0 : 0;
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, 'bonus', ?, ?, ?, ?)",
        [userId, bonusAmount, bal, bal, `Welcome bonus 100% match up to $${MAX_MATCH} (${WAGERING_MULT}x wagering)`]
      );
      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (_) {}
      throw txErr;
    }

    // Real-time push (non-blocking)
    try {
      const rt = require('../services/realtime.service');
      rt.broadcastBonusGranted(userId, {
        type: 'welcome',
        amount: bonusAmount,
        wageringRequired: wageringAdd,
      });
    } catch (_) {}

    const updated = await db.get('SELECT bonus_balance, wagering_requirement FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      bonusAmount: Math.round(bonusAmount * 100) / 100,
      wageringRequired: Math.round(wageringAdd * 100) / 100,
      bonusBalance: updated ? parseFloat(updated.bonus_balance) || 0 : 0,
      wageringRequirement: updated ? parseFloat(updated.wagering_requirement) || 0 : 0,
    });
  } catch (err) {
    console.warn('[welcome-bonus] claim error:', err.message);
    res.status(500).json({ error: 'Failed to claim welcome bonus' });
  }
});

module.exports = router;
