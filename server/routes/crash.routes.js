const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Crash
// Player bets before the round starts.  A multiplier climbs from 1.00x.
// The server pre-generates a crash point using a provably-fair formula
// (seeded RNG + house edge).  Player can cash out at any time before crash.
// If they don't cash out before the crash point, they lose their bet.
//
// Endpoints:
//   POST /api/crash/bet      { bet }            → { gameId, startAt }
//   POST /api/crash/cashout  { gameId, mult }   → { payout, profit, newBalance }
//   POST /api/crash/result   { gameId }         → { crashAt } (reveal crash point)

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET    = 0.25;
const MAX_BET    = 500;
const HOUSE_EDGE = 0.04;   // 4% house edge baked into crash point distribution

// Generate crash point: exponential distribution biased by house edge
// E[crash] = 1/(1-HOUSE_EDGE) ≈ 1.042, but right-skewed so big multipliers exist
function generateCrashPoint() {
  var r = secureFloat();
  if (r < HOUSE_EDGE) return 1.00;   // instant crash (house edge bucket)
  // Geometric series: P(crash >= x) = (1 - HOUSE_EDGE) / x
  // Inverse: x = (1 - HOUSE_EDGE) / (1 - r)  but capped at 10000x
  var crash = (1 - HOUSE_EDGE) / (1 - r);
  crash = Math.max(1.00, crash);
  crash = Math.min(10000, crash);
  return parseFloat(crash.toFixed(2));
}

var _games = {};
var GAME_TTL = 5 * 60 * 1000;

function cleanGames() {
  var now = Date.now();
  Object.keys(_games).forEach(function(id) {
    if (now - _games[id].ts > GAME_TTL) delete _games[id];
  });
}

function newGameId() {
  return _crypto.randomBytes(6).toString('hex')+Date.now().toString(36);
}

// ── POST /bet ─────────────────────────────────────────────────────────────────

router.post('/bet', authenticate, async function(req, res) {
  try {
    cleanGames();
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + '\u2013$' + MAX_BET });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var crashAt = generateCrashPoint();
    var gameId  = newGameId();

    _games[gameId] = {
      userId:      userId,
      bet:         bet,
      crashAt:     crashAt,
      cashedOut:   false,
      over:        false,
      ts:          Date.now(),
    };

    // Don't reveal crashAt yet — client doesn't know it
    return res.json({
      success: true,
      gameId:  gameId,
    });
  } catch (err) {
    console.error('[Crash] POST /bet error:', err.message);
    return res.status(500).json({ error: 'Failed to place bet' });
  }
});

// ── POST /cashout ─────────────────────────────────────────────────────────────

router.post('/cashout', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;
    const mult   = parseFloat(req.body.mult);

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.over || game.cashedOut) return res.status(400).json({ error: 'Game already over' });

    // Validate: cashout multiplier must be >= 1 and < crashAt
    if (isNaN(mult) || mult < 1.00) return res.status(400).json({ error: 'Invalid multiplier' });
    if (mult >= game.crashAt) {
      // Tried to cash out after crash — lose
      game.over    = true;
      delete _games[gameId];
      return res.json({ success: true, result: 'crash', payout: 0, profit: -game.bet, crashAt: game.crashAt });
    }

    game.cashedOut = true;
    game.over      = true;

    const payout = parseFloat((game.bet * mult).toFixed(2));
    const profit = parseFloat((payout - game.bet).toFixed(2));

    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);

    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Crash: cashed out at ' + mult + 'x']
      ).catch(function() {});
    }

    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     'cashout',
      mult:       mult,
      crashAt:    game.crashAt,
      payout:     payout,
      profit:     profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Crash] POST /cashout error:', err.message);
    return res.status(500).json({ error: 'Failed to cashout' });
  }
});

// ── POST /result — reveal crash point if player didn't cashout ────────────────

router.post('/result', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Game not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your game' });
    if (game.cashedOut) return res.status(400).json({ error: 'Already cashed out' });

    // Player rode it to (or past) the crash
    game.over = true;
    var crashAt = game.crashAt;
    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      result:     'crash',
      crashAt:    crashAt,
      payout:     0,
      profit:     -game.bet,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Crash] POST /result error:', err.message);
    return res.status(500).json({ error: 'Failed to get result' });
  }
});

module.exports = router;
