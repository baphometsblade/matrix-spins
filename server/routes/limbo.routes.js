const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Limbo — player picks a target multiplier; house generates a result multiplier.
// If result >= target the player wins at their chosen multiplier.
//
// POST /api/limbo/play  { bet, target }
//   → { result, target, win, payout, profit, newBalance }
//
// House RTP: ~97% (house edge ~3%)
// result formula: 1 / (1 - rand)  capped at 1,000,000x
// Win probability at target X = 0.97 / X   → expected value = bet * (0.97/X) * X = 0.97*bet

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.25;
const MAX_BET    = 500;
const MIN_TARGET = 1.01;
const MAX_TARGET = 1000000;
const HOUSE_EDGE = 0.03;   // 3%

function generateResult() {
  // result = 1 / (1 - r)  where r in [0, 1)
  // but we apply house edge: multiply random uniform by (1 - HOUSE_EDGE)
  // so P(result >= X) = (1-HOUSE_EDGE)/X = 0.97/X
  var r = secureFloat() * (1 - HOUSE_EDGE);
  if (r >= 1) r = 1 - 1e-9;
  var raw = 1 / (1 - r);
  // Floor to 2 decimal places, cap at 1,000,000
  return Math.min(1000000, Math.floor(raw * 100) / 100);
}

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    const target = parseFloat(req.body.target);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }
    if (isNaN(target) || target < MIN_TARGET || target > MAX_TARGET) {
      return res.status(400).json({ error: 'Target must be ' + MIN_TARGET + 'x \u2013 ' + MAX_TARGET + 'x' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const result = generateResult();
    const win    = result >= target;
    const payout = win ? parseFloat((bet * target).toFixed(2)) : 0;

    if (win) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Limbo: ' + target.toFixed(2) + 'x target (' + result.toFixed(2) + 'x result)']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     result,
      target:     target,
      win:        win,
      payout:     payout,
      profit:     win ? parseFloat((payout - bet).toFixed(2)) : parseFloat((-bet).toFixed(2)),
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Limbo] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Limbo' });
  }
});

module.exports = router;
