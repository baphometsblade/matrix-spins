'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// ── Bootstrap: add loyalty columns if they don't exist yet ──────────────────
db.run('ALTER TABLE users ADD COLUMN loyalty_points INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[loyaltyshop] ALTER failed:', e.message || e); });
db.run('ALTER TABLE users ADD COLUMN loyalty_lifetime INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[loyaltyshop] ALTER failed:', e.message || e); });
db.run('ALTER TABLE users ADD COLUMN last_loyalty_spin_id INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[loyaltyshop] ALTER failed:', e.message || e); });

// Constants
const POINTS_PER_SPIN      = 1;   // points awarded per spin
const POINTS_PER_DOLLAR    = 100; // 100 points = $1.00
const MIN_REDEEM_POINTS    = 100; // minimum redemption block

// ── GET /api/loyaltyshop/status ──────────────────────────────────────────────
// Returns current loyalty points balance for the authenticated user.
router.get('/status', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;

        // ROUND 34: Self-exclusion check (regulatory compliance)
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

    var user = await db.get(
      'SELECT loyalty_points, loyalty_lifetime FROM users WHERE id = ?',
      [userId]
    );
    var points         = user ? (parseInt(user.loyalty_points, 10)  || 0) : 0;
    var lifetimePoints = user ? (parseInt(user.loyalty_lifetime, 10) || 0) : 0;

    // pendingPoints: points earned this session but not yet redeemed (same as current balance)
    return res.json({
      points:         points,
      lifetimePoints: lifetimePoints,
      pendingPoints:  points
    });
  } catch (err) {
    console.warn('[LoyaltyShop] GET /status error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch loyalty status' });
  }
});

// ── POST /api/loyaltyshop/earn ───────────────────────────────────────────────
// Called after each spin to award loyalty points.
// Body: { spinsCount: 1 }  (defaults to 1 if omitted)
router.post('/earn', authenticate, async function(req, res) {
  try {
    var userId     = req.user.id;

    // ROUND 44: Find a recent spin that hasn't already been earned against.
    // Previously: checked for ANY spin in last 30 seconds, so calling /earn
    // 5 times within 30 seconds after 1 spin awarded 5 points instead of 1.
    // Fix: track last_loyalty_spin_id on the user row; only award for spins
    // with id > last_loyalty_spin_id.
    var user = await db.get(
      'SELECT last_loyalty_spin_id FROM users WHERE id = ?',
      [userId]
    );
    var lastEarnedSpinId = (user && user.last_loyalty_spin_id) ? user.last_loyalty_spin_id : 0;

    var recentSpin = await db.get(
      "SELECT id FROM spins WHERE user_id = ? AND id > ? AND created_at >= datetime('now', '-30 seconds') ORDER BY id DESC LIMIT 1",
      [userId, lastEarnedSpinId]
    );
    if (!recentSpin) {
      return res.status(400).json({ error: 'No recent unearned spin detected' });
    }

    // Always award exactly 1 point per verified call (ignore client spinsCount)
    var earned = POINTS_PER_SPIN;

    // Atomic: update points AND last_loyalty_spin_id together with WHERE guard
    var earnResult = await db.run(
      'UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + ?, loyalty_lifetime = COALESCE(loyalty_lifetime, 0) + ?, last_loyalty_spin_id = ? WHERE id = ? AND (last_loyalty_spin_id IS NULL OR last_loyalty_spin_id < ?)',
      [earned, earned, recentSpin.id, userId, recentSpin.id]
    );
    if (!earnResult || earnResult.changes === 0) {
      return res.status(400).json({ error: 'Points already awarded for this spin' });
    }

    var updated = await db.get('SELECT loyalty_points FROM users WHERE id = ?', [userId]);
    var points  = updated ? (parseInt(updated.loyalty_points, 10) || 0) : 0;

    return res.json({ points: points, earned: earned });
  } catch (err) {
    console.warn('[LoyaltyShop] POST /earn error:', err.message);
    return res.status(500).json({ error: 'Failed to award loyalty points' });
  }
});

// ── POST /api/loyaltyshop/redeem ─────────────────────────────────────────────
// Redeem loyalty points for real balance credit.
// Body: { points: <integer> }  — must be a multiple of 100, minimum 100.
// Rate: 100 points = $1.00
router.post('/redeem', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId      = req.user.id;
    var redeemPts   = parseInt(req.body.points, 10);

    // ROUND 44: Daily redemption cap — max $50/day to prevent bonus farming
    var DAILY_REDEEM_CAP = 50;
    try {
      var redeemedToday = await db.get(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'bonus' AND description LIKE 'Loyalty Points Redemption%' AND created_at >= datetime('now', '-1 day')",
        [userId]
      );
      var todayTotal = redeemedToday ? parseFloat(redeemedToday.total) || 0 : 0;
      var proposedAmount = redeemPts ? (redeemPts / POINTS_PER_DOLLAR) : 0;
      if (todayTotal + proposedAmount > DAILY_REDEEM_CAP) {
        return res.status(400).json({ error: 'Daily loyalty redemption limit reached ($' + DAILY_REDEEM_CAP + '/day). Redeemed today: $' + todayTotal.toFixed(2) });
      }
    } catch (capErr) {
      // Fail closed
      if (capErr.message && capErr.message.includes('no such table')) { /* OK */ }
      else {
        console.error('[LoyaltyShop] Redemption cap check failed:', capErr.message);
        return res.status(500).json({ error: 'Security check failed' });
      }
    }

    // ROUND 61: Number.isFinite — isNaN allows Infinity redemptions
    if (!redeemPts || !Number.isFinite(redeemPts)) {
      return res.status(400).json({ error: 'points is required' });
    }
    if (redeemPts < MIN_REDEEM_POINTS) {
      return res.status(400).json({ error: 'Minimum redemption is ' + MIN_REDEEM_POINTS + ' points' });
    }
    if (redeemPts % POINTS_PER_DOLLAR !== 0) {
      return res.status(400).json({ error: 'Points must be a multiple of ' + POINTS_PER_DOLLAR });
    }

    var user = await db.get('SELECT loyalty_points, balance FROM users WHERE id = ?', [userId]);
    var currentPoints = user ? (parseInt(user.loyalty_points, 10) || 0) : 0;

    if (currentPoints < redeemPts) {
      return res.status(400).json({ error: 'Insufficient loyalty points', points: currentPoints });
    }

    var creditAmount = redeemPts / POINTS_PER_DOLLAR; // e.g. 200 pts → $2.00
    creditAmount = Math.round(creditAmount * 100) / 100;

    // Credit to bonus_balance with 15x wagering requirement (not withdrawable balance)
    var wageringMult = 15;
    // Atomic deduct with guard against race conditions (loyalty_points >= redeemPts)
    var deductResult = await db.run(
      'UPDATE users SET loyalty_points = loyalty_points - ?, bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ? AND loyalty_points >= ?',
      [redeemPts, creditAmount, creditAmount * wageringMult, userId, redeemPts]
    );
    if (!deductResult || deductResult.changes === 0) {
      return res.status(400).json({ error: 'Insufficient loyalty points (concurrent request)' });
    }

    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
      [userId, creditAmount, 'Loyalty Points Redemption — ' + redeemPts + ' pts → $' + creditAmount.toFixed(2) + ' (15x wagering)']
    );

    var updated   = await db.get('SELECT balance, loyalty_points FROM users WHERE id = ?', [userId]);
    var newBalance = updated ? parseFloat(updated.balance) : 0;
    var newPoints  = updated ? (parseInt(updated.loyalty_points, 10) || 0) : 0;

    return res.json({
      success:    true,
      newBalance: newBalance,
      newPoints:  newPoints,
      credited:   creditAmount
    });
  } catch (err) {
    console.warn('[LoyaltyShop] POST /redeem error:', err.message);
    return res.status(500).json({ error: 'Redemption failed' });
  }
});

module.exports = router;
