const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Big Six Wheel — high house edge (~11–22% per segment type)
// Wheel has 54 slots: 24×$1, 15×$2, 7×$5, 4×$10, 2×$20, 1×Joker, 1×Logo
// Player bets any amount on any combo of segments.
// Wheel spins to random slot; matching bets pay at face value (1:1, 2:1, … 45:1 for Logo).
// Non-matching bets are lost.

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.25;
const MAX_BET  = 500;
const HOUSE_EDGE = 0.04; // applied via slot distribution

// Wheel composition — 54 total slots
// { value, count, payout } — payout is returned multiplier (stake returned too)
const SEGMENTS = [
  { id: '1',     label: '$1',    count: 24, payout: 1  },
  { id: '2',     label: '$2',    count: 15, payout: 2  },
  { id: '5',     label: '$5',    count:  7, payout: 5  },
  { id: '10',    label: '$10',   count:  4, payout: 10 },
  { id: '20',    label: '$20',   count:  2, payout: 20 },
  { id: 'joker', label: 'Joker', count:  1, payout: 45 },
  { id: 'logo',  label: 'Logo',  count:  1, payout: 45 },
];

const TOTAL_SLOTS = SEGMENTS.reduce(function(s, seg) { return s + seg.count; }, 0); // 54

// Build lookup table: slot index → segment id
var WHEEL = [];
SEGMENTS.forEach(function(seg) {
  for (var i = 0; i < seg.count; i++) WHEEL.push(seg.id);
});

function segById(id) {
  return SEGMENTS.find(function(s) { return s.id === id; });
}

// ── POST /spin ────────────────────────────────────────────────────────────────

router.post('/spin', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;

    // bets: { '1': amount, '2': amount, '5': amount, '10': amount, '20': amount, 'joker': amount, 'logo': amount }
    var bets = req.body.bets || {};
    var validIds = SEGMENTS.map(function(s) { return s.id; });

    var totalBet = 0;
    var betList  = [];
    for (var id of validIds) {
      var amt = parseFloat(bets[id]) || 0;
      if (amt > 0) {
        if (amt < MIN_BET || amt > MAX_BET)
          return res.status(400).json({ error: 'Each bet must be $' + MIN_BET + '\u2013$' + MAX_BET });
        betList.push({ id, amt });
        totalBet = parseFloat((totalBet + amt).toFixed(2));
      }
    }

    if (betList.length === 0)
      return res.status(400).json({ error: 'Place at least one bet' });
    if (totalBet > MAX_BET * validIds.length)
      return res.status(400).json({ error: 'Total bet too large' });

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < totalBet)
      return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [totalBet, userId]);

    // Spin
    var slotIdx = secureInt(TOTAL_SLOTS);
    var result  = WHEEL[slotIdx];
    var seg     = segById(result);

    // Calculate payout — only bets on the winning segment pay
    var payout = 0;
    var winBet = betList.find(function(b) { return b.id === result; });
    if (winBet) {
      payout = parseFloat((winBet.amt * (seg.payout + 1)).toFixed(2)); // stake + winnings
    }

    var profit = parseFloat((payout - totalBet).toFixed(2));

    if (payout > 0)
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    if (profit > 0)
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Big Six Wheel: ' + seg.label]
      ).catch(function() {});

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result,
      label:      seg.label,
      payout:     seg.payout,
      slotIndex:  slotIdx,
      totalSlots: TOTAL_SLOTS,
      winAmount:  payout > 0 ? parseFloat((payout - (winBet ? winBet.amt : 0)).toFixed(2)) : 0,
      totalBet,
      profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[BigSix] /spin error:', err.message);
    return res.status(500).json({ error: 'Spin failed' });
  }
});

// ── GET /info — wheel metadata ────────────────────────────────────────────────

router.get('/info', function(_req, res) {
  res.json({ segments: SEGMENTS, totalSlots: TOTAL_SLOTS });
});

module.exports = router;
