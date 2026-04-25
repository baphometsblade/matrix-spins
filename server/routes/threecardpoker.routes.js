const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Three Card Poker
// Player posts Ante (+ optional Pair Plus side bet), receives 3 cards.
// Player: Fold (lose both bets) or Play (post equal raise).
// Dealer qualifies with Q-high or better.
//
// Ante pay (when dealer qualifies + player wins):
//   Straight Flush 5:1  |  Three of a Kind 4:1  |  Straight 1:1  |  Flush 1:1  |  Pair 1:1  | High card 1:1
// Pair Plus (independent, always pays if player has pair+):
//   Straight Flush 40:1  |  Three of a Kind 30:1  |  Straight 6:1  |  Flush 4:1  |  Pair 1:1
// Ante Bonus (paid regardless of dealer outcome on player hands ≥ straight):
//   Straight Flush 5:1  |  Three of a Kind 4:1  |  Straight 1:1
//
// Endpoints:
//   POST /api/threecardpoker/deal  { bet, pairPlus? }  → { playerCards, dealerUp, gameId }
//   POST /api/threecardpoker/fold  { gameId }          → { result, payout, profit, newBalance }
//   POST /api/threecardpoker/play  { gameId }          → { result, playerHand, dealerHand, payout, profit, newBalance }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.50;
const MAX_BET  = 250;

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

// ── 3-card evaluator ──────────────────────────────────────────────────────────
// ranks: 6=Straight Flush, 5=Three-of-a-kind, 4=Straight, 3=Flush, 2=Pair, 1=High card
function eval3(cards) {
  var vals  = cards.map(function(c){return c.value;}).sort(function(a,b){return b-a;});
  var suits = cards.map(function(c){return c.suit;});
  var isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  var unique  = [vals[0], vals[1], vals[2]];
  var span    = unique[0] - unique[2];
  var isStraight = (new Set(unique).size === 3) && span === 2;
  // A-2-3 special straight
  if (!isStraight && unique[0] === 14 && unique[1] === 3 && unique[2] === 2) isStraight = true;

  if (isFlush && isStraight) return { rank: 6, name: 'Straight Flush', vals: vals };
  if (vals[0] === vals[1] && vals[1] === vals[2]) return { rank: 5, name: 'Three of a Kind', vals: vals };
  if (isStraight) return { rank: 4, name: 'Straight', vals: vals };
  if (isFlush)    return { rank: 3, name: 'Flush', vals: vals };
  if (vals[0] === vals[1] || vals[1] === vals[2]) return { rank: 2, name: 'Pair', vals: vals };
  return { rank: 1, name: 'High Card', vals: vals };
}

function dealerQualifies3(hand) {
  var ev = eval3(hand);
  if (ev.rank >= 2) return true;  // pair or better always qualifies
  // High card: qualifies with Q-high or better
  var vals = hand.map(function(c){return c.value;}).sort(function(a,b){return b-a;});
  return vals[0] >= 12; // Q=12
}

function compareHands3(ph, dh) {
  if (ph.rank !== dh.rank) return ph.rank > dh.rank ? 1 : -1;
  for (var i = 0; i < 3; i++) {
    if (ph.vals[i] > dh.vals[i]) return 1;
    if (ph.vals[i] < dh.vals[i]) return -1;
  }
  return 0;
}

// Pair Plus paytable
var PP_PAY = { 6: 40, 5: 30, 4: 6, 3: 4, 2: 1 };
// Ante bonus (on play hands, regardless of dealer)
var ANTE_BONUS = { 6: 5, 5: 4, 4: 1 };

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
    const userId   = req.user.id;
    const ante     = parseFloat(req.body.bet);
    const pairPlus = parseFloat(req.body.pairPlus) || 0;

    if (isNaN(ante) || ante < MIN_BET || ante > MAX_BET) {
      return res.status(400).json({ error: 'Ante must be $' + MIN_BET + '\u2013$' + MAX_BET });
    }
    if (pairPlus < 0 || pairPlus > MAX_BET) {
      return res.status(400).json({ error: 'Pair Plus bet invalid' });
    }

    const totalDeduct = ante + pairPlus;
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < totalDeduct) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [totalDeduct, userId]);

    var deck = shuffle(buildDeck());
    var playerCards = [deck[0], deck[1], deck[2]];
    var dealerCards = [deck[3], deck[4], deck[5]];

    const gameId = newGameId();
    _games[gameId] = {
      userId:      userId,
      ante:        ante,
      pairPlus:    pairPlus,
      playerCards: playerCards,
      dealerCards: dealerCards,
      ts:          Date.now(),
      over:        false,
    };

    return res.json({
      success:     true,
      gameId:      gameId,
      playerCards: playerCards,
      dealerUp:    dealerCards[0],
    });
  } catch (err) {
    console.error('[3CP] POST /deal error:', err.message);
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
    if (game.over) return res.status(400).json({ error: 'Game over' });

    game.over = true;
    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     'fold',
      payout:     0,
      profit:     -(game.ante + game.pairPlus),
      newBalance: u ? parseFloat(u.balance) : null,
      dealerCards: game.dealerCards,
    });
  } catch (err) {
    console.error('[3CP] POST /fold error:', err.message);
    return res.status(500).json({ error: 'Failed to fold' });
  }
});

// ── POST /play ────────────────────────────────────────────────────────────────

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;
    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over) return res.status(400).json({ error: 'Game over' });

    // Deduct play bet (= ante)
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < game.ante) {
      return res.status(400).json({ error: 'Insufficient balance for play bet' });
    }
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [game.ante, userId]);

    var ph = eval3(game.playerCards);
    var dh = eval3(game.dealerCards);

    var payout  = 0;
    var result;
    var totalIn = game.ante * 2 + game.pairPlus;

    // ── Pair Plus payout (always, independent of dealer) ──
    var ppPay = PP_PAY[ph.rank];
    if (ppPay && game.pairPlus > 0) {
      payout += game.pairPlus + game.pairPlus * ppPay;
    }
    // Pair Plus is lost if no qualifying hand (already deducted)

    // ── Ante / Play resolution ────────────────────────────
    var anteBonus = ANTE_BONUS[ph.rank] || 0;

    if (!dealerQualifies3(game.dealerCards)) {
      // Dealer doesn't qualify: ante 1:1, play pushes, ante bonus if applicable
      payout += game.ante * 2 + game.ante * anteBonus;  // ante win + stake + bonus
      payout += game.ante;  // play stake back
      result = 'no-qualify';
    } else {
      var cmp = compareHands3(ph, dh);
      if (cmp > 0) {
        // Player wins: ante 1:1 + play 1:1 + ante bonus
        payout += game.ante * 2 + game.ante * anteBonus;
        payout += game.ante * 2;  // play win + play stake
        result = 'win';
      } else if (cmp === 0) {
        // Tie: push ante and play
        payout += game.ante + game.ante;
        result = 'tie';
      } else {
        result = 'lose';
      }
    }

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    }

    var profit = parseFloat((payout - totalIn).toFixed(2));
    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Three Card Poker: ' + ph.name]
      ).catch(function(){});
    }

    game.over = true;
    delete _games[gameId];

    const u2 = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     result,
      playerHand: { cards: game.playerCards, name: ph.name, rank: ph.rank },
      dealerHand: { cards: game.dealerCards, name: dh.name, rank: dh.rank },
      payout:     parseFloat(payout.toFixed(2)),
      profit:     profit,
      newBalance: u2 ? parseFloat(u2.balance) : null,
    });
  } catch (err) {
    console.error('[3CP] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play' });
  }
});

module.exports = router;
