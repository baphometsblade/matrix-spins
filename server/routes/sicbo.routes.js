const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Sic Bo — 3 dice, multiple bet types.
//
// POST /api/sicbo/play  { bet, betType, betValue? }
// betType options:
//   'big'        — total 11-17 (excl. triple)  pays 1:1,  P≈48.6%
//   'small'      — total 4-10  (excl. triple)  pays 1:1,  P≈48.6%
//   'total'      — exact total (4-17)           varying odds
//   'triple'     — all three same value (1-6)   pays 180:1, P≈2.78% per value, 16.67% any
//   'anytriple'  — any triple                   pays 30:1,  P≈2.78%
//   'double'     — pair of specified value      pays 10:1,  P≈7.41%
//
// Returns: { dice, total, win, payout, profit, newBalance }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;

// Total payout table (pays X:1 for exact total)
// House edge varies — some totals very favourable to house
const TOTAL_PAYOUTS = {
  4:  60,   17: 60,
  5:  30,   16: 30,
  6:  17,   15: 17,
  7:  12,   14: 12,
  8:   8,   13:  8,
  9:   6,   12:  6,
  10:  6,   11:  6,
};

function rollDice() {
  return [
    secureInt(6) + 1,
    secureInt(6) + 1,
    secureInt(6) + 1,
  ];
}

function isTriple(dice) {
  return dice[0] === dice[1] && dice[1] === dice[2];
}

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId   = req.user.id;
    const bet      = parseFloat(req.body.bet);
    const betType  = req.body.betType;
    const betValue = req.body.betValue !== undefined ? parseInt(req.body.betValue, 10) : null;

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }

    const validTypes = ['big', 'small', 'total', 'triple', 'anytriple', 'double'];
    if (!validTypes.includes(betType)) {
      return res.status(400).json({ error: 'Invalid betType' });
    }
    if ((betType === 'total' || betType === 'triple' || betType === 'double') && (betValue === null || isNaN(betValue))) {
      return res.status(400).json({ error: 'betValue required for ' + betType });
    }
    if (betType === 'total' && (betValue < 4 || betValue > 17)) {
      return res.status(400).json({ error: 'total betValue must be 4-17' });
    }
    if (betType === 'triple' && (betValue < 1 || betValue > 6)) {
      return res.status(400).json({ error: 'triple betValue must be 1-6' });
    }
    if (betType === 'double' && (betValue < 1 || betValue > 6)) {
      return res.status(400).json({ error: 'double betValue must be 1-6' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const dice    = rollDice();
    const total   = dice[0] + dice[1] + dice[2];
    const triple  = isTriple(dice);
    const doublesMap = {};
    for (var i = 0; i < 3; i++) doublesMap[dice[i]] = (doublesMap[dice[i]] || 0) + 1;

    let win    = false;
    let multiplier = 0;

    switch (betType) {
      case 'big':
        win = !triple && total >= 11 && total <= 17;
        if (win) multiplier = 1;
        break;
      case 'small':
        win = !triple && total >= 4 && total <= 10;
        if (win) multiplier = 1;
        break;
      case 'total':
        win = total === betValue;
        if (win) multiplier = TOTAL_PAYOUTS[betValue] || 0;
        break;
      case 'triple':
        win = triple && dice[0] === betValue;
        if (win) multiplier = 180;
        break;
      case 'anytriple':
        win = triple;
        if (win) multiplier = 30;
        break;
      case 'double':
        win = (doublesMap[betValue] || 0) >= 2;
        if (win) multiplier = 10;
        break;
    }

    const payout = win ? parseFloat((bet * (multiplier + 1)).toFixed(2)) : 0;   // stake back + profit

    if (win) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Sic Bo: ' + betType + (betValue ? ' ' + betValue : '') + ' (' + dice.join(',') + ')']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      dice:       dice,
      total:      total,
      triple:     triple,
      betType:    betType,
      betValue:   betValue,
      win:        win,
      multiplier: multiplier,
      payout:     payout,
      profit:     parseFloat((payout - bet).toFixed(2)),
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[SicBo] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Sic Bo' });
  }
});

module.exports = router;
