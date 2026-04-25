const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Baccarat — classic punto banco rules
// POST /api/baccarat/play  { bet, betOn: 'player'|'banker'|'tie' }
//   → { success, playerCards, bankerCards, playerTotal, bankerTotal,
//       winner, payout, multiplier, newBalance }
//
// Payouts: player 1:1, banker 0.95:1 (5% commission), tie 8:1
// House edge: banker ~1.06%, player ~1.24%, tie ~14.4%

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.50;
const MAX_BET = 1000;
const SUITS   = ['H', 'D', 'C', 'S'];

// ── deck / card helpers ──────────────────────────────────────────────────────

function buildShoe() {
  // 6-deck shoe, shuffled
  const cards = [];
  for (let d = 0; d < 6; d++) {
    for (const s of SUITS) {
      for (let v = 1; v <= 13; v++) {
        cards.push({ s, v });
      }
    }
  }
  // Fisher-Yates
  for (let i = cards.length - 1; i > 0; i--) {
    const j = secureInt((i + 1));
    const tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
  }
  return cards;
}

function baccValue(v) {
  // Face cards and 10 = 0; ace = 1; others face value
  if (v >= 10) return 0;
  return v;
}

function handTotal(cards) {
  return cards.reduce(function(sum, c) { return sum + baccValue(c.v); }, 0) % 10;
}

function cardLabel(v) {
  if (v === 1)  return 'A';
  if (v === 11) return 'J';
  if (v === 12) return 'Q';
  if (v === 13) return 'K';
  return String(v);
}

function publicCard(c) {
  return { s: c.s, v: c.v, l: cardLabel(c.v) };
}

// ── third-card rules (punto banco standard) ──────────────────────────────────

function dealHand(shoe) {
  // Initial deal: 2 cards each, alternating P-B-P-B
  const player = [shoe.pop(), shoe.pop()];
  const banker  = [shoe.pop(), shoe.pop()];

  let pTotal = handTotal(player);
  let bTotal = handTotal(banker);

  // Natural: 8 or 9 — no more cards
  if (pTotal >= 8 || bTotal >= 8) {
    return { player, banker };
  }

  // Player third card rule
  let playerDrewThird = false;
  let playerThirdVal  = null;
  if (pTotal <= 5) {
    const card = shoe.pop();
    player.push(card);
    playerDrewThird = true;
    playerThirdVal  = baccValue(card.v);
    pTotal = handTotal(player);
  }

  // Banker third card rule
  if (!playerDrewThird) {
    // Player stood on 6 or 7
    if (bTotal <= 5) {
      banker.push(shoe.pop());
    }
  } else {
    // Banker draws based on banker total and player's third card value
    const b = bTotal;
    const p3 = playerThirdVal;
    let bankerDraws = false;
    if (b <= 2) {
      bankerDraws = true;
    } else if (b === 3) {
      bankerDraws = (p3 !== 8);
    } else if (b === 4) {
      bankerDraws = (p3 >= 2 && p3 <= 7);
    } else if (b === 5) {
      bankerDraws = (p3 >= 4 && p3 <= 7);
    } else if (b === 6) {
      bankerDraws = (p3 === 6 || p3 === 7);
    }
    // b === 7: banker stands
    if (bankerDraws) {
      banker.push(shoe.pop());
    }
  }

  return { player, banker };
}

// ── route ─────────────────────────────────────────────────────────────────────

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    const betOn  = req.body.betOn; // 'player' | 'banker' | 'tie'

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + '\u2013$' + MAX_BET });
    }
    if (!['player', 'banker', 'tie'].includes(betOn)) {
      return res.status(400).json({ error: "betOn must be 'player', 'banker', or 'tie'" });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const shoe = buildShoe();
    const { player, banker } = dealHand(shoe);

    const pTotal = handTotal(player);
    const bTotal = handTotal(banker);

    let winner;
    if (pTotal > bTotal)       winner = 'player';
    else if (bTotal > pTotal)  winner = 'banker';
    else                       winner = 'tie';

    // Compute payout multiplier
    let multiplier = 0;
    if (betOn === winner) {
      if (winner === 'player') multiplier = 1.0;        // 1:1
      if (winner === 'banker') multiplier = 0.95;       // 1:1 minus 5% commission
      if (winner === 'tie')    multiplier = 8.0;        // 8:1
    } else if (betOn !== 'tie' && winner === 'tie') {
      // tie pushes player/banker bets (return stake, no win)
      multiplier = -1; // special: return bet but no win
    }

    let payout;
    if (multiplier === -1) {
      // Push: return the bet
      payout = parseFloat(bet.toFixed(2));
      multiplier = 0; // report as 0 profit
    } else {
      payout = parseFloat(((1 + multiplier) * bet).toFixed(2));
    }

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Baccarat: ' + betOn + ' wins (' + winner + ')']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:      true,
      playerCards:  player.map(publicCard),
      bankerCards:  banker.map(publicCard),
      playerTotal:  pTotal,
      bankerTotal:  bTotal,
      winner:       winner,
      betOn:        betOn,
      multiplier:   parseFloat(multiplier.toFixed(2)),
      payout:       payout,
      profit:       parseFloat((payout - bet).toFixed(2)),
      newBalance:   u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Baccarat] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Baccarat' });
  }
});

module.exports = router;
