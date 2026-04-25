const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Mines
// 5x5 grid = 25 tiles.  Player chooses number of mines (1-24).
// Server places mines randomly.  Player reveals tiles one by one.
// Each safe reveal increases a multiplier.  Hitting a mine ends the game.
// Player can cashout after any safe reveal.
//
// Multiplier per reveal step (simplified):
//   mult_n = mult_{n-1} * ( (tiles_remaining) / (safe_remaining) ) * (1 - HOUSE_EDGE)
// where tiles_remaining = 25 - reveals_so_far, safe_remaining = safe tiles left.
//
// Endpoints:
//   POST /api/mines/start   { bet, mines }   → { gameId }
//   POST /api/mines/reveal  { gameId, tile }  → { safe, multiplier, canCashout, gameOver, minePositions? }
//   POST /api/mines/cashout { gameId }         → { payout, profit, newBalance, minePositions }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const GRID_SIZE  = 25;
const MIN_BET    = 0.25;
const MAX_BET    = 500;
const HOUSE_EDGE = 0.04;

function placeMines(count) {
  var positions = [];
  var pool = [];
  for (var i = 0; i < GRID_SIZE; i++) pool.push(i);
  // Fisher-Yates partial shuffle
  for (var m = 0; m < count; m++) {
    var idx = secureInt((pool.length - m)) + m;
    var tmp = pool[m]; pool[m] = pool[idx]; pool[idx] = tmp;
    positions.push(pool[m]);
  }
  return positions;
}

// Compute multiplier after n safe reveals given total mines
function calcMultiplier(mineCount, safeReveals) {
  var safeTiles  = GRID_SIZE - mineCount;
  if (safeReveals <= 0 || safeReveals > safeTiles) return 1.0;
  // Probability of picking n safe tiles consecutively from 25 tiles
  // P = C(safeTiles, n) * n! / (25 * 24 * ... * (25-n+1))
  //   = (safeTiles! / (safeTiles-n)!) / (25! / (25-n)!)
  var p = 1;
  for (var i = 0; i < safeReveals; i++) {
    p *= (safeTiles - i) / (GRID_SIZE - i);
  }
  // Fair payout would be 1/p; apply house edge
  var mult = (1 / p) * (1 - HOUSE_EDGE);
  return parseFloat(mult.toFixed(4));
}

var _games   = {};
var GAME_TTL = 15 * 60 * 1000;

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
    const mines  = parseInt(req.body.mines, 10);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + '\u2013$' + MAX_BET });
    }
    if (isNaN(mines) || mines < 1 || mines > 24) {
      return res.status(400).json({ error: 'Mines must be 1\u201324' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var minePositions = placeMines(mines);
    var gameId        = newGameId();

    _games[gameId] = {
      userId:        userId,
      bet:           bet,
      mines:         mines,
      minePositions: minePositions,
      revealed:      [],   // tile indices revealed so far (safe)
      multiplier:    1.0,
      ts:            Date.now(),
      over:          false,
    };

    return res.json({ success: true, gameId: gameId, gridSize: GRID_SIZE, mines: mines });
  } catch (err) {
    console.error('[Mines] POST /start error:', err.message);
    return res.status(500).json({ error: 'Failed to start Mines' });
  }
});

// ── POST /reveal ──────────────────────────────────────────────────────────────

router.post('/reveal', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;
    const tile   = parseInt(req.body.tile, 10);

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over) return res.status(400).json({ error: 'Game already over' });
    if (isNaN(tile) || tile < 0 || tile >= GRID_SIZE) {
      return res.status(400).json({ error: 'Invalid tile' });
    }
    if (game.revealed.indexOf(tile) >= 0) {
      return res.status(400).json({ error: 'Tile already revealed' });
    }

    var isMine = game.minePositions.indexOf(tile) >= 0;

    if (isMine) {
      game.over = true;
      delete _games[gameId];
      return res.json({
        success:       true,
        safe:          false,
        multiplier:    0,
        canCashout:    false,
        gameOver:      true,
        minePositions: game.minePositions,
      });
    }

    // Safe tile
    game.revealed.push(tile);
    var newMult = calcMultiplier(game.mines, game.revealed.length);
    game.multiplier = newMult;

    var safeTiles    = GRID_SIZE - game.mines;
    var allSafeFound = game.revealed.length >= safeTiles;

    if (allSafeFound) {
      // Player found all safe tiles — auto cashout
      var payout = parseFloat((game.bet * newMult).toFixed(2));
      var profit = parseFloat((payout - game.bet).toFixed(2));
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Mines: ' + game.mines + ' mines, all safe found ' + newMult + 'x']
        ).catch(function() {});
      }
      delete _games[gameId];
      const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      return res.json({
        success:       true,
        safe:          true,
        multiplier:    newMult,
        canCashout:    false,
        gameOver:      true,
        autoWin:       true,
        payout:        payout,
        profit:        profit,
        newBalance:    u ? parseFloat(u.balance) : null,
        minePositions: game.minePositions,
      });
    }

    return res.json({
      success:    true,
      safe:       true,
      multiplier: newMult,
      canCashout: true,
      gameOver:   false,
    });
  } catch (err) {
    console.error('[Mines] POST /reveal error:', err.message);
    return res.status(500).json({ error: 'Failed to reveal tile' });
  }
});

// ── POST /cashout ─────────────────────────────────────────────────────────────

router.post('/cashout', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over) return res.status(400).json({ error: 'Game already over' });
    if (game.revealed.length === 0) {
      return res.status(400).json({ error: 'Reveal at least one tile first' });
    }

    var payout = parseFloat((game.bet * game.multiplier).toFixed(2));
    var profit = parseFloat((payout - game.bet).toFixed(2));

    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Mines: ' + game.mines + ' mines, ' + game.revealed.length + ' safe, ' + game.multiplier + 'x']
      ).catch(function() {});
    }

    var minePositions = game.minePositions;
    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:       true,
      payout:        payout,
      profit:        profit,
      multiplier:    game.multiplier,
      newBalance:    u ? parseFloat(u.balance) : null,
      minePositions: minePositions,
    });
  } catch (err) {
    console.error('[Mines] POST /cashout error:', err.message);
    return res.status(500).json({ error: 'Failed to cashout' });
  }
});

module.exports = router;
