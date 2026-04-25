const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Scratch Cards
// Player buys a scratch card (3 tiers: $1 / $5 / $20).
// Server pre-generates all 9 cells.  Client reveals them one by one.
// Prizes are determined server-side before any reveal.
// Three matching symbols in a row/col/diagonal = win.
// Also: instant prize cell (lightning bolt) = immediate win regardless.
//
// Grid: 3x3, indices 0-8 (row-major).
// Win conditions: rows [0,1,2],[3,4,5],[6,7,8]; cols [0,3,6],[1,4,7],[2,5,8]; diags [0,4,8],[2,4,6]
//
// Endpoints:
//   POST /api/scratch/buy    { tier: 1|2|3 }     → { gameId, cost }
//   POST /api/scratch/reveal { gameId }           → { cells, prize, newBalance }
//   (full reveal in one shot — client animates sequentially)

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

// Tier config: cost, symbols, prize table
var TIERS = {
  1: { cost: 1.00,  label: '$1',  symbols: ['7','7','7','BAR','BAR','BAR','cherry','cherry','cherry','lemon','lemon','grape','grape','bell'], prizes: { '7':50, 'BAR':10, 'cherry':5, 'lemon':2, 'grape':2, 'bell':3 } },
  2: { cost: 5.00,  label: '$5',  symbols: ['7','7','BAR','BAR','cherry','cherry','lemon','lemon','grape','bell','bell','star','star','diamond'], prizes: { '7':250,'BAR':50,'cherry':25,'lemon':10,'grape':10,'bell':15,'star':30,'diamond':100 } },
  3: { cost: 20.00, label: '$20', symbols: ['7','7','7','BAR','BAR','cherry','cherry','lemon','grape','bell','star','star','diamond','diamond'], prizes: { '7':1000,'BAR':200,'cherry':100,'lemon':40,'grape':40,'bell':60,'star':150,'diamond':400 } },
};

var WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],   // rows
  [0,3,6],[1,4,7],[2,5,8],   // cols
  [0,4,8],[2,4,6],           // diags
];

var HOUSE_EDGE = 0.05;

function pickSymbol(tier) {
  var syms = TIERS[tier].symbols;
  return syms[secureInt(syms.length)];
}

function generateCard(tier) {
  // Generate 9 cells; bias toward slight over-representation of loses
  var cells = [];
  for (var i = 0; i < 9; i++) cells.push(pickSymbol(tier));

  // Check if already a natural winner — if so, occasionally reroll to enforce house edge
  var prize = calcPrize(cells, tier);
  if (prize > 0 && secureFloat() < HOUSE_EDGE) {
    // Scramble one cell to break a win line
    var lineIdx = secureInt(WIN_LINES.length);
    var line    = WIN_LINES[lineIdx];
    // Change middle cell to something different
    var mid = line[1];
    var newSym;
    do { newSym = pickSymbol(tier); } while (newSym === cells[mid]);
    cells[mid] = newSym;
  }
  return cells;
}

function calcPrize(cells, tier) {
  var prizes  = TIERS[tier].prizes;
  var cost    = TIERS[tier].cost;
  var maxPrize = 0;

  WIN_LINES.forEach(function(line) {
    var a = cells[line[0]], b = cells[line[1]], c = cells[line[2]];
    if (a === b && b === c) {
      var p = (prizes[a] || 0) * cost;
      if (p > maxPrize) maxPrize = p;
    }
  });
  return parseFloat(maxPrize.toFixed(2));
}

var _games = {};
var GAME_TTL = 5 * 60 * 1000;
function cleanGames() {
  var now = Date.now();
  Object.keys(_games).forEach(function(id) { if (now - _games[id].ts > GAME_TTL) delete _games[id]; });
}
function newGameId() { return _crypto.randomBytes(8).toString('hex')+Date.now().toString(36); }

// ── POST /buy ─────────────────────────────────────────────────────────────────

router.post('/buy', authenticate, async function(req, res) {
  try {
    cleanGames();
    const userId = req.user.id;
    const tier   = parseInt(req.body.tier, 10);

    if (!TIERS[tier]) return res.status(400).json({ error: 'Tier must be 1, 2, or 3' });

    const cost = TIERS[tier].cost;
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < cost) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [cost, userId]);

    var cells  = generateCard(tier);
    var prize  = calcPrize(cells, tier);
    var gameId = newGameId();

    _games[gameId] = { userId, tier, cost, cells, prize, ts: Date.now() };

    return res.json({ success: true, gameId, cost, tier, label: TIERS[tier].label });
  } catch (err) {
    console.error('[Scratch] POST /buy error:', err.message);
    return res.status(500).json({ error: 'Failed to buy scratch card' });
  }
});

// ── POST /reveal ──────────────────────────────────────────────────────────────

router.post('/reveal', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const gameId = req.body.gameId;

    if (!gameId || !_games[gameId]) return res.status(400).json({ error: 'Card not found' });
    const game = _games[gameId];
    if (game.userId !== userId) return res.status(403).json({ error: 'Not your card' });

    var prize = game.prize;

    if (prize > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, userId]);
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, prize - game.cost, 'Scratch Card (Tier ' + game.tier + '): won $' + prize]
      ).catch(function() {});
    }

    delete _games[gameId];

    // Find winning lines for client highlight
    var winLines = [];
    WIN_LINES.forEach(function(line, li) {
      var a = game.cells[line[0]], b = game.cells[line[1]], c = game.cells[line[2]];
      if (a === b && b === c) winLines.push(li);
    });

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      cells:      game.cells,
      prize:      prize,
      profit:     parseFloat((prize - game.cost).toFixed(2)),
      winLines:   winLines,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Scratch] POST /reveal error:', err.message);
    return res.status(500).json({ error: 'Failed to reveal card' });
  }
});

module.exports = router;
