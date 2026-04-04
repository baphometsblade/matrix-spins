'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

// Bootstrap table creation at module load
(async () => {
  try {
    var isPg = db.isPg ? db.isPg() : false;
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

    var createTableSQL = `
      CREATE TABLE IF NOT EXISTS loss_insurance_policies (
        id ${idDef},
        user_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        cost INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        refund_pct INTEGER NOT NULL,
        purchased_at ${tsDef},
        expires_at TIMESTAMP,
        claimed INTEGER DEFAULT 0,
        claim_amount INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `;

    await db.run(createTableSQL);
  } catch (err) {
    console.warn('Loss insurance table bootstrap error:', err.message);
  }
})();

// Insurance tier definitions
// ROUND 58: Reduced refund percentages and raised thresholds for profitability
// Old values: bronze 10%/$200, silver 20%/$100, gold 35%/$50 — too generous
const TIERS = {
  bronze: { cost: 50, threshold: 300, refund_pct: 5 },
  silver: { cost: 150, threshold: 200, refund_pct: 10 },
  gold: { cost: 500, threshold: 150, refund_pct: 15 }
};

const POLICY_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * GET /
 * Get user's active insurance policy and available tiers
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get active policy (not expired, not yet claimed)
    var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    var activePolicySQL = `
      SELECT id, user_id, tier, cost, threshold, refund_pct, purchased_at, expires_at, claimed, claim_amount
      FROM loss_insurance_policies
      WHERE user_id = ? AND claimed = 0 AND expires_at > ?
      ORDER BY purchased_at DESC
      LIMIT 1
    `;

    const activePolicy = await db.get(activePolicySQL, [userId, now]);

    res.json({
      active_policy: activePolicy || null,
      available_tiers: TIERS
    });
  } catch (err) {
    console.warn('GET /loss-insurance error:', err.message);
    res.status(500).json({ error: 'Failed to fetch insurance policy' });
  }
});

/**
 * POST /purchase
 * Buy an insurance policy
 */
router.post('/purchase', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tier } = req.body;

    // Validate tier
    if (!tier || !TIERS[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const tierConfig = TIERS[tier];

    // ROUND 32: Self-exclusion check (was missing entirely)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Account is self-excluded. Insurance is disabled.' });
      }
    } catch (exclErr) {
      if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
      else {
        console.error('[LossInsurance] Self-exclusion check failed:', exclErr.message);
        return res.status(500).json({ error: 'Security check failed' });
      }
    }

    // Check if user already has active policy
    var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    var activePolicySQL = `
      SELECT id FROM loss_insurance_policies
      WHERE user_id = ? AND claimed = 0 AND expires_at > ?
      LIMIT 1
    `;
    const existingPolicy = await db.get(activePolicySQL, [userId, now]);

    if (existingPolicy) {
      return res.status(400).json({ error: 'You already have an active insurance policy' });
    }

    // ROUND 32: Cooldown — prevent rapid buy→claim→buy cycles.
    // Must wait at least 1 hour after last policy claim before buying another.
    var recentClaim = await db.get(
      "SELECT id FROM loss_insurance_policies WHERE user_id = ? AND claimed = 1 AND expires_at >= datetime('now', '-1 hour') LIMIT 1",
      [userId]
    );
    if (recentClaim) {
      return res.status(400).json({ error: 'Please wait at least 1 hour after claiming before purchasing a new policy' });
    }

    // ROUND 32: Atomic balance deduction with WHERE guard (was non-atomic read-then-write)
    var deductResult = await db.run(
      'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
      [tierConfig.cost, userId, tierConfig.cost]
    );
    if (!deductResult || deductResult.changes === 0) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create policy
    var expiresAt = new Date(Date.now() + POLICY_DURATION_MS).toISOString().slice(0, 19).replace('T', ' ');
    var insertPolicySQL = `
      INSERT INTO loss_insurance_policies
      (user_id, tier, cost, threshold, refund_pct, purchased_at, expires_at, claimed, claim_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
    `;

    var result = await db.run(insertPolicySQL, [
      userId,
      tier,
      tierConfig.cost,
      tierConfig.threshold,
      tierConfig.refund_pct,
      now,
      expiresAt
    ]);

    res.json({
      success: true,
      policy_id: result.lastID,
      tier: tier,
      cost: tierConfig.cost,
      expires_at: expiresAt
    });
  } catch (err) {
    console.warn('POST /loss-insurance/purchase error:', err.message);
    res.status(500).json({ error: 'Failed to purchase insurance' });
  }
});

/**
 * POST /claim
 * Claim insurance payout
 */
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get active policy
    var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    var activePolicySQL = `
      SELECT id, user_id, tier, cost, threshold, refund_pct, purchased_at, expires_at, claimed
      FROM loss_insurance_policies
      WHERE user_id = ? AND claimed = 0 AND expires_at > ?
      ORDER BY purchased_at DESC
      LIMIT 1
    `;

    const policy = await db.get(activePolicySQL, [userId, now]);

    if (!policy) {
      return res.status(400).json({ error: 'No active insurance policy' });
    }

    // Calculate net loss during policy window
    var getSpinsSQL = `
      SELECT SUM(bet_amount) as total_bet, SUM(win_amount) as total_win
      FROM spins
      WHERE user_id = ? AND created_at >= ? AND created_at <= ?
    `;

    const spinData = await db.get(getSpinsSQL, [userId, policy.purchased_at, policy.expires_at]);

    const totalBet = spinData.total_bet || 0;
    const totalWin = spinData.total_win || 0;
    const netLoss = totalBet - totalWin;

    // Check if loss exceeds threshold
    let claimAmount = 0;
    if (netLoss > policy.threshold) {
      const lossesAboveThreshold = netLoss - policy.threshold;
      claimAmount = Math.floor(lossesAboveThreshold * (policy.refund_pct / 100));
    }

    // ── Atomic claim: wrap policy update + payout in transaction ──
    // The WHERE claimed=0 guard prevents double-claim even under concurrent requests
    await db.beginTransaction();
    try {
      var claimResult = await db.run(
        'UPDATE loss_insurance_policies SET claimed = 1, claim_amount = ? WHERE id = ? AND claimed = 0',
        [claimAmount, policy.id]
      );

      if (!claimResult || claimResult.changes === 0) {
        await db.rollback();
        return res.status(400).json({ error: 'Policy already claimed' });
      }

      // ROUND 58: Raised wagering from 10x to 15x — was too easy to clear and withdraw
      if (claimAmount > 0) {
        await db.run(
          'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
          [claimAmount, claimAmount * 15, userId]
        );
      }

      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (_rbErr) { console.warn('[LossInsurance] rollback error:', _rbErr.message); }
      throw txErr;
    }

    res.json({
      success: true,
      policy_id: policy.id,
      tier: policy.tier,
      total_loss: netLoss,
      threshold: policy.threshold,
      claim_eligible: netLoss > policy.threshold,
      claim_amount: claimAmount
    });
  } catch (err) {
    console.warn('POST /loss-insurance/claim error:', err.message);
    res.status(500).json({ error: 'Failed to claim insurance' });
  }
});

/**
 * GET /history
 * Get user's past insurance purchases and claims
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    var historySQL = `
      SELECT id, tier, cost, threshold, refund_pct, purchased_at, expires_at, claimed, claim_amount
      FROM loss_insurance_policies
      WHERE user_id = ?
      ORDER BY purchased_at DESC
    `;

    const history = await db.all(historySQL, [userId]);

    res.json({
      history: history || []
    });
  } catch (err) {
    console.warn('GET /loss-insurance/history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch insurance history' });
  }
});

module.exports = router;
