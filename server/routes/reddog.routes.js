const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Red Dog (Acey-Deucey) — two cards are dealt; player bets whether the third
// card will fall strictly between them in rank.
//
// Rules:
//   Consecutive ranks (spread 0): push — bet returned.
//   Pair (equal ranks): if third card matches → 11:1; else push.
//   Spread 1: 5:1   Spread 2: 4:1   Spread 3: 2:1   Spread 4+: 1:1
//   Player may RAISE (double the bet) before the third card is dealt.
//
// POST /api/reddog/deal   { bet }        → { card1, card2, spread, gameId }
// POST /api/reddog/raise  { gameId }     → { card3, win, payout, profit, newBalance }
// POST /api/reddog/stand  { gameId }     → { card3, win, payout, profit, newBalance }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.25;
const MAX_BET    = 500;
const HOUSE_EDGE = 0.028;   // ~2.8%

const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS  = ['\u2660','\u2665','\u2666','\u2663'];
const VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 };

function randomCard() {
  var rank = RANKS[secureInt(RANKS.length)];
  var suit = SUITS[secureInt(SUITS.length)];
  return { rank: rank, suit: suit, value: VALUES[rank] };
}

// Payout multiplier based on spread (n ranks strictly between the two cards)
function spreadPayout(spread) {
  if (spread === 1) return 5;
  if (spread === 2) return 4;
  if (spread === 3) return 2;
  return 1;  // spread 4–11
}

// In-memory game store (TTL 10 min)
var _games  = {};
var GAME_TTL = 10 * 60 * 1000;

function cleanGames() {
  var now = Date.now();
  Object.keys(_games).forEach(function(id) {
    if (now - _games[id].ts > GAME_TTL) delete _games[id];
  });
}

function newGameId() {
  return _crypto.randomBytes(5).toString('hex')+Date.now().toString(36);
}

// ── POST /deal ────────────────────────────────────────────────────────────────

router.post('/deal', authenticate, async function(req, res) {
  try {
    cleanGames();
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

    // Deduct initial bet
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var card1 = randomCard();
    var card2 = randomCard();

    // Ensure card2 is different from card1 (for spread clarity; re-draw once if needed)
    var attempts = 0;
    while (card2.value === card1.value && attempts++ < 10) {
      card2 = randomCard();
    }

    // Sort so card1.value <= card2.value
    if (card1.value > card2.value) { var tmp = card1; card1 = card2; card2 = tmp; }

    var spread = card2.value - card1.value - 1;  // ranks strictly between

    var gameId = newGameId();
    _games[gameId] = {
      userId: userId,
      bet:    bet,
      card1:  card1,
      card2:  card2,
      spread: spread,
      raised: false,
      ts:     Date.now(),
    };

    return res.json({
      success: true,
      gameId:  gameId,
      card1:   card1,
      card2:   card2,
      spread:  spread,
    });
  } catch (err) {
    console.error('[RedDog] POST /deal error:', err.message);
    return res.status(500).json({ error: 'Failed to deal' });
  }
});

// ── shared resolve (used by raise and stand) ──────────────────────────────────

async function resolveGame(gameId, userId, raise, res) {
  const game = _games[gameId];
  if (!game)               return res.status(400).json({ error: 'Game not found' });
  if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });

  const spread = game.spread;
  var   totalBet = game.bet;

  if (raise) {
    // Deduct extra bet equal to original
    const user2 = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user2 || parseFloat(user2.balance) < game.bet) {
      return res.status(400).json({ error: 'Insufficient balance to raise' });
    }
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [game.bet, userId]);
    totalBet = game.bet * 2;
    game.raised = true;
  }

  var card3  = randomCard();
  var payout = 0;
  var win    = false;

  // Consecutive (spread === 0 before re-draw adjusted): actually spread = card2.v - card1.v - 1
  // If cards are equal (spread = -1 after re-draw, but we re-drew so spread >= 0 usually)
  // Handle pair (original draw could have been a pair on second re-draw fail)
  if (card1value(game) === card2value(game)) {
    // Pair: third card same rank → 11:1 on total bet; else push
    if (card3.value === game.card1.value) {
      payout = totalBet + totalBet * 11;
      win    = true;
    } else {
      payout = totalBet;  // push
      win    = false;
    }
  } else if (spread === 0) {
    // Consecutive: always push
    payout = totalBet;
    win    = false;
  } else {
    // Normal spread
    if (card3.value > game.card1.value && card3.value < game.card2.value) {
      var mult = spreadPayout(spread);
      payout   = totalBet + totalBet * mult;
      win      = true;
    } else {
      // Miss — house edge via probability: we apply no further bias, just natural odds
      payout = 0;
      win    = false;
    }
  }

  // Pay out
  if (payout > 0) {
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
  }

  var profit = parseFloat((payout - totalBet).toFixed(2));

  if (profit > 0) {
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
      [userId, profit, 'Red Dog: spread ' + spread + ', ' + (raise ? 'raised' : 'stood')]
    ).catch(function() {});
  }

  delete _games[gameId];

  const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
  return res.json({
    success:    true,
    card3:      card3,
    win:        win,
    payout:     payout,
    profit:     profit,
    totalBet:   totalBet,
    newBalance: u ? parseFloat(u.balance) : null,
  });
}

function card1value(game) { return game.card1.value; }
function card2value(game) { return game.card2.value; }

// ── POST /raise ────────────────────────────────────────────────────────────────

router.post('/raise', authenticate, async function(req, res) {
  try {
    await resolveGame(req.body.gameId, req.user.id, true, res);
  } catch (err) {
    console.error('[RedDog] POST /raise error:', err.message);
    return res.status(500).json({ error: 'Failed to raise' });
  }
});

// ── POST /stand ────────────────────────────────────────────────────────────────

router.post('/stand', authenticate, async function(req, res) {
  try {
    await resolveGame(req.body.gameId, req.user.id, false, res);
  } catch (err) {
    console.error('[RedDog] POST /stand error:', err.message);
    return res.status(500).json({ error: 'Failed to stand' });
  }
});

module.exports = router;
