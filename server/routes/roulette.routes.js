const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// European Roulette Route — stateless spin, real European odds (97.3% RTP)
// POST /api/roulette/spin  { bets: [{type, value, amount}] }
//   type values: 'straight'|'red'|'black'|'odd'|'even'|'low'|'high'|'dozen'|'column'
//   value: number (straight), 1/2/3 (dozen/column), unused for red/black/odd/even/low/high
// Returns: { number, color, results, totalBet, totalPayout, newBalance }

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.10;
const MAX_BET    = 500;
const MAX_SINGLE = 500;  // max per individual bet
const SESSION_MAX = 50000;

// Red numbers in European roulette
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function numberColor(n) {
  if (n === 0) return 'green';
  return RED_SET.has(n) ? 'red' : 'black';
}

function spinNumber() {
  return secureInt(37); // 0-36
}

// Returns total payout (stake + winnings) for a single bet, or 0 if lost
function evalBet(type, value, amount, result) {
  switch (type) {
    case 'straight':
      return result === Number(value) ? amount * 36 : 0; // 35:1

    case 'red':
      return result > 0 && RED_SET.has(result) ? amount * 2 : 0; // 1:1

    case 'black':
      return result > 0 && !RED_SET.has(result) ? amount * 2 : 0;

    case 'odd':
      return result > 0 && result % 2 === 1 ? amount * 2 : 0;

    case 'even':
      return result > 0 && result % 2 === 0 ? amount * 2 : 0;

    case 'low':
      return result >= 1 && result <= 18 ? amount * 2 : 0;

    case 'high':
      return result >= 19 && result <= 36 ? amount * 2 : 0;

    case 'dozen': {
      var d = Number(value);
      var inD = d === 1 ? (result >= 1 && result <= 12)
              : d === 2 ? (result >= 13 && result <= 24)
              :            (result >= 25 && result <= 36);
      return inD ? amount * 3 : 0; // 2:1
    }

    case 'column': {
      var col = Number(value);
      // col 1: numbers % 3 === 1 (1,4,7,...34)
      // col 2: numbers % 3 === 2 (2,5,8,...35)
      // col 3: numbers % 3 === 0 (3,6,9,...36) — excludes 0
      var inC = result > 0 && result % 3 === (col === 3 ? 0 : col);
      return inC ? amount * 3 : 0;
    }

    default:
      return 0;
  }
}

const VALID_TYPES = new Set(['straight','red','black','odd','even','low','high','dozen','column']);

router.post('/spin', authenticate, async function(req, res) {
  try {
    var bets = req.body.bets;
    if (!Array.isArray(bets) || bets.length === 0) {
      return res.status(400).json({ error: 'bets must be a non-empty array' });
    }
    if (bets.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 bets per spin' });
    }

    // Validate each bet
    var totalBet = 0;
    for (var i = 0; i < bets.length; i++) {
      var b = bets[i];
      if (!VALID_TYPES.has(b.type)) {
        return res.status(400).json({ error: 'Invalid bet type: ' + b.type });
      }
      var amt = parseFloat(b.amount) || 0;
      if (amt < MIN_BET || amt > MAX_SINGLE) {
        return res.status(400).json({ error: 'Bet amount out of range ($0.10 – $500)' });
      }
      bets[i].amount = amt;
      totalBet += amt;
    }
    if (totalBet > MAX_BET * 20) {
      return res.status(400).json({ error: 'Total bet too large' });
    }

    var userId = req.user.id;
    var user   = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    var balance = parseFloat(user.balance) || 0;
    if (balance < totalBet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Deduct bets
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [totalBet, userId]);

    // Spin
    var result = spinNumber();
    var color  = numberColor(result);

    // Evaluate bets
    var totalPayout = 0;
    var results = bets.map(function(b) {
      var payout = evalBet(b.type, b.value, b.amount, result);
      var won    = payout > 0;
      totalPayout += payout;
      return {
        type:   b.type,
        value:  b.value,
        amount: b.amount,
        payout: payout,
        won:    won,
        profit: parseFloat((payout - b.amount).toFixed(2)),
      };
    });

    // Apply session cap
    if (totalPayout > SESSION_MAX) totalPayout = SESSION_MAX;
    totalPayout = parseFloat(totalPayout.toFixed(2));

    // Credit winnings
    if (totalPayout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [totalPayout, userId]);
      var profit = parseFloat((totalPayout - totalBet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Roulette win on ' + result + ' (' + color + ')']
        ).catch(function() {}); // non-critical
      }
    }

    var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:      true,
      number:       result,
      color:        color,
      results:      results,
      totalBet:     parseFloat(totalBet.toFixed(2)),
      totalPayout:  totalPayout,
      profit:       parseFloat((totalPayout - totalBet).toFixed(2)),
      newBalance:   updated ? parseFloat(updated.balance) : null,
    });

  } catch (err) {
    console.error('[Roulette] POST /spin error:', err.message);
    return res.status(500).json({ error: 'Failed to process spin' });
  }
});

module.exports = router;
