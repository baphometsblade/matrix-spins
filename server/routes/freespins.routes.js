'use strict';
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap: add free spin columns
db.run("ALTER TABLE users ADD COLUMN free_spins_count INTEGER DEFAULT 0").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[freespins] ALTER failed:', e.message || e); });
db.run("ALTER TABLE users ADD COLUMN free_spins_expires TEXT DEFAULT NULL").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[freespins] ALTER failed:', e.message || e); });
db.run("ALTER TABLE users ADD COLUMN free_spins_last_auto TEXT DEFAULT NULL").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[freespins] ALTER failed:', e.message || e); });

const FREE_SPIN_VALUE = 0.25; // dollars credited per free spin used

// GET /api/freespins/status
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

    var row = await db.get(
      'SELECT free_spins_count, free_spins_expires, free_spins_last_auto FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return res.json({ count: 0, expiresAt: null, expired: false });

    var count = row.free_spins_count || 0;
    var expiresAt = row.free_spins_expires || null;
    var expired = false;

    // Check expiry
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      // Reset expired spins
      await db.run('UPDATE users SET free_spins_count = 0, free_spins_expires = NULL WHERE id = ?', [userId]);
      count = 0;
      expiresAt = null;
      expired = true;
    }

    // Auto-grant welcome-back free spins: check if last spin was > 7 days ago
    // Uses atomic UPDATE with WHERE guard to prevent double-grant on concurrent requests
    if (count === 0 && !expired) {
      var lastSpin = await db.get(
        'SELECT created_at FROM spins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );

      if (lastSpin) {
        var daysSince = (Date.now() - new Date(lastSpin.created_at).getTime()) / (24*3600000);
        if (daysSince >= 7) {
          var grantCount = 3;
          var expires = new Date(Date.now() + 24*3600000).toISOString().slice(0, 19).replace('T', ' ');
          // Atomic: only grant if free_spins_last_auto is older than 7 days (or NULL)
          // The WHERE guard ensures concurrent requests can't both succeed
          var grantResult = await db.run(
            "UPDATE users SET free_spins_count = ?, free_spins_expires = ?, free_spins_last_auto = datetime('now') " +
            "WHERE id = ? AND (free_spins_last_auto IS NULL OR free_spins_last_auto <= datetime('now', '-7 days'))",
            [grantCount, expires, userId]
          );
          if (grantResult && grantResult.changes > 0) {
            count = grantCount;
            expiresAt = expires;
          }
        }
      }
    }

    return res.json({ count: count, expiresAt: expiresAt, expired: expired });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/freespins/use — use one free spin
// Uses atomic UPDATE to prevent race condition double-claim
router.post('/use', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId = req.user.id;

    // Check for expiry first
    var row = await db.get(
      'SELECT free_spins_count, free_spins_expires FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    if ((row.free_spins_count || 0) <= 0) return res.status(400).json({ error: 'No free spins available' });
    if (row.free_spins_expires && new Date(row.free_spins_expires).getTime() < Date.now()) {
      await db.run('UPDATE users SET free_spins_count = 0, free_spins_expires = NULL WHERE id = ?', [userId]);
      return res.status(400).json({ error: 'Free spins have expired' });
    }

    // Atomic: decrement spin count AND credit bonus_balance (NOT real balance) in one UPDATE
    // WHERE free_spins_count > 0 prevents race condition double-claim
    // Free spins are a bonus — winnings go to bonus_balance with 10x wagering requirement
    var WAGERING_MULTIPLIER = 10;
    var wagerReq = parseFloat((FREE_SPIN_VALUE * WAGERING_MULTIPLIER).toFixed(2));
    var result = await db.run(
      'UPDATE users SET free_spins_count = free_spins_count - 1, bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ? AND free_spins_count > 0',
      [FREE_SPIN_VALUE, wagerReq, userId]
    );
    if (result.changes === 0) {
      return res.status(400).json({ error: 'No free spins available' });
    }

    // Clear expires if count reached 0
    await db.run(
      'UPDATE users SET free_spins_expires = CASE WHEN free_spins_count = 0 THEN NULL ELSE free_spins_expires END WHERE id = ?',
      [userId]
    );

    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'free_spin', ?, 'Free spin credit')",
      [userId, FREE_SPIN_VALUE]
    );

    // Fetch updated values for response
    var updated = await db.get('SELECT free_spins_count, balance FROM users WHERE id = ?', [userId]);
    return res.json({ success: true, remaining: updated.free_spins_count || 0, newBalance: parseFloat(updated.balance || 0) });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/freespins/grant — admin only
// ROUND 29: Added authenticate before requireAdmin — was missing, so req.user could be undefined
router.post('/grant', authenticate, requireAdmin, async function(req, res) {
  try {
    var body = req.body || {};
    var targetUserId = body.userId;
    var count = parseInt(body.count) || 5;
    var hours = parseInt(body.hoursValid) || 24;
    if (!targetUserId) return res.status(400).json({ error: 'userId required' });

    // ROUND 37: Cap admin free spin grants to prevent abuse if admin credentials compromised
    if (count > 50) count = 50;
    if (hours > 72) hours = 72;
    var expires = new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    await db.run(
      'UPDATE users SET free_spins_count = free_spins_count + ?, free_spins_expires = ? WHERE id = ?',
      [count, expires, targetUserId]
    );
    return res.json({ success: true, granted: count, expiresAt: expires });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
