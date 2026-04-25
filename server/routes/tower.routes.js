const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Tower — player climbs a multi-row tower, picking one safe tile per row.
// Each row survived multiplies their bet. Bust = lose all. Cash out = keep winnings.
//
// Risk modes  (tiles_per_row x mines_per_row):
//   easy   : 4 tiles, 1 mine  → win_prob per row = 3/4 = 0.75
//   medium : 3 tiles, 1 mine  → win_prob per row = 2/3 ≈ 0.667
//   hard   : 2 tiles, 1 mine  → win_prob per row = 1/2 = 0.50
//   expert : 3 tiles, 2 mines → win_prob per row = 1/3 ≈ 0.333
//
// Multiplier per row (with house edge ~3%):
//   mult_per_row = (tiles / safe_tiles) * 0.97
//
// Tower has 10 rows. Max total multiplier = mult_per_row^10
//
// Routes:
//   POST /api/tower/start    { bet, risk }
//   POST /api/tower/step     { tileIndex }   (0-indexed, tileIndex < tiles_per_row)
//   POST /api/tower/cashout
//   GET  /api/tower/state

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET   = 0.25;
const MAX_BET   = 200;
const ROWS      = 10;
const HOUSE_EDGE = 0.03;

const RISK_CONFIG = {
  easy:   { tiles: 4, mines: 1 },
  medium: { tiles: 3, mines: 1 },
  hard:   { tiles: 2, mines: 1 },
  expert: { tiles: 3, mines: 2 },
};

var schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  var isPg  = !!process.env.DATABASE_URL;
  var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  var tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
  var tsDefault = isPg ? 'NOW()' : "datetime('now')";
  await db.run(
    'CREATE TABLE IF NOT EXISTS tower_games (' +
    'id ' + idDef + ',' +
    'user_id INTEGER NOT NULL,' +
    'bet REAL NOT NULL,' +
    'risk TEXT NOT NULL,' +
    'mine_map TEXT NOT NULL,' +   // JSON array[10] each being array of mine tile indices for that row
    'current_row INTEGER NOT NULL DEFAULT 0,' +
    'status TEXT NOT NULL DEFAULT \'active\',' +
    'payout REAL NOT NULL DEFAULT 0,' +
    'created_at ' + tsType + ' DEFAULT (' + tsDefault + ')' +
    ')'
  );
  schemaReady = true;
}

function rowMultiplier(cfg) {
  return parseFloat(((cfg.tiles / (cfg.tiles - cfg.mines)) * (1 - HOUSE_EDGE)).toFixed(6));
}

function calcMultiplier(rowsCleared, cfg) {
  if (rowsCleared === 0) return 1.0;
  return parseFloat(Math.pow(rowMultiplier(cfg), rowsCleared).toFixed(4));
}

function generateMineMap(cfg) {
  var map = [];
  for (var r = 0; r < ROWS; r++) {
    var tiles = [];
    for (var i = 0; i < cfg.tiles; i++) tiles.push(i);
    // Shuffle and pick first cfg.mines as mine positions
    for (var j = tiles.length - 1; j > 0; j--) {
      var k = secureInt((j + 1));
      var tmp = tiles[j]; tiles[j] = tiles[k]; tiles[k] = tmp;
    }
    map.push(tiles.slice(0, cfg.mines));
  }
  return map;
}

// ── GET /state ──────────────────────────────────────────────────────────────

router.get('/state', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var game = await db.get(
      'SELECT * FROM tower_games WHERE user_id = ? AND status = \'active\' ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!game) return res.json({ active: false });
    var cfg = RISK_CONFIG[game.risk] || RISK_CONFIG.medium;
    var mult = calcMultiplier(game.current_row, cfg);
    return res.json({
      active:        true,
      gameId:        game.id,
      bet:           game.bet,
      risk:          game.risk,
      currentRow:    game.current_row,
      multiplier:    mult,
      potentialPayout: parseFloat((game.bet * mult).toFixed(2)),
      tilesPerRow:   cfg.tiles,
      minesPerRow:   cfg.mines,
      rows:          ROWS,
    });
  } catch (err) {
    console.error('[Tower] GET /state error:', err.message);
    return res.status(500).json({ error: 'Failed to get game state' });
  }
});

// ── POST /start ─────────────────────────────────────────────────────────────

router.post('/start', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var bet    = parseFloat(req.body.bet);
    var risk   = req.body.risk || 'medium';

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' \u2013 $' + MAX_BET });
    }
    if (!RISK_CONFIG[risk]) {
      return res.status(400).json({ error: 'risk must be easy, medium, hard, or expert' });
    }

    // Forfeit any active game
    var existing = await db.get(
      'SELECT id FROM tower_games WHERE user_id = ? AND status = \'active\' LIMIT 1',
      [userId]
    );
    if (existing) {
      await db.run('UPDATE tower_games SET status = \'forfeited\' WHERE id = ?', [existing.id]);
    }

    var user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var cfg     = RISK_CONFIG[risk];
    var mineMap = generateMineMap(cfg);
    var result  = await db.run(
      'INSERT INTO tower_games (user_id, bet, risk, mine_map, current_row, status, payout) VALUES (?, ?, ?, ?, 0, \'active\', 0)',
      [userId, bet, risk, JSON.stringify(mineMap)]
    );

    var updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:     true,
      gameId:      result.lastID || result.id,
      bet:         bet,
      risk:        risk,
      tilesPerRow: cfg.tiles,
      minesPerRow: cfg.mines,
      rows:        ROWS,
      multiplier:  1.0,
      newBalance:  updatedUser ? parseFloat(updatedUser.balance) : null,
    });
  } catch (err) {
    console.error('[Tower] POST /start error:', err.message);
    return res.status(500).json({ error: 'Failed to start Tower game' });
  }
});

// ── POST /step ──────────────────────────────────────────────────────────────

router.post('/step', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId    = req.user.id;
    var tileIndex = parseInt(req.body.tileIndex, 10);

    var game = await db.get(
      'SELECT * FROM tower_games WHERE user_id = ? AND status = \'active\' ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active Tower game' });

    var cfg = RISK_CONFIG[game.risk] || RISK_CONFIG.medium;
    if (isNaN(tileIndex) || tileIndex < 0 || tileIndex >= cfg.tiles) {
      return res.status(400).json({ error: 'tileIndex must be 0\u2013' + (cfg.tiles - 1) });
    }
    if (game.current_row >= ROWS) {
      return res.status(400).json({ error: 'Tower already completed' });
    }

    var mineMap   = JSON.parse(game.mine_map);
    var rowMines  = mineMap[game.current_row];
    var hitMine   = rowMines.indexOf(tileIndex) !== -1;

    if (hitMine) {
      await db.run('UPDATE tower_games SET status = \'busted\', payout = 0 WHERE id = ?', [game.id]);
      return res.json({
        success:    true,
        result:     'mine',
        row:        game.current_row,
        rowMines:   rowMines,
        allMineMap: mineMap,
        payout:     0,
        newBalance: null,
      });
    }

    // Safe — advance row
    var newRow = game.current_row + 1;
    var mult   = calcMultiplier(newRow, cfg);
    var payout = parseFloat((game.bet * mult).toFixed(2));

    // Auto-win: reached the top
    if (newRow >= ROWS) {
      await db.run(
        'UPDATE tower_games SET current_row = ?, status = \'won\', payout = ? WHERE id = ?',
        [newRow, payout, game.id]
      );
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      var profit = parseFloat((payout - game.bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, \'win\', ?, ?)',
          [userId, profit, 'Tower: summit! ' + mult.toFixed(2) + 'x (' + game.risk + ')']
        ).catch(function() {});
      }
      var topUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      return res.json({
        success:    true,
        result:     'safe',
        row:        newRow,
        rowMines:   rowMines,
        multiplier: mult,
        payout:     payout,
        gameOver:   true,
        autoWin:    true,
        newBalance: topUser ? parseFloat(topUser.balance) : null,
      });
    }

    await db.run('UPDATE tower_games SET current_row = ?, payout = ? WHERE id = ?', [newRow, payout, game.id]);
    return res.json({
      success:    true,
      result:     'safe',
      row:        newRow,
      rowMines:   rowMines,
      multiplier: mult,
      payout:     payout,
      gameOver:   false,
    });
  } catch (err) {
    console.error('[Tower] POST /step error:', err.message);
    return res.status(500).json({ error: 'Failed to step Tower game' });
  }
});

// ── POST /cashout ────────────────────────────────────────────────────────────

router.post('/cashout', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    var userId = req.user.id;
    var game   = await db.get(
      'SELECT * FROM tower_games WHERE user_id = ? AND status = \'active\' ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!game) return res.status(404).json({ error: 'No active Tower game' });
    if (game.current_row === 0) return res.status(400).json({ error: 'Must survive at least one row before cashing out' });

    var cfg    = RISK_CONFIG[game.risk] || RISK_CONFIG.medium;
    var mult   = calcMultiplier(game.current_row, cfg);
    var payout = parseFloat((game.bet * mult).toFixed(2));

    await db.run('UPDATE tower_games SET status = \'cashed_out\', payout = ? WHERE id = ?', [payout, game.id]);
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);

    var profit = parseFloat((payout - game.bet).toFixed(2));
    if (profit > 0) {
      await db.run(
        'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, \'win\', ?, ?)',
        [userId, profit, 'Tower: cashed out ' + mult.toFixed(2) + 'x (row ' + game.current_row + ')']
      ).catch(function() {});
    }

    var updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      payout:     payout,
      multiplier: mult,
      rowsCleared: game.current_row,
      newBalance: updatedUser ? parseFloat(updatedUser.balance) : null,
    });
  } catch (err) {
    console.error('[Tower] POST /cashout error:', err.message);
    return res.status(500).json({ error: 'Failed to cash out Tower game' });
  }
});

module.exports = router;
