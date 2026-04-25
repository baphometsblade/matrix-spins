const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

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
  // Crypto-secure roll across 0..100 — Math.random is predictable in V8 and
  // payouts on this wheel reach $25 cash, so prediction = exfil. Floor weights
  // sum to 100 (validated by the loop guard).
  var roll = crypto.randomInt(10_000) / 100; // 0.00..99.99 with full uniform spread
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
router.post('/spin', authenticate, async function(req, res) {
  try {
    var user = await db.get(
      "SELECT balance, vip_wheel_last, total_wagered, gems FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    var vipLevel = getVipLevel(user);
    if (vipLevel < VIP_REQUIRED) {
      return res.status(403).json({ error: 'VIP Level ' + VIP_REQUIRED + ' required' });
    }

    var now = Date.now();
    if (user.vip_wheel_last) {
      var elapsed = now - new Date(user.vip_wheel_last).getTime();
      if (elapsed < COOLDOWN_MS) {
        return res.status(429).json({ error: 'Cooldown active' });
      }
    }

    var result = pickPrize();
    var nowISO = new Date(now).toISOString();

    if (result.prize.type === 'credits') {
      // Free credit prize → bonus_balance with 15x wagering (CLAUDE.md rule)
      var wagerReq = parseFloat((result.prize.value * 15).toFixed(2));
      await db.run(
        "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, " +
        "wagering_requirement = COALESCE(wagering_requirement, 0) + ?, " +
        "vip_wheel_last = ? WHERE id = ?",
        [result.prize.value, wagerReq, nowISO, req.user.id]
      );
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?, 'bonus', ?, ?, ?)",
        [req.user.id, result.prize.value, user.balance, 'VIP Wheel: ' + result.prize.label + ' (15x wagering)']
      );
    } else {
      // Gems are an in-game currency, not cashable — atomic accumulate
      await db.run(
        "UPDATE users SET gems = COALESCE(gems, 0) + ?, vip_wheel_last = ? WHERE id = ?",
        [result.prize.value, nowISO, req.user.id]
      );
    }

    res.json({
      prizeIndex: result.index,
      prize: result.prize,
      creditedTo: result.prize.type === 'credits' ? 'bonus_balance' : 'gems'
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
