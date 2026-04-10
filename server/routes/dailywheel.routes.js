const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const bonusCap = require('../services/bonus-cap.service');

// Wheel prize segments with weights
const WHEEL_PRIZES = [
  { amount: 0.50, label: 'Small Win', weight: 30 },
  { amount: 1.00, label: 'Lucky Spin', weight: 25 },
  { amount: 2.00, label: 'Nice!', weight: 20 },
  { amount: 5.00, label: 'Great Spin!', weight: 12 },
  { amount: 10.00, label: 'Big Win!', weight: 7 },
  { amount: 25.00, label: 'Jackpot Spin!', weight: 4 },
  { amount: 50.00, label: 'MEGA WIN!', weight: 1.5 },
  { amount: 0.25, label: 'Try Again', weight: 0.5 }
];

// Bootstrap daily_wheel_spins table
async function initializeDailyWheelTable() {
  try {
    var isPg = db.isPg();
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
    await db.run(
      'CREATE TABLE IF NOT EXISTS daily_wheel_spins (' +
      '  id ' + idDef + ',' +
      '  user_id INTEGER NOT NULL,' +
      '  prize_type TEXT NOT NULL,' +
      '  prize_amount REAL NOT NULL,' +
      '  spun_at ' + tsDef +
      ')'
    );
    console.warn('[DailyWheel] Table initialized');
  } catch (err) {
    console.warn('[DailyWheel] Bootstrap error:', err.message);
  }
}

initializeDailyWheelTable();

/**
 * Weighted random selection for wheel prizes
 */
function selectPrize() {
  const totalWeight = WHEEL_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  let random = (crypto.randomBytes(4).readUInt32BE(0) / 0x100000000) * totalWeight;

  for (const prize of WHEEL_PRIZES) {
    random -= prize.weight;
    if (random <= 0) {
      return prize;
    }
  }

  return WHEEL_PRIZES[0]; // Fallback
}

/**
 * Get user's spin streak (consecutive daily spins)
 */
async function calculateStreak(userId) {
  try {
    const rows = await db.all(
      `SELECT DATE(spun_at) as spin_date FROM daily_wheel_spins
       WHERE user_id = ?
       ORDER BY spun_at DESC
       LIMIT 7`,
      [userId]
    );

    if (rows.length === 0) {
      return 0;
    }

    let streak = 1;
    const today = new Date();

    for (let i = 0; i < rows.length - 1; i++) {
      const currentDate = new Date(rows[i].spin_date);
      const nextDate = new Date(rows[i + 1].spin_date);
      const diffDays = Math.floor((currentDate - nextDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  } catch (err) {
    console.warn('Error calculating streak:', err.message);
    return 0;
  }
}

/**
 * Check if user has already spun today
 */
async function hasSpunToday(userId) {
  try {
    const result = await db.get(
      `SELECT id FROM daily_wheel_spins
       WHERE user_id = ?
       AND DATE(spun_at) = DATE('now')`,
      [userId]
    );

    return !!result;
  } catch (err) {
    console.warn('Error checking if user spun today:', err.message);
    return false;
  }
}

/**
 * GET / - Get wheel status for authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already spun today
    const spunToday = await hasSpunToday(userId);

    // Get last spin
    const lastSpin = await db.get(
      `SELECT prize_type, prize_amount, spun_at FROM daily_wheel_spins
       WHERE user_id = ?
       ORDER BY spun_at DESC
       LIMIT 1`,
      [userId]
    );

    // Calculate current streak
    const streak = await calculateStreak(userId);

    let nextSpinAt = null;
    if (spunToday) {
      // Calculate next spin time (24 hours from last spin)
      const lastSpinTime = new Date(lastSpin.spun_at);
      const nextSpinTime = new Date(lastSpinTime.getTime() + 24 * 60 * 60 * 1000);
      nextSpinAt = nextSpinTime.toISOString();
    }

    res.json({
      canSpin: !spunToday,
      nextSpinAt,
      lastPrize: lastSpin ? {
        label: lastSpin.prize_type,
        amount: lastSpin.prize_amount
      } : null,
      streak,
      prizes: WHEEL_PRIZES
    });
  } catch (err) {
    console.warn('Error getting wheel status:', err.message);
    res.status(500).json({ error: 'Failed to get wheel status' });
  }
});

/**
 * POST /spin - Spin the wheel
 */
router.post('/spin', authenticate, bonusGuard, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already spun today
    const spunToday = await hasSpunToday(userId);
    if (spunToday) {
      return res.status(400).json({ error: 'You have already spun today' });
    }

    // Get current streak before spin
    const streak = await calculateStreak(userId);

    // Select prize using weighted random
    const prize = selectPrize();

    // Check if streak bonus applies (every 7th day)
    let finalAmount = prize.amount;
    let bonusApplied = false;
    if (streak > 0 && (streak + 1) % 7 === 0) {
      finalAmount = prize.amount * 2;
      bonusApplied = true;
    }

    // SECURITY: Check global daily bonus cap
    var capCheck = await bonusCap.checkDailyCap(userId);
    if (!capCheck.canReceive) {
      return res.status(400).json({ error: 'Daily bonus limit reached. Try again tomorrow.' });
    }
    // ROUND 48: Cap amount to remaining daily limit
    if (capCheck.remaining < finalAmount) {
      finalAmount = Math.round(capCheck.remaining * 100) / 100;
      if (finalAmount <= 0) {
        return res.status(400).json({ error: 'Daily bonus limit reached' });
      }
    }

    // ── REGULATORY: Self-exclusion blocks all platform activity ──
    // ROUND 30: Fail CLOSED on DB error (was silently continuing)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Your account is self-excluded' });
      }
    } catch (exclErr) {
      console.error('[DailyWheel] Self-exclusion check failed:', exclErr.message);
      return res.status(500).json({ error: 'Security check failed. Please try again.' });
    }

    // SECURITY: Atomic balance update + wagering requirement in transaction
    const WHEEL_WAGERING_MULTIPLIER = 15; // ROUND 30: Raised from 5x to 15x (industry standard, matches all other bonus routes)
    const wageringRequired = Math.round(finalAmount * WHEEL_WAGERING_MULTIPLIER * 100) / 100;

    const description = bonusApplied
      ? `Daily Bonus: ${prize.label} (${prize.amount.toFixed(2)} x2 streak bonus)`
      : `Daily Bonus: ${prize.label}`;

    await db.beginTransaction();
    try {
      // Record spin
      await db.run(
        `INSERT INTO daily_wheel_spins (user_id, prize_type, prize_amount)
         VALUES (?, ?, ?)`,
        [userId, prize.label, finalAmount]
      );

      // ROUND 30: CRITICAL FIX — Credit to bonus_balance, NOT real balance.
      // Was: balance = balance + ? → players could spin wheel and withdraw immediately.
      // Now: bonus_balance with wagering requirement, same as all other bonus routes.
      await db.run(
        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
        [finalAmount, wageringRequired, userId]
      );

      // Record transaction
      await db.run(
        `INSERT INTO transactions (user_id, type, amount, description)
         VALUES (?, ?, ?, ?)`,
        [userId, 'daily_bonus', finalAmount, description]
      );

      await db.commit();
    } catch (txErr) {
      await db.rollback();
      throw txErr;
    }

    // Fetch updated balance for response
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    const newBalance = user ? user.balance : 0;

    // Recalculate streak after spin
    const newStreak = await calculateStreak(userId);

    res.json({
      prize: {
        label: prize.label,
        amount: finalAmount,
        baseAmount: prize.amount,
        bonusApplied
      },
      newBalance,
      streak: newStreak
    });
  } catch (err) {
    console.warn('Error spinning wheel:', err.message);
    res.status(500).json({ error: 'Failed to spin wheel' });
  }
});

/**
 * GET /history - Get last 30 spins for authenticated user
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const spins = await db.all(
      `SELECT id, prize_type, prize_amount, spun_at FROM daily_wheel_spins
       WHERE user_id = ?
       ORDER BY spun_at DESC
       LIMIT 30`,
      [userId]
    );

    res.json({
      spins,
      count: spins.length
    });
  } catch (err) {
    console.warn('Error getting spin history:', err.message);
    res.status(500).json({ error: 'Failed to get spin history' });
  }
});

module.exports = router;
