const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Keno Turbo — pick 1-10 numbers from 1-80, 20 balls drawn
// High house edge ~27%. Fast rounds, no waiting.
// Paytable keyed by [picks][hits] — returns payout multiplier (includes stake).
// 0 multiplier = lose stake.

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.25;
const MAX_BET  = 100;
const BALLS    = 80;
const DRAWN    = 20;

// Paytable: PAYTABLE[picks][hits] = payout multiplier on stake
// Designed for ~73% RTP (27% house edge)
const PAYTABLE = {
  1:  { 0: 0, 1: 3 },
  2:  { 0: 0, 1: 0, 2: 12 },
  3:  { 0: 0, 1: 0, 2: 2, 3: 42 },
  4:  { 0: 0, 1: 0, 2: 1, 3: 5, 4: 100 },
  5:  { 0: 0, 1: 0, 2: 0, 3: 3, 4: 12, 5: 750 },
  6:  { 0: 0, 1: 0, 2: 0, 3: 2, 4: 6,  5: 80,  6: 1500 },
  7:  { 0: 0, 1: 0, 2: 0, 3: 1, 4: 3,  5: 20,  6: 200,  7: 5000 },
  8:  { 0: 0, 1: 0, 2: 0, 3: 0, 4: 2,  5: 8,   6: 50,   7: 500,  8: 10000 },
  9:  { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1,  5: 4,   6: 20,   7: 100,  8: 2000, 9: 25000 },
  10: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0,  5: 2,   6: 10,   7: 50,   8: 500,  9: 5000, 10: 100000 },
};

// Draw 20 unique numbers from 1-80 (partial Fisher-Yates)
function drawBalls() {
  var pool = [];
  for (var i = 1; i <= BALLS; i++) pool.push(i);
  for (var j = 0; j < DRAWN; j++) {
    var k = j + secureInt((BALLS - j));
    var t = pool[j]; pool[j] = pool[k]; pool[k] = t;
  }
  return pool.slice(0, DRAWN).sort(function(a, b) { return a - b; });
}

// ── POST /play ────────────────────────────────────────────────────────────────

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    var bet   = parseFloat(req.body.bet);
    var picks = req.body.picks; // array of integers

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET)
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + '\u2013$' + MAX_BET });

    if (!Array.isArray(picks) || picks.length < 1 || picks.length > 10)
      return res.status(400).json({ error: 'Pick 1\u201310 numbers' });

    picks = picks.map(Number);
    if (picks.some(function(n) { return n < 1 || n > 80 || !Number.isInteger(n); }))
      return res.status(400).json({ error: 'Numbers must be integers 1\u201380' });
    if (new Set(picks).size !== picks.length)
      return res.status(400).json({ error: 'Duplicate numbers not allowed' });

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet)
      return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    var drawn   = drawBalls();
    var drawnSet = new Set(drawn);
    var hits    = picks.filter(function(n) { return drawnSet.has(n); }).length;
    var numPicks = picks.length;

    var table  = PAYTABLE[numPicks] || {};
    var mult   = table[hits] || 0;
    var payout = parseFloat((bet * mult).toFixed(2));
    var profit = parseFloat((payout - bet).toFixed(2));

    if (payout > 0)
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    if (profit > 0)
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Keno Turbo: ' + hits + '/' + numPicks + ' hits']
      ).catch(function() {});

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      drawn,
      picks,
      hits,
      mult,
      bet,
      payout,
      profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[KenoTurbo] /play error:', err.message);
    return res.status(500).json({ error: 'Play failed' });
  }
});

// ── GET /paytable ─────────────────────────────────────────────────────────────

router.get('/paytable', function(_req, res) {
  res.json({ paytable: PAYTABLE, balls: BALLS, drawn: DRAWN });
});

module.exports = router;
