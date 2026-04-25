const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Hilo (Higher / Lower) — a card is revealed; player bets whether the next
// card will be higher or lower.  Each correct guess builds a multiplier chain.
// Player can cashout at any time after at least one correct guess.
//
// Endpoints:
//   POST /api/hilo/start    { bet }          → { card, gameId }
//   POST /api/hilo/guess    { gameId, guess: 'higher'|'lower'|'skip' }
//                                            → { newCard, correct, multiplier, canCashout, gameOver }
//   POST /api/hilo/cashout  { gameId }       → { payout, profit, newBalance }
//
// Multiplier per step: (correct_probability_of_guess)^-1 * (1 - HOUSE_EDGE)
// House edge 3% on every step; expected value = 0.97^n * bet after n steps.

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.25;
const MAX_BET    = 500;
const HOUSE_EDGE = 0.03;

// 52-card deck (infinite shoe — each card drawn independently)
const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS  = ['\u2660','\u2665','\u2666','\u2663'];
const VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 };

function randomCard() {
  var rank = RANKS[secureInt(RANKS.length)];
  var suit = SUITS[secureInt(SUITS.length)];
  return { rank: rank, suit: suit, value: VALUES[rank] };
}

// Probability that next card is strictly higher than current value (out of 13 ranks)
function pHigher(val) {
  // ranks with value > val
  var higher = RANKS.filter(function(r) { return VALUES[r] > val; }).length;
  return higher / RANKS.length;
}
function pLower(val) {
  var lower = RANKS.filter(function(r) { return VALUES[r] < val; }).length;
  return lower / RANKS.length;
}

// Step multiplier given a correct guess direction
function stepMultiplier(guess, cardValue) {
  var p = guess === 'higher' ? pHigher(cardValue) : pLower(cardValue);
  if (p <= 0) return 999;  // impossible guess — shouldn't happen after client validation
  return parseFloat(((1 / p) * (1 - HOUSE_EDGE)).toFixed(4));
}

// In-memory game store (TTL 10 minutes)
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

// ── POST /start ───────────────────────────────────────────────────────────────

router.post('/start', authenticate, async function(req, res) {
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

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const card   = randomCard();
    const gameId = newGameId();

    _games[gameId] = {
      userId:     userId,
      bet:        bet,
      card:       card,
      multiplier: 1.0,
      steps:      0,
      ts:         Date.now(),
      over:       false,
    };

    return res.json({
      success:    true,
      gameId:     gameId,
      card:       card,
      multiplier: 1.0,
      canCashout: false,
    });
  } catch (err) {
    console.error('[Hilo] POST /start error:', err.message);
    return res.status(500).json({ error: 'Failed to start Hilo' });
  }
});

// ── POST /guess ───────────────────────────────────────────────────────────────

router.post('/guess', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;
    const guess  = req.body.guess;  // 'higher' | 'lower'

    if (!gameId || !_games[gameId]) {
      return res.status(400).json({ error: 'Game not found — start a new game' });
    }
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over)              return res.status(400).json({ error: 'Game already over' });
    if (guess !== 'higher' && guess !== 'lower') {
      return res.status(400).json({ error: 'guess must be higher or lower' });
    }

    const prevCard = game.card;
    const newCard  = randomCard();
    var correct    = false;

    if (guess === 'higher' && newCard.value > prevCard.value) correct = true;
    if (guess === 'lower'  && newCard.value < prevCard.value) correct = true;
    // Exact same value = lose (house edge via ties)

    game.card = newCard;
    game.ts   = Date.now();

    if (correct) {
      var mult   = stepMultiplier(guess, prevCard.value);
      game.multiplier = parseFloat((game.multiplier * mult).toFixed(4));
      game.steps++;
      return res.json({
        success:    true,
        newCard:    newCard,
        correct:    true,
        multiplier: game.multiplier,
        canCashout: true,
        gameOver:   false,
      });
    } else {
      // Wrong — game over, bet already deducted
      game.over = true;
      delete _games[gameId];
      return res.json({
        success:    true,
        newCard:    newCard,
        correct:    false,
        multiplier: 0,
        canCashout: false,
        gameOver:   true,
      });
    }
  } catch (err) {
    console.error('[Hilo] POST /guess error:', err.message);
    return res.status(500).json({ error: 'Failed to process guess' });
  }
});

// ── POST /cashout ─────────────────────────────────────────────────────────────

router.post('/cashout', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) {
      return res.status(400).json({ error: 'Game not found' });
    }
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over)              return res.status(400).json({ error: 'Game already over' });
    if (game.steps === 0)       return res.status(400).json({ error: 'Make at least one correct guess first' });

    const payout = parseFloat((game.bet * game.multiplier).toFixed(2));
    const profit = parseFloat((payout - game.bet).toFixed(2));

    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);

    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Hilo: ' + game.steps + ' steps, ' + game.multiplier + 'x']
      ).catch(function() {});
    }

    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      payout:     payout,
      profit:     profit,
      multiplier: game.multiplier,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Hilo] POST /cashout error:', err.message);
    return res.status(500).json({ error: 'Failed to cashout' });
  }
});

module.exports = router;
