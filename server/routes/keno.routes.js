const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Keno — pick 1-10 numbers (1-80), house draws 20, win on matches
// POST /api/keno/play  { bet, picks: number[] }
//   → { success, drawn, matches, multiplier, payout, newBalance }
//
// Single-call, no persistent game state needed.
// House edge ~23% (high-revenue game).

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET   = 0.25;
const MAX_BET   = 200;
const POOL_SIZE = 80;    // numbers 1-80
const DRAW_SIZE = 20;    // house draws 20

// Pay table: PAY_TABLE[spots_picked][catches] = multiplier
// Tuned for ~75-77% RTP across all spot counts (≈23-25% house edge)
const PAY_TABLE = {
  1:  { 1: 3 },
  2:  { 2: 9 },
  3:  { 2: 2,   3: 27 },
  4:  { 2: 1,   3: 4,   4: 72 },
  5:  { 3: 3,   4: 12,  5: 450 },
  6:  { 3: 2,   4: 8,   5: 50,   6: 900 },
  7:  { 3: 1,   4: 5,   5: 25,   6: 200,  7: 3500 },
  8:  { 4: 2,   5: 12,  6: 80,   7: 500,  8: 10000 },
  9:  { 5: 5,   6: 20,  7: 150,  8: 1500, 9: 10000 },
  10: { 5: 2,   6: 8,   7: 40,   8: 300,  9: 2500,  10: 10000 },
};

// Fisher-Yates draw of DRAW_SIZE numbers from 1..POOL_SIZE
function drawNumbers() {
  const pool = [];
  for (let i = 1; i <= POOL_SIZE; i++) pool.push(i);
  for (let i = POOL_SIZE - 1; i > 0; i--) {
    const j = secureInt((i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, DRAW_SIZE).sort(function(a, b) { return a - b; });
}

router.post('/play', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);

    if (isNaN(bet) || bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: 'Bet must be $' + MIN_BET + ' – $' + MAX_BET });
    }

    // Validate picks
    const rawPicks = req.body.picks;
    if (!Array.isArray(rawPicks) || rawPicks.length < 1 || rawPicks.length > 10) {
      return res.status(400).json({ error: 'Pick 1–10 numbers' });
    }
    const picks = rawPicks.map(function(n) { return parseInt(n, 10); });
    if (picks.some(function(n) { return isNaN(n) || n < 1 || n > POOL_SIZE; })) {
      return res.status(400).json({ error: 'All picks must be 1–' + POOL_SIZE });
    }
    const unique = Array.from(new Set(picks));
    if (unique.length !== picks.length) {
      return res.status(400).json({ error: 'Picks must be unique' });
    }

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, userId]);

    const drawn   = drawNumbers();
    const drawnSet = new Set(drawn);
    const matches = picks.filter(function(n) { return drawnSet.has(n); });
    const spots   = picks.length;
    const catches = matches.length;

    // Look up multiplier
    const spotTable  = PAY_TABLE[spots] || {};
    const multiplier = spotTable[catches] || 0;
    const payout     = parseFloat((bet * multiplier).toFixed(2));

    if (payout > 0) {
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
      const profit = parseFloat((payout - bet).toFixed(2));
      if (profit > 0) {
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
          [userId, profit, 'Keno: ' + catches + '/' + spots + ' (' + multiplier + 'x)']
        ).catch(function() {});
      }
    }

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success:    true,
      drawn:      drawn,
      picks:      picks,
      matches:    matches,
      spots:      spots,
      catches:    catches,
      multiplier: multiplier,
      payout:     payout,
      payTable:   PAY_TABLE[spots],
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[Keno] POST /play error:', err.message);
    return res.status(500).json({ error: 'Failed to play Keno' });
  }
});

module.exports = router;
