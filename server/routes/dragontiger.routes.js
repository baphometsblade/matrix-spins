const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Dragon Tiger — simplest card game; one card each, higher wins.
// POST /api/dragontiger/play  { bet, betOn: 'dragon'|'tiger'|'tie'|'dragonSuit'|'tigerSuit' }
//   → { dragonCard, tigerCard, winner, betOn, multiplier, payout, profit, newBalance }
//
// Payouts:
//   dragon / tiger   1:1  (push on tie — stake returned)
//   tie              8:1
//   dragonSuit/tigerSuit (big/small) — suit bet (spades/clubs = big, hearts/diamonds = small)
//     NOT implemented for now; keep API clean for main bets only.
//
// House edge: ~3.73% on dragon/tiger (tie probability ~7.7% causes push instead of win)
//             ~32%   on tie bet

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;

const SUITS  = ['H', 'D', 'C', 'S'];
const RANKS  = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const VALUES = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, J:11, Q:12, K:13 };

function randomCard() {
  const suit  = SUITS[secureInt(SUITS.length)];
  const rank  = RANKS[secureInt(RANKS.length)];
  return { r: rank, s: suit, v: VALUES[rank] };
}

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    const betOn  = req.body.betOn;

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }
    const validBets = ['dragon', 'tiger', 'tie'];
    if (!validBets.includes(betOn)) {
      return res.status(400).json({ error: 'betOn must be dragon, tiger, or tie' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const dragonCard = randomCard();
    const tigerCard  = randomCard();

    let winner;
    if (dragonCard.v > tigerCard.v)       winner = 'dragon';
    else if (tigerCard.v > dragonCard.v)  winner = 'tiger';
    else                                  winner = 'tie';

    let multiplier = 0;
    let payout     = 0;

    if (winner === 'tie') {
      if (betOn === 'tie') {
        multiplier = 8;
        payout     = parseFloat((bet * multiplier).toFixed(2));
      } else {
        // Push — return stake
        multiplier = 1;
        payout     = bet;
      }
    } else if (winner === betOn) {
      multiplier = 1;
      payout     = parseFloat((bet * 2).toFixed(2));   // stake back + 1:1 profit
    }
    // else: loss — payout stays 0

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    }

    const profit = parseFloat((payout - bet).toFixed(2));
    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Dragon Tiger: ' + betOn + ' (' + winner + ' wins)']
      ).catch(function() {});
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      dragonCard: dragonCard,
      tigerCard:  tigerCard,
      winner:     winner,
      betOn:      betOn,
      multiplier: multiplier,
      payout:     payout,
      profit:     profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[DragonTiger] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Dragon Tiger' });
  }
});

module.exports = router;
