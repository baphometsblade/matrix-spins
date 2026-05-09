'use strict';

/**
 * Bonus History
 *
 * Aggregates the user's bonus-related activity across the bonus engine:
 *   - All bonus / promo / cashback / jackpot transactions
 *   - Current bonus_balance, wagering progress, and locked status
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// GET /api/bonus-history/summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await db.get(
      'SELECT balance, bonus_balance, wagering_requirement, wagering_progress, welcome_bonus_claimed, first_deposit_bonus_claimed FROM users WHERE id = ?',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bonusBalance       = parseFloat(user.bonus_balance) || 0;
    const wageringRequirement = parseFloat(user.wagering_requirement) || 0;
    const wageringProgress    = parseFloat(user.wagering_progress) || 0;
    const wageringRemaining   = Math.max(0, wageringRequirement - wageringProgress);
    const wageringPct = wageringRequirement > 0
      ? Math.min(100, (wageringProgress / wageringRequirement) * 100)
      : 100;

    res.json({
      withdrawable:    parseFloat(user.balance) || 0,
      bonusBalance:    Math.round(bonusBalance * 100) / 100,
      wageringRequirement: Math.round(wageringRequirement * 100) / 100,
      wageringProgress:    Math.round(wageringProgress * 100) / 100,
      wageringRemaining:   Math.round(wageringRemaining * 100) / 100,
      wageringPct:         Math.round(wageringPct * 100) / 100,
      bonusLocked:         wageringRemaining > 0 && bonusBalance > 0,
      welcomeBonusClaimed:      !!user.welcome_bonus_claimed,
      firstDepositBonusClaimed: !!user.first_deposit_bonus_claimed,
    });
  } catch (err) {
    console.warn('[bonus-history] summary error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bonus-history/list
router.get('/list', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    // Detect whether transactions has a `description` column (some deployments do)
    let hasDesc = false;
    try {
      if (db.isPg()) {
        const c = await db.get(
          "SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name='description'"
        );
        hasDesc = !!c;
      } else {
        const cols = await db.all('PRAGMA table_info(transactions)');
        hasDesc = (cols || []).some(c => c.name === 'description');
      }
    } catch (_) { hasDesc = false; }

    const selectCols = hasDesc
      ? 'id, type, amount, description, reference, created_at'
      : 'id, type, amount, reference, created_at';
    const rows = await db.all(
      `SELECT ${selectCols}
       FROM transactions
       WHERE user_id = ?
         AND type IN ('bonus', 'promo', 'cashback', 'jackpot', 'freespin', 'reward', 'streak', 'daily-login', 'bonus_forfeit')
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    res.json({
      history: rows.map(r => ({
        id: r.id,
        type: r.type,
        amount: parseFloat(r.amount) || 0,
        description: (hasDesc ? r.description : null) || r.reference || '',
        at: r.created_at,
      })),
    });
  } catch (err) {
    console.warn('[bonus-history] list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
