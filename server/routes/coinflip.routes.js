const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Coinflip — pick heads or tails; 2x payout; ~3% house edge.
// Win probability: 0.485 each side (0.03 house edge), tie impossible.
//
// POST /api/coinflip/play  { bet, pick: 'heads'|'tails' }
//   → { result, pick, win, payout, profit, newBalance }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.25;
const MAX_BET    = 1000;
const WIN_PROB   = 0.485;   // 48.5% → 3% house edge on 2x payout

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    const pick   = req.body.pick;

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }
    if (pick !== 'heads' && pick !== 'tails') {
      return res.status(400).json({ error: 'pick must be heads or tails' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    // Biased coin: if rand < WIN_PROB → player wins regardless of pick
    // Else: result is the opposite of pick (house wins)
    const r      = secureFloat();
    let result;
    if (r < WIN_PROB) {
      result = pick;           // player wins
    } else {
      result = pick === 'heads' ? 'tails' : 'heads';   // house wins
    }

    const win    = result === pick;
    const payout = win ? parseFloat((bet * 2).toFixed(2)) : 0;

    if (win) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Coinflip: ' + pick + ' (' + result + ')']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     result,
      pick:       pick,
      win:        win,
      payout:     payout,
      profit:     parseFloat((payout - bet).toFixed(2)),
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Coinflip] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Coinflip' });
  }
});

module.exports = router;
