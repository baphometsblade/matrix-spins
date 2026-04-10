'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap columns
db.run('ALTER TABLE users ADD COLUMN deposit_match_credits REAL DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[depositmatch] ALTER failed:', e.message || e); });
db.run('ALTER TABLE users ADD COLUMN deposit_match_last TEXT DEFAULT NULL').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[depositmatch] ALTER failed:', e.message || e); });

// VIP-tier-scaled deposit match configuration
const DEPOSIT_MATCH_TIERS = [
    { level: 0, label: 'Base',     rate: 0.25, cap: 2.50   },
    { level: 1, label: 'Bronze',   rate: 0.35, cap: 7.00   },
    { level: 2, label: 'Silver',   rate: 0.50, cap: 15.00  },
    { level: 3, label: 'Gold',     rate: 0.60, cap: 35.00  },
    { level: 4, label: 'Platinum', rate: 0.75, cap: 75.00  },
    { level: 5, label: 'Diamond',  rate: 1.00, cap: 200.00 }
];

function getDepositMatchConfig(totalWagered) {
    const w = parseFloat(totalWagered) || 0;
    if (w >= 50000) return DEPOSIT_MATCH_TIERS[5];
    if (w >= 10000) return DEPOSIT_MATCH_TIERS[4];
    if (w >= 2000)  return DEPOSIT_MATCH_TIERS[3];
    if (w >= 500)   return DEPOSIT_MATCH_TIERS[2];
    if (w >= 100)   return DEPOSIT_MATCH_TIERS[1];
    return DEPOSIT_MATCH_TIERS[0];
}

// GET /api/depositmatch/status
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

    var user = await db.get('SELECT deposit_match_credits, deposit_match_last, total_wagered FROM users WHERE id = ?', [userId]);
    var pendingMatch = user ? (user.deposit_match_credits || 0) : 0;

    var cfg = getDepositMatchConfig(user ? user.total_wagered : 0);

    // Check if there's a recent deposit that hasn't been matched yet
    var lastDeposit = await db.get(
      "SELECT amount, created_at FROM transactions WHERE user_id = ? AND type = 'deposit' ORDER BY created_at DESC LIMIT 1",
      [userId]
    );

    var eligible = false;
    var matchAmount = 0;

    if (lastDeposit) {
      var lastMatchTime = user ? user.deposit_match_last : null;
      if (!lastMatchTime || lastDeposit.created_at > lastMatchTime) {
        eligible = true;
        matchAmount = Math.min(lastDeposit.amount * cfg.rate, cfg.cap);
      }
    }

    return res.json({
      eligible: eligible,
      vipLevel: cfg.level,
      vipLabel: cfg.label,
      matchRate: cfg.rate,
      maxMatch: cfg.cap,
      matchAmount: matchAmount,
      pendingCredits: pendingMatch,
      lastDeposit: lastDeposit ? lastDeposit.amount : 0
    });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/depositmatch/claim
router.post('/claim', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId = req.user.id;
    var user = await db.get('SELECT deposit_match_last, total_wagered FROM users WHERE id = ?', [userId]);

    var cfg = getDepositMatchConfig(user ? user.total_wagered : 0);

    var lastDeposit = await db.get(
      "SELECT amount, created_at FROM transactions WHERE user_id = ? AND type = 'deposit' ORDER BY created_at DESC LIMIT 1",
      [userId]
    );

    if (!lastDeposit) return res.status(400).json({ error: 'No deposit found' });

    var lastMatchTime = user ? user.deposit_match_last : null;
    if (lastMatchTime && lastDeposit.created_at <= lastMatchTime) {
      return res.status(400).json({ error: 'Already claimed for this deposit' });
    }

    var matchAmount = Math.min(lastDeposit.amount * cfg.rate, cfg.cap);
    matchAmount = Math.round(matchAmount * 100) / 100;

    if (matchAmount <= 0) return res.status(400).json({ error: 'No match available' });

    // ROUND 36: Lifetime deposit match cap — prevent unlimited match farming.
    // Max $1000 total deposit match bonuses per user lifetime.
    var MAX_LIFETIME_MATCH = 1000;
    var lifetimeMatch = await db.get(
        "SELECT COALESCE(deposit_match_credits, 0) as total FROM users WHERE id = ?",
        [userId]
    );
    if (lifetimeMatch && lifetimeMatch.total >= MAX_LIFETIME_MATCH) {
        return res.status(400).json({ error: 'Lifetime deposit match limit reached ($' + MAX_LIFETIME_MATCH + ')' });
    }
    // Also cap individual match if it would exceed lifetime limit
    var remaining = MAX_LIFETIME_MATCH - (lifetimeMatch ? lifetimeMatch.total : 0);
    if (matchAmount > remaining) matchAmount = Math.round(remaining * 100) / 100;

    // Credit to bonus_balance with wagering requirement (not withdrawable balance)
    var wageringMult = 30; // 30x playthrough on deposit match bonus
    await db.beginTransaction();
    try {
        await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, deposit_match_credits = COALESCE(deposit_match_credits, 0) + ?, deposit_match_last = ? WHERE id = ?',
          [matchAmount, matchAmount * wageringMult, matchAmount, lastDeposit.created_at, userId]);
        await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
          [userId, matchAmount, 'Deposit Match ' + Math.round(cfg.rate * 100) + '% (' + cfg.label + ') — $' + matchAmount.toFixed(2) + ' (30x wagering)']);
        await db.commit();
    } catch (txErr) {
        await db.rollback();
        throw txErr;
    }

    var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      matchAmount: matchAmount,
      vipLabel: cfg.label,
      matchRate: cfg.rate,
      newBalance: updated ? updated.balance : 0
    });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
