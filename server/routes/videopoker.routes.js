const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Video Poker -- Jacks or Better, standard pay table, ~99.5% RTP
// POST /api/videopoker/deal    { bet }          -- deal 5 cards, deduct bet
// POST /api/videopoker/draw    { holds }        -- holds: array of 5 booleans
//   Replace non-held cards, evaluate hand, pay out.
// GET  /api/videopoker/state                    -- active game state

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.25;
const MAX_BET  = 100;
// Bet multipliers (coins x bet)
// Standard Jacks or Better 9/6 pay table:
const PAY_TABLE = {
  'royal_flush':     800,
  'straight_flush':  50,
  'four_of_a_kind':  25,
  'full_house':      9,
  'flush':           6,
  'straight':        4,
  'three_of_a_kind': 3,
  'two_pair':        2,
  'jacks_or_better': 1,
  'nothing':         0,
};

const SUITS  = ['H','D','C','S'];

function buildDeck() {
  var deck = [];
  for (var s = 0; s < SUITS.length; s++) {
    for (var v = 1; v <= 13; v++) {
      deck.push({ s: SUITS[s], v: v });
    }
  }
  // Fisher-Yates shuffle
  for (var i = deck.length - 1; i > 0; i--) {
    var j = secureInt((i + 1));
    var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
  }
  return deck;
}

function cardLabel(v) {
  if (v === 1)  return 'A';
  if (v === 11) return 'J';
  if (v === 12) return 'Q';
  if (v === 13) return 'K';
  return String(v);
}

function publicCard(c) { return { s: c.s, v: c.v, l: cardLabel(c.v) }; }

// -- hand evaluation ----------------------------------------------------------

function evaluateHand(hand) {
  // hand: [{s,v}, ...]  v: 1-13
  var vals  = hand.map(function(c) { return c.v; }).sort(function(a,b){return a-b;});
  var suits = hand.map(function(c) { return c.s; });

  var counts = {};
  vals.forEach(function(v) { counts[v] = (counts[v]||0) + 1; });
  var groups = Object.values(counts).sort(function(a,b){return b-a;}); // e.g. [3,2] = full house

  var isFlush    = suits.every(function(s){return s===suits[0];});
  var isStraight = (function() {
    var unique = Array.from(new Set(vals)).sort(function(a,b){return a-b;});
    if (unique.length !== 5) return false;
    // Normal straight
    if (unique[4] - unique[0] === 4) return true;
    // Ace-low: A 2 3 4 5
    if (JSON.stringify(unique) === JSON.stringify([1,2,3,4,5])) return true;
    // Ace-high: 10 J Q K A
    if (JSON.stringify(unique) === JSON.stringify([1,10,11,12,13])) return true;
    return false;
  }());
  var isRoyal = isFlush && JSON.stringify(vals) === JSON.stringify([1,10,11,12,13]);

  if (isRoyal)                          return 'royal_flush';
  if (isFlush  && isStraight)           return 'straight_flush';
  if (groups[0] === 4)                  return 'four_of_a_kind';
  if (groups[0] === 3 && groups[1]===2) return 'full_house';
  if (isFlush)                          return 'flush';
  if (isStraight)                       return 'straight';
  if (groups[0] === 3)                  return 'three_of_a_kind';
  if (groups[0] === 2 && groups[1]===2) {
    // Two pair -- check if at least one pair is J,Q,K, or A
    var HIGH_VALS = new Set([1,11,12,13]);
    var pairs = Object.keys(counts).filter(function(v){return counts[v]===2;}).map(Number);
    var hasHigh = pairs.some(function(v){return HIGH_VALS.has(v);});
    return 'two_pair'; // two_pair always pays
  }
  if (groups[0] === 2) {
    // Single pair -- only JJ, QQ, KK, AA
    var HIGH_VALS2 = new Set([1,11,12,13]);
    var pairVal = parseInt(Object.keys(counts).find(function(v){return counts[v]===2;}), 10);
    if (HIGH_VALS2.has(pairVal)) return 'jacks_or_better';
  }
  return 'nothing';
}

// -- schema -------------------------------------------------------------------

var schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  var isPg  = !!process.env.DATABASE_URL;
  var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  var tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
  var tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
  await db.run(`
    CREATE TABLE IF NOT EXISTS vp_games (
      id ${idDef},
      user_id INTEGER NOT NULL,
      bet REAL NOT NULL,
      deck TEXT NOT NULL,
      hand TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'dealt',
      result TEXT,
      payout REAL NOT NULL DEFAULT 0,
      created_at ${tsType} DEFAULT ${tsDefault}
    )
  `);
  schemaReady = true;
}

// -- GET /state ---------------------------------------------------------------

router.get('/state', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var game = await db.get(
      "SELECT * FROM vp_games WHERE user_id=? AND status='dealt' ORDER BY id DESC LIMIT 1",
      [req.user.id]
    );
    if (!game) return res.json({ active: false });
    return res.json({
      active:  true,
      gameId:  game.id,
      bet:     game.bet,
      hand:    JSON.parse(game.hand).map(publicCard),
      status:  game.status,
      payTable: PAY_TABLE,
    });
  } catch (err) {
    console.error('[VP] GET /state error:', err.message);
    return res.status(500).json({ error: 'Failed to get state' });
  }
});

// -- POST /deal ---------------------------------------------------------------

router.post('/deal', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;

    // Forfeit any open game
    await db.run(
      "UPDATE vp_games SET status='forfeited' WHERE user_id=? AND status='dealt'",
      [userId]
    );

    var bet = parseFloat(req.body.bet) || 1.0;
    if (bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet out of range ($0.25 - $100)' });
    }

    var user = await db.get('SELECT balance FROM users WHERE id=?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id=?', [bet, userId]);

    var deck = buildDeck();
    var hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

    var result = await db.run(
      "INSERT INTO vp_games (user_id, bet, deck, hand, status) VALUES (?,?,?,?,'dealt')",
      [userId, bet, JSON.stringify(deck), JSON.stringify(hand)]
    );

    var u = await db.get('SELECT balance FROM users WHERE id=?', [userId]);
    return res.json({
      success:    true,
      gameId:     result.lastID || result.id,
      bet,
      hand:       hand.map(publicCard),
      newBalance: u ? parseFloat(u.balance) : null,
      payTable:   PAY_TABLE,
    });
  } catch (err) {
    console.error('[VP] POST /deal error:', err.message);
    return res.status(500).json({ error: 'Failed to deal' });
  }
});

// -- POST /draw ---------------------------------------------------------------

router.post('/draw', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var holds  = req.body.holds; // [true/false x 5]

    if (!Array.isArray(holds) || holds.length !== 5) {
      return res.status(400).json({ error: 'holds must be an array of 5 booleans' });
    }

    var game = await db.get(
      "SELECT * FROM vp_games WHERE user_id=? AND status='dealt' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active game' });

    var deck = JSON.parse(game.deck);
    var hand = JSON.parse(game.hand);

    // Replace non-held cards
    for (var i = 0; i < 5; i++) {
      if (!holds[i] && deck.length > 0) {
        hand[i] = deck.pop();
      }
    }

    var result = evaluateHand(hand);
    var mult   = PAY_TABLE[result] || 0;
    var payout = parseFloat((game.bet * mult).toFixed(2));

    await db.run(
      "UPDATE vp_games SET deck=?, hand=?, status='drawn', result=?, payout=? WHERE id=?",
      [JSON.stringify(deck), JSON.stringify(hand), result, payout, game.id]
    );

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id=?', [payout, userId]);
      var profit = parseFloat((payout - game.bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?,'win',?,?)",
          [userId, profit, 'Video Poker: ' + result + ' (' + mult + 'x)']
        ).catch(function(){});
      }
    }

    var u = await db.get('SELECT balance FROM users WHERE id=?', [userId]);
    return res.json({
      success:    true,
      hand:       hand.map(publicCard),
      holds,
      result,
      multiplier: mult,
      payout,
      profit:     parseFloat((payout - game.bet).toFixed(2)),
      newBalance: u ? parseFloat(u.balance) : null,
      payTable:   PAY_TABLE,
    });
  } catch (err) {
    console.error('[VP] POST /draw error:', err.message);
    return res.status(500).json({ error: 'Failed to draw' });
  }
});

module.exports = router;
