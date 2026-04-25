const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Caribbean Stud Poker
// Player posts an Ante bet, receives 5 cards; dealer shows 1 card up.
// Player decides: Fold (lose ante) or Call (post 2x ante raise bet).
// Dealer qualifies with A-K or better.  If dealer doesn't qualify, ante
// pays 1:1 and raise pushes.  If dealer qualifies and player wins,
// ante pays 1:1 and raise pays by hand rank paytable.
//
// Endpoints:
//   POST /api/caribbeanstud/deal   { bet }           → { playerCards, dealerUp, gameId }
//   POST /api/caribbeanstud/fold   { gameId }        → { result:'fold', payout:0 }
//   POST /api/caribbeanstud/call   { gameId }        → { result, playerHand, dealerHand,
//                                                         payout, profit, newBalance }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.50;
const MAX_BET    = 250;

const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS  = ['\u2660','\u2665','\u2666','\u2663'];
const VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 };

function buildDeck() {
  var deck = [];
  SUITS.forEach(function(s) {
    RANKS.forEach(function(r) {
      deck.push({ rank: r, suit: s, value: VALUES[r] });
    });
  });
  return deck;
}

function shuffle(deck) {
  for (var i = deck.length - 1; i > 0; i--) {
    var j = secureInt((i + 1));
    var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

function dealCards(n, deck, idx) {
  var hand = [];
  for (var i = 0; i < n; i++) hand.push(deck[idx + i]);
  return hand;
}

// ── Hand evaluator ────────────────────────────────────────────────────────────
// Returns { rank: 0-8, name: string }
// 8=Royal Flush, 7=Str.Flush, 6=Four-of-a-kind, 5=Full House,
// 4=Flush, 3=Straight, 2=Three-of-a-kind, 1=Two pair, 0=Pair, -1=High card

function evalHand(cards) {
  var vals = cards.map(function(c) { return c.value; }).sort(function(a,b){return b-a;});
  var suits = cards.map(function(c) { return c.suit; });
  var rankCounts = {};
  vals.forEach(function(v) { rankCounts[v] = (rankCounts[v] || 0) + 1; });
  var counts = Object.values(rankCounts).sort(function(a,b){return b-a;});

  var isFlush   = suits.every(function(s) { return s === suits[0]; });
  var isStraight = false;
  var uvs = Object.keys(rankCounts).map(Number).sort(function(a,b){return b-a;});
  if (uvs.length === 5) {
    if (uvs[0] - uvs[4] === 4) isStraight = true;
    // Ace-low straight A-2-3-4-5
    if (uvs[0] === 14 && uvs[1] === 5 && uvs[2] === 4 && uvs[3] === 3 && uvs[4] === 2) {
      isStraight = true;
    }
  }

  if (isFlush && isStraight) {
    return { rank: vals[0] === 14 && vals[1] === 13 ? 9 : 7, name: vals[0] === 14 && vals[1] === 13 ? 'Royal Flush' : 'Straight Flush' };
  }
  if (counts[0] === 4) return { rank: 6, name: 'Four of a Kind' };
  if (counts[0] === 3 && counts[1] === 2) return { rank: 5, name: 'Full House' };
  if (isFlush)    return { rank: 4, name: 'Flush' };
  if (isStraight) return { rank: 3, name: 'Straight' };
  if (counts[0] === 3) return { rank: 2, name: 'Three of a Kind' };
  if (counts[0] === 2 && counts[1] === 2) return { rank: 1, name: 'Two Pair' };
  if (counts[0] === 2) return { rank: 0, name: 'Pair' };
  return { rank: -1, name: 'High Card' };
}

// Raise paytable (pays on raise bet)
var RAISE_PAY = { 9:100, 7:50, 6:20, 5:7, 4:5, 3:4, 2:3, 1:2, 0:1, '-1':1 };

function dealerQualifies(hand) {
  var ev = evalHand(hand);
  if (ev.rank > -1) return true; // any pair or better qualifies
  // High card: qualifies only with A-K high or better
  var vals = hand.map(function(c){return c.value;}).sort(function(a,b){return b-a;});
  return vals[0] === 14 && vals[1] === 13; // A+K present
}

// Compare hands numerically; returns 1=player wins, 0=tie, -1=dealer wins
function compareHands(ph, dh) {
  if (ph.rank !== dh.rank) return ph.rank > dh.rank ? 1 : -1;
  // Same rank — compare kicker values (already sorted desc by caller)
  var pv = ph.vals, dv = dh.vals;
  for (var i = 0; i < 5; i++) {
    if (pv[i] > dv[i]) return 1;
    if (pv[i] < dv[i]) return -1;
  }
  return 0;
}

// In-memory game store
var _games = {};
var GAME_TTL = 10 * 60 * 1000;

function cleanGames() {
  var now = Date.now();
  Object.keys(_games).forEach(function(id) {
    if (now - _games[id].ts > GAME_TTL) delete _games[id];
  });
}

function newGameId() {
  return _crypto.randomBytes(6).toString('hex')+Date.now().toString(36);
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

    // Deduct ante
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var deck = shuffle(buildDeck());
    var playerCards = dealCards(5, deck, 0);
    var dealerCards = dealCards(5, deck, 5);

    const gameId = newGameId();
    _games[gameId] = {
      userId:      userId,
      bet:         bet,
      playerCards: playerCards,
      dealerCards: dealerCards,
      ts:          Date.now(),
      over:        false,
    };

    return res.json({
      success:     true,
      gameId:      gameId,
      playerCards: playerCards,
      dealerUp:    dealerCards[0],  // only first card shown
    });
  } catch (err) {
    console.error('[CStud] POST /deal error:', err.message);
    return res.status(500).json({ error: 'Failed to deal' });
  }
});

// ── POST /fold ────────────────────────────────────────────────────────────────

router.post('/fold', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over)              return res.status(400).json({ error: 'Game already over' });

    game.over = true;
    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     'fold',
      payout:     0,
      profit:     -game.bet,
      newBalance: u ? parseFloat(u.balance) : null,
      dealerCards: game.dealerCards,
    });
  } catch (err) {
    console.error('[CStud] POST /fold error:', err.message);
    return res.status(500).json({ error: 'Failed to fold' });
  }
});

// ── POST /call ────────────────────────────────────────────────────────────────

router.post('/call', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over)              return res.status(400).json({ error: 'Game already over' });

    // Deduct call bet (2x ante)
    const callBet = game.bet * 2;
    const user    = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < callBet) {
      return res.status(400).json({ error: 'Insufficient balance for call' });
    }
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [callBet, userId]);

    // Evaluate
    var ph = evalHand(game.playerCards);
    var dh = evalHand(game.dealerCards);

    // Kicker arrays for tiebreaker
    ph.vals = game.playerCards.map(function(c){return c.value;}).sort(function(a,b){return b-a;});
    dh.vals = game.dealerCards.map(function(c){return c.value;}).sort(function(a,b){return b-a;});

    var totalBet = game.bet + callBet; // ante + call = 3x ante
    var payout   = 0;
    var result;

    if (!dealerQualifies(game.dealerCards)) {
      // Dealer doesn't qualify: ante pays 1:1, call pushes
      payout = game.bet * 2 + callBet; // ante win + ante stake + call stake back
      result = 'no-qualify';
    } else {
      var cmp = compareHands(ph, dh);
      if (cmp > 0) {
        // Player wins
        var raisePay = RAISE_PAY[String(ph.rank)] || 1;
        payout = game.bet * 2 + callBet + callBet * raisePay; // 2x ante (win+stake) + call stake + raise payout
        result = 'win';
      } else if (cmp === 0) {
        // Tie: push everything
        payout = totalBet;
        result = 'tie';
      } else {
        // Dealer wins: already deducted both bets
        payout = 0;
        result = 'lose';
      }
    }

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    }

    var profit = parseFloat((payout - totalBet).toFixed(2));
    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Caribbean Stud: ' + ph.name]
      ).catch(function() {});
    }

    game.over = true;
    delete _games[gameId];

    const u2 = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:     true,
      result:      result,
      playerHand:  { cards: game.playerCards, name: ph.name, rank: ph.rank },
      dealerHand:  { cards: game.dealerCards, name: dh.name, rank: dh.rank },
      payout:      parseFloat(payout.toFixed(2)),
      profit:      profit,
      newBalance:  u2 ? parseFloat(u2.balance) : null,
    });
  } catch (err) {
    console.error('[CStud] POST /call error:', err.message);
    return res.status(500).json({ error: 'Failed to call' });
  }
});

module.exports = router;
