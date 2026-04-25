'use strict';
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');

// Bootstrap: add free spin columns
db.run("ALTER TABLE users ADD COLUMN free_spins_count INTEGER DEFAULT 0").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN free_spins_expires TEXT DEFAULT NULL").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN free_spins_last_auto TEXT DEFAULT NULL").catch(function() {});

const FREE_SPIN_VALUE = 0.25; // dollars credited per free spin used

// GET /api/freespins/status
router.get('/status', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
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
    if (count === 0 && !expired) {
      var lastSpin = await db.get(
        'SELECT created_at FROM spins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      var lastAutoStr = row.free_spins_last_auto || null;
      var lastAutoWeek = lastAutoStr ? Math.floor(new Date(lastAutoStr).getTime() / (7*24*3600000)) : -1;
      var thisWeek = Math.floor(Date.now() / (7*24*3600000));
      var alreadyGrantedThisWeek = (lastAutoWeek === thisWeek);

      if (lastSpin && !alreadyGrantedThisWeek) {
        var daysSince = (Date.now() - new Date(lastSpin.created_at).getTime()) / (24*3600000);
        if (daysSince >= 7) {
          var grantCount = 3;
          var expires = new Date(Date.now() + 24*3600000).toISOString();
          await db.run(
            'UPDATE users SET free_spins_count = ?, free_spins_expires = ?, free_spins_last_auto = datetime(\'now\') WHERE id = ?',
            [grantCount, expires, userId]
          );
          count = grantCount;
          expiresAt = expires;
        }
      }
    }

    return res.json({ count: count, expiresAt: expiresAt, expired: expired });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/freespins/use — use one free spin
router.post('/use', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var row = await db.get(
      'SELECT free_spins_count, free_spins_expires, balance FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    var count = row.free_spins_count || 0;
    var expiresAt = row.free_spins_expires || null;

    if (count <= 0) return res.status(400).json({ error: 'No free spins available' });
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      await db.run('UPDATE users SET free_spins_count = 0, free_spins_expires = NULL WHERE id = ?', [userId]);
      return res.status(400).json({ error: 'Free spins have expired' });
    }

    // RACE-SAFE decrement of the spin counter — only one concurrent claim succeeds
    var dec = await db.run(
      'UPDATE users SET free_spins_count = free_spins_count - 1 WHERE id = ? AND free_spins_count > 0',
      [userId]
    );
    var decRows = (dec && (dec.changes || dec.rowCount)) || 0;
    if (decRows === 0) {
      return res.status(400).json({ error: 'No free spins available (concurrent claim detected)' });
    }
    var newCount = count - 1;
    var newExpires = newCount === 0 ? null : expiresAt;
    // Free-spin payout → bonus_balance with 10x wagering (CLAUDE.md free-spin rule)
    var fsWager = FREE_SPIN_VALUE * 10;
    await db.run(
      'UPDATE users SET free_spins_expires = ?, ' +
      'bonus_balance = COALESCE(bonus_balance, 0) + ?, ' +
      'wagering_requirement = COALESCE(wagering_requirement, 0) + ? ' +
      'WHERE id = ?',
      [newExpires, FREE_SPIN_VALUE, fsWager, userId]
    );
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'free_spin', ?, 'Free spin credit (10x wagering)')",
      [userId, FREE_SPIN_VALUE]
    );
    return res.json({ success: true, remaining: newCount, creditedTo: 'bonus_balance', wageringRequirement: fsWager });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/freespins/grant — admin only
router.post('/grant', requireAdmin, async function(req, res) {
  try {
    var body = req.body || {};
    var targetUserId = body.userId;
    var count = parseInt(body.count) || 5;
    var hours = parseInt(body.hoursValid) || 24;
    if (!targetUserId) return res.status(400).json({ error: 'userId required' });
    var expires = new Date(Date.now() + hours * 3600000).toISOString();
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
