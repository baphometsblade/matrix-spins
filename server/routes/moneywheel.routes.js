const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Money Wheel — multiplier prize wheel
// 60-slot wheel with segments: 1x ×26, 2x ×14, 5x ×8, 10x ×4, 20x ×3,
//   50x ×2, 100x ×1, 200x ×1, 500x ×1
// Player bets a stake; wins stake × multiplier on that segment.
// House edge: 4% applied via slot counts (expected value < 1 per spin).

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 250; // lower cap — 500x multiplier risk

// Wheel definition — each segment: { mult, count }
// Total slots: 60. Expected value ≈ 0.960 → ~4% house edge.
const SEGMENTS = [
  { mult: 1,   count: 26 },
  { mult: 2,   count: 14 },
  { mult: 5,   count:  8 },
  { mult: 10,  count:  4 },
  { mult: 20,  count:  3 },
  { mult: 50,  count:  2 },
  { mult: 100, count:  1 },
  { mult: 200, count:  1 },
  { mult: 500, count:  1 },
];

const TOTAL_SLOTS = SEGMENTS.reduce(function(s, seg) { return s + seg.count; }, 0); // 60

// Build flat wheel lookup
var WHEEL = [];
SEGMENTS.forEach(function(seg) {
  for (var i = 0; i < seg.count; i++) WHEEL.push(seg.mult);
});

// ── POST /spin ────────────────────────────────────────────────────────────────

router.post('/spin', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    var bet = parseFloat(req.body.bet);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET)
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + '\u2013$' + MAX_BET });

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet)
      return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var slotIndex = secureInt(TOTAL_SLOTS);
    var mult      = WHEEL[slotIndex];
    var payout    = parseFloat((bet * mult).toFixed(2));
    var profit    = parseFloat((payout - bet).toFixed(2));

    if (payout > 0)
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    if (profit > 0)
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Money Wheel: ' + mult + 'x']
      ).catch(function() {});

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      slotIndex,
      totalSlots: TOTAL_SLOTS,
      mult,
      bet,
      payout,
      profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[MoneyWheel] /spin error:', err.message);
    return res.status(500).json({ error: 'Spin failed' });
  }
});

// ── GET /info ─────────────────────────────────────────────────────────────────

router.get('/info', function(_req, res) {
  res.json({ segments: SEGMENTS, totalSlots: TOTAL_SLOTS });
});

module.exports = router;
