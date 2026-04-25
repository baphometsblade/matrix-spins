const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

db.run("ALTER TABLE users ADD COLUMN scratch_last_date TEXT DEFAULT NULL").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN scratch_result TEXT DEFAULT NULL").catch(function() {});

const SYMBOLS = ['💎', '⭐', '🍀', '🔔', '7️⃣', '💰'];

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function rand(min, max) {
  return secureInt((max - min + 1)) + min;
}

function generateResult() {
  // 9 tiles, 3x3
  var tiles = [];
  for (var i = 0; i < 9; i++) {
    var sym = SYMBOLS[secureInt(SYMBOLS.length)];
    tiles.push({ symbol: sym, index: i });
  }

  // Check wins: rows [0-2],[3-5],[6-8], cols [0,3,6],[1,4,7],[2,5,8], diags [0,4,8],[2,4,6]
  var lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];

  var bestMatch = 0;
  var matchSymbol = null;
  lines.forEach(function(line) {
    var syms = line.map(function(i) { return tiles[i].symbol; });
    if (syms[0] === syms[1] && syms[1] === syms[2]) {
      if (bestMatch < 3) { bestMatch = 3; matchSymbol = syms[0]; }
    } else if (syms[0] === syms[1] || syms[1] === syms[2] || syms[0] === syms[2]) {
      if (bestMatch < 2) { bestMatch = 2; matchSymbol = syms[0] === syms[1] ? syms[0] : syms[2]; }
    }
  });

  var prize;
  if (bestMatch === 3) {
    var gems = matchSymbol === '💎' ? rand(150, 200) : matchSymbol === '7️⃣' ? rand(120, 150) : rand(50, 100);
    prize = { type: 'gems', gems: gems, credits: 0, label: '🎉 3 MATCH! +' + gems + ' Gems!' };
  } else if (bestMatch === 2) {
    var g2 = rand(10, 25);
    prize = { type: 'gems_small', gems: g2, credits: 0, label: '✨ 2 Match! +' + g2 + ' Gems' };
  } else {
    prize = { type: 'consolation', gems: 5, credits: 0.10, label: '🎁 +5 Gems & $0.10 Credits' };
  }

  return { tiles: tiles, prize: prize };
}

// GET /api/scratchcard/today
router.get('/today', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var today = todayUTC();
    var row = await db.get('SELECT scratch_last_date, scratch_result FROM users WHERE id = ?', [userId]);
    if (!row) return res.json({ available: true, alreadyScratched: false, result: null });

    var alreadyScratched = (row.scratch_last_date === today);
    var result = null;
    if (alreadyScratched && row.scratch_result) {
      try { result = JSON.parse(row.scratch_result); } catch(e) {}
    }
    return res.json({ available: !alreadyScratched, alreadyScratched: alreadyScratched, result: result });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/scratchcard/scratch
router.post('/scratch', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;
    var today = todayUTC();
    var row = await db.get('SELECT scratch_last_date, balance FROM users WHERE id = ?', [userId]);
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (row.scratch_last_date === today) return res.status(400).json({ error: 'Already scratched today' });

    var result = generateResult();
    var prize = result.prize;

    // Award credits
    if (prize.credits > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [prize.credits, userId]);
    }

    // Award gems (safe — use transactions table if gems column missing)
    if (prize.gems > 0) {
      await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [prize.gems, userId])
        .catch(function() {});
    }

    // Record transaction
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'scratch_card', ?, ?)",
      [userId, prize.credits, 'Daily scratch card: ' + prize.label]
    ).catch(function() {});

    // Save result and mark scratched
    await db.run(
      'UPDATE users SET scratch_last_date = ?, scratch_result = ? WHERE id = ?',
      [today, JSON.stringify(result), userId]
    );

    var updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    var newBalance = updatedUser ? (updatedUser.balance || 0) : 0;

    return res.json({ success: true, tiles: result.tiles, prize: prize, newBalance: newBalance });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
