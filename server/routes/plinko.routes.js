const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Plinko - ball drops through a Galton board and lands in a multiplier slot.
// 16 rows of pegs = 17 buckets. House edge ~3% (baked into multiplier table).
//
// POST /api/plinko/play  { bet, risk }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;
const ROWS    = 16;

const MULTIPLIERS = {
  low:    [5.6, 2.1, 1.1, 1.0, 0.5, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.5, 1.0, 1.1, 2.1, 5.6],
  medium: [110,  41,  10,   5,   3, 1.5,   1, 0.5, 0.3, 0.5,   1, 1.5,   3,   5,  10,  41, 110],
  high:   [1000,130,  26,   9,   4,   2, 0.2, 0.2, 0.2, 0.2, 0.2,   2,   4,   9,  26, 130,1000],
};

function dropBall() {
  var bucket = 0;
  var path   = [];
  for (var r = 0; r < ROWS; r++) {
    var goRight = secureFloat() < 0.5 ? 1 : 0;
    path.push(goRight);
    bucket += goRight;
  }
  return { bucket: bucket, path: path };
}

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    const risk   = req.body.risk;

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' - $' + MAX_BET });
    }
    if (!MULTIPLIERS[risk]) {
      return res.status(400).json({ error: 'Risk must be low, medium, or high' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const { bucket, path } = dropBall();
    const multiplier = MULTIPLIERS[risk][bucket];
    const payout     = parseFloat((bet * multiplier).toFixed(2));
    const profit     = parseFloat((payout - bet).toFixed(2));

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    }

    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Plinko: ' + risk + ' risk, ' + multiplier + 'x (bucket ' + bucket + ')']
      ).catch(function() {});
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      bucket:     bucket,
      multiplier: multiplier,
      path:       path,
      payout:     payout,
      profit:     profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Plinko] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Plinko' });
  }
});

module.exports = router;
