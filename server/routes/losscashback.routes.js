const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT CURRENT_TIMESTAMP";

// Bootstrap: create loss_cashback_claims table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS loss_cashback_claims (
    id ${idDef},
    user_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    cashback_amount REAL NOT NULL,
    session_losses REAL NOT NULL,
    claimed_at ${tsDef},
    created_at ${tsDef},
    UNIQUE(user_id, tier, DATE(claimed_at))
  )
`).catch(function(err) {
  console.warn('[LossCashback] Table creation error:', err.message);
});

/**
 * Calculate session losses from the past 24 hours
 * Returns the sum of (bet_amount - win_amount) where win < bet
 */
async function computeSessionLosses(userId) {
  try {
    const row = await db.get(
      `SELECT COALESCE(SUM(CASE
        WHEN win_amount < bet_amount THEN (bet_amount - win_amount)
        ELSE 0
      END), 0) AS net_losses
       FROM spins
       WHERE user_id = ?
       AND created_at >= datetime('now', '-24 hours')`,
      [userId]
    );
    return parseFloat(row.net_losses) || 0;
  } catch (err) {
    console.warn('[LossCashback] Error computing session losses:', err.message);
    return 0;
  }
}

/**
 * Get cashback tier info based on session losses
 */
function getTierInfo(losses) {
  if (losses >= 250) {
    return { tier: '50', rate: 0.50, threshold: 250 };
  } else if (losses >= 100) {
    return { tier: '35', rate: 0.35, threshold: 100 };
  } else if (losses >= 50) {
    return { tier: '25', rate: 0.25, threshold: 50 };
  }
  return null;
}

/**
 * GET /api/losscashback/status
 * Returns player's recent session losses and current cashback tier
 * Response: { sessionLosses, currentTier, rate, eligible, lastClaim }
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    const sessionLosses = await computeSessionLosses(req.user.id);
    const tierInfo = getTierInfo(sessionLosses);

    // Check if user has already claimed this tier in the last 24 hours
    let lastClaim = null;
    let claimed = false;

    if (tierInfo) {
      const claimRecord = await db.get(
        `SELECT claimed_at FROM loss_cashback_claims
         WHERE user_id = ?
         AND tier = ?
         AND claimed_at >= datetime('now', '-24 hours')
         ORDER BY claimed_at DESC
         LIMIT 1`,
        [req.user.id, tierInfo.tier]
      );
      if (claimRecord) {
        lastClaim = claimRecord.claimed_at;
        claimed = true;
      }
    }

    res.json({
      sessionLosses: parseFloat(sessionLosses.toFixed(2)),
      currentTier: tierInfo ? tierInfo.tier : null,
      rate: tierInfo ? tierInfo.rate : null,
      threshold: tierInfo ? tierInfo.threshold : null,
      eligible: tierInfo && !claimed,
      claimed: claimed,
      lastClaim: lastClaim
    });
  } catch (err) {
    console.warn('[LossCashback] Status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cashback status' });
  }
});

/**
 * POST /api/losscashback/claim
 * Claim cashback and credit to balance
 * Body: { tier: '25' | '35' | '50' }
 * Response: { success, credited, newBalance, tier, rate }
 */
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
  try {
    const { tier } = req.body;

    // Validate tier
    if (!['25', '35', '50'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const user = await db.get(
      'SELECT balance, bonus_balance FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Compute session losses
    const sessionLosses = await computeSessionLosses(req.user.id);

    // Map tier to rate and threshold
    let tierInfo;
    if (tier === '50' && sessionLosses >= 250) {
      tierInfo = { tier: '50', rate: 0.50, threshold: 250 };
    } else if (tier === '35' && sessionLosses >= 100) {
      tierInfo = { tier: '35', rate: 0.35, threshold: 100 };
    } else if (tier === '25' && sessionLosses >= 50) {
      tierInfo = { tier: '25', rate: 0.25, threshold: 50 };
    } else {
      return res.status(400).json({
        error: 'Tier ' + tier + '% not available (losses: $' + sessionLosses.toFixed(2) + ')'
      });
    }

    // Check if already claimed this tier in the past 24 hours
    const existing = await db.get(
      `SELECT claimed_at FROM loss_cashback_claims
       WHERE user_id = ?
       AND tier = ?
       AND claimed_at >= datetime('now', '-24 hours')`,
      [req.user.id, tier]
    );

    if (existing) {
      return res.status(400).json({
        error: 'You have already claimed ' + tier + '% cashback in the past 24 hours'
      });
    }

    // Calculate cashback amount
    const credited = parseFloat((sessionLosses * tierInfo.rate).toFixed(2));

    if (credited <= 0) {
      return res.status(400).json({ error: 'No cashback available' });
    }

    // Credit to bonus_balance with 10x wagering requirement (loss compensation)
    await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
      [credited, credited * 10, req.user.id]
    );

    // Record the claim
    await db.run(
      `INSERT INTO loss_cashback_claims (user_id, tier, cashback_amount, session_losses)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, tier, credited, sessionLosses]
    );

    // Record transaction
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'loss_cashback', ?, ?)",
      [
        req.user.id,
        credited,
        'Loss-driven cashback — ' + tier + '% of $' + sessionLosses.toFixed(2) + ' session losses'
      ]
    );

    // Get updated balance
    const updatedUser = await db.get(
      'SELECT bonus_balance FROM users WHERE id = ?',
      [req.user.id]
    );
    const newBalance = updatedUser ? parseFloat(updatedUser.bonus_balance) : 0;

    console.warn('[LossCashback] Claim successful - User:', req.user.id, 'Tier:', tier, 'Amount:', credited);

    res.json({
      success: true,
      credited: credited,
      newBalance: newBalance,
      tier: tier,
      rate: tierInfo.rate,
      sessionLosses: parseFloat(sessionLosses.toFixed(2))
    });
  } catch (err) {
    console.warn('[LossCashback] Claim error:', err.message);
    res.status(500).json({ error: 'Claim failed' });
  }
});

module.exports = router;
