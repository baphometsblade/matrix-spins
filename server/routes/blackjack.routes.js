const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Blackjack — 6-deck shoe, dealer stands on all 17s, BJ pays 3:2
// Routes:
//   GET  /api/blackjack/state          — active game state
//   POST /api/blackjack/start  {bet}   — deal initial hands
//   POST /api/blackjack/hit            — deal 1 card to player
//   POST /api/blackjack/stand          — dealer plays, resolve
//   POST /api/blackjack/double         — double bet, deal 1 card, stand

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.50;
const MAX_BET = 500;
const DECKS   = 6;
const SUITS   = ['H','D','C','S'];

// ── card helpers ────────────────────────────────────────────────────────────────

function buildShoe() {
  var shoe = [];
  for (var d = 0; d < DECKS; d++) {
    for (var s = 0; s < SUITS.length; s++) {
      for (var v = 1; v <= 13; v++) {
        shoe.push({ s: SUITS[s], v: v });
      }
    }
  }
  // Fisher-Yates shuffle
  for (var i = shoe.length - 1; i > 0; i--) {
    var j = secureInt((i + 1));
    var tmp = shoe[i]; shoe[i] = shoe[j]; shoe[j] = tmp;
  }
  return shoe;
}

function cardPoints(v) {
  if (v >= 11) return 10;  // J, Q, K
  return v;                // 1–10
}

function handValue(hand) {
  var total = 0;
  var aces  = 0;
  for (var i = 0; i < hand.length; i++) {
    var p = cardPoints(hand[i].v);
    total += p;
    if (hand[i].v === 1) aces++;
  }
  // Promote one ace to 11 if it doesn't bust
  if (aces > 0 && total + 10 <= 21) total += 10;
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}
function isBust(hand) {
  return handValue(hand) > 21;
}

function cardLabel(v) {
  if (v === 1)  return 'A';
  if (v === 11) return 'J';
  if (v === 12) return 'Q';
  if (v === 13) return 'K';
  return String(v);
}

function publicCard(card) {
  return { s: card.s, v: card.v, l: cardLabel(card.v) };
}

// Resolve final payout given player and dealer hands
function resolveGame(playerHand, dealerHand, bet) {
  var playerBJ = isBlackjack(playerHand);
  var dealerBJ = isBlackjack(dealerHand);

  if (playerBJ && dealerBJ) return { status: 'push',       payout: bet };
  if (playerBJ)             return { status: 'blackjack',  payout: parseFloat((bet * 2.5).toFixed(2)) }; // 3:2
  if (dealerBJ)             return { status: 'dealer_win', payout: 0 };

  var pv = handValue(playerHand);
  var dv = handValue(dealerHand);

  if (pv > 21) return { status: 'player_bust', payout: 0 };
  if (dv > 21) return { status: 'dealer_bust', payout: parseFloat((bet * 2).toFixed(2)) };
  if (pv > dv) return { status: 'player_win',  payout: parseFloat((bet * 2).toFixed(2)) };
  if (dv > pv) return { status: 'dealer_win',  payout: 0 };
  return          { status: 'push',            payout: bet };
}

// Dealer plays: hit until 17+
function dealerPlay(shoe, hand) {
  while (handValue(hand) < 17 && shoe.length > 0) {
    hand.push(shoe.pop());
  }
}

// ── schema ────────────────────────────────────────────────────────────────────────

var schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  var isPg  = !!process.env.DATABASE_URL;
  var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  var tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
  var tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
  await db.run(`
    CREATE TABLE IF NOT EXISTS blackjack_games (
      id ${idDef},
      user_id INTEGER NOT NULL,
      bet REAL NOT NULL,
      shoe TEXT NOT NULL,
      player_hand TEXT NOT NULL,
      dealer_hand TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'playing',
      payout REAL NOT NULL DEFAULT 0,
      created_at ${tsType} DEFAULT ${tsDefault}
    )
  `);
  schemaReady = true;
}

function gameResponse(game, showDealerHole) {
  var playerHand = JSON.parse(game.player_hand);
  var dealerHand = JSON.parse(game.dealer_hand);
  var shoe       = JSON.parse(game.shoe);

  var dealerVisible = showDealerHole
    ? dealerHand.map(publicCard)
    : [publicCard(dealerHand[0]), { hidden: true }];  // hide hole card

  return {
    gameId:      game.id,
    status:      game.status,
    bet:         game.bet,
    payout:      game.payout,
    playerHand:  playerHand.map(publicCard),
    playerValue: handValue(playerHand),
    dealerHand:  dealerVisible,
    dealerValue: showDealerHole ? handValue(dealerHand) : handValue([dealerHand[0]]),
    deckRemain:  shoe.length,
    canDouble:   game.status === 'playing' && playerHand.length === 2,
  };
}

// ── GET /state ───────────────────────────────────────────────────────────────

router.get('/state', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var game = await db.get(
      "SELECT * FROM blackjack_games WHERE user_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
      [req.user.id]
    );
    if (!game) return res.json({ active: false });
    return res.json({ active: true, ...gameResponse(game, false) });
  } catch (err) {
    console.error('[BJ] GET /state error:', err.message);
    return res.status(500).json({ error: 'Failed to get state' });
  }
});

// ── POST /start ──────────────────────────────────────────────────────────────

router.post('/start', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;

    // Forfeit any existing active game
    await db.run(
      "UPDATE blackjack_games SET status = 'forfeited' WHERE user_id = ? AND status = 'playing'",
      [userId]
    );

    var bet = parseFloat(req.body.bet) || 5.0;
    if (bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet out of range ($0.50 – $500)' });
    }

    var user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    var balance = parseFloat(user.balance) || 0;
    if (balance < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    // Deal
    var shoe       = buildShoe();
    var playerHand = [shoe.pop(), shoe.pop()];
    var dealerHand = [shoe.pop(), shoe.pop()];

    // Check immediate blackjack
    var playerBJ = isBlackjack(playerHand);
    var dealerBJ = isBlackjack(dealerHand);
    var status   = 'playing';
    var payout   = 0;

    if (playerBJ || dealerBJ) {
      var res2 = resolveGame(playerHand, dealerHand, bet);
      status = res2.status;
      payout = res2.payout;
    }

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      var profit2 = parseFloat((payout - bet).toFixed(2));
      if (profit2 > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, 'Blackjack win')",
          [userId, profit2]
        ).catch(function() {});
      }
    }

    var result = await db.run(
      "INSERT INTO blackjack_games (user_id, bet, shoe, player_hand, dealer_hand, status, payout) VALUES (?,?,?,?,?,?,?)",
      [userId, bet, JSON.stringify(shoe), JSON.stringify(playerHand), JSON.stringify(dealerHand), status, payout]
    );

    var gameId   = result.lastID || result.id;
    var gameRow  = await db.get('SELECT * FROM blackjack_games WHERE id = ?', [gameId]);
    var u        = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var showHole = status !== 'playing';

    return res.json({
      success:    true,
      newBalance: u ? parseFloat(u.balance) : null,
      active:     status === 'playing',
      ...gameResponse(gameRow, showHole),
    });
  } catch (err) {
    console.error('[BJ] POST /start error:', err.message);
    return res.status(500).json({ error: 'Failed to start game' });
  }
});

// ── POST /hit ────────────────────────────────────────────────────────────────

router.post('/hit', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var game   = await db.get(
      "SELECT * FROM blackjack_games WHERE user_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active game' });

    var shoe       = JSON.parse(game.shoe);
    var playerHand = JSON.parse(game.player_hand);
    var dealerHand = JSON.parse(game.dealer_hand);

    playerHand.push(shoe.pop());

    var status = 'playing';
    var payout = 0;

    if (isBust(playerHand)) {
      status = 'player_bust';
      payout = 0;
    }

    await db.run(
      'UPDATE blackjack_games SET shoe=?, player_hand=?, status=?, payout=? WHERE id=?',
      [JSON.stringify(shoe), JSON.stringify(playerHand), status, payout, game.id]
    );

    var u = null;
    var showHole = status !== 'playing';
    if (showHole && payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    } else if (showHole) {
      u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    }

    var updated = await db.get('SELECT * FROM blackjack_games WHERE id=?', [game.id]);
    return res.json({
      success:    true,
      active:     status === 'playing',
      newBalance: u ? parseFloat(u.balance) : null,
      ...gameResponse(updated, showHole),
    });
  } catch (err) {
    console.error('[BJ] POST /hit error:', err.message);
    return res.status(500).json({ error: 'Failed to hit' });
  }
});

// ── POST /stand ──────────────────────────────────────────────────────────────

router.post('/stand', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var game   = await db.get(
      "SELECT * FROM blackjack_games WHERE user_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active game' });

    var shoe       = JSON.parse(game.shoe);
    var playerHand = JSON.parse(game.player_hand);
    var dealerHand = JSON.parse(game.dealer_hand);

    dealerPlay(shoe, dealerHand);

    var res2   = resolveGame(playerHand, dealerHand, game.bet);
    var status = res2.status;
    var payout = res2.payout;

    await db.run(
      'UPDATE blackjack_games SET shoe=?, dealer_hand=?, status=?, payout=? WHERE id=?',
      [JSON.stringify(shoe), JSON.stringify(dealerHand), status, payout, game.id]
    );

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      var profit3 = parseFloat((payout - game.bet).toFixed(2));
      if (profit3 > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, 'Blackjack win')",
          [userId, profit3]
        ).catch(function() {});
      }
    }

    var u       = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var updated = await db.get('SELECT * FROM blackjack_games WHERE id=?', [game.id]);
    return res.json({
      success:    true,
      active:     false,
      newBalance: u ? parseFloat(u.balance) : null,
      ...gameResponse(updated, true),
    });
  } catch (err) {
    console.error('[BJ] POST /stand error:', err.message);
    return res.status(500).json({ error: 'Failed to stand' });
  }
});

// ── POST /double ─────────────────────────────────────────────────────────────

router.post('/double', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var game   = await db.get(
      "SELECT * FROM blackjack_games WHERE user_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active game' });

    var playerHand = JSON.parse(game.player_hand);
    if (playerHand.length !== 2) {
      return res.status(400).json({ error: 'Can only double on initial two cards' });
    }

    var user    = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var balance = parseFloat(user.balance) || 0;
    if (balance < game.bet) {
      return res.status(400).json({ error: 'Insufficient balance to double' });
    }

    // Deduct extra bet
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [game.bet, userId]);
    var doubleBet = parseFloat((game.bet * 2).toFixed(2));

    var shoe = JSON.parse(game.shoe);
    var dealerHand = JSON.parse(game.dealer_hand);

    // Deal exactly one card to player
    playerHand.push(shoe.pop());

    // Dealer plays
    dealerPlay(shoe, dealerHand);

    var res2   = resolveGame(playerHand, dealerHand, doubleBet);
    var status = res2.status;
    var payout = res2.payout;

    await db.run(
      'UPDATE blackjack_games SET shoe=?, player_hand=?, dealer_hand=?, bet=?, status=?, payout=? WHERE id=?',
      [JSON.stringify(shoe), JSON.stringify(playerHand), JSON.stringify(dealerHand),
       doubleBet, status, payout, game.id]
    );

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      var profit4 = parseFloat((payout - doubleBet).toFixed(2));
      if (profit4 > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, 'Blackjack double win')",
          [userId, profit4]
        ).catch(function() {});
      }
    }

    var u       = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var updated = await db.get('SELECT * FROM blackjack_games WHERE id=?', [game.id]);
    return res.json({
      success:    true,
      active:     false,
      newBalance: u ? parseFloat(u.balance) : null,
      ...gameResponse(updated, true),
    });
  } catch (err) {
    console.error('[BJ] POST /double error:', err.message);
    return res.status(500).json({ error: 'Failed to double' });
  }
});

module.exports = router;
