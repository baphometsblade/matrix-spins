'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');
const emailService = require('../services/email.service');
const config = require('../config');

// Bootstrap: add first_deposit_bonus_claimed column safely
db.run('ALTER TABLE users ADD COLUMN first_deposit_bonus_claimed INTEGER DEFAULT 0').catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[firstdeposit] ALTER failed:', e.message || e); });

// GET /api/firstdeposit/status
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

    var user = await db.get('SELECT first_deposit_bonus_claimed FROM users WHERE id = ?', [userId]);
    var claimed = user ? (user.first_deposit_bonus_claimed || 0) : 0;

    var eligible = false;
    if (!claimed) {
      var deposit = await db.get(
        "SELECT id FROM transactions WHERE user_id = ? AND type = 'deposit' LIMIT 1",
        [userId]
      );
      eligible = !!deposit;
    }

    return res.json({ eligible: eligible, claimed: !!claimed });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/firstdeposit/claim
router.post('/claim', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId = req.user.id;
    var user = await db.get('SELECT first_deposit_bonus_claimed, balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.first_deposit_bonus_claimed) return res.status(400).json({ error: 'Already claimed' });

    var deposit = await db.get(
      "SELECT id FROM transactions WHERE user_id = ? AND type = 'deposit' LIMIT 1",
      [userId]
    );
    if (!deposit) return res.status(400).json({ error: 'No deposit found' });

    var BONUS_GEMS = 500;
    var BONUS_CREDITS = 2.00;

    // Atomic WHERE guard prevents TOCTOU double-claim race condition
    var claimResult = await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ?, bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, first_deposit_bonus_claimed = 1 WHERE id = ? AND (first_deposit_bonus_claimed IS NULL OR first_deposit_bonus_claimed = 0)',
      [BONUS_GEMS, BONUS_CREDITS, BONUS_CREDITS * 45, userId]); // CLAUDE.md Rule: First deposit = 45x wagering
    if (!claimResult || claimResult.changes === 0) {
      return res.status(409).json({ error: 'Already claimed (concurrent request)' });
    }
    await db.run('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
      [userId, 'bonus', BONUS_CREDITS, userId, userId, 'First Deposit Welcome Bonus']);
    // Grant first_deposit achievement (idempotent)
    require('../services/achievement.service').grant(userId, 'first_deposit').catch(function(err) { console.warn('[FirstDeposit] Failed to grant first_deposit achievement:', err.message); });

    // Fire-and-forget bonus notification email
    if (config.SMTP_HOST) {
      db.get('SELECT email, username FROM users WHERE id = ?', [userId]).then(function(emailRow) {
        if (emailRow && emailRow.email) {
          emailService.send({
            to: emailRow.email,
            userId: userId,
            template: 'broadcast',
            data: {
              subject: 'Your first deposit bonus has arrived — Matrix Spins',
              headline: 'Welcome bonus credited!',
              body: 'Hi ' + emailRow.username + ', your $' + BONUS_CREDITS.toFixed(2) + ' welcome bonus has been added to your account! You\'ll need to wager $' + (BONUS_CREDITS * 45).toFixed(2) + ' (45x) to unlock it for withdrawal. Head back to Matrix Spins and start playing now!',
              ctaLabel: 'Play now',
              ctaUrl: 'https://msaart.online'
            }
          }).catch(function(err) { console.error('[email] first deposit bonus notification failed:', err.message); });
        }
      }).catch(function(err) { console.error('[email] first deposit user lookup failed:', err.message); });
    }

    var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      reward: { gems: BONUS_GEMS, credits: BONUS_CREDITS },
      newBalance: updated ? updated.balance : 0
    });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
