const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Casino War — player and dealer each draw one card; higher card wins.
// On tie: player can Surrender (lose half) or Go to War (double bet, extra card each).
//
// POST /api/casinowar/play   { bet }
//   → { playerCard, dealerCard, result: 'win'|'lose'|'tie', payout, profit, newBalance }
//
// POST /api/casinowar/war    { bet, warBet }  (called when result='tie', warBet = extra bet = original bet)
//   → { playerCard, dealerCard, playerWarCard, dealerWarCard, result, payout, profit, newBalance }
//
// Card values: A=14 (highest), K=13, Q=12, J=11, 10-2 face value
// House edge: ~2.88% on main game
//             Tie bet (8:1) available — but for simplicity, just main + war logic

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;

const SUITS  = ['H', 'D', 'C', 'S'];
const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function randomCard() {
  const suit  = SUITS[secureInt(SUITS.length)];
  const rank  = RANKS[secureInt(RANKS.length)];
  return { r: rank, s: suit, v: VALUES[rank] };
}

// ── POST /play ───────────────────────────────────────────────────────────────

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const playerCard = randomCard();
    const dealerCard = randomCard();

    let result, payout;
    if (playerCard.v > dealerCard.v) {
      result = 'win';
      payout = parseFloat((bet * 2).toFixed(2));
    } else if (playerCard.v < dealerCard.v) {
      result = 'lose';
      payout = 0;
    } else {
      result = 'tie';
      // Bet is held — returned to player while they decide (surrender or war)
      payout = bet;   // hold amount (will be re-deducted or refunded in /war)
    }

    if (result === 'win') {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Casino War: win (' + playerCard.r + ' vs ' + dealerCard.r + ')']
        ).catch(function() {});
      }
    } else if (result === 'tie') {
      // Return stake to balance temporarily so player can decide
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [bet, userId]);
    }
    // lose: nothing to add back

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      playerCard: playerCard,
      dealerCard: dealerCard,
      result:     result,
      bet:        bet,
      payout:     result === 'win' ? payout : (result === 'tie' ? bet : 0),
      profit:     result === 'win' ? parseFloat((payout - bet).toFixed(2)) : (result === 'tie' ? 0 : parseFloat((-bet).toFixed(2))),
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[CasinoWar] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Casino War' });
  }
});

// ── POST /war (on tie — player goes to war) ──────────────────────────────────

router.post('/war', authenticate, async function(req, res) {
  try {
    const userId    = req.user.id;
    const bet       = parseFloat(req.body.bet);       // original bet
    const warChoice = req.body.warChoice;             // 'war' or 'surrender'

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Invalid bet amount' });
    }
    if (warChoice !== 'war' && warChoice !== 'surrender') {
      return res.status(400).json({ error: 'warChoice must be war or surrender' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (warChoice === 'surrender') {
      // Lose half the bet; balance already has bet returned from /play
      const surrender = parseFloat((bet / 2).toFixed(2));
      await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [surrender, userId]);
      const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      return res.json({
        success:     true,
        warChoice:   'surrender',
        surrendered: surrender,
        profit:      parseFloat((-surrender).toFixed(2)),
        newBalance:  u ? parseFloat(u.balance) : null,
      });
    }

    // Go to War — player must post another bet equal to original
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance to go to war' });
    }
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const playerWarCard = randomCard();
    const dealerWarCard = randomCard();

    let result, payout;
    if (playerWarCard.v >= dealerWarCard.v) {
      // Win war — player wins ONLY the war bet (original bet is push/returned)
      result = 'win';
      payout = parseFloat((bet * 3).toFixed(2));   // war bet back + original bet back + 1x profit on war bet
    } else {
      result = 'lose';
      payout = 0;
    }

    if (result === 'win') {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((bet).toFixed(2));   // net profit = 1x war bet
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Casino War: war win (' + playerWarCard.r + ' vs ' + dealerWarCard.r + ')']
        ).catch(function() {});
      }
    }
    // lose: both original bet (already deducted) and war bet (just deducted) are lost

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:        true,
      warChoice:      'war',
      playerWarCard:  playerWarCard,
      dealerWarCard:  dealerWarCard,
      result:         result,
      payout:         payout,
      profit:         result === 'win' ? parseFloat((bet).toFixed(2)) : parseFloat((-bet * 2).toFixed(2)),
      newBalance:     u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[CasinoWar] POST /war error:', err.message);
    return res.status(500).json({ error: 'Failed to process war' });
  }
});

module.exports = router;
