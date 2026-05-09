'use strict';

/**
 * Bonus Forfeit
 *
 * Allows the user to voluntarily forfeit their bonus_balance and clear
 * outstanding wagering requirements. Used when a player wants to withdraw
 * before completing wagering — they explicitly give up the locked bonus.
 *
 * Forfeiture clears:
 *   - bonus_balance       → 0
 *   - wagering_requirement → 0
 *   - wagering_progress    → 0
 *
 * Audit-logged for compliance.
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// GET /api/bonus-forfeit/quote — show what the user would lose
router.get('/quote', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.get(
      'SELECT bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bonusBalance = parseFloat(user.bonus_balance) || 0;
    const wageringReq = parseFloat(user.wagering_requirement) || 0;
    const wageringProg = parseFloat(user.wagering_progress) || 0;

    res.json({
      bonusBalanceForfeited: Math.round(bonusBalance * 100) / 100,
      wageringRequirementCleared: Math.round(wageringReq * 100) / 100,
      wageringProgressCleared: Math.round(wageringProg * 100) / 100,
      hasActiveBonus: bonusBalance > 0 || wageringReq > 0,
    });
  } catch (err) {
    console.warn('[bonus-forfeit] quote error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bonus-forfeit/confirm — irreversibly forfeit bonus
router.post('/confirm', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { acknowledge } = req.body || {};
    if (acknowledge !== true) {
      return res.status(400).json({ error: 'Set acknowledge=true to confirm forfeiture' });
    }

    const user = await db.get(
      'SELECT bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bonusBalance = parseFloat(user.bonus_balance) || 0;
    const wageringReq = parseFloat(user.wagering_requirement) || 0;
    const wageringProg = parseFloat(user.wagering_progress) || 0;

    if (bonusBalance <= 0 && wageringReq <= 0) {
      return res.status(400).json({ error: 'No active bonus to forfeit' });
    }

    await db.beginTransaction();
    try {
      // Atomic: only succeed if state still matches what we read
      const result = await db.run(
        'UPDATE users SET bonus_balance = 0, wagering_requirement = 0, wagering_progress = 0 WHERE id = ? AND bonus_balance = ? AND wagering_requirement = ?',
        [userId, bonusBalance, wageringReq]
      );
      if (!result || result.changes === 0) {
        await db.rollback();
        return res.status(409).json({ error: 'Bonus state changed mid-request — try again' });
      }
      const u2 = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      const bal = u2 ? parseFloat(u2.balance) || 0 : 0;
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, 'bonus_forfeit', ?, ?, ?, ?)",
        [userId, -bonusBalance, bal, bal, `Voluntary bonus forfeit — $${bonusBalance.toFixed(2)} bonus and $${wageringReq.toFixed(2)} wagering cleared`]
      );
      try {
        await db.run(
          'INSERT INTO audit_log (event_type, user_id, amount, reference, details) VALUES (?, ?, ?, ?, ?)',
          ['bonus_forfeit', userId, bonusBalance, 'bonus_forfeit', JSON.stringify({ bonusBalance, wageringReq, wageringProg })]
        );
      } catch (_) { /* audit best-effort */ }
      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      forfeited: {
        bonusBalance: Math.round(bonusBalance * 100) / 100,
        wageringRequirement: Math.round(wageringReq * 100) / 100,
      },
    });
  } catch (err) {
    console.warn('[bonus-forfeit] confirm error:', err.message);
    res.status(500).json({ error: 'Failed to forfeit bonus' });
  }
});

module.exports = router;
