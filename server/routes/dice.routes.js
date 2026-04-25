const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Dice Game Route — "Roll Over / Roll Under" style, 97% RTP
// Player picks: a target number (2–98) and direction (over|under).
// The roll result is 0–100 (2 decimal places).
// POST /api/dice/roll  { bet, target, direction }
// Returns: { roll, won, payout, newBalance, chance, multiplier }

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.10;
const MAX_BET  = 1000;
const RTP      = 0.97;
const MIN_WIN_CHANCE = 1;   // 1% minimum win probability
const MAX_WIN_CHANCE = 97;  // 97% maximum win probability

// Win chance = % of numbers that result in a win
// Multiplier  = RTP / (winChance / 100)
function calcChanceAndMult(target, direction) {
  // roll is 0.00 – 100.00 (uniform), but we snap to 2dp.
  // For "over N": winning range is (N, 100] → chance = 100 - N
  // For "under N": winning range is [0, N) → chance = N
  var chance = direction === 'over' ? (100 - target) : target;
  chance = Math.max(MIN_WIN_CHANCE, Math.min(MAX_WIN_CHANCE, chance));
  var mult = parseFloat((RTP / (chance / 100)).toFixed(4));
  return { chance: chance, multiplier: mult };
}

function rollDice() {
  // 0.00 – 100.00 uniform
  return parseFloat((secureFloat() * 100).toFixed(2));
}

function didWin(roll, target, direction) {
  return direction === 'over' ? roll > target : roll < target;
}

router.post('/roll', authenticate, async function(req, res) {
  try {
    var bet       = parseFloat(req.body.bet)    || 1.0;
    var target    = parseFloat(req.body.target) || 50;
    var direction = req.body.direction;          // 'over' | 'under'

    if (bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet out of range ($0.10 – $1,000)' });
    }
    if (direction !== 'over' && direction !== 'under') {
      return res.status(400).json({ error: 'direction must be "over" or "under"' });
    }
    target = Math.max(1, Math.min(99, target));

    var cm = calcChanceAndMult(target, direction);
    if (cm.chance < MIN_WIN_CHANCE || cm.chance > MAX_WIN_CHANCE) {
      return res.status(400).json({ error: 'Win chance must be between 1% and 97%' });
    }

    var userId = req.user.id;
    var user   = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    var balance = parseFloat(user.balance) || 0;
    if (balance < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var roll    = rollDice();
    var won     = didWin(roll, target, direction);
    var payout  = won ? parseFloat((bet * cm.multiplier).toFixed(2)) : 0;

    if (won && payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      var profit = parseFloat((payout - bet).toFixed(2));
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Dice win: rolled ' + roll + ' ' + direction + ' ' + target + ' (' + cm.multiplier + 'x)']
      ).catch(function() {});
    }

    var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      roll:       roll,
      target:     target,
      direction:  direction,
      won:        won,
      chance:     cm.chance,
      multiplier: cm.multiplier,
      bet:        bet,
      payout:     payout,
      profit:     parseFloat((payout - bet).toFixed(2)),
      newBalance: updated ? parseFloat(updated.balance) : null,
    });

  } catch (err) {
    console.error('[Dice] POST /roll error:', err.message);
    return res.status(500).json({ error: 'Failed to process roll' });
  }
});

module.exports = router;
