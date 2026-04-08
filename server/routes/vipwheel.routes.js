const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

// Bootstrap columns
db.run("ALTER TABLE users ADD COLUMN vip_wheel_last TEXT").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN gems INTEGER DEFAULT 0").catch(function() {});

var COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
var VIP_REQUIRED = 3;

// Prize table (weights must sum to 100)
var PRIZES = [
  { label: '500 Gems',   type: 'gems',    value: 500,   weight: 30 },
  { label: '$2',          type: 'credits', value: 2.00,  weight: 25 },
  { label: '1K Gems',    type: 'gems',    value: 1000,  weight: 18 },
  { label: '$5',          type: 'credits', value: 5.00,  weight: 12 },
  { label: '2.5K Gems',  type: 'gems',    value: 2500,  weight: 7 },
  { label: '$10',         type: 'credits', value: 10.00, weight: 4 },
  { label: '5K Gems',    type: 'gems',    value: 5000,  weight: 3 },
  { label: '$25',         type: 'credits', value: 25.00, weight: 1 }
];

function pickPrize() {
  var roll = (crypto.randomBytes(4).readUInt32BE(0) / 0x100000000) * 100;
  var cumulative = 0;
  for (var i = 0; i < PRIZES.length; i++) {
    cumulative += PRIZES[i].weight;
    if (roll < cumulative) return { index: i, prize: PRIZES[i] };
  }
  return { index: 0, prize: PRIZES[0] };
}

function getVipLevel(user) {
  // VIP level based on total_wagered field
  var wagered = user.total_wagered || 0;
  if (wagered >= 50000) return 5;
  if (wagered >= 10000) return 4;
  if (wagered >= 2000) return 3;
  if (wagered >= 500) return 2;
  if (wagered >= 100) return 1;
  return 0;
}

// GET /api/vipwheel/status
router.get('/status', authenticate, async function(req, res) {
  try {
    var user = await db.get(
      "SELECT vip_wheel_last, total_wagered FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    var vipLevel = getVipLevel(user);
    var eligible = vipLevel >= VIP_REQUIRED;
    var now = Date.now();
    var last = user.vip_wheel_last;
    var available = true;
    var cooldownEnds = null;

    if (last) {
      var elapsed = now - new Date(last).getTime();
      if (elapsed < COOLDOWN_MS) {
        available = false;
        cooldownEnds = new Date(new Date(last).getTime() + COOLDOWN_MS).toISOString();
      }
    }

    res.json({
      eligible: eligible,
      vipLevel: vipLevel,
      vipRequired: VIP_REQUIRED,
      available: available,
      cooldownEnds: cooldownEnds
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/vipwheel/spin
router.post('/spin', authenticate, bonusGuard, async function(req, res) {
  try {
    var user = await db.get(
      "SELECT balance, vip_wheel_last, total_wagered, gems FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ROUND 52: Self-exclusion check (regulatory compliance)
    try {
      var exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [req.user.id]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Account is self-excluded. VIP wheel is disabled.' });
      }
    } catch (exclErr) {
      if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
      else {
        console.error('[SelfExcl] VIP wheel check failed:', exclErr.message);
        return res.status(500).json({ error: 'Security check failed' });
      }
    }

    var vipLevel = getVipLevel(user);
    if (vipLevel < VIP_REQUIRED) {
      return res.status(403).json({ error: 'VIP Level ' + VIP_REQUIRED + ' required' });
    }

    // ── Atomic cooldown check-and-set to prevent double-spin race condition ──
    // Two concurrent requests could both pass a read-check-write pattern;
    // instead, do the check + update in one SQL WHERE clause.
    var now = Date.now();
    var nowISO = new Date(now).toISOString();
    var cooldownSeconds = Math.floor(COOLDOWN_MS / 1000);

    var cooldownResult = await db.run(
      "UPDATE users SET vip_wheel_last = ? WHERE id = ? AND (vip_wheel_last IS NULL OR (julianday(?) - julianday(vip_wheel_last)) * 86400 >= ?)",
      [nowISO, req.user.id, nowISO, cooldownSeconds]
    );
    if (!cooldownResult || cooldownResult.changes === 0) {
      return res.status(429).json({ error: 'Cooldown active' });
    }

    var result = pickPrize();
    var newBalance = user.balance;

    // ── Wrap prize credit + transaction record in DB transaction ──
    await db.beginTransaction();
    try {
      if (result.prize.type === 'credits') {
        // ROUND 52: Cap to remaining daily bonus limit
        var creditVal = result.prize.value;
        if (creditVal > 0 && req.bonusCapRemaining !== undefined && creditVal > req.bonusCapRemaining) {
          creditVal = Math.max(0, Math.floor(req.bonusCapRemaining * 100) / 100);
        }
        if (creditVal <= 0) {
          await db.rollback();
          return res.status(400).json({ error: 'Daily bonus limit reached' });
        }
        // Credit to bonus_balance with 15x wagering (revenue protection)
        await db.run(
          "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?",
          [creditVal, creditVal * 15, req.user.id]
        );
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
          [req.user.id, result.prize.value, 'VIP Wheel: ' + result.prize.label + ' (bonus, 15x wagering)']
        );
      } else {
        await db.run(
          "UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?",
          [result.prize.value, req.user.id]
        );
      }
      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (_rbErr) { console.warn('[VIPWheel] rollback error:', _rbErr.message); }
      throw txErr;
    }

    res.json({
      prizeIndex: result.index,
      prize: result.prize,
      newBalance: newBalance
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
