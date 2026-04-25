const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Wheel of Fortune
// POST /api/wheel/play  { bet }
//   → { segment, multiplier, payout, profit, newBalance, segmentIndex }
//
// Wheel segments (54 total):
//   24 × 0x   (lose)
//   12 × 1.5x
//    8 × 2x
//    5 × 3x
//    3 × 5x
//    1 × 10x
//    1 × 20x
// Total: 54 segments
// EV = (12*1.5 + 8*2 + 5*3 + 3*5 + 1*10 + 1*20) / 54
//    = (18 + 16 + 15 + 15 + 10 + 20) / 54 = 94/54 ≈ 0.9259x → ~7.4% house edge

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;

// Build the segment list once
const SEGMENTS = [];
(function() {
  var defs = [
    { mult: 0,    count: 24, color: '#1f2937', label: 'LOSE' },
    { mult: 1.5,  count: 12, color: '#1d4ed8', label: '1.5x' },
    { mult: 2,    count:  8, color: '#7c3aed', label: '2x'   },
    { mult: 3,    count:  5, color: '#b45309', label: '3x'   },
    { mult: 5,    count:  3, color: '#047857', label: '5x'   },
    { mult: 10,   count:  1, color: '#b91c1c', label: '10x'  },
    { mult: 20,   count:  1, color: '#d97706', label: '20x'  },
  ];
  for (var d = 0; d < defs.length; d++) {
    for (var c = 0; c < defs[d].count; c++) {
      SEGMENTS.push({ mult: defs[d].mult, color: defs[d].color, label: defs[d].label });
    }
  }
})();

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const segmentIndex = secureInt(SEGMENTS.length);
    const segment      = SEGMENTS[segmentIndex];
    const multiplier   = segment.mult;
    const payout       = parseFloat((bet * multiplier).toFixed(2));

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Wheel: ' + segment.label + ' (' + multiplier + 'x)']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:      true,
      segmentIndex: segmentIndex,
      segment:      segment,
      multiplier:   multiplier,
      payout:       payout,
      profit:       parseFloat((payout - bet).toFixed(2)),
      newBalance:   u ? parseFloat(u.balance) : null,
      totalSegments: SEGMENTS.length,
    });
  } catch (err) {
    console.error('[Wheel] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to spin wheel' });
  }
});

// Expose segment data for client to build the visual wheel
router.get('/segments', function(req, res) {
  return res.json({ segments: SEGMENTS });
});

module.exports = router;
